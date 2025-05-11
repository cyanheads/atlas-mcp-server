import { createToolResponse } from "../../../types/mcp.js"; // Import the new response creator
import { KnowledgeListResponse } from "./types.js";

/**
 * Defines a generic interface for formatting data into a string.
 */
interface ResponseFormatter<T> {
  format(data: T): string;
}

/**
 * Formatter for structured knowledge query responses
 */
export class KnowledgeListFormatter implements ResponseFormatter<KnowledgeListResponse> {
  format(data: KnowledgeListResponse): string {
    const { knowledge, total, page, limit, totalPages } = data;
    
    // Generate result summary section
    const summary = `Knowledge Repository\n\n` +
      `Total Items: ${total}\n` +
      `Page: ${page} of ${totalPages}\n` +
      `Displaying: ${Math.min(limit, knowledge.length)} item(s) per page\n`;
    
    if (knowledge.length === 0) {
      return `${summary}\n\nNo knowledge items matched the specified criteria`;
    }
    
    // Format each knowledge item
    const knowledgeSections = knowledge.map((item, index) => {
      const {
        id,
        projectId,
        projectName,
        domain,
        tags,
        text,
        citations,
        createdAt,
        updatedAt
      } = item;
      
      let knowledgeSection = `${index + 1}. ${domain || 'Uncategorized'} Knowledge\n\n` +
        `ID: ${id}\n` +
        `Project: ${projectName || projectId}\n` +
        `Domain: ${domain}\n`;
      
      // Add tags if available
      if (tags && tags.length > 0) {
        knowledgeSection += `Tags: ${tags.join(', ')}\n`;
      }
      
      // Format dates
      const createdDate = createdAt ? new Date(createdAt).toLocaleString() : 'Unknown Date';
      const updatedDate = updatedAt ? new Date(updatedAt).toLocaleString() : 'Unknown Date';
      
      knowledgeSection += `Created: ${createdDate}\n` +
                          `Updated: ${updatedDate}\n\n`;
      
      // Add knowledge content
      knowledgeSection += `Content:\n${text || 'No content available'}\n`;
      
      // Add citations if available
      if (citations && citations.length > 0) {
        knowledgeSection += `\nCitations:\n`;
        citations.forEach((citation, citIndex) => {
          knowledgeSection += `${citIndex + 1}. ${citation}\n`;
        });
      }
      
      return knowledgeSection;
    }).join("\n\n----------\n\n");
    
    // Append pagination metadata for multi-page results
    let paginationInfo = "";
    if (totalPages > 1) {
      paginationInfo = `\n\nPagination Controls\n\n` +
        `Viewing page ${page} of ${totalPages}.\n` +
        `${page < totalPages ? "Use 'page' parameter to navigate to additional results." : ""}`;
    }
    
    return `${summary}\n\n${knowledgeSections}${paginationInfo}`;
  }
}

/**
 * Create a human-readable formatted response for the atlas_knowledge_list tool
 * 
 * @param data The structured knowledge query response data
 * @param isError Whether this response represents an error condition
 * @returns Formatted MCP tool response with appropriate structure
 */
export function formatKnowledgeListResponse(data: any, isError = false): any {
  const formatter = new KnowledgeListFormatter();
  const formattedText = formatter.format(data as KnowledgeListResponse); // Assuming data is KnowledgeListResponse
  return createToolResponse(formattedText, isError);
}
