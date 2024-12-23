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
    TASK_INVALID_PARENT: 'TASK_1006',
    TASK_CYCLE: 'TASK_1007',

    // Storage errors (2000-2999)
    STORAGE_ERROR: 'STORAGE_2001',
    STORAGE_INIT: 'STORAGE_2002',
    STORAGE_READ: 'STORAGE_2003',
    STORAGE_WRITE: 'STORAGE_2004',
    STORAGE_DELETE: 'STORAGE_2005',
    STORAGE_TRANSACTION: 'STORAGE_2006',

    // Validation errors (3000-3999)
    INVALID_INPUT: 'VALIDATION_3001',
    INVALID_PATH: 'VALIDATION_3002',
    INVALID_TYPE: 'VALIDATION_3003',
    INVALID_STATUS: 'VALIDATION_3004',
    INVALID_METADATA: 'VALIDATION_3005',

    // Operation errors (4000-4999)
    OPERATION_FAILED: 'OPERATION_4001',
    OPERATION_TIMEOUT: 'OPERATION_4002',
    OPERATION_CANCELLED: 'OPERATION_4003',
    OPERATION_CONFLICT: 'OPERATION_4004',
    BULK_OPERATION_ERROR: 'OPERATION_4005',

    // Cache errors (5000-5999)
    CACHE_ERROR: 'CACHE_5001',
    CACHE_MISS: 'CACHE_5002',
    CACHE_FULL: 'CACHE_5003',
    CACHE_INVALID: 'CACHE_5004',

    // Tool errors (6000-6999)
    TOOL_NOT_FOUND: 'TOOL_6001',
    TOOL_EXECUTION: 'TOOL_6002',
    TOOL_TIMEOUT: 'TOOL_6003',
    TOOL_VALIDATION: 'TOOL_6004',
    TOOL_INITIALIZATION: 'TOOL_6005',
    TOOL_SHUTDOWN: 'TOOL_6006'
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
export function isKnownError(error: unknown): error is Error & { code: ErrorCode } {
    return error instanceof Error && 'code' in error;
}

/**
 * Gets a human-readable description for an error code
 */
export function getErrorDescription(code: ErrorCode): string {
    const descriptions: Record<ErrorCode, string> = {
        // Task errors
        TASK_1001: 'Task not found',
        TASK_1002: 'Task validation failed',
        TASK_1003: 'Task dependency error',
        TASK_1004: 'Invalid task status',
        TASK_1005: 'Duplicate task',
        TASK_1006: 'Invalid parent task',
        TASK_1007: 'Dependency cycle detected',

        // Storage errors
        STORAGE_2001: 'Storage operation failed',
        STORAGE_2002: 'Storage initialization failed',
        STORAGE_2003: 'Storage read failed',
        STORAGE_2004: 'Storage write failed',
        STORAGE_2005: 'Storage delete failed',
        STORAGE_2006: 'Transaction error',

        // Validation errors
        VALIDATION_3001: 'Invalid input',
        VALIDATION_3002: 'Invalid path',
        VALIDATION_3003: 'Invalid type',
        VALIDATION_3004: 'Invalid status',
        VALIDATION_3005: 'Invalid metadata',

        // Operation errors
        OPERATION_4001: 'Operation failed',
        OPERATION_4002: 'Operation timed out',
        OPERATION_4003: 'Operation cancelled',
        OPERATION_4004: 'Operation conflict',
        OPERATION_4005: 'Bulk operation error',

        // Cache errors
        CACHE_5001: 'Cache error',
        CACHE_5002: 'Cache miss',
        CACHE_5003: 'Cache full',
        CACHE_5004: 'Invalid cache entry',

        // Tool errors
        TOOL_6001: 'Tool not found',
        TOOL_6002: 'Tool execution failed',
        TOOL_6003: 'Tool execution timed out',
        TOOL_6004: 'Tool validation failed',
        TOOL_6005: 'Tool initialization failed',
        TOOL_6006: 'Tool shutdown failed'
    };

    return descriptions[code] || 'Unknown error';
}
