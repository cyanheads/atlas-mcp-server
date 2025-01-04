import { Logger } from '../../../logging/index.js';
import { TransactionScope } from './scope.js';
import { StorageError } from '../../../errors/storage-error.js';
import { Database } from 'sqlite';

/**
 * Coordinates transactions across the application to prevent nested transactions
 * and maintain proper transaction state.
 */
export class TransactionCoordinator {
  private static instance: TransactionCoordinator;
  private readonly logger: Logger;
  private activeTransactions: Map<string, TransactionScope> = new Map();
  private transactionCounter = 0;
  private readonly db: Database;

  private constructor(db: Database) {
    this.logger = Logger.getInstance().child({ component: 'TransactionCoordinator' });
    this.db = db;
  }

  static getInstance(db: Database): TransactionCoordinator {
    if (!TransactionCoordinator.instance) {
      TransactionCoordinator.instance = new TransactionCoordinator(db);
    }
    return TransactionCoordinator.instance;
  }

  /**
   * Begin a new transaction scope
   */
  async beginScope(): Promise<TransactionScope> {
    const transactionId = this.generateTransactionId();
    const scope = new TransactionScope(transactionId, this.db);

    try {
      await scope.begin();
      this.activeTransactions.set(transactionId, scope);

      this.logger.debug('Transaction scope created', {
        transactionId,
        activeTransactions: this.activeTransactions.size,
      });

      return scope;
    } catch (error) {
      // If scope creation fails, ensure it's not tracked
      this.activeTransactions.delete(transactionId);
      throw error;
    }
  }

  /**
   * Execute work within a transaction scope
   */
  async executeInScope<T>(
    work: (scope: TransactionScope) => Promise<T>,
    options: {
      maxRetries?: number;
      retryDelay?: number;
    } = {}
  ): Promise<T> {
    const { maxRetries = 3, retryDelay = 100 } = options;
    let attempt = 0;
    let lastError: Error | undefined;

    while (attempt < maxRetries) {
      const scope = await this.beginScope();

      try {
        const result = await work(scope);
        await this.commitScope(scope);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(`Transaction failed (attempt ${attempt + 1}/${maxRetries})`, {
          error: lastError,
          transactionId: scope.id,
        });

        await this.rollbackScope(scope);

        attempt++;
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelay * Math.pow(2, attempt)));
        }
      } finally {
        this.cleanupScope(scope);
      }
    }

    throw StorageError.transaction(
      'coordinator',
      'TransactionCoordinator.executeInScope',
      'Transaction failed after max retries',
      {
        maxRetries,
        lastError,
        activeTransactions: this.activeTransactions.size,
      }
    );
  }

  /**
   * Commit a transaction scope
   */
  private async commitScope(scope: TransactionScope): Promise<void> {
    if (!this.activeTransactions.has(scope.id)) {
      throw StorageError.transaction(
        scope.id,
        'TransactionCoordinator.commitScope',
        'Transaction scope not found',
        { activeTransactions: this.activeTransactions.size }
      );
    }

    await scope.commit();
    this.logger.debug('Transaction committed', {
      transactionId: scope.id,
    });
  }

  /**
   * Rollback a transaction scope
   */
  private async rollbackScope(scope: TransactionScope): Promise<void> {
    if (!this.activeTransactions.has(scope.id)) {
      throw StorageError.transaction(
        scope.id,
        'TransactionCoordinator.rollbackScope',
        'Transaction scope not found',
        { activeTransactions: this.activeTransactions.size }
      );
    }

    await scope.rollback();
    this.logger.debug('Transaction rolled back', {
      transactionId: scope.id,
    });
  }

  /**
   * Clean up a transaction scope
   */
  private cleanupScope(scope: TransactionScope): void {
    this.activeTransactions.delete(scope.id);
    this.logger.debug('Transaction scope cleaned up', {
      transactionId: scope.id,
      activeTransactions: this.activeTransactions.size,
    });
  }

  /**
   * Generate a unique transaction ID
   */
  private generateTransactionId(): string {
    return `txn_${Date.now()}_${++this.transactionCounter}`;
  }

  /**
   * Get active transaction count
   */
  getActiveTransactionCount(): number {
    return this.activeTransactions.size;
  }

  /**
   * Check if a transaction is active
   */
  isTransactionActive(transactionId: string): boolean {
    return this.activeTransactions.has(transactionId);
  }

  /**
   * Get metrics about transaction usage
   */
  getMetrics(): {
    activeTransactions: number;
    totalTransactions: number;
  } {
    return {
      activeTransactions: this.activeTransactions.size,
      totalTransactions: this.transactionCounter,
    };
  }
}
