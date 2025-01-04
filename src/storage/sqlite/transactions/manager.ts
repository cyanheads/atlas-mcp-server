import { Database } from 'sqlite';
import { Logger } from '../../../logging/index.js';
import { ErrorCodes, createError, type ErrorCode } from '../../../errors/index.js';
import { EventManager } from '../../../events/event-manager.js';
import { EventTypes } from '../../../types/events.js';
import crypto from 'crypto';

export interface TransactionState {
  active: boolean;
  depth: number;
  startTime: number;
  timeout?: NodeJS.Timeout;
  id: string;
}

/**
 * Helper function to create errors with consistent operation naming
 */
function createTransactionError(
  code: ErrorCode,
  message: string,
  operation: string = 'TransactionManager',
  userMessage?: string,
  metadata?: Record<string, unknown>
): Error {
  return createError(code, message, `TransactionManager.${operation}`, userMessage, metadata);
}

export class TransactionManager {
  private static instance: TransactionManager;
  private readonly logger: Logger;
  private readonly eventManager: EventManager;
  private readonly activeTransactions = new Map<string, TransactionState>();
  private readonly DEFAULT_TIMEOUT = 30000; // 30 seconds

  private constructor() {
    this.logger = Logger.getInstance().child({ component: 'TransactionManager' });
    this.eventManager = EventManager.getInstance();
  }

  static getInstance(): TransactionManager {
    if (!TransactionManager.instance) {
      TransactionManager.instance = new TransactionManager();
    }
    return TransactionManager.instance;
  }

  /**
   * Begin a new transaction with proper isolation and timeout
   */
  async beginTransaction(db: Database): Promise<string> {
    const txId = crypto.randomUUID();

    try {
      // Check for existing transaction
      const existingTx = Array.from(this.activeTransactions.values()).find(tx => tx.active);

      if (existingTx) {
        // Handle nested transaction
        existingTx.depth++;
        this.logger.debug('Nested transaction started', {
          transactionId: existingTx.id,
          depth: existingTx.depth,
        });
        return existingTx.id;
      }

      // Start new transaction
      await db.exec('BEGIN IMMEDIATE');

      // Set up transaction timeout
      const timeoutHandle = setTimeout(
        () => this.handleTransactionTimeout(db, txId),
        this.DEFAULT_TIMEOUT
      );

      // Record active transaction
      const transaction: TransactionState = {
        id: txId,
        active: true,
        depth: 1,
        startTime: Date.now(),
        timeout: timeoutHandle,
      };

      this.activeTransactions.set(txId, transaction);

      // Emit transaction start event
      this.eventManager.emitSystemEvent({
        type: EventTypes.TRANSACTION_STARTED,
        timestamp: Date.now(),
        metadata: {
          transactionId: txId,
        },
      });

      return txId;
    } catch (error) {
      this.logger.error('Failed to begin transaction', { error });
      throw createTransactionError(
        ErrorCodes.TRANSACTION_ERROR,
        'Failed to begin transaction',
        'beginTransaction',
        'Could not start database transaction',
        { originalError: error }
      );
    }
  }

  /**
   * Commit a transaction
   */
  async commitTransaction(db: Database, txId: string): Promise<void> {
    const transaction = this.activeTransactions.get(txId);
    if (!transaction) {
      throw createTransactionError(
        ErrorCodes.TRANSACTION_ERROR,
        'No active transaction to commit',
        'commitTransaction',
        'Transaction not found or already completed'
      );
    }

    try {
      if (transaction.depth > 1) {
        // Handle nested transaction
        transaction.depth--;
        this.logger.debug('Nested transaction committed', {
          transactionId: txId,
          depth: transaction.depth,
        });
        return;
      }

      // Clear timeout
      if (transaction.timeout) {
        clearTimeout(transaction.timeout);
      }

      // Commit transaction
      await db.exec('COMMIT');

      const duration = Date.now() - transaction.startTime;

      // Clean up transaction state
      this.activeTransactions.delete(txId);

      // Emit transaction committed event
      this.eventManager.emitSystemEvent({
        type: EventTypes.TRANSACTION_COMMITTED,
        timestamp: Date.now(),
        metadata: {
          transactionId: txId,
          duration,
        },
      });
    } catch (error) {
      this.logger.error('Failed to commit transaction', { error });
      throw createTransactionError(
        ErrorCodes.TRANSACTION_ERROR,
        'Failed to commit transaction',
        'commitTransaction',
        'Could not commit database changes',
        { originalError: error }
      );
    }
  }

  /**
   * Rollback a transaction
   */
  async rollbackTransaction(db: Database, txId: string): Promise<void> {
    const transaction = this.activeTransactions.get(txId);
    if (!transaction) {
      throw createTransactionError(
        ErrorCodes.TRANSACTION_ERROR,
        'No active transaction to rollback',
        'rollbackTransaction',
        'Transaction not found or already completed'
      );
    }

    try {
      if (transaction.depth > 1) {
        // Handle nested transaction
        transaction.depth--;
        this.logger.debug('Nested transaction rolled back', {
          transactionId: txId,
          depth: transaction.depth,
        });
        return;
      }

      // Clear timeout
      if (transaction.timeout) {
        clearTimeout(transaction.timeout);
      }

      // Rollback transaction
      await db.exec('ROLLBACK');

      const duration = Date.now() - transaction.startTime;

      // Clean up transaction state
      this.activeTransactions.delete(txId);

      // Emit transaction rollback event
      this.eventManager.emitSystemEvent({
        type: EventTypes.TRANSACTION_ROLLED_BACK,
        timestamp: Date.now(),
        metadata: {
          transactionId: txId,
          duration,
        },
      });
    } catch (error) {
      this.logger.error('Failed to rollback transaction', { error });
      throw createTransactionError(
        ErrorCodes.TRANSACTION_ERROR,
        'Failed to rollback transaction',
        'rollbackTransaction',
        'Could not rollback database changes',
        { originalError: error }
      );
    }
  }

  /**
   * Handle transaction timeout
   */
  private async handleTransactionTimeout(db: Database, txId: string): Promise<void> {
    const transaction = this.activeTransactions.get(txId);
    if (!transaction) return;

    this.logger.warn('Transaction timeout', {
      transactionId: txId,
      duration: Date.now() - transaction.startTime,
    });

    try {
      await this.rollbackTransaction(db, txId);

      // Emit timeout event
      this.eventManager.emitSystemEvent({
        type: EventTypes.TRANSACTION_TIMEOUT,
        timestamp: Date.now(),
        metadata: {
          transactionId: txId,
          duration: Date.now() - transaction.startTime,
        },
      });
    } catch (error) {
      this.logger.error('Failed to handle transaction timeout', { error });
    }
  }

  /**
   * Check if a transaction is active
   */
  isTransactionActive(txId: string): boolean {
    const transaction = this.activeTransactions.get(txId);
    return transaction?.active || false;
  }

  /**
   * Get transaction depth
   */
  getTransactionDepth(txId: string): number {
    const transaction = this.activeTransactions.get(txId);
    return transaction?.depth || 0;
  }

  /**
   * Clean up all transactions
   */
  async cleanupAllTransactions(db: Database): Promise<void> {
    for (const [txId, transaction] of this.activeTransactions.entries()) {
      if (transaction.active) {
        try {
          await this.rollbackTransaction(db, txId);
        } catch (error) {
          this.logger.error('Failed to cleanup transaction', {
            error,
            transactionId: txId,
          });
        }
      }
    }
    this.activeTransactions.clear();
  }
}
