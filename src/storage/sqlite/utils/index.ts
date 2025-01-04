/**
 * Storage utility exports
 */

export { StoragePathUtils } from './storage-path-utils.js';
export { StorageErrorHandler } from './storage-error-handler.js';

// Re-export platform utilities for convenience
export { PlatformPaths, PlatformCapabilities, ProcessManager } from '../../utils/platform-utils.js';

// Re-export error utilities
export {
  isDatabaseError,
  isTransientError,
  toSerializableError,
  summarizeError,
} from '../../utils/error-utils.js';

/**
 * Storage-specific constants
 */
export const STORAGE_CONSTANTS = {
  // Default file extensions
  FILE_EXTENSIONS: ['.db', '.sqlite', '.sqlite3'],

  // Default file names
  DEFAULT_DB_NAME: 'storage.sqlite',
  WAL_EXTENSION: '-wal',
  SHM_EXTENSION: '-shm',
  JOURNAL_EXTENSION: '-journal',

  // Size limits (in bytes)
  MAX_DB_SIZE: 1024 * 1024 * 1024 * 10, // 10GB
  MAX_WAL_SIZE: 1024 * 1024 * 100, // 100MB
  MIN_FREE_SPACE: 1024 * 1024 * 100, // 100MB required

  // Timeouts (in milliseconds)
  BUSY_TIMEOUT: 5000,
  LOCK_TIMEOUT: 10000,
  CHECKPOINT_INTERVAL: 300000, // 5 minutes
  VACUUM_INTERVAL: 3600000, // 1 hour

  // Query limits
  MAX_VARIABLES: 999, // SQLite limit
  MAX_COMPOUND_SELECT: 500,
  MAX_RECURSIVE_DEPTH: 1000,

  // Connection pool settings
  MIN_POOL_SIZE: 1,
  MAX_POOL_SIZE: 10,
  CONNECTION_TIMEOUT: 15000,
  IDLE_TIMEOUT: 60000,

  // Error retry settings
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000,
  RETRY_MULTIPLIER: 2,

  // Feature flags
  ENABLE_WAL: true,
  ENABLE_SHARED_CACHE: true,
  ENABLE_MEMORY_MAPPING: true,
  ENABLE_FOREIGN_KEYS: true,
} as const;

/**
 * Storage error codes
 */
export const STORAGE_ERROR_CODES = {
  // Connection errors
  CONNECTION_FAILED: 'STORAGE_CONNECTION_FAILED',
  CONNECTION_LOST: 'STORAGE_CONNECTION_LOST',
  CONNECTION_BUSY: 'STORAGE_CONNECTION_BUSY',
  CONNECTION_TIMEOUT: 'STORAGE_CONNECTION_TIMEOUT',

  // Transaction errors
  TRANSACTION_FAILED: 'STORAGE_TRANSACTION_FAILED',
  TRANSACTION_TIMEOUT: 'STORAGE_TRANSACTION_TIMEOUT',
  TRANSACTION_DEADLOCK: 'STORAGE_TRANSACTION_DEADLOCK',
  TRANSACTION_ROLLBACK: 'STORAGE_TRANSACTION_ROLLBACK',

  // Query errors
  QUERY_FAILED: 'STORAGE_QUERY_FAILED',
  QUERY_TIMEOUT: 'STORAGE_QUERY_TIMEOUT',
  QUERY_SYNTAX: 'STORAGE_QUERY_SYNTAX',
  QUERY_CONSTRAINT: 'STORAGE_QUERY_CONSTRAINT',

  // Resource errors
  RESOURCE_NOT_FOUND: 'STORAGE_RESOURCE_NOT_FOUND',
  RESOURCE_EXISTS: 'STORAGE_RESOURCE_EXISTS',
  RESOURCE_LOCKED: 'STORAGE_RESOURCE_LOCKED',
  RESOURCE_CORRUPT: 'STORAGE_RESOURCE_CORRUPT',

  // System errors
  SYSTEM_ERROR: 'STORAGE_SYSTEM_ERROR',
  OUT_OF_MEMORY: 'STORAGE_OUT_OF_MEMORY',
  DISK_FULL: 'STORAGE_DISK_FULL',
  IO_ERROR: 'STORAGE_IO_ERROR',
} as const;

/**
 * Storage operation phases
 */
export const STORAGE_PHASES = {
  INITIALIZATION: 'initialization',
  CONNECTION: 'connection',
  TRANSACTION: 'transaction',
  QUERY: 'query',
  MAINTENANCE: 'maintenance',
  CLEANUP: 'cleanup',
} as const;
