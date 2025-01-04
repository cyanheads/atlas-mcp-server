import { Database } from 'sqlite';
import { Logger } from '../../../logging/index.js';
import { StorageError } from '../../../errors/storage-error.js';

/**
 * Represents a transaction scope with its own lifecycle
 */
export class TransactionScope {
  private readonly logger: Logger;
  private _isActive = false;
  private _isCommitted = false;
  private _isRolledBack = false;

  constructor(
    private readonly _id: string,
    private readonly db: Database
  ) {
    this.logger = Logger.getInstance().child({
      component: 'TransactionScope',
      transactionId: _id,
    });
  }

  /**
   * Get transaction ID
   */
  get id(): string {
    return this._id;
  }

  /**
   * Check if transaction is active
   */
  get isActive(): boolean {
    return this._isActive;
  }

  /**
   * Check if transaction is committed
   */
  get isCommitted(): boolean {
    return this._isCommitted;
  }

  /**
   * Check if transaction is rolled back
   */
  get isRolledBack(): boolean {
    return this._isRolledBack;
  }

  /**
   * Begin transaction
   */
  async begin(): Promise<void> {
    if (this._isActive) {
      throw StorageError.transaction(
        this._id,
        'TransactionScope.begin',
        'Transaction already active',
        {
          isActive: this._isActive,
          isCommitted: this._isCommitted,
          isRolledBack: this._isRolledBack,
        }
      );
    }

    try {
      await this.db.run('BEGIN TRANSACTION');
      this._isActive = true;
      this.logger.debug('Transaction begun');
    } catch (error) {
      if (error instanceof Error) {
        throw StorageError.database(this._id, 'TransactionScope.begin', error, {
          isActive: this._isActive,
          isCommitted: this._isCommitted,
          isRolledBack: this._isRolledBack,
        });
      }
      throw error;
    }
  }

  /**
   * Commit transaction
   */
  async commit(): Promise<void> {
    if (!this._isActive) {
      throw StorageError.transaction(
        this._id,
        'TransactionScope.commit',
        'No active transaction to commit',
        {
          isActive: this._isActive,
          isCommitted: this._isCommitted,
          isRolledBack: this._isRolledBack,
        }
      );
    }

    if (this._isCommitted) {
      throw StorageError.transaction(
        this._id,
        'TransactionScope.commit',
        'Transaction already committed',
        {
          isActive: this._isActive,
          isCommitted: this._isCommitted,
          isRolledBack: this._isRolledBack,
        }
      );
    }

    if (this._isRolledBack) {
      throw StorageError.transaction(
        this._id,
        'TransactionScope.commit',
        'Cannot commit rolled back transaction',
        {
          isActive: this._isActive,
          isCommitted: this._isCommitted,
          isRolledBack: this._isRolledBack,
        }
      );
    }

    try {
      await this.db.run('COMMIT');
      this._isActive = false;
      this._isCommitted = true;
      this.logger.debug('Transaction committed');
    } catch (error) {
      if (error instanceof Error) {
        throw StorageError.commit(this._id, 'TransactionScope.commit', error.message, {
          isActive: this._isActive,
          isCommitted: this._isCommitted,
          isRolledBack: this._isRolledBack,
          error,
        });
      }
      throw error;
    }
  }

  /**
   * Rollback transaction
   */
  async rollback(): Promise<void> {
    if (!this._isActive) {
      throw StorageError.transaction(
        this._id,
        'TransactionScope.rollback',
        'No active transaction to rollback',
        {
          isActive: this._isActive,
          isCommitted: this._isCommitted,
          isRolledBack: this._isRolledBack,
        }
      );
    }

    if (this._isCommitted) {
      throw StorageError.transaction(
        this._id,
        'TransactionScope.rollback',
        'Cannot rollback committed transaction',
        {
          isActive: this._isActive,
          isCommitted: this._isCommitted,
          isRolledBack: this._isRolledBack,
        }
      );
    }

    if (this._isRolledBack) {
      throw StorageError.transaction(
        this._id,
        'TransactionScope.rollback',
        'Transaction already rolled back',
        {
          isActive: this._isActive,
          isCommitted: this._isCommitted,
          isRolledBack: this._isRolledBack,
        }
      );
    }

    try {
      await this.db.run('ROLLBACK');
      this._isActive = false;
      this._isRolledBack = true;
      this.logger.debug('Transaction rolled back');
    } catch (error) {
      if (error instanceof Error) {
        throw StorageError.rollback(this._id, 'TransactionScope.rollback', error.message, {
          isActive: this._isActive,
          isCommitted: this._isCommitted,
          isRolledBack: this._isRolledBack,
          error,
        });
      }
      throw error;
    }
  }

  /**
   * Execute SQL within transaction
   */
  async execute<T>(sql: string, params?: unknown[]): Promise<T> {
    if (!this._isActive) {
      throw StorageError.transaction(
        this._id,
        'TransactionScope.execute',
        'No active transaction',
        {
          isActive: this._isActive,
          isCommitted: this._isCommitted,
          isRolledBack: this._isRolledBack,
          sql,
          params,
        }
      );
    }

    try {
      return (await this.db.run(sql, params)) as T;
    } catch (error) {
      if (error instanceof Error) {
        throw StorageError.database(this._id, 'TransactionScope.execute', error, {
          isActive: this._isActive,
          isCommitted: this._isCommitted,
          isRolledBack: this._isRolledBack,
          sql,
          params,
        });
      }
      throw error;
    }
  }
}
