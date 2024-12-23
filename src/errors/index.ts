/**
 * Error handling module
 * Provides centralized error handling and error types with detailed guidance
 */

import { z } from 'zod';

/**
 * Error codes enumeration with categories
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

    // Configuration errors (3000-3999)
    CONFIG_INVALID: 'CONFIG_3001',
    CONFIG_MISSING: 'CONFIG_3002',
    CONFIG_TYPE_ERROR: 'CONFIG_3003',

    // Validation errors (4000-4999)
    VALIDATION_ERROR: 'VALIDATION_4001',
    INVALID_INPUT: 'VALIDATION_4002',
    INVALID_STATE: 'VALIDATION_4003',

    // Operation errors (5000-5999)
    OPERATION_FAILED: 'OPERATION_5001',
    NOT_IMPLEMENTED: 'OPERATION_5002',
    INTERNAL_ERROR: 'OPERATION_5003',
    CONCURRENT_MODIFICATION: 'OPERATION_5004',
    TIMEOUT: 'OPERATION_5005',

    // Tool errors (6000-6999)
    TOOL_NOT_FOUND: 'TOOL_6001',
    TOOL_HANDLER_MISSING: 'TOOL_6002',
    TOOL_PARAMS_INVALID: 'TOOL_6003',
    TOOL_EXECUTION_FAILED: 'TOOL_6004',
    TOOL_STATE_INVALID: 'TOOL_6005',
    TOOL_SHUTDOWN: 'TOOL_6006'
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

/**
 * Error messages with detailed explanations and recovery suggestions
 */
