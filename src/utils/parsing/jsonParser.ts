import { parse as parsePartialJson, Allow as PartialJsonAllow } from 'partial-json';
import { BaseErrorCode, McpError } from '../../types/errors.js';
// Import utils from the main barrel file (logger, RequestContext from ../internal/*)
import { logger, RequestContext } from '../index.js';

/**
 * Enum mirroring partial-json's Allow constants for specifying
 * what types of partial JSON structures are permissible during parsing.
 * Use bitwise OR to combine options (e.g., Allow.STR | Allow.OBJ).
 */
export const Allow = PartialJsonAllow;

// Regex to find a <think> block at the start, capturing its content and the rest of the string
const thinkBlockRegex = /^<think>([\s\S]*?)<\/think>\s*([\s\S]*)$/;

/**
 * Utility class for parsing potentially partial JSON strings.
 * Wraps the 'partial-json' library to provide a consistent interface
 * within the atlas-mcp-agent project.
 * Handles optional <think>...</think> blocks at the beginning of the input.
 */
class JsonParser {
  /**
   * Parses a JSON string, potentially allowing for incomplete structures
   * and handling optional <think> blocks at the start.
   *
   * @param jsonString The JSON string to parse.
   * @param allowPartial A bitwise OR combination of 'Allow' constants specifying permissible partial types (defaults to Allow.ALL).
   * @param context Optional RequestContext for error correlation and logging think blocks.
   * @returns The parsed JavaScript value.
   * @throws {McpError} Throws an McpError with BaseErrorCode.VALIDATION_ERROR if parsing fails due to malformed JSON.
   */
  parse<T = any>(jsonString: string, allowPartial: number = Allow.ALL, context?: RequestContext): T {
    let stringToParse = jsonString;
    const match = jsonString.match(thinkBlockRegex);

    if (match) {
      const thinkContent = match[1].trim();
      const restOfString = match[2];

      if (thinkContent) {
        logger.debug('LLM <think> block detected and logged.', { ...context, thinkContent });
      } else {
        logger.debug('Empty LLM <think> block detected.', context);
      }

      stringToParse = restOfString; // Parse only the part after </think>
    }

    // Trim leading/trailing whitespace which might interfere with JSON parsing, especially if only JSON is left
    stringToParse = stringToParse.trim();

    if (!stringToParse) {
        // If after removing think block and trimming, the string is empty, it's an error
        throw new McpError(
            BaseErrorCode.VALIDATION_ERROR,
            'JSON string is empty after removing <think> block.',
            context
        );
    }

    try {
      // Ensure the string starts with '{' or '[' if we expect an object or array after stripping <think>
      // This helps catch cases where only non-JSON text remains.
      if (!stringToParse.startsWith('{') && !stringToParse.startsWith('[')) {
           // Check if it might be a simple string value that partial-json could parse
           // Allow simple strings only if specifically permitted or Allow.ALL is used
           const allowsString = (allowPartial & Allow.STR) === Allow.STR;
           if (!allowsString && !stringToParse.startsWith('"')) { // Allow quoted strings if Allow.STR is set
                throw new Error('Remaining content does not appear to be valid JSON object or array.');
           }
           // If it starts with a quote and strings are allowed, let parsePartialJson handle it
      }

      return parsePartialJson(stringToParse, allowPartial) as T;
    } catch (error: any) {
      // Wrap the original error in an McpError for consistent error handling
      // Include the original error message for better debugging context.
      logger.error('Failed to parse JSON content.', { ...context, error: error.message, contentAttempted: stringToParse });
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        `Failed to parse JSON: ${error.message}`,
        { // Combine context and details into the third argument
          ...context,
          originalContent: stringToParse,
          rawError: error instanceof Error ? error.stack : String(error) // Include raw error info
        }
      );
    }
  }
}

/**
 * Singleton instance of the JsonParser utility.
 */
export const jsonParser = new JsonParser();
