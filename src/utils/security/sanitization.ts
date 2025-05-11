import path from 'path';
import sanitizeHtml from 'sanitize-html';
import validator from 'validator';
import { BaseErrorCode, McpError } from '../../types-global/errors.js';
// Import utils from the main barrel file (logger from ../internal/logger.js)
import { logger } from '../index.js';

/**
 * Options for path sanitization.
 */
export interface PathSanitizeOptions {
  /**
   * Restrict paths to a specific root directory.
   * If provided, the sanitized path will be relative to this root,
   * and attempts to traverse above this root will be prevented.
   */
  rootDir?: string;
  /**
   * Normalize Windows-style backslashes (`\\`) to POSIX-style forward slashes (`/`).
   * Defaults to `false`.
   */
  toPosix?: boolean;
  /**
   * Allow absolute paths.
   * If `false` (default), absolute paths will be converted to relative paths
   * (by removing leading slashes or drive letters).
   * If `true`, absolute paths are permitted, subject to `rootDir` constraints if provided.
   */
  allowAbsolute?: boolean;
}

/**
 * Information returned by the sanitizePath method, providing details about the sanitization process.
 */
export interface SanitizedPathInfo {
  /** The final sanitized and normalized path string. */
  sanitizedPath: string;
  /** The original path string passed to the function before any normalization or sanitization. */
  originalInput: string;
  /** Indicates if the input path was determined to be absolute after initial `path.normalize()`. */
  wasAbsolute: boolean;
  /**
   * Indicates if an initially absolute path was converted to a relative path.
   * This typically happens if `options.allowAbsolute` was `false`.
   */
  convertedToRelative: boolean;
  /** The effective options that were used for sanitization, including defaults. */
  optionsUsed: PathSanitizeOptions;
}

/**
 * Context-specific input sanitization options
 */
export interface SanitizeStringOptions {
  /** Handle content differently based on context */
  context?: 'text' | 'html' | 'attribute' | 'url' | 'javascript';
  /** Custom allowed tags when using html context */
  allowedTags?: string[];
  /** Custom allowed attributes when using html context */
  allowedAttributes?: Record<string, string[]>;
}

/**
 * Configuration for HTML sanitization
 */
export interface HtmlSanitizeConfig {
  /** Allowed HTML tags */
  allowedTags?: string[];
  /** Allowed HTML attributes (global or per-tag) */
  allowedAttributes?: sanitizeHtml.IOptions['allowedAttributes'];
  /** Allow preserving comments - uses allowedTags internally */
  preserveComments?: boolean;
  /** Custom URL sanitizer */
  transformTags?: sanitizeHtml.IOptions['transformTags'];
}

/**
 * Sanitization class for handling various input sanitization tasks.
 * Provides methods to clean and validate strings, HTML, URLs, paths, JSON, and numbers.
 */
export class Sanitization {
  private static instance: Sanitization;
  
  /** Default list of sensitive fields for sanitizing logs */
  private sensitiveFields: string[] = [
    'password', 'token', 'secret', 'key', 'apiKey', 'auth', 
    'credential', 'jwt', 'ssn', 'credit', 'card', 'cvv', 'authorization'
  ];

