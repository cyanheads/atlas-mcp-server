/**
 * @file errorHandler.ts
 * @description This module provides utilities for creating and managing request contexts.
 * A request context is a data structure associated with a specific request or operation,
 * carrying a unique ID, timestamp, and other relevant information for logging, tracing,
 * and processing.
 */
import { BaseErrorCode, McpError } from '../../types-global/errors.js';
import { sanitizeInputForLogging } from '../index.js';
import { logger } from './logger.js';

/**
 * @interface ErrorContext
 * @description Defines a generic structure for providing context with errors.
 * This context can include identifiers like `requestId` or any other relevant
 * key-value pairs that aid in debugging or understanding the error's circumstances.
 */
export interface ErrorContext {
  /**
   * A unique identifier for the request or operation during which the error occurred.
   * Useful for tracing errors through logs and distributed systems.
   * @type {string}
   * @optional
   */
  requestId?: string;

  /**
   * Allows for arbitrary additional context information.
   * Keys are strings, and values can be of any type.
   */
  [key: string]: unknown;
}

/**
 * @interface ErrorHandlerOptions
 * @description Configuration options for the `ErrorHandler.handleError` method.
 * These options control how an error is processed, logged, and whether it's rethrown.
 */
export interface ErrorHandlerOptions {
  /**
   * The context of the operation that caused the error.
   * This can include `requestId` and other relevant debugging information.
   * @type {ErrorContext}
   * @optional
   */
  context?: ErrorContext;

  /**
   * A descriptive name of the operation being performed when the error occurred.
   * This helps in identifying the source or nature of the error in logs.
   * Example: "UserLogin", "ProcessPayment", "FetchUserProfile".
   * @type {string}
   * @required
   */
  operation: string;

  /**
   * The input data or parameters that were being processed when the error occurred.
   * This input will be sanitized before logging to prevent sensitive data exposure.
   * @type {unknown}
   * @optional
   */
  input?: unknown;

  /**
   * If true, the (potentially transformed) error will be rethrown after handling.
   * Defaults to `false`.
   * @type {boolean}
   * @optional
   */
  rethrow?: boolean;

  /**
   * A specific `BaseErrorCode` to assign to the error, overriding any
   * automatically determined error code.
   * @type {BaseErrorCode}
   * @optional
   */
  errorCode?: BaseErrorCode;

  /**
   * A custom function to map or transform the original error into a new `Error` instance.
   * If provided, this function is used instead of the default `McpError` creation.
   * @param {unknown} error - The original error that occurred.
   * @returns {Error} The transformed error.
   * @optional
   */
  errorMapper?: (error: unknown) => Error;

  /**
   * If true, stack traces will be included in the logs.
   * Defaults to `true`.
   * @type {boolean}
   * @optional
   */
  includeStack?: boolean;

  /**
   * If true, indicates that the error is critical and might require immediate attention
   * or could lead to system instability. This is primarily for logging and alerting.
   * Defaults to `false`.
   * @type {boolean}
   * @optional
   */
  critical?: boolean;
}

/**
 * @interface BaseErrorMapping
 * @description Defines a basic rule for mapping errors based on patterns.
 * Used internally by `COMMON_ERROR_PATTERNS` and as a base for `ErrorMapping`.
 */
export interface BaseErrorMapping {
  /**
   * A string or regular expression to match against the error message.
   * If a string is provided, it's typically used for substring matching (case-insensitive).
   * @type {string | RegExp}
   * @required
   */
  pattern: string | RegExp;

  /**
   * The `BaseErrorCode` to assign if the pattern matches.
   * @type {BaseErrorCode}
   * @required
   */
  errorCode: BaseErrorCode;

  /**
   * An optional custom message template for the mapped error.
   * (Note: This property is defined but not directly used by `ErrorHandler.determineErrorCode`
   * which focuses on `errorCode`. It's more relevant for custom mapping logic.)
   * @type {string}
   * @optional
   */
  messageTemplate?: string;
}

