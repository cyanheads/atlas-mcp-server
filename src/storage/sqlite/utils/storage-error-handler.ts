import { BaseError } from '../../errors/base-error.js';
import { createError, ErrorCodes } from '../../errors/index.js';
import {
  isDatabaseError,
  isTransientError,
  toSerializableError,
  summarizeError,
} from '../../utils/error-utils.js';
import { Logger } from '../../logging/index.js';

/**
 * Storage-specific error handler
 */
export class StorageErrorHandler {
  private readonly logger: Logger;

  constructor(component = 'StorageErrorHandler') {
    this.logger = Logger.getInstance().child({ component });
  }

  /**
   * Handle storage operation errors
   */
  handleError(error: unknown, operation: string, context?: Record<string, unknown>): never {
    // Already handled errors
    if (error instanceof BaseError) {
      throw error;
    }

    // Database errors
    if (isDatabaseError(error)) {
      const sqliteError = error as any;
      const code = sqliteError.code || 'UNKNOWN_DB_ERROR';
      const message = sqliteError.message || 'Database operation failed';

      this.logger.error('Database error occurred', {
        error: toSerializableError(error),
        operation,
        context,
      });

      throw createError(ErrorCodes.STORAGE_ERROR, message, operation, `Database error: ${code}`, {
        ...context,
        sqliteCode: code,
        isTransient: isTransientError(error),
      });
    }

    // System errors
    if (error instanceof Error) {
      this.logger.error('System error occurred', {
        error: toSerializableError(error),
        operation,
        context,
      });

      throw createError(
        ErrorCodes.STORAGE_ERROR,
        error.message,
        operation,
        'System error occurred',
        {
          ...context,
          originalError: summarizeError(error),
          isTransient: isTransientError(error),
        }
      );
    }

    // Unknown errors
    this.logger.error('Unknown error occurred', {
      error: String(error),
      operation,
      context,
    });

    throw createError(
      ErrorCodes.STORAGE_ERROR,
      'An unexpected error occurred',
      operation,
      'Unknown error type',
      context
    );
  }

  /**
   * Handle initialization errors
   */
  handleInitError(error: unknown, context?: Record<string, unknown>): never {
    return this.handleError(error, 'initialize', {
      ...context,
      phase: 'initialization',
    });
  }

  /**
   * Handle connection errors
   */
  handleConnectionError(error: unknown, context?: Record<string, unknown>): never {
    return this.handleError(error, 'connect', {
      ...context,
      phase: 'connection',
    });
  }

  /**
   * Handle transaction errors
   */
  handleTransactionError(error: unknown, context?: Record<string, unknown>): never {
    return this.handleError(error, 'transaction', {
      ...context,
      phase: 'transaction',
    });
  }

  /**
   * Handle query errors
   */
  handleQueryError(error: unknown, query: string, params?: unknown[]): never {
    return this.handleError(error, 'query', {
      query,
      params,
      phase: 'query',
    });
  }

  /**
   * Handle maintenance operation errors
   */
  handleMaintenanceError(error: unknown, operation: string): never {
    return this.handleError(error, operation, {
      phase: 'maintenance',
    });
  }

  /**
   * Handle cleanup errors
   */
  handleCleanupError(error: unknown, context?: Record<string, unknown>): never {
    return this.handleError(error, 'cleanup', {
      ...context,
      phase: 'cleanup',
    });
  }

  /**
   * Log warning without throwing
   */
  logWarning(message: string, error: unknown, context?: Record<string, unknown>): void {
    this.logger.warn(message, {
      error: error instanceof Error ? toSerializableError(error) : String(error),
      ...context,
    });
  }
}