  /** Default sanitize-html configuration */
  private defaultHtmlSanitizeConfig: HtmlSanitizeConfig = {
    allowedTags: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'ul', 'ol', 
      'li', 'b', 'i', 'strong', 'em', 'strike', 'code', 'hr', 'br', 
      'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'pre'
    ],
    allowedAttributes: {
      'a': ['href', 'name', 'target'],
      'img': ['src', 'alt', 'title', 'width', 'height'],
      '*': ['class', 'id', 'style']
    },
    preserveComments: false
  };

  /**
   * Private constructor to enforce singleton pattern.
   */
  private constructor() {
    // Constructor intentionally left blank for singleton.
  }

  /**
   * Get the singleton Sanitization instance.
   * @returns {Sanitization} The singleton instance.
   */
  public static getInstance(): Sanitization {
    if (!Sanitization.instance) {
      Sanitization.instance = new Sanitization();
    }
    return Sanitization.instance;
  }

  /**
   * Set sensitive fields for log sanitization. These fields will be redacted when
   * `sanitizeForLogging` is called.
   * @param {string[]} fields - Array of field names to consider sensitive.
   */
  public setSensitiveFields(fields: string[]): void {
    this.sensitiveFields = [...new Set([...this.sensitiveFields, ...fields])]; // Ensure uniqueness
    logger.debug('Updated sensitive fields list', { count: this.sensitiveFields.length });
  }

  /**
   * Get the current list of sensitive fields used for log sanitization.
   * @returns {string[]} Array of sensitive field names.
   */
  public getSensitiveFields(): string[] {
    return [...this.sensitiveFields];
  }

  /**
   * Sanitize HTML content using the `sanitize-html` library.
   * Removes potentially malicious tags and attributes.
   * @param {string} input - HTML string to sanitize.
   * @param {HtmlSanitizeConfig} [config] - Optional custom sanitization configuration.
   * @returns {string} Sanitized HTML string.
   */
  public sanitizeHtml(input: string, config?: HtmlSanitizeConfig): string {
    if (!input) return '';
    
    const effectiveConfig = { ...this.defaultHtmlSanitizeConfig, ...config };
    
    const options: sanitizeHtml.IOptions = {
      allowedTags: effectiveConfig.allowedTags,
      allowedAttributes: effectiveConfig.allowedAttributes,
      transformTags: effectiveConfig.transformTags
    };
    
    if (effectiveConfig.preserveComments) {
      options.allowedTags = [...(options.allowedTags || []), '!--'];
    }
    
    return sanitizeHtml(input, options);
  }

  /**
   * Sanitize string input based on context.
   *
   * **Important:** Using `context: 'javascript'` is explicitly disallowed and will throw an `McpError`.
   * This is a security measure to prevent accidental execution or ineffective sanitization of JavaScript code.
   *
   * @param {string} input - String to sanitize.
   * @param {SanitizeStringOptions} [options={}] - Sanitization options.
   * @returns {string} Sanitized string.
   * @throws {McpError} If `context: 'javascript'` is used.
   */
  public sanitizeString(input: string, options: SanitizeStringOptions = {}): string {
    if (!input) return '';
    
    switch (options.context) {
      case 'html':
        return this.sanitizeHtml(input, {
          allowedTags: options.allowedTags,
          allowedAttributes: options.allowedAttributes ? 
            this.convertAttributesFormat(options.allowedAttributes) : 
            undefined
        });
      case 'attribute':
        return sanitizeHtml(input, { allowedTags: [], allowedAttributes: {} });
      case 'url':
        if (!validator.isURL(input, { protocols: ['http', 'https'], require_protocol: true })) {
           logger.warning('Invalid URL detected during string sanitization', { input });
           return '';
         }
        return validator.trim(input);
      case 'javascript':
        logger.error('Attempted JavaScript sanitization via sanitizeString', { input: input.substring(0, 50) });
        throw new McpError(
          BaseErrorCode.VALIDATION_ERROR,
          'JavaScript sanitization not supported through string sanitizer'
        );
      case 'text':
      default:
        return sanitizeHtml(input, { allowedTags: [], allowedAttributes: {} });
    }
  }

  /**
   * Sanitize URL with robust validation.
   * Ensures the URL uses allowed protocols and is well-formed.
   * @param {string} input - URL to sanitize.
   * @param {string[]} [allowedProtocols=['http', 'https']] - Allowed URL protocols.
   * @returns {string} Sanitized URL.
   * @throws {McpError} If URL is invalid or uses a disallowed protocol.
   */
  public sanitizeUrl(input: string, allowedProtocols: string[] = ['http', 'https']): string {
    try {
      if (!validator.isURL(input, { protocols: allowedProtocols, require_protocol: true })) {
        throw new Error('Invalid URL format or protocol');
      }
      const lowerInput = input.toLowerCase().trim();
      if (lowerInput.startsWith('javascript:')) { // Double-check against javascript:
        throw new Error('JavaScript protocol not allowed');
      }
      return validator.trim(input);
    } catch (error) {
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        error instanceof Error ? error.message : 'Invalid URL format',
        { input }
      );
    }
  }

  /**
   * Sanitizes a file path to prevent path traversal and other common attacks.
   * Normalizes the path, optionally converts to POSIX style, and can restrict
   * the path to a root directory.
   *
   * @param {string} input - The file path to sanitize.
   * @param {PathSanitizeOptions} [options={}] - Options to control sanitization behavior.
   * @returns {SanitizedPathInfo} An object containing the sanitized path and metadata about the sanitization process.
   * @throws {McpError} If the path is invalid, unsafe (e.g., contains null bytes, attempts traversal).
   */
  public sanitizePath(input: string, options: PathSanitizeOptions = {}): SanitizedPathInfo {
    const originalInput = input;
    const effectiveOptions: PathSanitizeOptions = { // Ensure all options have defaults
      toPosix: options.toPosix ?? false,
      allowAbsolute: options.allowAbsolute ?? false,
      rootDir: options.rootDir
    };

    let wasAbsoluteInitially = false;
    let convertedToRelative = false;

    try {
      if (!input || typeof input !== 'string') {
        throw new Error('Invalid path input: must be a non-empty string');
      }
      
      let normalized = path.normalize(input);
      wasAbsoluteInitially = path.isAbsolute(normalized);
      
      if (normalized.includes('\0')) {
        throw new Error('Path contains null byte');
      }
      
      if (effectiveOptions.toPosix) {
        normalized = normalized.replace(/\\/g, '/');
      }
      
      if (!effectiveOptions.allowAbsolute && path.isAbsolute(normalized)) {
        // Original path was absolute, but absolute paths are not allowed.
        // Convert to relative by stripping leading slash or drive letter.
        normalized = normalized.replace(/^(?:[A-Za-z]:)?[/\\]+/, '');
        convertedToRelative = true;
      }
      
      let finalSanitizedPath: string;

      if (effectiveOptions.rootDir) {
        const rootDirResolved = path.resolve(effectiveOptions.rootDir);
        // If 'normalized' is absolute (and allowed), path.resolve uses it as the base.
        // If 'normalized' is relative, it's resolved against 'rootDirResolved'.
        const fullPath = path.resolve(rootDirResolved, normalized);
        
        if (!fullPath.startsWith(rootDirResolved + path.sep) && fullPath !== rootDirResolved) {
          throw new Error('Path traversal detected (escapes rootDir)');
        }
        // Path is within rootDir, return it relative to rootDir.
        finalSanitizedPath = path.relative(rootDirResolved, fullPath);
        // Ensure empty string result from path.relative (if fullPath equals rootDirResolved) becomes '.'
        finalSanitizedPath = finalSanitizedPath === '' ? '.' : finalSanitizedPath;

      } else { // No rootDir specified
        if (path.isAbsolute(normalized)) {
          if (effectiveOptions.allowAbsolute) {
            // Absolute path is allowed and no rootDir to constrain it.
            finalSanitizedPath = normalized;
          } else {
            // Should not happen if logic above is correct (already made relative or was originally relative)
            // but as a safeguard:
            throw new Error('Absolute path encountered when not allowed and not rooted');
          }
        } else { // Path is relative and no rootDir
          if (normalized.includes('..')) {
             const resolvedPath = path.resolve(normalized); // Resolves relative to CWD
             const currentWorkingDir = path.resolve('.');
             if (!resolvedPath.startsWith(currentWorkingDir)) {
                throw new Error('Relative path traversal detected (escapes CWD)');
             }
          }
          finalSanitizedPath = normalized;
        }
      }
      
      return {
        sanitizedPath: finalSanitizedPath,
        originalInput,
        wasAbsolute: wasAbsoluteInitially,
        convertedToRelative,
        optionsUsed: effectiveOptions
      };

    } catch (error) {
      logger.warning('Path sanitization error', {
        input: originalInput,
        options: effectiveOptions,
        error: error instanceof Error ? error.message : String(error)
      });
      
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        error instanceof Error ? error.message : 'Invalid or unsafe path',
        { input: originalInput } // Provide original input in error details
      );
    }
  }
  
  /**
   * Sanitize a JSON string. Validates format and optionally checks size.
   * @template T - The expected type of the parsed JSON object.
   * @param {string} input - JSON string to sanitize.
   * @param {number} [maxSize] - Maximum allowed size in bytes.
   * @returns {T} Parsed and sanitized object.
   * @throws {McpError} If JSON is invalid, too large, or input is not a string.
   */
  public sanitizeJson<T = unknown>(input: string, maxSize?: number): T {
    try {
      if (typeof input !== 'string') {
        throw new Error('Invalid input: expected a JSON string');
      }
      
      if (maxSize !== undefined && Buffer.byteLength(input, 'utf8') > maxSize) {
        throw new McpError(
          BaseErrorCode.VALIDATION_ERROR,
          `JSON exceeds maximum allowed size of ${maxSize} bytes`,
          { size: Buffer.byteLength(input, 'utf8'), maxSize }
        );
      }
      
      const parsed = JSON.parse(input);
      // Optional: Add recursive sanitization of parsed object values if needed
      // this.sanitizeObjectRecursively(parsed); 
      return parsed as T;

    } catch (error) {
      if (error instanceof McpError) throw error;
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        error instanceof Error ? error.message : 'Invalid JSON format',
        { input: input.length > 100 ? `${input.substring(0, 100)}...` : input }
      );
    }
  }
  
  /**
   * Ensure input is a valid number and optionally within a numeric range.
   * Clamps the number to the range if min/max are provided and value is outside.
   * @param {number | string} input - Number or string to validate.
   * @param {number} [min] - Minimum allowed value (inclusive).
   * @param {number} [max] - Maximum allowed value (inclusive).
   * @returns {number} Sanitized number.
   * @throws {McpError} If input is not a valid number or parsable string.
   */
  public sanitizeNumber(input: number | string, min?: number, max?: number): number {
    let value: number;
    
    if (typeof input === 'string') {
      if (!validator.isNumeric(input.trim())) {
        throw new McpError(BaseErrorCode.VALIDATION_ERROR, 'Invalid number format', { input });
      }
      value = parseFloat(input.trim());
    } else if (typeof input === 'number') {
      value = input;
    } else {
       throw new McpError(BaseErrorCode.VALIDATION_ERROR, 'Invalid input type: expected number or string', { input: String(input) });
    }
    
    if (isNaN(value) || !isFinite(value)) {
      throw new McpError(BaseErrorCode.VALIDATION_ERROR, 'Invalid number value (NaN or Infinity)', { input });
    }
    
    let clamped = false;
    if (min !== undefined && value < min) {
      value = min;
      clamped = true;
    }
    if (max !== undefined && value > max) {
      value = max;
      clamped = true;
    }
    if (clamped) {
      logger.debug('Number clamped to range', { input, min, max, finalValue: value });
    }
    
    return value;
  }

  /**
   * Sanitize input for logging to protect sensitive information.
   * Deep clones the input and redacts fields matching `this.sensitiveFields`.
   * @param {unknown} input - Input to sanitize.
   * @returns {unknown} Sanitized input safe for logging.
   */
  public sanitizeForLogging(input: unknown): unknown {
    try {
      if (!input || typeof input !== 'object') {
        return input;
      }
      
      const clonedInput = typeof structuredClone === 'function' 
        ? structuredClone(input)
        : JSON.parse(JSON.stringify(input)); // Fallback for older Node versions
          
      this.redactSensitiveFields(clonedInput);
      return clonedInput;

    } catch (error) {
      logger.error('Error during log sanitization', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return '[Log Sanitization Failed]';
    }
  }

  /**
   * Private helper to convert attribute format for sanitize-html.
   */
  private convertAttributesFormat(attrs: Record<string, string[]>): sanitizeHtml.IOptions['allowedAttributes'] {
    return attrs;
  }

  /**
   * Recursively redact sensitive fields in an object or array.
   * Modifies the object in place.
   * @param {unknown} obj - The object or array to redact.
   */
  private redactSensitiveFields(obj: unknown): void {
    if (!obj || typeof obj !== 'object') {
      return;
    }
    
    if (Array.isArray(obj)) {
      obj.forEach(item => {
        if (item && typeof item === 'object') {
          this.redactSensitiveFields(item);
        }
      });
      return;
    }
    
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const value = (obj as Record<string, unknown>)[key];
        const isSensitive = this.sensitiveFields.some(field => 
          key.toLowerCase().includes(field.toLowerCase())
        );
        
        if (isSensitive) {
          (obj as Record<string, unknown>)[key] = '[REDACTED]';
        } else if (value && typeof value === 'object') {
          this.redactSensitiveFields(value);
        }
      }
    }
  }
}

// Create and export singleton instance
export const sanitization = Sanitization.getInstance();

/**
 * Convenience function to sanitize input for logging.
 * @param {unknown} input - Input to sanitize.
 * @returns {unknown} Sanitized input safe for logging.
 */
export const sanitizeInputForLogging = (input: unknown): unknown => 
  sanitization.sanitizeForLogging(input);