/**
 * @interface ErrorMapping
 * @template T - The type of `Error` this mapping will produce, defaults to `Error`.
 * @description Extends `BaseErrorMapping` to include a factory function for creating
 * specific error instances and additional context for the mapping.
 * Used by `ErrorHandler.mapError`.
 */
export interface ErrorMapping<T extends Error = Error> extends BaseErrorMapping {
  /**
   * A factory function that creates and returns an instance of the mapped error type `T`.
   * @param {unknown} error - The original error that occurred.
   * @param {Record<string, unknown>} [context] - Optional additional context provided in the mapping rule.
   * @returns {T} The newly created error instance.
   * @required
   */
  factory: (error: unknown, context?: Record<string, unknown>) => T;

  /**
   * Additional static context to be merged or passed to the `factory` function
   * when this mapping rule is applied.
   * @type {Record<string, unknown>}
   * @optional
   */
  additionalContext?: Record<string, unknown>;
}

/**
 * @constant ERROR_TYPE_MAPPINGS
 * @description Maps standard JavaScript error constructor names to `BaseErrorCode` values.
 * This allows for quick classification of common built-in error types.
 * @readonly
 */
const ERROR_TYPE_MAPPINGS: Readonly<Record<string, BaseErrorCode>> = {
  'SyntaxError': BaseErrorCode.VALIDATION_ERROR,
  'TypeError': BaseErrorCode.VALIDATION_ERROR,
  'ReferenceError': BaseErrorCode.INTERNAL_ERROR,
  'RangeError': BaseErrorCode.VALIDATION_ERROR,
  'URIError': BaseErrorCode.VALIDATION_ERROR,
  'EvalError': BaseErrorCode.INTERNAL_ERROR,
};

/**
 * @constant COMMON_ERROR_PATTERNS
 * @description An array of `BaseErrorMapping` rules used to automatically classify
 * errors based on keywords or patterns found in their messages or names.
 * These patterns are typically case-insensitive.
 * **IMPORTANT**: The order of patterns matters. More specific patterns should generally come
 * before more generic ones if there's a possibility of overlap, as the first match is used.
 * @readonly
 */
const COMMON_ERROR_PATTERNS: ReadonlyArray<Readonly<BaseErrorMapping>> = [
  { pattern: /auth|unauthorized|unauthenticated|not.*logged.*in|invalid.*token|expired.*token/i, errorCode: BaseErrorCode.UNAUTHORIZED },
  { pattern: /permission|forbidden|access.*denied|not.*allowed/i, errorCode: BaseErrorCode.FORBIDDEN },
  { pattern: /not.*found|missing|no.*such|doesn't.*exist|couldn't.*find/i, errorCode: BaseErrorCode.NOT_FOUND },
  { pattern: /invalid|validation|malformed|bad request|wrong format|missing.*required/i, errorCode: BaseErrorCode.VALIDATION_ERROR },
  { pattern: /conflict|already.*exists|duplicate|unique.*constraint/i, errorCode: BaseErrorCode.CONFLICT },
  { pattern: /rate.*limit|too.*many.*requests|throttled/i, errorCode: BaseErrorCode.RATE_LIMITED },
  { pattern: /timeout|timed.*out|deadline.*exceeded/i, errorCode: BaseErrorCode.TIMEOUT },
  { pattern: /service.*unavailable|bad.*gateway|gateway.*timeout|upstream.*error/i, errorCode: BaseErrorCode.SERVICE_UNAVAILABLE },
];

/**
 * Creates a "safe" RegExp for testing error messages.
 * Ensures case-insensitivity if not already specified and removes the global flag.
 * @param pattern - The string or RegExp pattern.
 * @returns A new RegExp instance.
 */
