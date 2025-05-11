import { createToolResponse } from "../../../types/mcp.js"; // Import the new response creator

/**
 * Defines a generic interface for formatting data into a string.
 */
interface ResponseFormatter<T> {
  format(data: T): string;
}

/**
 * Interface for single knowledge item deletion response
 */
interface SingleKnowledgeDeleteResponse {
  id: string;
  success: boolean;
  message: string;
}

/**
 * Interface for bulk knowledge deletion response
 */
interface BulkKnowledgeDeleteResponse {
  success: boolean;
  message: string;
  deleted: string[];
  errors: {
    knowledgeId: string;
    error: {
      code: string;
      message: string;
      details?: any;
    };
  }[];
}

/**
 * Formatter for individual knowledge item removal responses
 */
export class SingleKnowledgeDeleteFormatter implements ResponseFormatter<SingleKnowledgeDeleteResponse> {
  format(data: SingleKnowledgeDeleteResponse): string {
    return `Knowledge Item Removal\n\n` +
      `Result: ${data.success ? '✅ Success' : '❌ Failed'}\n` +
      `Knowledge ID: ${data.id}\n` +
      `Message: ${data.message}\n`;
  }
}

/**
 * Formatter for batch knowledge item removal responses
 */
export class BulkKnowledgeDeleteFormatter implements ResponseFormatter<BulkKnowledgeDeleteResponse> {
  format(data: BulkKnowledgeDeleteResponse): string {
    const { success, message, deleted, errors } = data;
    
    const summary = `Knowledge Cleanup Operation\n\n` +
      `Status: ${success && errors.length === 0 ? '✅ Complete Success' : (errors.length > 0 ? '⚠️ Partial Success / Errors' : '✅ Success (No items or no errors)')}\n` +
      `Summary: ${message}\n` +
      `Removed: ${deleted.length} knowledge item(s)\n` +
      `Errors: ${errors.length} error(s)\n`;
    
    let deletedSection = "";
    if (deleted.length > 0) {
      deletedSection = `\n--- Removed Knowledge Items (${deleted.length}) ---\n\n`;
      deletedSection += deleted.map(id => `- ${id}`).join('\n');
    }
    
    let errorsSection = "";
    if (errors.length > 0) {
      errorsSection = `\n--- Errors Encountered (${errors.length}) ---\n\n`;
      errorsSection += errors.map((errorItem, index) => {
        return `${index + 1}. Failed to remove ID: ${errorItem.knowledgeId}\n` +
          `   Error Code: ${errorItem.error.code}\n` +
          `   Message: ${errorItem.error.message}` +
          (errorItem.error.details ? `\n   Details: ${JSON.stringify(errorItem.error.details)}` : "");
      }).join("\n\n");
    }
    
    return `${summary}${deletedSection}${errorsSection}`.trim();
  }
}

/**
 * Create a human-readable formatted response for the atlas_knowledge_delete tool
 * 
 * @param data The structured knowledge removal operation results (SingleKnowledgeDeleteResponse or BulkKnowledgeDeleteResponse)
 * @param isError This parameter is effectively ignored as success is determined from data.success. Kept for signature consistency if needed.
 * @returns Formatted MCP tool response with appropriate structure
 */
export function formatKnowledgeDeleteResponse(data: any, isError = false): any {
  const isBulkResponse = data.hasOwnProperty("deleted") && Array.isArray(data.deleted) && data.hasOwnProperty("errors");
  
  let formattedText: string;
  let finalIsError: boolean;

  if (isBulkResponse) {
    const formatter = new BulkKnowledgeDeleteFormatter();
    const bulkData = data as BulkKnowledgeDeleteResponse;
    formattedText = formatter.format(bulkData);
    finalIsError = !bulkData.success || bulkData.errors.length > 0;
  } else {
    const formatter = new SingleKnowledgeDeleteFormatter();
    const singleData = data as SingleKnowledgeDeleteResponse;
    formattedText = formatter.format(singleData);
    finalIsError = !singleData.success;
  }
  return createToolResponse(formattedText, finalIsError);
}
