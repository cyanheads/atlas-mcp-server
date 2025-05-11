import { createToolResponse } from "../../../types/mcp.js"; // Import the new response creator

/**
 * Defines a generic interface for formatting data into a string.
 */
interface ResponseFormatter<T> {
  format(data: T): string;
}

/**
 * Interface for single project deletion response
 */
interface SingleProjectDeleteResponse {
  id: string;
  success: boolean;
  message: string;
}

/**
 * Interface for bulk project deletion response
 */
interface BulkProjectDeleteResponse {
  success: boolean;
  message: string;
  deleted: string[];
  errors: {
    projectId: string;
    error: {
      code: string;
      message: string;
      details?: any;
    };
  }[];
}

/**
 * Formatter for individual project removal responses
 */
export class SingleProjectDeleteFormatter implements ResponseFormatter<SingleProjectDeleteResponse> {
  format(data: SingleProjectDeleteResponse): string {
    return `Project Removal\n\n` +
      `Result: ${data.success ? '✅ Success' : '❌ Failed'}\n` +
      `Project ID: ${data.id}\n` +
      `Message: ${data.message}\n`;
  }
}

/**
 * Formatter for batch project removal responses
 */
export class BulkProjectDeleteFormatter implements ResponseFormatter<BulkProjectDeleteResponse> {
  format(data: BulkProjectDeleteResponse): string {
    const { success, message, deleted, errors } = data;
    
    const summary = `Project Cleanup Operation\n\n` +
      `Status: ${success && errors.length === 0 ? '✅ Complete Success' : (errors.length > 0 ? '⚠️ Partial Success / Errors' : '✅ Success (No items or no errors)')}\n` +
      `Summary: ${message}\n` +
      `Removed: ${deleted.length} project(s)\n` +
      `Errors: ${errors.length} error(s)\n`;
    
    let deletedSection = "";
    if (deleted.length > 0) {
      deletedSection = `\n--- Removed Projects (${deleted.length}) ---\n\n`;
      deletedSection += deleted.map(id => `- ${id}`).join('\n');
    }
    
    let errorsSection = "";
    if (errors.length > 0) {
      errorsSection = `\n--- Errors Encountered (${errors.length}) ---\n\n`;
      errorsSection += errors.map((errorItem, index) => {
        return `${index + 1}. Failed to remove ID: ${errorItem.projectId}\n` +
          `   Error Code: ${errorItem.error.code}\n` +
          `   Message: ${errorItem.error.message}` +
          (errorItem.error.details ? `\n   Details: ${JSON.stringify(errorItem.error.details)}` : "");
      }).join("\n\n");
    }
    
    return `${summary}${deletedSection}${errorsSection}`.trim();
  }
}

/**
 * Create a human-readable formatted response for the atlas_project_delete tool
 * 
 * @param data The structured project removal operation results (SingleProjectDeleteResponse or BulkProjectDeleteResponse)
 * @param isError This parameter is effectively ignored as success is determined from data.success. Kept for signature consistency if needed.
 * @returns Formatted MCP tool response with appropriate structure
 */
export function formatProjectDeleteResponse(data: any, isError = false): any {
  const isBulkResponse = data.hasOwnProperty("deleted") && Array.isArray(data.deleted) && data.hasOwnProperty("errors");
  
  let formattedText: string;
  let finalIsError: boolean;

  if (isBulkResponse) {
    const formatter = new BulkProjectDeleteFormatter();
    const bulkData = data as BulkProjectDeleteResponse;
    formattedText = formatter.format(bulkData);
    finalIsError = !bulkData.success || bulkData.errors.length > 0;
  } else {
    const formatter = new SingleProjectDeleteFormatter();
    const singleData = data as SingleProjectDeleteResponse;
    formattedText = formatter.format(singleData);
    finalIsError = !singleData.success;
  }
  return createToolResponse(formattedText, finalIsError);
}
