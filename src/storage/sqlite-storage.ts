/**
 * SQLite storage implementation
 */
import { Database, open } from 'sqlite';
import { Task, TaskStatus } from '../types/task.js';
import { StorageConfig, TaskStorage, StorageMetrics, CacheStats } from '../types/storage.js';
import { Logger } from '../logging/index.js';
import { ErrorCodes, createError } from '../errors/index.js';
import { ConnectionManager } from './connection-manager.js';
import { globToSqlPattern } from '../utils/pattern-matcher.js';

interface CacheEntry {
    task: Task;
    timestamp: number;
    hits: number;
}

export class SqliteStorage implements TaskStorage {
    private db: Database | null = null;
    private readonly logger: Logger;
    private readonly config: StorageConfig;
    private readonly connectionManager: ConnectionManager;
    private readonly cache: Map<string, CacheEntry> = new Map();
    private readonly MAX_CACHE_SIZE = 1000;
    private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    private cacheHits = 0;
    private cacheMisses = 0;

    constructor(config: StorageConfig) {
        this.config = config;
        this.logger = Logger.getInstance().child({ component: 'SqliteStorage' });
        this.connectionManager = new ConnectionManager(config.connection);
    }

    async initialize(): Promise<void> {
        const dbPath = `${this.config.baseDir}/${this.config.name}.db`;
        this.logger.debug('Opening SQLite database', { dbPath });

        try {
            // Import required modules
            const fs = await import('fs/promises');
            const path = await import('path');
            
            // Ensure storage directory exists with proper permissions
            await fs.mkdir(path.dirname(dbPath), { recursive: true, mode: 0o750 });
            this.logger.debug('Storage directory created/verified', { path: path.dirname(dbPath) });

            // Import sqlite3 with verbose mode for better error messages
            const sqlite3 = (await import('sqlite3')).default;
            this.logger.debug('SQLite3 module imported');

            // Initialize database with retry support
            await this.connectionManager.executeWithRetry(async () => {
                try {
                    // Initialize database with promise interface
                    this.db = await open({
                        filename: dbPath,
                        driver: sqlite3.Database,
                        mode: sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE
                    });
                    this.logger.debug('Database opened successfully');
                } catch (err) {
                    this.logger.error('Failed to open database', {
                        error: err instanceof Error ? {
                            name: err.name,
                            message: err.message,
                            stack: err.stack,
                            code: (err as any).code,
                            errno: (err as any).errno
                        } : err
                    });
                    throw err;
                }

                // Set busy timeout
                await this.db.run(`PRAGMA busy_timeout = ${this.config.connection?.busyTimeout || 5000}`);

                // Enable extended error codes
                await this.db.run('PRAGMA extended_result_codes = ON');

                // Configure database
                if (this.config.performance) {
                    await this.db.exec(`
                        PRAGMA cache_size=${this.config.performance.cacheSize || 2000};
                        PRAGMA mmap_size=${this.config.performance.mmapSize || 30000000000};
                        PRAGMA page_size=${this.config.performance.pageSize || 4096};
                        PRAGMA journal_mode=WAL;
                        PRAGMA synchronous=NORMAL;
                        PRAGMA temp_store=MEMORY;
                        PRAGMA foreign_keys=ON;
                        PRAGMA busy_timeout=${this.config.connection?.busyTimeout || 5000};
                    `);
                }
            }, 'initialize');

            await this.setupDatabase();
            this.logger.info('SQLite storage initialized', { path: this.config.baseDir });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const errorDetails = {
                error: error instanceof Error ? {
                    stack: error.stack,
                    ...error,
                    // Ensure custom properties don't get overwritten
                    customProps: Object.getOwnPropertyNames(error).reduce((acc, key) => {
                        if (key !== 'name' && key !== 'message' && key !== 'stack') {
                            acc[key] = (error as any)[key];
                        }
                        return acc;
                    }, {} as Record<string, unknown>)
                } : error,
                config: {
                    baseDir: this.config.baseDir,
                    name: this.config.name,
                    dbPath: `${this.config.baseDir}/${this.config.name}.db`
                }
            };
            
            this.logger.error('Failed to initialize SQLite storage', errorDetails);
            
            // Try to get more details about the SQLite error
            if (error instanceof Error && 'code' in error) {
                this.logger.error('SQLite error details', {
                    code: (error as any).code,
                    errno: (error as any).errno,
                    syscall: (error as any).syscall
                });
            }
            
            throw createError(
                ErrorCodes.STORAGE_INIT,
                'Failed to initialize SQLite storage',
                `${errorMessage} - Details: ${JSON.stringify(errorDetails, null, 2)}`
            );
        }
    }

