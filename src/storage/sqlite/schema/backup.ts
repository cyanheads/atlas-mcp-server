/**
 * Database backup and recovery system
 */
import { Database } from 'sqlite';
import { Logger } from '../../../logging/index.js';
import { ErrorCodes, createError } from '../../../errors/index.js';
import { promises as fs } from 'fs';
import { join, basename } from 'path';
import { PlatformCapabilities } from '../../../utils/platform-utils.js';

export interface BackupMetadata {
  timestamp: number;
  version: number;
  size: number;
  checksum: string;
  comment?: string;
}

export interface BackupOptions {
  compress?: boolean;
  vacuum?: boolean;
  comment?: string;
}

export interface RestoreOptions {
  force?: boolean;
  verify?: boolean;
}

export class BackupManager {
  private readonly logger: Logger;
  private readonly backupDir: string;
  private readonly maxBackups: number;

  constructor(options: { backupDir: string; maxBackups?: number }) {
    this.logger = Logger.getInstance().child({ component: 'BackupManager' });
    this.backupDir = options.backupDir;
    this.maxBackups = options.maxBackups || 10;
  }

  /**
   * Initialize backup system
   */
  async initialize(): Promise<void> {
    try {
      // Create backup directory if it doesn't exist with platform-appropriate permissions
      await fs.mkdir(this.backupDir, {
        recursive: true,
        mode: PlatformCapabilities.getFileMode(0o755),
      });

      // Verify backup directory is writable
      await fs.access(this.backupDir, fs.constants.W_OK);

      this.logger.info('Backup system initialized', {
        backupDir: this.backupDir,
        maxBackups: this.maxBackups,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to initialize backup system', { error: errorMessage });
      throw createError(
        ErrorCodes.STORAGE_INIT,
        'Failed to initialize backup system',
        errorMessage
      );
    }
  }

  /**
   * Create a backup
   */
  async createBackup(db: Database, dbPath: string, options: BackupOptions = {}): Promise<string> {
    const timestamp = Date.now();
    const backupName = `backup_${timestamp}.db`;
    const backupPath = join(this.backupDir, backupName);

    try {
      // Ensure database is in a consistent state
      await db.run('PRAGMA wal_checkpoint(TRUNCATE)');

      // Vacuum database if requested
      if (options.vacuum) {
        await db.run('VACUUM');
      }

      // Create backup
      await this.copyDatabase(dbPath, backupPath);

      // Calculate checksum
      const checksum = await this.calculateChecksum(backupPath);

      // Save metadata
      const metadata: BackupMetadata = {
        timestamp,
        version: await this.getCurrentVersion(db),
        size: (await fs.stat(backupPath)).size,
        checksum,
        comment: options.comment,
      };
      await this.saveMetadata(backupName, metadata);

      // Compress if requested
      if (options.compress) {
        await this.compressBackup(backupPath);
      }

      // Clean up old backups
      await this.cleanupOldBackups();

      this.logger.info('Backup created successfully', {
        backup: backupName,
        size: metadata.size,
        compressed: options.compress,
      });

      return backupPath;
    } catch (error) {
      // Clean up failed backup
      try {
        await fs.unlink(backupPath);
      } catch {
        // Ignore cleanup errors
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to create backup', { error: errorMessage });
      throw createError(ErrorCodes.STORAGE_ERROR, 'Failed to create backup', errorMessage);
    }
  }

  /**
   * Restore from backup
   */
  async restoreBackup(
    db: Database,
    dbPath: string,
    backupPath: string,
    options: RestoreOptions = {}
  ): Promise<void> {
    try {
      // Verify backup exists
      await fs.access(backupPath);

      // Get backup metadata
      const backupName = basename(backupPath);
      const metadata = await this.getMetadata(backupName);

      if (!metadata) {
        throw new Error('Backup metadata not found');
      }

      // Verify backup if requested
      if (options.verify) {
        const checksum = await this.calculateChecksum(backupPath);
        if (checksum !== metadata.checksum) {
          throw new Error('Backup checksum verification failed');
        }
      }

      // Close database connection
      await db.close();

      // Create backup of current database
      const currentBackupPath = `${dbPath}.bak`;
      await this.copyDatabase(dbPath, currentBackupPath);

      try {
        // Restore backup
        await this.copyDatabase(backupPath, dbPath);

        this.logger.info('Backup restored successfully', {
          backup: backupName,
          version: metadata.version,
        });
      } catch (error) {
        // Restore failed, revert to original
        await this.copyDatabase(currentBackupPath, dbPath);
        throw error;
      } finally {
        // Clean up temporary backup
        try {
          await fs.unlink(currentBackupPath);
        } catch {
          // Ignore cleanup errors
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to restore backup', { error: errorMessage });
      throw createError(ErrorCodes.STORAGE_ERROR, 'Failed to restore backup', errorMessage);
    }
  }

  /**
   * List available backups
   */
  async listBackups(): Promise<
    {
      name: string;
      metadata: BackupMetadata;
    }[]
  > {
    try {
      const files = await fs.readdir(this.backupDir);
      const backups = [];

      for (const file of files) {
        if (file.startsWith('backup_') && file.endsWith('.db')) {
          const metadata = await this.getMetadata(file);
          if (metadata) {
            backups.push({ name: file, metadata });
          }
        }
      }

      return backups.sort((a, b) => b.metadata.timestamp - a.metadata.timestamp);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to list backups', { error: errorMessage });
      throw createError(ErrorCodes.STORAGE_ERROR, 'Failed to list backups', errorMessage);
    }
  }

  /**
   * Delete a backup
   */
  async deleteBackup(backupName: string): Promise<void> {
    try {
      const backupPath = join(this.backupDir, backupName);
      await fs.unlink(backupPath);

      // Delete metadata
      const metadataPath = `${backupPath}.meta`;
      try {
        await fs.unlink(metadataPath);
      } catch {
        // Ignore metadata deletion errors
      }

      this.logger.info('Backup deleted', { backup: backupName });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to delete backup', { error: errorMessage });
      throw createError(ErrorCodes.STORAGE_ERROR, 'Failed to delete backup', errorMessage);
    }
  }

  private async getCurrentVersion(db: Database): Promise<number> {
    const result = await db.get<{ version: number }>(
      'SELECT MAX(version) as version FROM migrations'
    );
    return result?.version || 0;
  }

  private async copyDatabase(source: string, destination: string): Promise<void> {
    // Handle file locking in a platform-agnostic way
    try {
      await fs.access(destination);
      // If destination exists, ensure it's not locked
      await fs.unlink(destination).catch(() => {});
    } catch (error) {
      // Ignore if destination doesn't exist
    }
    await fs.copyFile(source, destination);
  }

  private async calculateChecksum(filePath: string): Promise<string> {
    const { createHash } = await import('crypto');
    const content = await fs.readFile(filePath);
    return createHash('sha256').update(content).digest('hex');
  }

  private async saveMetadata(backupName: string, metadata: BackupMetadata): Promise<void> {
    const metadataPath = join(this.backupDir, `${backupName}.meta`);
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  }

  private async getMetadata(backupName: string): Promise<BackupMetadata | null> {
    try {
      const metadataPath = join(this.backupDir, `${backupName}.meta`);
      const content = await fs.readFile(metadataPath, 'utf8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  private async compressBackup(backupPath: string): Promise<void> {
    const { gzip } = await import('zlib');
    const { promisify } = await import('util');
    const gzipAsync = promisify(gzip);

    const content = await fs.readFile(backupPath);
    const compressed = await gzipAsync(content);
    await fs.writeFile(`${backupPath}.gz`, compressed);
    await fs.unlink(backupPath);
  }

  private async cleanupOldBackups(): Promise<void> {
    const backups = await this.listBackups();

    if (backups.length > this.maxBackups) {
      // Keep newest backups, delete oldest
      const toDelete = backups.slice(this.maxBackups);
      for (const backup of toDelete) {
        await this.deleteBackup(backup.name);
      }
    }
  }
}