export const ErrorMessages: Record<ErrorCode, { message: string; suggestion: string }> = {
    // Task errors
    [ErrorCodes.TASK_NOT_FOUND]: {
        message: 'Task not found',
        suggestion: 'Verify the task ID and ensure it exists in the system'
    },
    [ErrorCodes.TASK_VALIDATION]: {
        message: 'Task validation failed',
        suggestion: 'Check task properties against schema requirements'
    },
    [ErrorCodes.TASK_DEPENDENCY]: {
        message: 'Invalid task dependency',
        suggestion: 'Ensure all dependent tasks exist and are valid. Common issues:\n' +
                   '1. Referenced task does not exist\n' +
                   '2. Dependency creates a circular reference\n' +
                   '3. Dependent task is in a failed or blocked state\n' +
                   '4. Dependencies specified in both task and metadata (use task.dependencies instead)'
    },
    [ErrorCodes.TASK_STATUS]: {
        message: 'Invalid task status transition',
        suggestion: 'Follow the allowed status transition flow: pending → in_progress → completed'
    },
    [ErrorCodes.TASK_DUPLICATE]: {
        message: 'Task already exists',
        suggestion: 'Use a unique task identifier or update the existing task'
    },
    [ErrorCodes.TASK_INVALID_TYPE]: {
        message: 'Invalid task type',
        suggestion: 'Use one of: task, milestone, or group'
    },
    [ErrorCodes.TASK_INVALID_STATUS]: {
        message: 'Invalid task status value',
        suggestion: 'Use one of: pending, in_progress, completed, failed, or blocked'
    },
    [ErrorCodes.TASK_INVALID_PARENT]: {
        message: 'Invalid parent-child relationship',
        suggestion: 'Check parent task existence and type compatibility'
    },
    [ErrorCodes.TASK_PARENT_NOT_FOUND]: {
        message: 'Parent task not found',
        suggestion: 'Verify the parent task ID exists in the system'
    },
    [ErrorCodes.TASK_PARENT_TYPE]: {
        message: 'Invalid parent task type',
        suggestion: 'Parent tasks must be of type "group" or "milestone". Regular tasks cannot contain subtasks.'
    },
    [ErrorCodes.TASK_DUPLICATE_NAME]: {
        message: 'Duplicate task name in scope',
        suggestion: 'Task names must be unique within the same level (either as root tasks or under the same parent)'
    },
    [ErrorCodes.TASK_LOCKED]: {
        message: 'Task is locked by another operation',
        suggestion: 'Wait a few seconds and retry the operation'
    },
    [ErrorCodes.TASK_CYCLE]: {
        message: 'Circular dependency detected',
        suggestion: 'Review and restructure task dependencies to eliminate cycles. Steps to resolve:\n' +
                   '1. Identify the cycle path in the error message\n' +
                   '2. Break the cycle by removing one of the dependencies\n' +
                   '3. Consider using task ordering or parent-child relationships instead\n' +
                   '4. Ensure dependencies flow in one direction'
    },
    [ErrorCodes.TASK_INVALID_PATH]: {
        message: 'Invalid task path format',
        suggestion: 'Task paths must:\n' +
                   '1. Contain only alphanumeric characters, hyphens, and forward slashes\n' +
                   '2. Not exceed 8 levels of depth\n' +
                   '3. Not start or end with a slash\n' +
                   '4. Use lowercase characters'
    },

    // Storage errors
    [ErrorCodes.STORAGE_READ]: {
        message: 'Failed to read from storage',
        suggestion: 'Check storage permissions and connectivity'
    },
    [ErrorCodes.STORAGE_WRITE]: {
        message: 'Failed to write to storage',
        suggestion: 'Verify storage capacity and permissions'
    },
    [ErrorCodes.STORAGE_DELETE]: {
        message: 'Failed to delete from storage',
        suggestion: 'Check if item exists and you have delete permissions'
    },
    [ErrorCodes.STORAGE_ERROR]: {
        message: 'Storage operation failed',
        suggestion: 'Verify storage system health and connectivity'
    },
    [ErrorCodes.STORAGE_INIT]: {
        message: 'Failed to initialize storage',
        suggestion: 'Check storage configuration and permissions'
    },
    [ErrorCodes.STORAGE_INIT_ERROR]: {
        message: 'Storage initialization error',
        suggestion: 'Verify storage prerequisites and configuration'
    },

    // Configuration errors
    [ErrorCodes.CONFIG_INVALID]: {
        message: 'Invalid configuration',
        suggestion: 'Review configuration against schema requirements'
    },
    [ErrorCodes.CONFIG_MISSING]: {
        message: 'Required configuration missing',
        suggestion: 'Provide all required configuration parameters'
    },
    [ErrorCodes.CONFIG_TYPE_ERROR]: {
        message: 'Configuration type error',
        suggestion: 'Ensure configuration values match expected types'
    },

    // Validation errors
    [ErrorCodes.VALIDATION_ERROR]: {
        message: 'Validation failed',
        suggestion: 'Check input against validation requirements. Common issues: missing required fields, invalid field types, or constraint violations. Review the validation error details for specific field issues.'
    },
    [ErrorCodes.INVALID_INPUT]: {
        message: 'Invalid input provided',
        suggestion: 'Review input format and requirements'
    },
    [ErrorCodes.INVALID_STATE]: {
        message: 'Invalid state',
        suggestion: 'Ensure operation is valid for current state'
    },

    // Operation errors
    [ErrorCodes.OPERATION_FAILED]: {
        message: 'Operation failed',
        suggestion: 'Check error details and retry operation'
    },
    [ErrorCodes.NOT_IMPLEMENTED]: {
        message: 'Feature not implemented',
        suggestion: 'This feature is planned but not yet available'
    },
    [ErrorCodes.INTERNAL_ERROR]: {
        message: 'Internal error occurred',
        suggestion: 'Contact system administrator if problem persists'
    },
    [ErrorCodes.CONCURRENT_MODIFICATION]: {
        message: 'Concurrent modification detected',
        suggestion: 'Refresh data and retry operation'
    },
    [ErrorCodes.TIMEOUT]: {
        message: 'Operation timed out',
        suggestion: 'Check system load and retry operation'
    },

    // Tool errors
    [ErrorCodes.TOOL_NOT_FOUND]: {
        message: 'Tool not found',
        suggestion: 'Verify the tool name and ensure it is registered in the system'
    },
    [ErrorCodes.TOOL_HANDLER_MISSING]: {
        message: 'Tool handler not implemented',
        suggestion: 'This is a system configuration issue. Contact the administrator.'
    },
    [ErrorCodes.TOOL_PARAMS_INVALID]: {
        message: 'Invalid tool parameters',
        suggestion: 'Check the tool documentation for required parameters and their formats'
    },
    [ErrorCodes.TOOL_EXECUTION_FAILED]: {
        message: 'Tool execution failed',
        suggestion: 'Review error details and verify all prerequisites are met'
    },
    [ErrorCodes.TOOL_STATE_INVALID]: {
        message: 'Invalid tool state',
        suggestion: 'The tool cannot perform this operation in its current state. Common issues:\n' +
                   '1. Database is not initialized\n' +
                   '2. Required resources are locked\n' +
                   '3. System is in an invalid state'
    },
    [ErrorCodes.TOOL_SHUTDOWN]: {
        message: 'Tool system is shutting down',
        suggestion: 'Wait for system restart before retrying operations'
    }
};

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
        this.suggestion = suggestion || ErrorMessages[code]?.suggestion;
    }

    /**
     * Gets a user-friendly error message with guidance
     */
    public getUserMessage(): string {
        const baseMessage = this.message || ErrorMessages[this.code]?.message;
        const suggestion = this.suggestion || ErrorMessages[this.code]?.suggestion;
        return `${baseMessage}${suggestion ? `\nSuggestion: ${suggestion}` : ''}`;
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
    constructor(
        code: ErrorCode,
        message: string,
        public readonly validationErrors?: Array<{
            field: string;
            error: string;
            received?: unknown;
            expected?: string;
        }>,
        details?: unknown,
        suggestion?: string
    ) {
        const formattedMessage = validationErrors 
            ? `${message}\nValidation Errors:\n${validationErrors.map(
                err => `- ${err.field}: ${err.error}${err.received ? ` (received: ${JSON.stringify(err.received)})` : ''}${err.expected ? ` (expected: ${err.expected})` : ''}`
              ).join('\n')}`
            : message;
        super(code, formattedMessage, details, suggestion);
    }

    /**
     * Creates a validation error from Zod validation issues
     */
    static fromZodError(error: z.ZodError): ValidationError {
        const validationErrors = error.errors.map((err: z.ZodIssue) => {
            const base = {
                field: err.path.join('.'),
                error: err.message
            };

            // Handle different types of Zod issues
            if (err.code === 'invalid_type') {
                return {
                    ...base,
                    received: err.received,
                    expected: err.expected
                };
            }

            if (err.code === 'invalid_enum_value') {
                return {
                    ...base,
                    received: err.received,
                    expected: err.options.join(' | ')
                };
            }

            if (err.code === 'too_small') {
                return {
                    ...base,
                    received: 'value too small',
                    expected: `${err.type === 'string' ? 'length' : 'value'} >= ${(err as z.ZodTooSmallIssue).minimum}`
                };
            }

            if (err.code === 'too_big') {
                return {
                    ...base,
                    received: 'value too big',
                    expected: `${err.type === 'string' ? 'length' : 'value'} <= ${(err as z.ZodTooBigIssue).maximum}`
                };
            }

            // Default case for other types of errors
            return base;
        });

        return new ValidationError(
            ErrorCodes.VALIDATION_ERROR,
            'Task validation failed',
            validationErrors
        );
    }
}

