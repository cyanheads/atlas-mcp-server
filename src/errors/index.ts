/**
 * Error handling and error code definitions
 */
export const ErrorCodes = {
    // Task errors (1000-1999)
    TASK_NOT_FOUND: 'TASK_1001',
    TASK_VALIDATION: 'TASK_1002',
    TASK_DEPENDENCY: 'TASK_1003',
    TASK_STATUS: 'TASK_1004',
    TASK_DUPLICATE: 'TASK_1005',
    TASK_INVALID_PATH: 'TASK_1014',
    TASK_INVALID_TYPE: 'TASK_1006',
    TASK_INVALID_STATUS: 'TASK_1007',
    TASK_INVALID_PARENT: 'TASK_1008',
    TASK_PARENT_NOT_FOUND: 'TASK_1009',
    TASK_PARENT_TYPE: 'TASK_1010',
    TASK_DUPLICATE_NAME: 'TASK_1011',
    TASK_LOCKED: 'TASK_1012',
    TASK_CYCLE: 'TASK_1013',

    // Storage errors (2000-2999)
    STORAGE_READ: 'STORAGE_2001',
    STORAGE_WRITE: 'STORAGE_2002',
    STORAGE_DELETE: 'STORAGE_2003',
    STORAGE_ERROR: 'STORAGE_2004',
    STORAGE_INIT: 'STORAGE_2005',
    STORAGE_INIT_ERROR: 'STORAGE_2006',
    STORAGE_TRANSACTION: 'STORAGE_2007',

    // Configuration errors (3000-3999)
    CONFIG_INVALID: 'CONFIG_3001',
    CONFIG_MISSING: 'CONFIG_3002',
    CONFIG_TYPE_ERROR: 'CONFIG_3003',

    // Validation errors (4000-4999)
    VALIDATION_ERROR: 'VALIDATION_4001',
    INVALID_INPUT: 'VALIDATION_4002',
    INVALID_STATE: 'VALIDATION_4003',
    INVALID_PATH: 'VALIDATION_4004',
    INVALID_TYPE: 'VALIDATION_4005',
    INVALID_STATUS: 'VALIDATION_4006',
    INVALID_METADATA: 'VALIDATION_4007',

    // Operation errors (5000-5999)
    OPERATION_FAILED: 'OPERATION_5001',
    NOT_IMPLEMENTED: 'OPERATION_5002',
    INTERNAL_ERROR: 'OPERATION_5003',
    CONCURRENT_MODIFICATION: 'OPERATION_5004',
    TIMEOUT: 'OPERATION_5005',
    OPERATION_CANCELLED: 'OPERATION_5006',
    OPERATION_CONFLICT: 'OPERATION_5007',
    BULK_OPERATION_ERROR: 'OPERATION_5008',

    // Cache errors (6000-6999)
    CACHE_ERROR: 'CACHE_6001',
    CACHE_MISS: 'CACHE_6002',
    CACHE_FULL: 'CACHE_6003',
    CACHE_INVALID: 'CACHE_6004',

    // Tool errors (7000-7999)
    TOOL_NOT_FOUND: 'TOOL_7001',
    TOOL_HANDLER_MISSING: 'TOOL_7002',
    TOOL_PARAMS_INVALID: 'TOOL_7003',
    TOOL_EXECUTION_FAILED: 'TOOL_7004',
    TOOL_STATE_INVALID: 'TOOL_7005',
    TOOL_SHUTDOWN: 'TOOL_7006',
    TOOL_EXECUTION: 'TOOL_7007',
    TOOL_TIMEOUT: 'TOOL_7008',
    TOOL_VALIDATION: 'TOOL_7009',
    TOOL_INITIALIZATION: 'TOOL_7010'
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

interface ErrorContext {
    [key: string]: unknown;
}

/**
 * Creates a standardized error object with detailed information
 */
export function createError(
    code: ErrorCode,
    context: ErrorContext | string,
    message?: string,
    details?: string
): Error {
    const error = new Error(typeof context === 'string' ? context : message || 'An error occurred');
    const errorContext = typeof context === 'string' ? {} : context;

    Object.assign(error, {
        code,
        context: errorContext,
        details,
        timestamp: new Date().toISOString()
    });

    return error;
}

/**
 * Checks if an error is a known error type
 */
/**
 * Base error class for all application errors
 */
export class BaseError extends Error {
    constructor(
        public readonly code: ErrorCode,
        message: string,
        public readonly details?: unknown,
        public readonly suggestion?: string
    ) {
        super(message);
        this.name = this.constructor.name;
    }
}

/**
 * Task-related errors
 */
export class TaskError extends BaseError {
    constructor(code: ErrorCode, message: string, details?: unknown, suggestion?: string) {
        super(code, message, details, suggestion);
    }
}

/**
 * Configuration-related errors
 */
export class ConfigError extends BaseError {
    constructor(code: ErrorCode, message: string, details?: unknown, suggestion?: string) {
        super(code, message, details, suggestion);
    }
}

/**
 * Storage-related errors
 */
export class StorageError extends BaseError {
    constructor(code: ErrorCode, message: string, details?: unknown, suggestion?: string) {
        super(code, message, details, suggestion);
    }
}

/**
 * Validation-related errors
 */
export class ValidationError extends BaseError {
    constructor(code: ErrorCode, message: string, details?: unknown, suggestion?: string) {
        super(code, message, details, suggestion);
    }
}

export function isKnownError(error: unknown): error is Error & { code: ErrorCode } {
    return error instanceof Error && 'code' in error;
}

/**
 * Gets a human-readable description for an error code
 */
export function getErrorDescription(code: ErrorCode): string {
    const descriptions: Record<ErrorCode, string> = {
        // Task errors (1000-1999)
        'TASK_1001': 'Task not found',
        'TASK_1002': 'Task validation failed',
        'TASK_1003': 'Task dependency error',
        'TASK_1004': 'Invalid task status',
        'TASK_1005': 'Duplicate task',
        'TASK_1014': 'Invalid task path',
        'TASK_1006': 'Invalid task type',
        'TASK_1007': 'Invalid task status value',
        'TASK_1008': 'Invalid parent-child relationship',
        'TASK_1009': 'Parent task not found',
        'TASK_1010': 'Invalid parent task type',
        'TASK_1011': 'Duplicate task name in scope',
        'TASK_1012': 'Task is locked by another operation',
        'TASK_1013': 'Circular dependency detected',

        // Storage errors (2000-2999)
        'STORAGE_2001': 'Failed to read from storage',
        'STORAGE_2002': 'Failed to write to storage',
        'STORAGE_2003': 'Failed to delete from storage',
        'STORAGE_2004': 'Storage operation failed',
        'STORAGE_2005': 'Failed to initialize storage',
        'STORAGE_2006': 'Storage initialization error',
        'STORAGE_2007': 'Transaction error',

        // Configuration errors (3000-3999)
        'CONFIG_3001': 'Invalid configuration',
        'CONFIG_3002': 'Required configuration missing',
        'CONFIG_3003': 'Configuration type error',

        // Validation errors (4000-4999)
        'VALIDATION_4001': 'Validation failed',
        'VALIDATION_4002': 'Invalid input provided',
        'VALIDATION_4003': 'Invalid state',
        'VALIDATION_4004': 'Invalid path format',
        'VALIDATION_4005': 'Invalid type',
        'VALIDATION_4006': 'Invalid status',
        'VALIDATION_4007': 'Invalid metadata',

        // Operation errors (5000-5999)
        'OPERATION_5001': 'Operation failed',
        'OPERATION_5002': 'Feature not implemented',
        'OPERATION_5003': 'Internal error occurred',
        'OPERATION_5004': 'Concurrent modification detected',
        'OPERATION_5005': 'Operation timed out',
        'OPERATION_5006': 'Operation cancelled',
        'OPERATION_5007': 'Operation conflict',
        'OPERATION_5008': 'Bulk operation error',

        // Cache errors (6000-6999)
        'CACHE_6001': 'Cache error',
        'CACHE_6002': 'Cache miss',
        'CACHE_6003': 'Cache full',
        'CACHE_6004': 'Invalid cache entry',

        // Tool errors (7000-7999)
        'TOOL_7001': 'Tool not found',
        'TOOL_7002': 'Tool handler not implemented',
        'TOOL_7003': 'Invalid tool parameters',
        'TOOL_7004': 'Tool execution failed',
        'TOOL_7005': 'Invalid tool state',
        'TOOL_7006': 'Tool system is shutting down',
        'TOOL_7007': 'Tool execution error',
        'TOOL_7008': 'Tool execution timed out',
        'TOOL_7009': 'Tool validation failed',
        'TOOL_7010': 'Tool initialization failed'
    };

    return descriptions[code] || 'Unknown error';
}
