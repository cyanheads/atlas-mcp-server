/**
 * Path-based task storage with caching, indexing, and transaction support
 */
import { Task, TaskStatus, validateTaskPath, isValidTaskHierarchy, getParentPath } from '../../types/task.js';
import { TaskStorage } from '../../types/storage.js';
import { Logger } from '../../logging/index.js';
import { TaskIndexManager } from './indexing/index-manager.js';
import { EnhancedCacheManager } from './cache/cache-manager.js';
import { DependencyValidator } from './dependency-validator.js';
import { ErrorCodes, createError } from '../../errors/index.js';
import { TransactionManager } from './transactions/transaction-manager.js';

const BATCH_SIZE = 50; // Maximum number of tasks to process in parallel

export class TaskStore {
    private readonly logger: Logger;
    private readonly indexManager: TaskIndexManager;
    private readonly cacheManager: EnhancedCacheManager;
    private readonly dependencyValidator: DependencyValidator;
    private readonly transactionManager: TransactionManager;

    constructor(private readonly storage: TaskStorage) {
        this.logger = Logger.getInstance().child({ component: 'TaskStore' });
        this.indexManager = new TaskIndexManager();
        this.cacheManager = new EnhancedCacheManager({
            maxSize: 1000,
            baseTTL: 60000,
            maxTTL: 300000
        });
        this.dependencyValidator = new DependencyValidator();
        this.transactionManager = new TransactionManager(storage);
    }

