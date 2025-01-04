import { BaseError } from '../../errors/base-error.js';
import { ErrorCodes, createError, type ErrorCode } from '../../errors/index.js';
import {
  isDatabaseError,
  isTransientError,
  toSerializableError,
  summarizeError,
} from '../../utils/error-utils.js';
import { Logger } from '../../logging/index.js';

/**
 * SQLite error codes and their meanings
 */
export const SQLITE_ERROR_CODES = {
  SQLITE_CANTOPEN: 14, // Unable to open database file
  SQLITE_CORRUPT: 11, // Database file is corrupt
  SQLITE_FULL: 13, // Disk full or quota exceeded
  SQLITE_IOERR: 10, // I/O error during operation
  SQLITE_LOCKED: 6, // Database is locked
  SQLITE_NOTADB: 26, // File is not a database
  SQLITE_READONLY: 8, // Attempt to write to readonly database
  SQLITE_BUSY: 5, // Database is busy
};

/**
 * Helper function to create storage errors with consistent operation naming
 */
export function createStorageError(
  code: ErrorCode,
  message: string,
  operation: string = 'SqliteStorage',
  userMessage?: string,
  metadata?: Record<string, unknown>
): Error {
  return createError(code, message, `SqliteStorage.${operation}`, userMessage, metadata);
}

/**
 * Helper function to format error details for logging and error creation
 */
interface SqliteErrorDetails {
  code?: string | number;
  errno?: number;
  syscall?: string;
  description?: string;
}

interface ErrorDetails extends Record<string, unknown> {
  name: string;
  message: string;
  stack?: string;
  sqliteError?: SqliteErrorDetails;
  customProps?: Record<string, unknown>;
}

function formatErrorDetails(error: unknown): ErrorDetails {
  if (error instanceof Error) {
    const details: ErrorDetails = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };

    // Extract SQLite-specific error information
    if ('code' in error || 'errno' in error) {
      const errorObj = error as any;
      const sqliteError: SqliteErrorDetails = {
        code: errorObj.code,
        errno: errorObj.errno,
        syscall: errorObj.syscall,
      };

      // Map SQLite error codes to meaningful messages
      if (sqliteError.errno) {
        switch (sqliteError.errno) {
          case SQLITE_ERROR_CODES.SQLITE_CANTOPEN:
            sqliteError.description = 'Unable to open database file';
            break;
          case SQLITE_ERROR_CODES.SQLITE_CORRUPT:
            sqliteError.description = 'Database file is corrupt';
            break;
          case SQLITE_ERROR_CODES.SQLITE_FULL:
            sqliteError.description = 'Disk full or quota exceeded';
            break;
          case SQLITE_ERROR_CODES.SQLITE_IOERR:
            sqliteError.description = 'I/O error during operation';
            break;
          case SQLITE_ERROR_CODES.SQLITE_LOCKED:
            sqliteError.description = 'Database is locked';
            break;
          case SQLITE_ERROR_CODES.SQLITE_NOTADB:
            sqliteError.description = 'File is not a database';
            break;
          case SQLITE_ERROR_CODES.SQLITE_READONLY:
            sqliteError.description = 'Attempt to write to readonly database';
            break;
          case SQLITE_ERROR_CODES.SQLITE_BUSY:
            sqliteError.description = 'Database is busy';
            break;
        }
      }
      details.sqliteError = sqliteError;
    }

    // Include any additional custom properties
    details.customProps = Object.getOwnPropertyNames(error).reduce(
      (acc, key) => {
        if (!['name', 'message', 'stack', 'code', 'errno', 'syscall'].includes(key)) {
          acc[key] = (error as any)[key];
        }
        return acc;
      },
      {} as Record<string, unknown>
    );

    return details;
  }
  return {
    name: 'UnknownError',
    message: String(error),
    error,
  };
}

/**
 * Unified SQLite error handler with comprehensive error handling and logging
 */
export class SqliteErrorHandler {
  private readonly logger: Logger;

  constructor(component: string = 'SqliteStorage') {
    this.logger = Logger.getInstance().child({ component });
  }

  /**
   * Handle storage operation errors with comprehensive error handling and logging
   */
  handleError(error: unknown, operation: string, context?: Record<string, unknown>): never {
    // Already handled errors
    if (error instanceof BaseError) {
      throw error;
    }

    const errorDetails = formatErrorDetails(error);
    const timestamp = Date.now();

    // Database errors
    if (isDatabaseError(error)) {
      const sqliteError = error as any;
      const code = sqliteError.code || 'UNKNOWN_DB_ERROR';
      const message = sqliteError.message || 'Database operation failed';

      this.logger.error('Database error occurred', {
        error: errorDetails,
        context: {
          ...context,
          operation,
          timestamp,
          sqliteError: errorDetails.sqliteError,
        },
      });

      throw createStorageError(
        ErrorCodes.STORAGE_ERROR,
        message,
        operation,
        `Database error: ${code}`,
        {
          ...context,
          sqliteCode: code,
          isTransient: isTransientError(error),
          error: errorDetails,
        }
      );
    }

    // System errors
    if (error instanceof Error) {
      this.logger.error('System error occurred', {
        error: errorDetails,
        context: {
          ...context,
          operation,
          timestamp,
        },
      });

      throw createStorageError(
        ErrorCodes.STORAGE_ERROR,
        error.message,
        operation,
        'System error occurred',
        {
          ...context,
          originalError: summarizeError(error),
          isTransient: isTransientError(error),
          error: errorDetails,
        }
      );
    }

    // Unknown errors
    this.logger.error('Unknown error occurred', {
      error: errorDetails,
      context: {
        ...context,
        operation,
        timestamp,
      },
    });

    throw createStorageError(
      ErrorCodes.STORAGE_ERROR,
      'An unexpected error occurred',
      operation,
      'Unknown error type',
      {
        ...context,
        error: errorDetails,
      }
    );
  }

  /**
   * Handle initialization errors with detailed logging
   */
  handleInitError(error: unknown, config: Record<string, unknown>): never {
    const errorDetails = formatErrorDetails(error);
    const timestamp = Date.now();

    this.logger.error('Failed to initialize SQLite storage', {
      error: errorDetails,
      context: {
        config,
        timestamp,
        operation: 'initialize',
      },
    });

    if (errorDetails.sqliteError) {
      this.logger.error('SQLite initialization error details', {
        sqliteError: errorDetails.sqliteError,
        dbPath: config.baseDir ? `${config.baseDir}/${config.name}.db` : undefined,
        config: {
          baseDir: config.baseDir,
          name: config.name,
        },
      });
    }

    throw createStorageError(
      ErrorCodes.STORAGE_INIT,
      'Failed to initialize SQLite storage',
      'initialize',
      `Storage initialization failed: ${error instanceof Error ? error.message : String(error)}`,
      {
        config,
        error: errorDetails,
      }
    );
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
   * Handle query errors with query context
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
    const errorDetails = formatErrorDetails(error);
    this.logger.warn(message, {
      error: errorDetails,
      context: {
        ...context,
        timestamp: Date.now(),
      },
    });
  }
}