function createSafeRegex(pattern: string | RegExp): RegExp {
  if (pattern instanceof RegExp) {
    let flags = pattern.flags.replace('g', ''); // Remove global flag
    if (!flags.includes('i')) {
      flags += 'i'; // Add case-insensitive if not present
    }
    return new RegExp(pattern.source, flags);
  }
  return new RegExp(pattern, 'i'); // Default to case-insensitive for string patterns
}

/**
 * Retrieves a descriptive name for an error object or value.
 * Handles various types including `Error` instances, `null`, `undefined`, and other primitives/objects.
 *
 * @param error - The error object or value.
 * @returns A string representing the error's name or type.
 */
function getErrorName(error: unknown): string {
  if (error instanceof Error) {
    return error.name || 'Error';
  }
  if (error === null) {
    return 'NullValueEncountered';
  }
  if (error === undefined) {
    return 'UndefinedValueEncountered';
  }
  if (typeof error === 'object' && error !== null && error.constructor && typeof error.constructor.name === 'string' && error.constructor.name !== 'Object') {
    return `${error.constructor.name}Encountered`;
  }
  return `${typeof error}Encountered`;
}

/**
 * Extracts a message string from an error object or value.
 * Handles `Error` instances, primitives, and converts other types to a string representation.
 *
 * @param error - The error object or value.
 * @returns The error message string.
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (error === null) {
    return 'Null value encountered as error';
  }
  if (error === undefined) {
    return 'Undefined value encountered as error';
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    const str = String(error);
    if (str === '[object Object]' && error !== null) {
      try {
        return `Non-Error object encountered: ${JSON.stringify(error)}`;
      } catch (stringifyError) {
        return `Unstringifyable non-Error object encountered (constructor: ${error.constructor?.name || 'Unknown'})`;
      }
    }
    return str;
  } catch (e) {
    return `Error converting error to string: ${e instanceof Error ? e.message : 'Unknown conversion error'}`;
  }
}

/**
 * @class ErrorHandler
 * @description A utility class providing static methods for comprehensive error handling.
 */
export class ErrorHandler {
  /**
   * Determines an appropriate `BaseErrorCode` for a given error.
   */
  public static determineErrorCode(error: unknown): BaseErrorCode {
    if (error instanceof McpError) {
      return error.code;
    }

    const errorName = getErrorName(error);
    const errorMessage = getErrorMessage(error);

    if (errorName in ERROR_TYPE_MAPPINGS) {
      return ERROR_TYPE_MAPPINGS[errorName as keyof typeof ERROR_TYPE_MAPPINGS];
    }

    for (const mapping of COMMON_ERROR_PATTERNS) {
      const regex = createSafeRegex(mapping.pattern);
      if (regex.test(errorMessage) || regex.test(errorName)) {
        return mapping.errorCode;
      }
    }
    return BaseErrorCode.INTERNAL_ERROR;
  }

