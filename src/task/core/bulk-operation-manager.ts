/**
 * Manages bulk operations with improved error handling and batching
 */
import { Task, CreateTaskInput, UpdateTaskInput } from '../../types/task.js';
import { Logger } from '../../logging/index.js';
import { ErrorCodes, createError } from '../../errors/index.js';
import { TaskStatusManager } from './status-manager.js';
import { TaskStorage } from '../../types/storage.js';

interface BulkOperationResult {
    success: boolean;
    operation: string;
    path: string;
    error?: string;
}

interface BatchStats {
    total: number;
    processed: number;
    succeeded: number;
    failed: number;
    startTime: number;
    endTime?: number;
}

export class BulkOperationManager {
    private readonly logger: Logger;
    private readonly storage: TaskStorage;
    private readonly statusManager: TaskStatusManager;
    private readonly BATCH_SIZE = 50;
    private stats: BatchStats;

    constructor(storage: TaskStorage) {
        this.logger = Logger.getInstance().child({ component: 'BulkOperationManager' });
        this.storage = storage;
        this.statusManager = new TaskStatusManager();
        this.stats = this.initStats();
    }

    /**
     * Executes bulk operations with batching and error handling
     */
    async executeBulkOperations(operations: Array<{
        type: 'create' | 'update' | 'delete';
        path: string;
        data?: CreateTaskInput | UpdateTaskInput;
    }>): Promise<{
        success: boolean;
        results: BulkOperationResult[];
        stats: BatchStats;
    }> {
        this.stats = this.initStats();
        this.stats.total = operations.length;

        try {
            // Sort operations to handle dependencies correctly
            const sortedOps = this.sortOperations(operations);
            
            // Split into batches
            const batches = this.createBatches(sortedOps);
            const results: BulkOperationResult[] = [];

            // Process batches with concurrency control
            for (const batch of batches) {
                const batchResults = await Promise.all(
                    batch.map(op => this.executeOperation(op))
                );
                results.push(...batchResults);

                // Update stats
                this.stats.processed += batch.length;
                this.stats.succeeded += batchResults.filter(r => r.success).length;
                this.stats.failed += batchResults.filter(r => !r.success).length;
            }

            this.stats.endTime = Date.now();
            
            // Log completion stats
            this.logger.info('Bulk operations completed', {
                total: this.stats.total,
                succeeded: this.stats.succeeded,
                failed: this.stats.failed,
                duration: `${this.stats.endTime - this.stats.startTime}ms`
            });

            return {
                success: this.stats.failed === 0,
                results,
                stats: { ...this.stats }
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error('Failed to execute bulk operations', {
                error: errorMessage,
                stats: this.stats
            });
            throw createError(
                ErrorCodes.BULK_OPERATION_ERROR,
                'Failed to execute bulk operations',
                errorMessage
            );
        }
    }

    /**
     * Sorts operations to handle dependencies correctly
     */
    private sortOperations(operations: Array<{
        type: 'create' | 'update' | 'delete';
        path: string;
        data?: CreateTaskInput | UpdateTaskInput;
    }>): typeof operations {
        return operations.sort((a, b) => {
            // Deletes should come last
            if (a.type === 'delete' && b.type !== 'delete') return 1;
            if (b.type === 'delete' && a.type !== 'delete') return -1;

            // Creates should come before updates
            if (a.type === 'create' && b.type === 'update') return -1;
            if (b.type === 'create' && a.type === 'update') return 1;

            // Sort by path depth (parent paths first)
            const aDepth = a.path.split('/').length;
            const bDepth = b.path.split('/').length;
            return aDepth - bDepth;
        });
    }

    /**
     * Creates batches of operations for efficient processing
     */
    private createBatches<T>(items: T[]): T[][] {
        const batches: T[][] = [];
        for (let i = 0; i < items.length; i += this.BATCH_SIZE) {
            batches.push(items.slice(i, i + this.BATCH_SIZE));
        }
        return batches;
    }

    /**
     * Executes a single operation with error handling
     */
    private async executeOperation(operation: {
        type: 'create' | 'update' | 'delete';
        path: string;
        data?: CreateTaskInput | UpdateTaskInput;
    }): Promise<BulkOperationResult> {
        try {
            switch (operation.type) {
                case 'create':
                    if (!operation.data) {
                        throw new Error('Data required for create operation');
                    }
                    await this.storage.saveTask(operation.data as unknown as Task);
                    break;

                case 'update':
                    if (!operation.data) {
                        throw new Error('Data required for update operation');
                    }
                    const task = await this.storage.getTask(operation.path);
                    if (!task) {
                        throw new Error(`Task not found: ${operation.path}`);
                    }

                    // Validate status transition if status is being updated
                    const updateData = operation.data as UpdateTaskInput;
                    if (updateData.status) {
                        const validation = this.statusManager.validateStatusTransition(
                            task,
                            updateData.status
                        );
                        if (!validation.valid) {
                            throw new Error(validation.reason);
                        }
                    }

                    await this.storage.saveTask({
                        ...task,
                        ...updateData,
                        metadata: {
                            ...task.metadata,
                            ...(updateData.metadata || {}),
                            updated: Date.now(),
                            version: task.metadata.version + 1
                        }
                    });
                    break;

                case 'delete':
                    await this.storage.deleteTask(operation.path);
                    break;

                default:
                    throw new Error(`Unknown operation type: ${operation.type}`);
            }

            return {
                success: true,
                operation: operation.type,
                path: operation.path
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error(`Failed to execute ${operation.type} operation`, {
                error: errorMessage,
                path: operation.path
            });

            return {
                success: false,
                operation: operation.type,
                path: operation.path,
                error: errorMessage
            };
        }
    }

    /**
     * Initializes batch statistics
     */
    private initStats(): BatchStats {
        return {
            total: 0,
            processed: 0,
            succeeded: 0,
            failed: 0,
            startTime: Date.now()
        };
    }

    /**
     * Gets current operation statistics
     */
    getStats(): Readonly<BatchStats> {
        return { ...this.stats };
    }
}
