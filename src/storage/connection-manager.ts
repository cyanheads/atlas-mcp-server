/**
 * Database connection manager
 */
import { Logger } from '../logging/index.js';
import { ErrorCodes, createError } from '../errors/index.js';

export class ConnectionManager {
    private readonly logger: Logger;
    private readonly maxRetries: number;
    private readonly retryDelay: number;
    private readonly busyTimeout: number;

    constructor(options: {
        maxRetries?: number;
        retryDelay?: number;
        busyTimeout?: number;
    } = {}) {
        this.logger = Logger.getInstance().child({ component: 'ConnectionManager' });
        this.maxRetries = options.maxRetries || 5;
        this.retryDelay = options.retryDelay || 2000;
        this.busyTimeout = options.busyTimeout || 20000; // Increase timeout for busy state
    }

    /**
     * Executes a database operation with retries
     */
    async executeWithRetry<T>(
        operation: () => Promise<T>,
        context: string
    ): Promise<T> {
        let lastError: Error | undefined;
        let retryCount = 0;

        while (retryCount < this.maxRetries) {
            try {
                // Handle busy state with timeout
                return await new Promise<T>((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        reject(new Error('Operation timed out'));
                    }, this.busyTimeout);

                    operation()
                        .then((result) => {
                            clearTimeout(timeout);
                            resolve(result);
                        })
                        .catch((error) => {
                            clearTimeout(timeout);
                            reject(error);
                        });
                });
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                retryCount++;

                // Check if error is due to database being locked
                const isLocked = lastError.message.includes('SQLITE_BUSY') || 
                               lastError.message.includes('database is locked');

                if (retryCount < this.maxRetries) {
                    this.logger.warn(`Operation failed, retrying (${retryCount}/${this.maxRetries})`, {
                        error: lastError,
                        context,
                        isLocked
                    });

                    // Use longer delay for locked database
                    const delay = isLocked ? this.retryDelay * 2 : this.retryDelay;
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        throw createError(
            ErrorCodes.STORAGE_ERROR,
            'Operation failed',
            `Failed after ${this.maxRetries} retries: ${lastError?.message}`
        );
    }

    /**
     * Handles database busy state
     */
    async handleBusy(
        operation: () => Promise<void>,
        context: string
    ): Promise<void> {
        const startTime = Date.now();

        while (true) {
            try {
                await operation();
                return;
            } catch (error) {
                const elapsed = Date.now() - startTime;
                if (elapsed >= this.busyTimeout) {
                    throw createError(
                        ErrorCodes.STORAGE_ERROR,
                        'Operation timed out',
                        `Timed out after ${elapsed}ms: ${error instanceof Error ? error.message : String(error)}`
                    );
                }

                this.logger.warn('Database busy, waiting...', {
                    elapsed,
                    timeout: this.busyTimeout,
                    context
                });

                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
    }
}