    /**
     * Processes tasks in batches
     */
    private async processBatch<T>(
        items: T[],
        processor: (item: T) => Promise<void>
    ): Promise<void> {
        for (let i = 0; i < items.length; i += BATCH_SIZE) {
            const batch = items.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(processor));
        }
    }

    /**
     * Gets a task by path, checking cache first
     */
    private async getTaskByPath(path: string): Promise<Task | null> {
        if (!validateTaskPath(path)) {
            throw createError(
                ErrorCodes.TASK_INVALID_PATH,
                `Invalid task path: ${path}`
            );
        }

        // Check cache first
        const cachedTask = await this.cacheManager.get(path);
        if (cachedTask) {
            return cachedTask;
        }

        // Check index
        const indexedTask = await this.indexManager.getTaskByPath(path);
        if (indexedTask) {
            await this.cacheManager.set(path, indexedTask);
            return indexedTask;
        }

        // Load from storage
        const task = await this.storage.getTask(path);
        if (task) {
            await this.cacheManager.set(path, task);
            await this.indexManager.indexTask(task);
        }

        return task;
    }

    /**
     * Updates dependent task statuses
     */
    private async updateDependentStatuses(task: Task): Promise<void> {
        const dependentTasks = await this.indexManager.getDependentTasks(task.path);
        
        for (const depTask of dependentTasks) {
            const taskPath = depTask.path;
            const updatedTask = await this.getTaskByPath(taskPath);
            if (!updatedTask) continue;

            // If a dependency fails or is blocked, block the dependent task
            if (task.status === TaskStatus.FAILED || task.status === TaskStatus.BLOCKED) {
                updatedTask.status = TaskStatus.BLOCKED;
                await this.saveTasks([updatedTask]);
            }
            // If all dependencies are complete, unblock the dependent task
            else if (task.status === TaskStatus.COMPLETED) {
                const allDepsCompleted = await this.checkAllDependenciesCompleted(updatedTask);
                if (allDepsCompleted) {
                    updatedTask.status = TaskStatus.PENDING;
                    await this.saveTasks([updatedTask]);
                }
            }
        }
    }

    /**
     * Checks if all dependencies are completed
     */
    private async checkAllDependenciesCompleted(task: Task): Promise<boolean> {
        for (const depPath of task.dependencies) {
            const depTask = await this.getTaskByPath(depPath);
            if (!depTask || depTask.status !== TaskStatus.COMPLETED) {
                return false;
            }
        }
        return true;
    }

    /**
     * Saves tasks with validation, indexing, and transaction support
     */
    async saveTasks(tasks: Task[]): Promise<void> {
        // Validate paths and collect parent updates
        for (const task of tasks) {
            if (!validateTaskPath(task.path)) {
                throw createError(
                    ErrorCodes.TASK_INVALID_PATH,
                    `Invalid task path: ${task.path}`
                );
            }
        }

        const transaction = await this.transactionManager.begin();

        try {
            // First pass: validate all tasks and collect parent paths
            const parentPaths = new Set<string>();
            const tasksToSave = new Map<string, Task>();

            for (const task of tasks) {
                // Ensure task has required arrays
                if (!task.subtasks) task.subtasks = [];
                if (!task.dependencies) task.dependencies = [];

                // Get and validate parent path
                const parentPath = task.parentPath || getParentPath(task.path);
                if (parentPath) {
                    task.parentPath = parentPath;
                    parentPaths.add(parentPath);
                }

                tasksToSave.set(task.path, task);
            }

            // Second pass: load and validate all parents
            const parentUpdates = new Map<string, Task>();
            for (const parentPath of parentPaths) {
                const parent = await this.getTaskByPath(parentPath);
                if (!parent) {
                    throw createError(
                        ErrorCodes.TASK_PARENT_NOT_FOUND,
                        `Parent task not found: ${parentPath}. Parent tasks must be created before their children.`
                    );
                }
                parentUpdates.set(parentPath, parent);
            }

            // Third pass: validate and synchronize parent-child relationships
            for (const task of tasksToSave.values()) {
                if (task.parentPath) {
                    const parent = parentUpdates.get(task.parentPath);
                    if (!parent) continue; // Already handled in second pass

                    // Validate task type hierarchy
                    if (!isValidTaskHierarchy(parent.type, task.type)) {
                        throw createError(
                            ErrorCodes.TASK_PARENT_TYPE,
                            `Invalid parent-child relationship: ${parent.type} cannot contain ${task.type}`
                        );
                    }

                    // Ensure bidirectional consistency
                    if (!parent.subtasks.includes(task.path)) {
                        parent.subtasks = [...parent.subtasks, task.path];
                        parentUpdates.set(parent.path, parent);
                    }
                } else {
                    // If no parent path, ensure task is not in any parent's subtasks
                    for (const potentialParent of parentUpdates.values()) {
                        if (potentialParent.subtasks.includes(task.path)) {
                            potentialParent.subtasks = potentialParent.subtasks.filter(p => p !== task.path);
                            parentUpdates.set(potentialParent.path, potentialParent);
                        }
                    }
                }

                // Ensure task's subtasks array is consistent with children's parentPath
                const childrenToRemove: string[] = [];
                for (const childPath of task.subtasks) {
                    const child = tasksToSave.get(childPath);
                    if (child) {
                        if (child.parentPath !== task.path) {
                            childrenToRemove.push(childPath);
                        }
                    } else {
                        // Child not in current batch, load from storage
                        const existingChild = await this.getTaskByPath(childPath);
                        if (!existingChild || existingChild.parentPath !== task.path) {
                            childrenToRemove.push(childPath);
                        }
                    }
                }
                if (childrenToRemove.length > 0) {
                    task.subtasks = task.subtasks.filter(p => !childrenToRemove.includes(p));
                    tasksToSave.set(task.path, task);
                }
            }

            // Prepare final task list with updated relationships
            const allTasks = [...parentUpdates.values(), ...tasksToSave.values()];
            await this.storage.saveTasks(allTasks);

            // Clear cache for all affected tasks
            await Promise.all(allTasks.map(task => this.cacheManager.delete(task.path)));

            // Reindex all tasks to ensure relationships are properly established
            for (const task of allTasks) {
                await this.indexManager.indexTask(task);
                await this.cacheManager.set(task.path, task);
            }

            // Validate dependencies for original tasks
            for (const task of tasks) {
                await this.dependencyValidator.validateDependencies(
                    task.path,
                    task.dependencies,
                    this.getTaskByPath.bind(this)
                );
            }

            // Propagate status changes
            await this.processBatch(tasks, async task => {
                await this.updateDependentStatuses(task);
            });

            await this.transactionManager.commit(transaction);

            this.logger.debug('Tasks saved successfully', {
                count: tasks.length,
                paths: tasks.map(t => t.path)
            });
        } catch (error) {
            // Rollback transaction
            await this.transactionManager.rollback(transaction);

            // Rollback cache and indexes
            await this.processBatch(tasks, async task => {
                await this.indexManager.unindexTask(task);
                await this.cacheManager.delete(task.path);
            });

            this.logger.error('Failed to save tasks', { error, tasks });
            throw error;
        }
    }

    /**
     * Gets tasks by path pattern with efficient caching
     */
    async getTasksByPattern(pattern: string): Promise<Task[]> {
        try {
            // Get indexed tasks first
            const indexedTasks = await this.indexManager.getProjectTasks(pattern);
            
            // Batch process cache checks
            const tasks: Task[] = [];
            const missingPaths: string[] = [];

            await this.processBatch(indexedTasks, async indexedTask => {
                const cachedTask = await this.cacheManager.get(indexedTask.path);
                if (cachedTask) {
                    tasks.push(cachedTask);
                } else {
                    missingPaths.push(indexedTask.path);
                }
            });

            // If all tasks were cached, return them
            if (missingPaths.length === 0) {
                return tasks;
            }

            // Load missing tasks from storage
            const storageTasks = await this.storage.getTasksByPattern(pattern);

            // Update cache and indexes for missing tasks
            await this.processBatch(storageTasks, async task => {
                await this.indexManager.indexTask(task);
                await this.cacheManager.set(task.path, task);
                tasks.push(task);
            });

            return tasks;
        } catch (error) {
            this.logger.error('Failed to get tasks by pattern', { error, pattern });
            throw error;
        }
    }

    /**
     * Gets tasks by status with efficient caching
     */
    async getTasksByStatus(status: TaskStatus): Promise<Task[]> {
        try {
            // Get indexed tasks first
            const indexedTasks = await this.indexManager.getTasksByStatus(status, '');
            
            // Batch process cache checks
            const tasks: Task[] = [];
            const missingPaths: string[] = [];

            await this.processBatch(indexedTasks, async indexedTask => {
                const cachedTask = await this.cacheManager.get(indexedTask.path);
                if (cachedTask) {
                    tasks.push(cachedTask);
                } else {
                    missingPaths.push(indexedTask.path);
                }
            });

            // If all tasks were cached, return them
            if (missingPaths.length === 0) {
                return tasks;
            }

            // Load missing tasks from storage
            const storageTasks = await this.storage.getTasksByStatus(status);

            // Update cache and indexes for missing tasks
            await this.processBatch(storageTasks, async task => {
                await this.indexManager.indexTask(task);
                await this.cacheManager.set(task.path, task);
                tasks.push(task);
            });

            return tasks;
        } catch (error) {
            this.logger.error('Failed to get tasks by status', { error, status });
            throw error;
        }
    }

    /**
     * Gets subtasks of a task with efficient caching
     */
    async getSubtasks(parentPath: string): Promise<Task[]> {
        if (!validateTaskPath(parentPath)) {
            throw createError(
                ErrorCodes.TASK_INVALID_PATH,
                `Invalid parent path: ${parentPath}`
            );
        }

        try {
            // Get the parent task first
            const parentTask = await this.getTaskByPath(parentPath);
            if (!parentTask) {
                return [];
            }

            // Get all tasks that are listed in parent's subtasks array
            const tasks: Task[] = [];
            for (const childPath of parentTask.subtasks) {
                const task = await this.getTaskByPath(childPath);
                if (task) {
                    tasks.push(task);
                }
            }

            return tasks;
        } catch (error) {
            this.logger.error('Failed to get subtasks', { error, parentPath });
            throw error;
        }
    }

    /**
     * Deletes a task and its subtasks with transaction support
     */
    async deleteTask(path: string): Promise<void> {
        if (!validateTaskPath(path)) {
            throw createError(
                ErrorCodes.TASK_INVALID_PATH,
                `Invalid task path: ${path}`
            );
        }

        const transaction = await this.transactionManager.begin();

        try {
            // Get task and subtasks
            const task = await this.storage.getTask(path);
            if (!task) {
                throw createError(
                    ErrorCodes.TASK_NOT_FOUND,
                    `Task not found: ${path}`
                );
            }

            const subtasks = await this.storage.getSubtasks(path);
            const allTasks = [task, ...subtasks];
            const allPaths = allTasks.map(t => t.path);

            // Add delete operation to transaction with both paths and tasks
            transaction.operations.push({
                type: 'delete',
                paths: allPaths,
                tasks: allTasks
            });

            // Delete from storage
            await this.storage.deleteTasks(allPaths);

            // Update cache and indexes
            await this.processBatch(allTasks, async task => {
                await this.indexManager.unindexTask(task);
                await this.cacheManager.delete(task.path);
            });

            // Update dependent tasks
            await this.processBatch(allTasks, async task => {
                await this.updateDependentStatuses(task);
            });

            await this.transactionManager.commit(transaction);

            this.logger.debug('Task and subtasks deleted', {
                path,
                subtaskCount: subtasks.length
            });
        } catch (error) {
            await this.transactionManager.rollback(transaction);
            this.logger.error('Failed to delete task', { error, path });
            throw error;
        }
    }

    /**
     * Clears cache and indexes with transaction support
     */
    /**
     * Clears all tasks and resets indexes
     */
    async clearAllTasks(confirm: boolean): Promise<void> {
        if (!confirm) {
            throw createError(
                ErrorCodes.OPERATION_FAILED,
                'Must explicitly confirm task deletion'
            );
        }

        const transaction = await this.transactionManager.begin();

        try {
            // Clear all tasks from storage
            await this.storage.clearAllTasks();
            
            // Clear cache and indexes
            await Promise.all([
                this.indexManager.clear(),
                this.cacheManager.clear()
            ]);

            await this.transactionManager.commit(transaction);
            this.logger.info('All tasks and indexes cleared');
        } catch (error) {
            await this.transactionManager.rollback(transaction);
            this.logger.error('Failed to clear tasks', { error });
            throw error;
        }
    }

    /**
     * Optimizes database storage and performance
     */
    async vacuumDatabase(analyze: boolean = true): Promise<void> {
        try {
            await this.storage.vacuum();
            if (analyze) {
                await this.storage.analyze();
            }
            await this.storage.checkpoint();
            this.logger.info('Database optimized', { analyzed: analyze });
        } catch (error) {
            this.logger.error('Failed to optimize database', { error });
            throw error;
        }
    }

    /**
     * Repairs parent-child relationships and fixes inconsistencies
     */
    async repairRelationships(dryRun: boolean = false, pathPattern?: string): Promise<{ fixed: number, issues: string[] }> {
        const transaction = await this.transactionManager.begin();

        try {
            // Get tasks to repair
            const tasks = pathPattern ? 
                await this.getTasksByPattern(pathPattern) :
                await this.storage.getTasks([]);

            // Clear cache for affected tasks
            await Promise.all(tasks.map(task => this.cacheManager.delete(task.path)));

            // Repair relationships
            const result = await this.storage.repairRelationships(dryRun);

            if (!dryRun) {
                // Reindex all tasks after repair
                await Promise.all(tasks.map(task => this.indexManager.indexTask(task)));
            }

            await this.transactionManager.commit(transaction);
            return result;
        } catch (error) {
            await this.transactionManager.rollback(transaction);
            this.logger.error('Failed to repair relationships', { error });
            throw error;
        }
    }

    /**
     * Clears cache and indexes
     */
    async clearCache(): Promise<void> {
        const transaction = await this.transactionManager.begin();

        try {
            await Promise.all([
                this.indexManager.clear(),
                this.cacheManager.clear()
            ]);

            await this.transactionManager.commit(transaction);
            this.logger.debug('Cache cleared');
        } catch (error) {
            await this.transactionManager.rollback(transaction);
            this.logger.error('Failed to clear cache', { error });
            throw error;
        }
    }
}
