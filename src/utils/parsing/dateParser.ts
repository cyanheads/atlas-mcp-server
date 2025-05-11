import * as chrono from 'chrono-node';
// Import utils from the main barrel file (logger, ErrorHandler, RequestContext from ../internal/*)
import { logger, ErrorHandler, RequestContext } from '../index.js';
import { McpError, BaseErrorCode } from '../../types-global/errors.js'; // Corrected path

/**
 * Parses a natural language date string into a Date object.
 *
 * @param text The natural language date string (e.g., "tomorrow", "in 5 days", "2024-01-15").
 * @param context The request context for logging and error tracking.
 * @param refDate Optional reference date for parsing relative dates. Defaults to now.
 * @returns A Date object representing the parsed date, or null if parsing fails.
 * @throws McpError if parsing fails unexpectedly.
 */
async function parseDateString(
  text: string,
  context: RequestContext,
  refDate?: Date
): Promise<Date | null> {
  const operation = 'parseDateString';
  const logContext = { ...context, operation, inputText: text, refDate };
  logger.debug(`Attempting to parse date string: "${text}"`, logContext);

  return await ErrorHandler.tryCatch(
    async () => {
      const parsedDate = chrono.parseDate(text, refDate, { forwardDate: true });
      if (parsedDate) {
        logger.debug(`Successfully parsed "${text}" to ${parsedDate.toISOString()}`, logContext);
        return parsedDate;
      } else {
        logger.warning(`Failed to parse date string: "${text}"`, logContext);
        return null;
      }
    },
    {
      operation,
      context: logContext,
      input: { text, refDate },
      errorCode: BaseErrorCode.PARSING_ERROR,
    }
  );
}

/**
 * Parses a natural language date string and returns detailed parsing results.
 *
 * @param text The natural language date string.
 * @param context The request context for logging and error tracking.
 * @param refDate Optional reference date for parsing relative dates. Defaults to now.
 * @returns An array of chrono.ParsedResult objects, or an empty array if parsing fails.
 * @throws McpError if parsing fails unexpectedly.
 */
async function parseDateStringDetailed(
  text: string,
  context: RequestContext,
  refDate?: Date
): Promise<chrono.ParsedResult[]> {
  const operation = 'parseDateStringDetailed';
  const logContext = { ...context, operation, inputText: text, refDate };
  logger.debug(`Attempting detailed parse of date string: "${text}"`, logContext);

  return await ErrorHandler.tryCatch(
    async () => {
      const results = chrono.parse(text, refDate, { forwardDate: true });
      logger.debug(`Detailed parse of "${text}" resulted in ${results.length} result(s)`, logContext);
      return results;
    },
    {
      operation,
      context: logContext,
      input: { text, refDate },
      errorCode: BaseErrorCode.PARSING_ERROR,
    }
  );
}

export const dateParser = {
  parse: parseDateStringDetailed,
  parseDate: parseDateString,
};