/**
 * Creates an error with a standard message and suggestion
 */
export function createError(
    code: ErrorCode,
    details?: unknown,
    customMessage?: string,
    customSuggestion?: string
): BaseError {
    const message = customMessage || ErrorMessages[code]?.message;
    const suggestion = customSuggestion || ErrorMessages[code]?.suggestion;

    switch (code) {
        case ErrorCodes.TASK_NOT_FOUND:
        case ErrorCodes.TASK_VALIDATION:
        case ErrorCodes.TASK_DEPENDENCY:
        case ErrorCodes.TASK_STATUS:
        case ErrorCodes.TASK_DUPLICATE:
        case ErrorCodes.TASK_INVALID_TYPE:
        case ErrorCodes.TASK_INVALID_STATUS:
        case ErrorCodes.TASK_INVALID_PARENT:
        case ErrorCodes.TASK_LOCKED:
        case ErrorCodes.TASK_CYCLE:
            return new TaskError(code, message, details, suggestion);

        case ErrorCodes.CONFIG_INVALID:
        case ErrorCodes.CONFIG_MISSING:
        case ErrorCodes.CONFIG_TYPE_ERROR:
            return new ConfigError(code, message, details, suggestion);

        case ErrorCodes.STORAGE_READ:
        case ErrorCodes.STORAGE_WRITE:
        case ErrorCodes.STORAGE_DELETE:
        case ErrorCodes.STORAGE_ERROR:
        case ErrorCodes.STORAGE_INIT:
        case ErrorCodes.STORAGE_INIT_ERROR:
            return new StorageError(code, message, details, suggestion);

        case ErrorCodes.VALIDATION_ERROR:
        case ErrorCodes.INVALID_INPUT:
        case ErrorCodes.INVALID_STATE:
            if (details instanceof z.ZodError) {
                return ValidationError.fromZodError(details);
            }
            return new ValidationError(code, message, undefined, details, suggestion);

        default:
            return new BaseError(code, message, details, suggestion);
    }
}

/**
 * Wraps an error with additional context
 */
export function wrapError(error: unknown, context: string): BaseError {
    if (error instanceof BaseError) {
        return new BaseError(
            error.code,
            `${context}: ${error.message}`,
            error.details,
            error.suggestion
        );
    }
    return new BaseError(
        ErrorCodes.INTERNAL_ERROR,
        `${context}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error,
        ErrorMessages[ErrorCodes.INTERNAL_ERROR].suggestion
    );
}

/**
 * Type guard for BaseError
 */
export function isBaseError(error: unknown): error is BaseError {
    return error instanceof BaseError;
}

/**
 * Gets a user-friendly error message with guidance
 */
export function getUserErrorMessage(error: unknown): string {
    if (error instanceof BaseError) {
        return error.getUserMessage();
    }
    const defaultError = ErrorMessages[ErrorCodes.INTERNAL_ERROR];
    return `${defaultError.message}\nSuggestion: ${defaultError.suggestion}`;
}

/**
 * Error handler type
 */
export type ErrorHandler = (error: unknown) => void;

/**
 * Creates a default error handler with context
 */
export function createErrorHandler(context: string): ErrorHandler {
    return (error: unknown) => {
        const message = error instanceof BaseError ? error.getUserMessage() : String(error);
        console.error(`[${context}] ${message}`);
    };
}
