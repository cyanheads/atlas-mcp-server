/**
 * Manages database transactions with improved error handling and state management
 */
import { Database } from 'sqlite';
import { Logger } from '../logging/index.js';
import { ErrorCodes, createError } from '../errors/index.js';

interface TransactionState {
    depth: number;
    active: boolean;
    startTime: number;
    operations: number;
}

export class TransactionManager {
    private readonly logger: Logger;
    private state: TransactionState;
    private readonly MAX_TRANSACTION_TIME = 30000; // 30 seconds
    private readonly MAX_OPERATIONS = 1000;
    private readonly db: Database;

    constructor(db: Database) {
        this.logger = Logger.getInstance().child({ component: 'TransactionManager' });
        this.db = db;
        this.state = {
            depth: 0,
            active: false,
            startTime: 0,
            operations: 0
        };
    }

    /**
     * Begins a new transaction or increments depth for nested transactions
     */
    async begin(): Promise<void> {
        try {
            if (this.state.depth === 0) {
                // Ensure no active transaction
                try {
                    await this.rollback();
                } catch (e) {
                    // Ignore rollback errors when no transaction is active
                }

                await this.db.run('BEGIN IMMEDIATE');
                this.state = {
                    depth: 1,
                    active: true,
                    startTime: Date.now(),
                    operations: 0
                };
                this.logger.debug('Started new transaction', { depth: this.state.depth });
            } else {
                this.state.depth++;
                this.logger.debug('Nested transaction started', { depth: this.state.depth });
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error('Failed to begin transaction', { 
                error: errorMessage,
                state: this.state
            });
            throw createError(
                ErrorCodes.STORAGE_ERROR,
                'Failed to begin transaction',
                errorMessage
            );
        }
    }

    /**
     * Commits the current transaction or decrements depth for nested transactions
     */
    async commit(): Promise<void> {
        try {
            if (!this.state.active) {
                this.logger.warn('No active transaction to commit');
                return;
            }

            if (this.state.depth > 1) {
                this.state.depth--;
                this.logger.debug('Nested transaction committed', { depth: this.state.depth });
                return;
            }

            await this.db.run('COMMIT');
            this.resetState();
            this.logger.debug('Transaction committed successfully');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error('Failed to commit transaction', { 
                error: errorMessage,
                state: this.state
            });
            throw createError(
                ErrorCodes.STORAGE_ERROR,
                'Failed to commit transaction',
                errorMessage
            );
        }
    }

    /**
     * Rolls back the current transaction
     */
    async rollback(): Promise<void> {
        try {
            if (!this.state.active) {
                this.logger.debug('No active transaction to rollback');
                return;
            }

            if (this.state.depth > 1) {
                this.state.depth--;
                this.logger.debug('Nested transaction rolled back', { depth: this.state.depth });
                return;
            }

            // Check if a transaction is actually active in SQLite
            const inTransaction = await this.db.get('SELECT count(*) as count FROM sqlite_master');
            if (!inTransaction) {
                this.logger.debug('No SQLite transaction active, resetting state');
                this.resetState();
                return;
            }

            await this.db.run('ROLLBACK');
            this.resetState();
            this.logger.debug('Transaction rolled back successfully');
        } catch (error) {
            // If the error is about no active transaction, just reset state
            if (error instanceof Error && error.message.includes('no transaction is active')) {
                this.logger.debug('No transaction active during rollback, resetting state');
                this.resetState();
                return;
            }

            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error('Failed to rollback transaction', { 
                error: errorMessage,
                state: this.state
            });
            
            // Reset state even on error to prevent being stuck
            this.resetState();
            
            throw createError(
                ErrorCodes.STORAGE_ERROR,
                'Failed to rollback transaction',
                errorMessage
            );
        }
    }

    /**
     * Executes an operation within a transaction with proper error handling
     */
    async execute<T>(operation: () => Promise<T>): Promise<T> {
        await this.begin();

        try {
            // Check transaction time limit
            if (Date.now() - this.state.startTime > this.MAX_TRANSACTION_TIME) {
                throw createError(
                    ErrorCodes.STORAGE_ERROR,
                    'Transaction timeout',
                    `Transaction exceeded maximum time of ${this.MAX_TRANSACTION_TIME}ms`
                );
            }

            // Check operation limit
            if (++this.state.operations > this.MAX_OPERATIONS) {
                throw createError(
                    ErrorCodes.STORAGE_ERROR,
                    'Transaction operation limit exceeded',
                    `Transaction exceeded maximum operations of ${this.MAX_OPERATIONS}`
                );
            }

            const result = await operation();
            await this.commit();
            return result;
        } catch (error) {
            await this.rollback();
            throw error;
        }
    }

    /**
     * Resets the transaction state
     */
    private resetState(): void {
        this.state = {
            depth: 0,
            active: false,
            startTime: 0,
            operations: 0
        };
    }

    /**
     * Gets the current transaction state
     */
    getState(): Readonly<TransactionState> {
        return { ...this.state };
    }

    /**
     * Checks if a transaction is currently active
     */
    isActive(): boolean {
        return this.state.active;
    }
}