  /**
   * Handles an error with consistent logging and optional transformation.
   */
  public static handleError(error: unknown, options: ErrorHandlerOptions): Error {
    const {
      context = {},
      operation,
      input,
      rethrow = false,
      errorCode: explicitErrorCode,
      includeStack = true,
      critical = false,
      errorMapper,
    } = options;

    const sanitizedInput = input !== undefined ? sanitizeInputForLogging(input) : undefined;
    const originalErrorName = getErrorName(error);
    const originalErrorMessage = getErrorMessage(error);
    const originalStack = error instanceof Error ? error.stack : undefined;

    let finalError: Error;
    let loggedErrorCode: BaseErrorCode;

    // Consolidate details for McpError and logging
    const errorDetailsSeed = error instanceof McpError && typeof error.details === 'object' && error.details !== null
      ? { ...error.details } // Clone to avoid mutating original
      : {};

    const consolidatedDetails: Record<string, unknown> = {
      ...errorDetailsSeed,
      ...context, // Operation context takes precedence over seed details if keys overlap
      originalErrorName,
      originalMessage: originalErrorMessage,
    };
    if (originalStack && !(error instanceof McpError && error.details?.originalStack)) { // Avoid duplicating if already there
        consolidatedDetails.originalStack = originalStack;
    }


    if (error instanceof McpError) {
      loggedErrorCode = error.code;
      finalError = errorMapper ? errorMapper(error) : new McpError(error.code, error.message, consolidatedDetails);
      if (finalError instanceof McpError && !finalError.details) {
        (finalError as McpError).details = consolidatedDetails;
      }
    } else {
      loggedErrorCode = explicitErrorCode || ErrorHandler.determineErrorCode(error);
      const message = `Error in ${operation}: ${originalErrorMessage}`;
      finalError = errorMapper ? errorMapper(error) : new McpError(loggedErrorCode, message, consolidatedDetails);
      if (finalError instanceof McpError && !finalError.details) {
         (finalError as McpError).details = consolidatedDetails;
      }
    }

    // Preserve original stack if the finalError is a new Error instance and original was an Error
    if (finalError !== error && error instanceof Error && finalError instanceof Error && !finalError.stack && error.stack) {
      finalError.stack = error.stack;
    }


    // Prepare log payload
    const logPayload: Record<string, unknown> = {
      operation,
      requestId: context.requestId,
      input: sanitizedInput,
      critical,
      errorCode: loggedErrorCode,
      originalErrorType: originalErrorName, // Retain for clarity
      finalErrorType: getErrorName(finalError),
    };

    if (finalError instanceof McpError && finalError.details) {
        logPayload.errorDetails = finalError.details;
    } else {
        // For non-McpError or McpError without details, use the consolidatedDetails we built
        logPayload.errorDetails = consolidatedDetails;
    }


    if (includeStack && finalError instanceof Error && finalError.stack) {
      logPayload.stack = finalError.stack;
    } else if (includeStack && originalStack && !logPayload.stack) { // Fallback to original stack if finalError lost it
      logPayload.stack = originalStack;
    }


    logger.error(`Error in ${operation}: ${finalError.message || originalErrorMessage}`, logPayload);

    if (rethrow) {
      throw finalError;
    }
    return finalError;
  }

  /**
   * Maps an error to a specific error type `T` based on a list of `ErrorMapping` rules.
   */
  public static mapError<T extends Error>(
    error: unknown,
    mappings: ReadonlyArray<ErrorMapping<T>>,
    defaultFactory?: (error: unknown, context?: Record<string, unknown>) => T
  ): T | Error {
    const errorMessage = getErrorMessage(error);
    const errorName = getErrorName(error);

    for (const mapping of mappings) {
      const regex = createSafeRegex(mapping.pattern);
      if (regex.test(errorMessage) || regex.test(errorName)) {
        return mapping.factory(error, mapping.additionalContext);
      }
    }

    if (defaultFactory) {
      return defaultFactory(error);
    }
    return error instanceof Error ? error : new Error(String(error));
  }

  /**
   * Formats an error into a consistent object structure, typically for API responses.
   */
  public static formatError(error: unknown): Record<string, unknown> {
    if (error instanceof McpError) {
      return {
        code: error.code,
        message: error.message,
        details: typeof error.details === 'object' && error.details !== null ? error.details : {},
      };
    }

    if (error instanceof Error) {
      return {
        code: ErrorHandler.determineErrorCode(error),
        message: error.message,
        details: { errorType: error.name || 'Error' },
      };
    }

    return {
      code: BaseErrorCode.UNKNOWN_ERROR,
      message: getErrorMessage(error),
      details: { errorType: getErrorName(error) },
    };
  }

  /**
   * Safely executes a function and handles any errors using `ErrorHandler.handleError`.
   */
  public static async tryCatch<T>(
    fn: () => Promise<T> | T,
    options: Omit<ErrorHandlerOptions, 'rethrow'>
  ): Promise<T> {
    try {
      return await Promise.resolve(fn());
    } catch (error) {
      throw ErrorHandler.handleError(error, { ...options, rethrow: true });
    }
  }
}
