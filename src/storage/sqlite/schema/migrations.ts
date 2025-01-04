/**
 * Schema migration management
 */
import { Database } from 'sqlite';
import { Logger } from '../../../logging/index.js';
import { ErrorCodes, createError } from '../../../errors/index.js';
import { EventManager } from '../../../events/event-manager.js';
import { EventTypes } from '../../../types/events.js';

export interface Migration {
  version: number;
  description: string;
  up: (db: Database) => Promise<void>;
  down: (db: Database) => Promise<void>;
}

export class SchemaManager {
  private readonly logger: Logger;
  private readonly eventManager: EventManager;
  private readonly migrations: Migration[] = [];

  constructor() {
    this.logger = Logger.getInstance().child({ component: 'SchemaManager' });
    this.eventManager = EventManager.getInstance();

    // Register migrations
    this.registerMigrations();
  }

  private registerMigrations(): void {
    // Migration 1: Initial schema
    this.migrations.push({
      version: 1,
      description: 'Initial schema',
      up: async (db: Database) => {
        // Create tables one at a time with error handling
        await db.exec('BEGIN IMMEDIATE');

        try {
          // Create schema_migrations table first
          await db.exec(`
                        CREATE TABLE IF NOT EXISTS schema_migrations (
                            version INTEGER PRIMARY KEY,
                            description TEXT NOT NULL,
                            applied_at INTEGER NOT NULL
                        )
                    `);

          // Create tasks table with proper column types
          await db.exec(`
                        CREATE TABLE IF NOT EXISTS tasks (
                            path TEXT PRIMARY KEY,
                            name TEXT NOT NULL,
                            description TEXT,
                            type TEXT NOT NULL CHECK(type IN ('TASK', 'GROUP', 'MILESTONE')),
                            status TEXT NOT NULL CHECK(status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED', 'CANCELLED')),
                            parent_path TEXT REFERENCES tasks(path) ON DELETE CASCADE,
                            notes TEXT,
                            reasoning TEXT,
                            dependencies TEXT CHECK(json_valid(COALESCE(dependencies, '[]'))),
                            subtasks TEXT CHECK(json_valid(COALESCE(subtasks, '[]'))),
                            metadata TEXT CHECK(json_valid(COALESCE(metadata, '{}'))),
                            created_at INTEGER NOT NULL,
                            updated_at INTEGER NOT NULL
                        )
                    `);

          // Create indexes with proper syntax
          await db.exec(
            `CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_path) WHERE parent_path IS NOT NULL`
          );
          await db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`);
          await db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type)`);

          await db.exec('COMMIT');
        } catch (error) {
          await db.exec('ROLLBACK');
          throw error;
        }
      },
      down: async (db: Database) => {
        await db.exec(`
                    DROP TABLE IF EXISTS tasks;
                    DROP TABLE IF EXISTS schema_migrations;
                `);
      },
    });

    // Migration 2: Add indexes for performance
    this.migrations.push({
      version: 2,
      description: 'Add performance indexes',
      up: async (db: Database) => {
        await db.exec(`
                    CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);
                    CREATE INDEX IF NOT EXISTS idx_tasks_updated ON tasks(updated_at);
                    CREATE INDEX IF NOT EXISTS idx_tasks_dependencies ON tasks(dependencies) WHERE json_array_length(dependencies) > 0;
                `);
      },
      down: async (db: Database) => {
        await db.exec(`
                    DROP INDEX IF EXISTS idx_tasks_created;
                    DROP INDEX IF EXISTS idx_tasks_updated;
                    DROP INDEX IF EXISTS idx_tasks_dependencies;
                `);
      },
    });
  }

  /**
   * Apply pending migrations
   */
  async applyMigrations(db: Database): Promise<void> {
    try {
      // Ensure migrations table exists
      await db.exec(`
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version INTEGER PRIMARY KEY,
                    description TEXT NOT NULL,
                    applied_at INTEGER NOT NULL
                );
            `);

      // Get current version
      const result = await db.get<{ version: number }>(
        'SELECT MAX(version) as version FROM schema_migrations'
      );
      const currentVersion = result?.version || 0;

      // Apply pending migrations
      for (const migration of this.migrations) {
        if (migration.version > currentVersion) {
          this.logger.info('Applying migration', {
            version: migration.version,
            description: migration.description,
          });

          await db.run('BEGIN IMMEDIATE');
          try {
            await migration.up(db);
            await db.run(
              'INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?)',
              migration.version,
              migration.description,
              Date.now()
            );
            await db.run('COMMIT');

            // Emit migration event
            this.eventManager.emitSystemEvent({
              type: EventTypes.SYSTEM_STARTUP,
              timestamp: Date.now(),
              metadata: {
                component: 'SchemaManager',
                operation: 'migration',
                version: String(migration.version),
                reason: migration.description,
              },
            });
          } catch (error) {
            await db.run('ROLLBACK');
            throw error;
          }
        }
      }

      this.logger.info('Schema migrations complete', {
        fromVersion: currentVersion,
        toVersion: this.migrations[this.migrations.length - 1]?.version || currentVersion,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to apply migrations', { error: errorMessage });
      throw createError(ErrorCodes.STORAGE_INIT, 'Failed to apply migrations', errorMessage);
    }
  }

  /**
   * Rollback migrations to a specific version
   */
  async rollbackTo(db: Database, targetVersion: number): Promise<void> {
    try {
      // Get current version
      const result = await db.get<{ version: number }>(
        'SELECT MAX(version) as version FROM schema_migrations'
      );
      const currentVersion = result?.version || 0;

      if (targetVersion >= currentVersion) {
        return;
      }

      // Apply rollbacks in reverse order
      for (let i = this.migrations.length - 1; i >= 0; i--) {
        const migration = this.migrations[i];
        if (migration.version > targetVersion && migration.version <= currentVersion) {
          this.logger.info('Rolling back migration', {
            version: migration.version,
            description: migration.description,
          });

          await db.run('BEGIN IMMEDIATE');
          try {
            await migration.down(db);
            await db.run('DELETE FROM schema_migrations WHERE version = ?', migration.version);
            await db.run('COMMIT');

            // Emit rollback event
            this.eventManager.emitSystemEvent({
              type: EventTypes.SYSTEM_STARTUP,
              timestamp: Date.now(),
              metadata: {
                component: 'SchemaManager',
                operation: 'rollback',
                version: String(migration.version),
                reason: migration.description,
              },
            });
          } catch (error) {
            await db.run('ROLLBACK');
            throw error;
          }
        }
      }

      this.logger.info('Schema rollback complete', {
        fromVersion: currentVersion,
        toVersion: targetVersion,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to rollback migrations', { error: errorMessage });
      throw createError(ErrorCodes.STORAGE_ERROR, 'Failed to rollback migrations', errorMessage);
    }
  }

  /**
   * Get current schema version
   */
  async getCurrentVersion(db: Database): Promise<number> {
    const result = await db.get<{ version: number }>(
      'SELECT MAX(version) as version FROM schema_migrations'
    );
    return result?.version || 0;
  }

  /**
   * Get migration history
   */
  async getMigrationHistory(db: Database): Promise<
    Array<{
      version: number;
      description: string;
      appliedAt: number;
    }>
  > {
    return db.all(`
            SELECT version, description, applied_at as appliedAt
            FROM schema_migrations
            ORDER BY version DESC
        `);
  }
}
