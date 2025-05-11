import { SearchResultItem } from "../../../services/neo4j/searchService.js";
import { McpToolResponse, createToolResponse } from "../../../types/mcp.js";
import { UnifiedSearchResponse } from "./types.js";

/**
 * Formatter for unified search responses
 */
class UnifiedSearchFormatter {
  // The input 'responseData' should match the UnifiedSearchResponse type structure.
  format(responseData: UnifiedSearchResponse): string { 
    // Destructure the 'results' property as defined in UnifiedSearchResponse
    const { results, total, page, limit, totalPages } = responseData;

    // Create a summary section with pagination info
    const summary = `Search Results\n\n` +
      `Found ${total ?? 0} result(s)\n` + // Use nullish coalescing for safety
      `Page ${page ?? 1} of ${totalPages ?? 1} (${limit ?? 0} per page)\n`; // Use nullish coalescing

    // Add a robust check for results being a valid array before accessing length
    if (!Array.isArray(results) || results.length === 0) {
      return `${summary}\nNo matches found for the specified search criteria.`;
    }
    
    // Group results by entity type for better organization
    const groupedResults: Record<string, SearchResultItem[]> = {};
    
    results.forEach((result: SearchResultItem) => { // Add explicit type here
      if (!groupedResults[result.type]) {
        groupedResults[result.type] = [];
      }
      groupedResults[result.type].push(result);
    });
    
    // Build formatted output for each entity type group
    let resultsOutput = '';
    
    Object.entries(groupedResults).forEach(([type, items]) => {
      // Add section heading for this entity type
      resultsOutput += `\n${this.capitalizeFirstLetter(type)} Results (${items.length})\n\n`;
      
      // Format each result item
      items.forEach((item, index) => {
        const score = Math.round(item.score * 10) / 10; // Round to 1 decimal place
        const relevanceIndicator = this.getRelevanceIndicator(score);
        
        resultsOutput += `${index + 1}. ${relevanceIndicator} ${item.title}\n`;
        
        // Add relevant metadata based on entity type
        if (item.type === 'project') {
          resultsOutput += `   ID: ${item.id}\n`;
          resultsOutput += `   Type: ${item.entityType}\n`;
          resultsOutput += `   Match: Found in ${item.matchedProperty}\n`;
        } else if (item.type === 'task') {
          resultsOutput += `   ID: ${item.id}\n`;
          resultsOutput += `   Project: ${item.projectName || 'Unknown'}\n`;
          resultsOutput += `   Type: ${item.entityType}\n`;
          resultsOutput += `   Match: Found in ${item.matchedProperty}\n`;
        } else if (item.type === 'knowledge') {
          resultsOutput += `   ID: ${item.id}\n`;
          resultsOutput += `   Project: ${item.projectName || 'Unknown'}\n`;
          resultsOutput += `   Domain: ${item.entityType}\n`;
          resultsOutput += `   Match: Found in ${item.matchedProperty}\n`;
        }
        
        // Add a snippet of the matched content
        if (item.matchedValue) {
          const matchSnippet = this.truncateText(item.matchedValue, 100);
           resultsOutput += `   Content: "${matchSnippet}"\n`;
         }
         
         // Conditionally add created date if available
         if (item.createdAt) {
           resultsOutput += `   Created: ${new Date(item.createdAt).toLocaleString()}\n`;
         }
         // Add a blank line after each item
         resultsOutput += `\n`; 
       });
     });
    
    // Add help text for pagination
    let paginationHelp = "";
    if (totalPages > 1) {
      paginationHelp = `\nTo view more results, use 'page' parameter (current: ${page}, total pages: ${totalPages}).`;
    }
    
    return `${summary}${resultsOutput}${paginationHelp}`;
  }
  
  /**
   * Capitalize the first letter of a string
   */
  private capitalizeFirstLetter(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
  
  /**
   * Get a visual indicator for the relevance score
   */
  private getRelevanceIndicator(score: number): string {
    if (score >= 8) return '🔍 [Highly Relevant]';
    if (score >= 6) return '🔍 [Relevant]';
    if (score >= 4) return '🔍 [Moderately Relevant]';
    return '🔍 [Potentially Relevant]';
  }
  
  /**
   * Truncate text to a specified length with ellipsis
   */
  private truncateText(text: string | null | undefined, maxLength: number): string {
    // Add check to ensure text is a string and handle null/undefined
    if (typeof text !== 'string' || text.length === 0) {
      return ''; // Return empty string if text is not valid
    }
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - 3) + '...';
  }
}

/**
 * Create a formatted, human-readable response for the atlas_unified_search tool
 * 
 * @param data The search response data
 * @param isError Whether this response represents an error condition
 * @returns Formatted MCP tool response with appropriate structure
 */
export function formatUnifiedSearchResponse(data: UnifiedSearchResponse, isError = false): McpToolResponse {
  const formatter = new UnifiedSearchFormatter();
  const formattedText = formatter.format(data);
  return createToolResponse(formattedText, isError);
}