    private async setupDatabase(): Promise<void> {
        if (!this.db) {
            throw createError(
                ErrorCodes.STORAGE_ERROR,
                'Database not initialized'
            );
        }

        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS tasks (
                path TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                type TEXT NOT NULL,
                status TEXT NOT NULL,
                parent_path TEXT,
                notes TEXT,
                reasoning TEXT,
                dependencies TEXT,
                subtasks TEXT,
                metadata TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_path);
            CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
            CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type);
        `);
    }

    async saveTask(task: Task): Promise<void> {
        await this.saveTasks([task]);
    }

    async saveTasks(tasks: Task[]): Promise<void> {
        if (!this.db) {
            throw createError(
                ErrorCodes.STORAGE_ERROR,
                'Database not initialized'
            );
        }

        try {
            await this.db.run('BEGIN TRANSACTION');

            // First pass: collect all parent paths to load existing parents
            const parentPaths = new Set<string>();
            for (const task of tasks) {
                if (task.parentPath) {
                    parentPaths.add(task.parentPath);
                }
            }

            // Load existing parents
            const existingParents = new Map<string, Task>();
            if (parentPaths.size > 0) {
                const placeholders = Array(parentPaths.size).fill('?').join(',');
                const rows = await this.db.all<Record<string, unknown>[]>(
                    `SELECT * FROM tasks WHERE path IN (${placeholders})`,
                    Array.from(parentPaths)
                );
                for (const row of rows) {
                    const parent = this.rowToTask(row);
                    existingParents.set(parent.path, parent);
                }
            }

            // Second pass: update parent-child relationships
            for (const task of tasks) {
                if (task.parentPath) {
                    let parent = existingParents.get(task.parentPath);
                    if (parent) {
                        // Update parent's subtasks array if needed
                        if (!parent.subtasks.includes(task.path)) {
                            parent.subtasks = [...parent.subtasks, task.path];
                            existingParents.set(parent.path, parent);
                            tasks.push(parent); // Add parent to tasks to be saved
                        }
                    }
                }
            }

            // Save all tasks with updated relationships
            for (const task of tasks) {
                await this.db.run(
                    `INSERT OR REPLACE INTO tasks (
                        path, name, description, type, status,
                        parent_path, notes, reasoning, dependencies,
                        subtasks, metadata, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    task.path,
                    task.name,
                    task.description,
                    task.type,
                    task.status,
                    task.parentPath,
                    task.notes ? JSON.stringify(task.notes) : null,
                    task.reasoning,
                    JSON.stringify(task.dependencies),
                    JSON.stringify(task.subtasks),
                    JSON.stringify(task.metadata),
                    task.metadata.created,
                    task.metadata.updated
                );
            }

            await this.db.run('COMMIT');
        } catch (error) {
            await this.db.run('ROLLBACK');
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error('Failed to save tasks', { error: errorMessage, tasks });
            throw createError(
                ErrorCodes.STORAGE_WRITE,
                'Failed to save tasks',
                errorMessage
            );
        }
    }

    /**
     * Implements CacheManager.clearCache
     */
    async clearCache(): Promise<void> {
        this.cache.clear();
        this.cacheHits = 0;
        this.cacheMisses = 0;
        this.logger.debug('Cache cleared');
    }

    /**
     * Implements CacheManager.getCacheStats
     */
    async getCacheStats(): Promise<CacheStats> {
        const totalRequests = this.cacheHits + this.cacheMisses;
        return {
            size: this.cache.size,
            hitRate: totalRequests > 0 ? this.cacheHits / totalRequests : 0,
            memoryUsage: process.memoryUsage().heapUsed
        };
    }

    /**
     * Gets a task from cache or database
     */
    async getTask(path: string): Promise<Task | null> {
        // Check cache first
        const cached = this.cache.get(path);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
            cached.hits++;
            this.cacheHits++;
            return cached.task;
        }
        this.cacheMisses++;

        if (!this.db) {
            throw createError(
                ErrorCodes.STORAGE_ERROR,
                'Database not initialized'
            );
        }

        try {
            const row = await this.db.get<Record<string, unknown>>(
                'SELECT * FROM tasks WHERE path = ?',
                path
            );

            if (!row) {
                return null;
            }

            const task = this.rowToTask(row);
            
            // Add to cache with LRU eviction
            if (this.cache.size >= this.MAX_CACHE_SIZE) {
                // Find least recently used entry
                let oldestTime = Date.now();
                let oldestKey = '';
                for (const [key, entry] of this.cache.entries()) {
                    if (entry.timestamp < oldestTime) {
                        oldestTime = entry.timestamp;
                        oldestKey = key;
                    }
                }
                this.cache.delete(oldestKey);
            }
            
            this.cache.set(path, {
                task,
                timestamp: Date.now(),
                hits: 1
            });

            return task;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error('Failed to get task', { error: errorMessage, path });
            throw createError(
                ErrorCodes.STORAGE_READ,
                'Failed to get task',
                errorMessage
            );
        }
    }

    async getTasks(paths: string[]): Promise<Task[]> {
        if (!this.db) {
            throw createError(
                ErrorCodes.STORAGE_ERROR,
                'Database not initialized'
            );
        }

        try {
            const placeholders = paths.map(() => '?').join(',');
            const rows = await this.db.all<Record<string, unknown>[]>(
                `SELECT * FROM tasks WHERE path IN (${placeholders})`,
                ...paths
            );

            return rows.map(row => this.rowToTask(row));
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error('Failed to get tasks', { error: errorMessage, paths });
            throw createError(
                ErrorCodes.STORAGE_READ,
                'Failed to get tasks',
                errorMessage
            );
        }
    }

    async getTasksByPattern(pattern: string): Promise<Task[]> {
        if (!this.db) {
            throw createError(
                ErrorCodes.STORAGE_ERROR,
                'Database not initialized'
            );
        }

        try {
            // Convert glob pattern to SQL pattern
            const sqlPattern = globToSqlPattern(pattern);

            this.logger.debug('Converting glob pattern to SQL', {
                original: pattern,
                sql: sqlPattern
            });

            // Use both GLOB and LIKE for better pattern matching
            const rows = await this.db.all<Record<string, unknown>[]>(
                `SELECT * FROM tasks WHERE 
                 path GLOB ? OR 
                 path LIKE ? OR
                 path LIKE ?`,
                sqlPattern,
                sqlPattern,
                // Add recursive matching for **
                pattern.includes('**') ? `${sqlPattern}/%` : sqlPattern
            );

            return rows.map(row => this.rowToTask(row));
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error('Failed to get tasks by pattern', { error: errorMessage, pattern });
            throw createError(
                ErrorCodes.STORAGE_READ,
                'Failed to get tasks by pattern',
                errorMessage
            );
        }
    }

    async getTasksByStatus(status: TaskStatus): Promise<Task[]> {
        if (!this.db) {
            throw createError(
                ErrorCodes.STORAGE_ERROR,
                'Database not initialized'
            );
        }

        try {
            const rows = await this.db.all<Record<string, unknown>[]>(
                'SELECT * FROM tasks WHERE status = ?',
                status
            );

            return rows.map(row => this.rowToTask(row));
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error('Failed to get tasks by status', { error: errorMessage, status });
            throw createError(
                ErrorCodes.STORAGE_READ,
                'Failed to get tasks by status',
                errorMessage
            );
        }
    }

    async getSubtasks(parentPath: string): Promise<Task[]> {
        if (!this.db) {
            throw createError(
                ErrorCodes.STORAGE_ERROR,
                'Database not initialized'
            );
        }

        try {
            // Get the parent task first
            const parent = await this.getTask(parentPath);
            if (!parent) {
                return [];
            }

            // Get tasks that have this parent path
            const rows = await this.db.all<Record<string, unknown>[]>(
                `SELECT * FROM tasks WHERE parent_path = ?`,
                parentPath
            );

            // Convert rows to tasks
            const tasks = rows.map(row => this.rowToTask(row));

            // Ensure consistency - update any tasks that have this parent
            // but aren't in the parent's subtasks array
            const needsUpdate = tasks.some(task => 
                task.parentPath === parentPath && !parent.subtasks.includes(task.path)
            );

            if (needsUpdate) {
                parent.subtasks = Array.from(new Set([
                    ...parent.subtasks,
                    ...tasks.filter(t => t.parentPath === parentPath).map(t => t.path)
                ]));
                await this.saveTask(parent);
            }

            return tasks;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error('Failed to get subtasks', { error: errorMessage, parentPath });
            throw createError(
                ErrorCodes.STORAGE_READ,
                'Failed to get subtasks',
                errorMessage
            );
        }
    }

    async deleteTask(path: string): Promise<void> {
        await this.deleteTasks([path]);
    }

    async deleteTasks(paths: string[]): Promise<void> {
        if (!this.db) {
            throw createError(
                ErrorCodes.STORAGE_ERROR,
                'Database not initialized'
            );
        }

        try {
            await this.db.run('BEGIN TRANSACTION');

            // Get all tasks that need to be deleted using recursive CTE
            const placeholders = paths.map(() => '?').join(',');
            const rows = await this.db.all<Record<string, unknown>[]>(
                `WITH RECURSIVE task_tree AS (
                    -- Base case: tasks with paths in the input list
                    SELECT path, parent_path, json_extract(subtasks, '$') as subtasks
                    FROM tasks 
                    WHERE path IN (${placeholders})
                    
                    UNION ALL
                    
                    -- Recursive case 1: tasks with parent_path matching any task in tree
                    SELECT t.path, t.parent_path, json_extract(t.subtasks, '$')
                    FROM tasks t
                    JOIN task_tree tt ON t.parent_path = tt.path
                    
                    UNION ALL
                    
                    -- Recursive case 2: tasks listed in subtasks array of any task in tree
                    SELECT t.path, t.parent_path, json_extract(t.subtasks, '$')
                    FROM tasks t
                    JOIN task_tree tt ON json_each.value = t.path
                    JOIN json_each(tt.subtasks)
                )
                SELECT DISTINCT path FROM task_tree`,
                ...paths
            );

            const allPaths = rows.map(row => String(row.path));
            this.logger.debug('Found tasks to delete', { 
                inputPaths: paths,
                foundPaths: allPaths 
            });

            // Get all tasks before deletion for proper cleanup
            const tasksToDelete = await Promise.all(
                allPaths.map(path => this.getTask(path))
            );
            const validTasksToDelete = tasksToDelete.filter((t): t is Task => t !== null);

            // Find all parent paths that need updating
            const parentsToUpdate = new Set(
                validTasksToDelete
                    .filter(t => t.parentPath)
                    .map(t => t.parentPath as string)
            );

            // Update parent tasks' subtasks arrays
            for (const parentPath of parentsToUpdate) {
                const parent = await this.getTask(parentPath);
                if (parent && !allPaths.includes(parent.path)) {
                    parent.subtasks = parent.subtasks.filter(p => !allPaths.includes(p));
                    await this.saveTask(parent);
                }
            }

            // Delete all tasks and their descendants
            if (allPaths.length > 0) {
                const deletePlaceholders = allPaths.map(() => '?').join(',');
                await this.db.run(
                    `DELETE FROM tasks WHERE path IN (${deletePlaceholders})`,
                    ...allPaths
                );
            }

            await this.db.run('COMMIT');

            this.logger.debug('Tasks deleted with descendants', {
                inputPaths: paths,
                deletedPaths: allPaths
            });
        } catch (error) {
            await this.db.run('ROLLBACK');
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error('Failed to delete tasks', { error: errorMessage, paths });
            throw createError(
                ErrorCodes.STORAGE_DELETE,
                'Failed to delete tasks',
                errorMessage
            );
        }
    }

    async vacuum(): Promise<void> {
        if (!this.db) {
            throw createError(
                ErrorCodes.STORAGE_ERROR,
                'Database not initialized'
            );
        }

        try {
            await this.db.run('VACUUM');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error('Failed to vacuum database', { error: errorMessage });
            throw createError(
                ErrorCodes.STORAGE_ERROR,
                'Failed to vacuum database',
                errorMessage
            );
        }
    }

    async analyze(): Promise<void> {
        if (!this.db) {
            throw createError(
                ErrorCodes.STORAGE_ERROR,
                'Database not initialized'
            );
        }

        try {
            await this.db.run('ANALYZE');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error('Failed to analyze database', { error: errorMessage });
            throw createError(
                ErrorCodes.STORAGE_ERROR,
                'Failed to analyze database',
                errorMessage
            );
        }
    }

    async checkpoint(): Promise<void> {
        if (!this.db) {
            throw createError(
                ErrorCodes.STORAGE_ERROR,
                'Database not initialized'
            );
        }

        try {
            await this.db.run('PRAGMA wal_checkpoint(TRUNCATE)');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error('Failed to checkpoint database', { error: errorMessage });
            throw createError(
                ErrorCodes.STORAGE_ERROR,
                'Failed to checkpoint database',
                errorMessage
            );
        }
    }

    async getMetrics(): Promise<StorageMetrics & {
        cache?: CacheStats;
        memory?: {
            heapUsed: number;
            heapTotal: number;
            rss: number;
        };
    }> {
        if (!this.db) {
            throw createError(
                ErrorCodes.STORAGE_ERROR,
                'Database not initialized'
            );
        }

        try {
            const [taskStats, storageStats] = await Promise.all([
                this.db.get<Record<string, unknown>>(`
                    SELECT 
                        COUNT(*) as total,
                        SUM(CASE WHEN notes IS NOT NULL THEN 1 ELSE 0 END) as noteCount,
                        SUM(CASE WHEN dependencies IS NOT NULL THEN json_array_length(dependencies) ELSE 0 END) as dependencyCount,
                        json_group_object(status, COUNT(*)) as byStatus
                    FROM tasks
                `),
                this.db.get<Record<string, unknown>>(`
                    SELECT 
                        page_count * page_size as totalSize,
                        page_size,
                        page_count,
                        (SELECT page_count * page_size FROM pragma_wal_checkpoint) as wal_size
                    FROM pragma_page_count, pragma_page_size
                `)
            ]);

            const memUsage = process.memoryUsage();
            const cacheStats = await this.getCacheStats();

            return {
                tasks: {
                    total: Number(taskStats?.total || 0),
                    byStatus: this.parseJSON(String(taskStats?.byStatus || '{}'), {}),
                    noteCount: Number(taskStats?.noteCount || 0),
                    dependencyCount: Number(taskStats?.dependencyCount || 0)
                },
                storage: {
                    totalSize: Number(storageStats?.totalSize || 0),
                    pageSize: Number(storageStats?.page_size || 0),
                    pageCount: Number(storageStats?.page_count || 0),
                    walSize: Number(storageStats?.wal_size || 0),
                    cache: {
                        hitRate: cacheStats.hitRate,
                        memoryUsage: cacheStats.memoryUsage,
                        entryCount: this.cache.size
                    }
                },
                cache: cacheStats,
                memory: {
                    heapUsed: memUsage.heapUsed,
                    heapTotal: memUsage.heapTotal,
                    rss: memUsage.rss
                }
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error('Failed to get storage metrics', { error: errorMessage });
            throw createError(
                ErrorCodes.STORAGE_ERROR,
                'Failed to get storage metrics',
                errorMessage
            );
        }
    }

    private parseJSON<T>(value: string | null | undefined, defaultValue: T): T {
        if (!value) return defaultValue;
        try {
            return JSON.parse(value) as T;
        } catch {
            return defaultValue;
        }
    }

    private rowToTask(row: Record<string, unknown>): Task {
        return {
            path: String(row.path || ''),
            name: String(row.name || ''),
            description: row.description ? String(row.description) : undefined,
            type: String(row.type || '') as Task['type'],
            status: String(row.status || '') as Task['status'],
            parentPath: row.parent_path ? String(row.parent_path) : undefined,
            notes: this.parseJSON<string[]>(String(row.notes || '[]'), []),
            reasoning: row.reasoning ? String(row.reasoning) : undefined,
            dependencies: this.parseJSON<string[]>(String(row.dependencies || '[]'), []),
            subtasks: this.parseJSON<string[]>(String(row.subtasks || '[]'), []),
            metadata: this.parseJSON(String(row.metadata || '{}'), {
                created: Date.now(),
                updated: Date.now(),
                projectPath: String(row.path || '').split('/')[0],
                version: 1
            })
        };
    }

    /**
     * Clears all tasks from the database
     */
    async clearAllTasks(): Promise<void> {
        if (!this.db) {
            throw createError(
                ErrorCodes.STORAGE_ERROR,
                'Database not initialized'
            );
        }

        try {
            await this.db.run('BEGIN TRANSACTION');
            await this.db.run('DELETE FROM tasks');
            await this.db.run('COMMIT');
            this.logger.info('All tasks cleared from database');
        } catch (error) {
            await this.db.run('ROLLBACK');
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error('Failed to clear tasks', { error: errorMessage });
            throw createError(
                ErrorCodes.STORAGE_DELETE,
                'Failed to clear tasks',
                errorMessage
            );
        }
    }

    /**
     * Repairs parent-child relationships
     */
    async repairRelationships(dryRun: boolean = false): Promise<{ fixed: number, issues: string[] }> {
        if (!this.db) {
            throw createError(
                ErrorCodes.STORAGE_ERROR,
                'Database not initialized'
            );
        }

        const issues: string[] = [];
        let fixCount = 0;

        try {
            // Start transaction if not dry run
            if (!dryRun) {
                await this.db.run('BEGIN TRANSACTION');
            }

            // Find tasks with invalid parent paths
            const orphanedTasks = await this.db.all<Record<string, unknown>[]>(
                `SELECT t1.path, t1.parent_path 
                 FROM tasks t1 
                 LEFT JOIN tasks t2 ON t1.parent_path = t2.path 
                 WHERE t1.parent_path IS NOT NULL 
                 AND t2.path IS NULL`
            );

            for (const task of orphanedTasks) {
                issues.push(`Task ${task.path} has invalid parent_path: ${task.parent_path}`);
                if (!dryRun) {
                    await this.db.run(
                        'UPDATE tasks SET parent_path = NULL WHERE path = ?',
                        task.path
                    );
                    fixCount++;
                }
            }

            // Find inconsistencies between parent_path and subtasks
            const rows = await this.db.all<Record<string, unknown>[]>(
                'SELECT * FROM tasks WHERE parent_path IS NOT NULL OR subtasks IS NOT NULL'
            );

            for (const row of rows) {
                const task = this.rowToTask(row);
                const subtaskRefs = new Set(task.subtasks);
                
                // Check if all subtasks exist and reference this task as parent
                if (subtaskRefs.size > 0) {
                    const subtasks = await this.db.all<Record<string, unknown>[]>(
                        `SELECT * FROM tasks WHERE path IN (${Array(subtaskRefs.size).fill('?').join(',')})`,
                        ...Array.from(subtaskRefs)
                    );

                    for (const subtask of subtasks.map(r => this.rowToTask(r))) {
                        if (subtask.parentPath !== task.path) {
                            issues.push(`Task ${task.path} lists ${subtask.path} as subtask but parent_path mismatch`);
                            if (!dryRun) {
                                subtask.parentPath = task.path;
                                await this.saveTask(subtask);
                                fixCount++;
                            }
                        }
                    }
                }
            }

            if (!dryRun) {
                await this.db.run('COMMIT');
            }

            return { fixed: fixCount, issues };
        } catch (error) {
            if (!dryRun) {
                await this.db.run('ROLLBACK');
            }
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error('Failed to repair relationships', { error: errorMessage });
            throw createError(
                ErrorCodes.STORAGE_ERROR,
                'Failed to repair relationships',
                errorMessage
            );
        }
    }

    async close(): Promise<void> {
        await this.clearCache();
        if (this.db) {
            await this.db.close();
            this.db = null;
        }
    }
}
