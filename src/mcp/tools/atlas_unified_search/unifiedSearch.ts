import { SearchService } from '../../../services/neo4j/searchService.js';
import { BaseErrorCode, McpError } from '../../../types/errors.js';
import { ResponseFormat } from '../../../types/mcp.js';
import { ToolContext } from '../../../types/tool.js';
import { logger } from '../../../utils/internal/logger.js';
import { formatUnifiedSearchResponse } from './responseFormat.js';
// Assuming UnifiedSearchResponse is defined correctly in types.ts
import { UnifiedSearchRequestInput, UnifiedSearchRequestSchema, UnifiedSearchResponse } from './types.js';

export const atlasUnifiedSearch = async (
  input: unknown,
  context: ToolContext
): Promise<any> => {
  const requestId = context.requestContext?.requestId;
  try {
    // Parse and validate input against schema
    const validatedInput = UnifiedSearchRequestSchema.parse(input) as UnifiedSearchRequestInput & { responseFormat?: ResponseFormat };

    // Log operation
    logger.info("Performing unified search", {
      searchTerm: validatedInput.value,
      entityTypes: validatedInput.entityTypes,
      property: validatedInput.property,
      fuzzy: validatedInput.fuzzy,
      requestId: requestId
    });

    if (!validatedInput.value || validatedInput.value.trim() === '') {
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        "Search value cannot be empty",
        { param: "value" }
      );
    }

    // --- Simplified Logic: Always use fullTextSearch ---

    // Construct the Lucene query string
    let luceneQuery: string;
    const property = validatedInput.property?.trim();
    const isFuzzy = validatedInput.fuzzy === true;

    // Escape common Lucene special characters, including quotes if we might add them
    const escapeLucene = (str: string) => str.replace(/([+\-!(){}\[\]^"~*?:\\\/"])/g, '\\$1');
    const escapedValue = escapeLucene(validatedInput.value);

    if (property) {
      // Search within a specific property
      if (isFuzzy) {
        luceneQuery = `${property}:${escapedValue}~1`; // Fuzzy on specific property
      } else {
        luceneQuery = `${property}:"${escapedValue}"`; // Exact phrase on specific property
      }
    } else {
      // Search across default indexed fields
      if (isFuzzy) {
        luceneQuery = `${escapedValue}~1`; // Fuzzy on default fields
      } else {
        // For non-fuzzy, no-property search, just use the escaped value.
        // Wrapping in quotes here might be too restrictive if searching description/text.
        luceneQuery = escapedValue;
      }
    }

    logger.info("Using simplified full-text search", { luceneQuery, input: validatedInput, requestId });

    // Always call fullTextSearch with the constructed Lucene query
    const searchResults = await SearchService.fullTextSearch(luceneQuery, {
      entityTypes: validatedInput.entityTypes,
      taskType: validatedInput.taskType,
      page: validatedInput.page,
      limit: validatedInput.limit
    });


    // Add robust check for searchResults and searchResults.data
    if (!searchResults || !Array.isArray(searchResults.data)) {
       logger.error("Search service returned invalid data structure.", { searchResults, requestId });
       throw new McpError(
         BaseErrorCode.INTERNAL_ERROR,
         "Received invalid data structure from search service."
       );
    }

    logger.info("Unified search completed successfully", {
      resultCount: searchResults.data.length,
      totalResults: searchResults.total,
      requestId: requestId
    });

    // Create the response object with search results data, mapping 'data' to 'results'
    const responseData: UnifiedSearchResponse = {
      results: searchResults.data, // Map data to results
      total: searchResults.total,
      page: searchResults.page,
      limit: searchResults.limit,
      totalPages: searchResults.totalPages
    };

    // Format and return the response based on requested format
    if (validatedInput.responseFormat === ResponseFormat.JSON) {
      return responseData; // Return raw JSON data
    } else {
      // Default to formatted or if 'formatted' is explicitly requested
      return formatUnifiedSearchResponse(responseData);
    }

  } catch (error) {
    // Log the specific error message and stack if available
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error("Failed to perform unified search", {
      error: errorMessage,
      stack: errorStack, // Log stack trace
      originalError: error, // Log the original error object
      requestId: requestId
    });

    // Re-throw as McpError if not already one
    if (error instanceof McpError) {
      throw error;
    } else {
      throw new McpError(
        BaseErrorCode.INTERNAL_ERROR,
        `Error performing unified search: ${errorMessage}`
      );
    }
  }
};
