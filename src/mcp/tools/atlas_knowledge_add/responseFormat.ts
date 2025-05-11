import { createToolResponse } from "../../../types/mcp.js"; // Import the new response creator

/**
 * Defines a generic interface for formatting data into a string.
 */
interface ResponseFormatter<T> {
  format(data: T): string;
}

/**
 * Interface for a single knowledge item response
 */
interface SingleKnowledgeResponse {
  id: string;
  projectId: string;
  text: string;
  tags?: string[];
  domain: string;
  citations?: string[];
  createdAt: string;
  updatedAt: string;
  properties?: any; // Neo4j properties if not fully mapped
  identity?: number;  // Neo4j internal ID
  labels?: string[];  // Neo4j labels
  elementId?: string; // Neo4j element ID
}

/**
 * Interface for bulk knowledge addition response
 */
interface BulkKnowledgeResponse {
  success: boolean;
  message: string;
  created: (SingleKnowledgeResponse & { properties?: any; identity?: number; labels?: string[]; elementId?: string; })[];
  errors: {
    index: number;
    knowledge: any; // Original input for the failed item
    error: {
      code: string;
      message: string;
      details?: any;
    };
  }[];
}

/**
 * Formatter for single knowledge item addition responses
 */
export class SingleKnowledgeFormatter implements ResponseFormatter<SingleKnowledgeResponse> {
  format(data: SingleKnowledgeResponse): string {
    // Extract knowledge properties from Neo4j structure or direct data
    const knowledgeData = data.properties || data;
    const { id, projectId, domain, createdAt, text, tags, citations, updatedAt } = knowledgeData;
    
    // Create a summary section
    const summary = `Knowledge Item Added Successfully\n\n` +
      `ID: ${id || 'Unknown ID'}\n` +
      `Project ID: ${projectId || 'Unknown Project'}\n` +
      `Domain: ${domain || 'Uncategorized'}\n` +
      `Created: ${createdAt ? new Date(createdAt).toLocaleString() : 'Unknown Date'}\n`;
    
    // Create a comprehensive details section
    const fieldLabels: Record<keyof SingleKnowledgeResponse, string> = {
      id: "ID",
      projectId: "Project ID",
      text: "Content",
      tags: "Tags",
      domain: "Domain",
      citations: "Citations",
      createdAt: "Created At",
      updatedAt: "Updated At",
      // Neo4j specific fields are generally not for direct user display unless needed
      properties: "Raw Properties", 
      identity: "Neo4j Identity",
      labels: "Neo4j Labels",
      elementId: "Neo4j Element ID"
    };
    
    let details = `Knowledge Item Details\n\n`;
    
    // Build details as key-value pairs for relevant fields
    (Object.keys(fieldLabels) as Array<keyof SingleKnowledgeResponse>).forEach(key => {
      if (knowledgeData[key] !== undefined && ['properties', 'identity', 'labels', 'elementId'].indexOf(key as string) === -1) { // Exclude raw Neo4j fields from default display
        let value = knowledgeData[key];
        
        if (Array.isArray(value)) {
          value = value.length > 0 ? value.join(', ') : "None";
        } else if (typeof value === 'string' && (key === 'createdAt' || key === 'updatedAt')) {
          try {
            value = new Date(value).toLocaleString();
          } catch (e) { /* Keep original if parsing fails */ }
        }
        
        if (key === 'text' && typeof value === 'string' && value.length > 100) {
          value = value.substring(0, 100) + '... (truncated)';
        }
        
        details += `${fieldLabels[key]}: ${value}\n`;
      }
    });
    
    return `${summary}\n${details}`;
  }
}

/**
 * Formatter for bulk knowledge addition responses
 */
export class BulkKnowledgeFormatter implements ResponseFormatter<BulkKnowledgeResponse> {
  format(data: BulkKnowledgeResponse): string {
    const { success, message, created, errors } = data;
    
    const summary = `${success && errors.length === 0 ? "Knowledge Items Added Successfully" : "Knowledge Addition Completed"}\n\n` +
      `Status: ${success && errors.length === 0 ? "✅ Success" : (errors.length > 0 ? "⚠️ Partial Success / Errors" : "✅ Success (No items or no errors)")}\n` +
      `Summary: ${message}\n` +
      `Added: ${created.length} item(s)\n` +
      `Errors: ${errors.length} error(s)\n`;
    
    let createdSection = "";
    if (created.length > 0) {
      createdSection = `\n--- Added Knowledge Items (${created.length}) ---\n\n`;
      createdSection += created.map((item, index) => {
        const itemData = item.properties || item;
        return `${index + 1}. ID: ${itemData.id || 'N/A'}\n` +
          `   Project ID: ${itemData.projectId || 'N/A'}\n` +
          `   Domain: ${itemData.domain || 'N/A'}\n` +
          `   Tags: ${itemData.tags ? itemData.tags.join(', ') : 'None'}\n` +
          `   Created: ${itemData.createdAt ? new Date(itemData.createdAt).toLocaleString() : 'N/A'}`;
      }).join("\n\n");
    }
    
    let errorsSection = "";
    if (errors.length > 0) {
      errorsSection = `\n--- Errors Encountered (${errors.length}) ---\n\n`;
      errorsSection += errors.map((errorDetail, index) => {
        const itemInput = errorDetail.knowledge;
        return `${index + 1}. Error for item (Index: ${errorDetail.index})\n` +
          `   Input Project ID: ${itemInput?.projectId || 'N/A'}\n` +
          `   Input Domain: ${itemInput?.domain || 'N/A'}\n` +
          `   Error Code: ${errorDetail.error.code}\n` +
          `   Message: ${errorDetail.error.message}` +
          (errorDetail.error.details ? `\n   Details: ${JSON.stringify(errorDetail.error.details)}` : "");
      }).join("\n\n");
    }
    
    return `${summary}${createdSection}${errorsSection}`.trim();
  }
}

/**
 * Create a formatted, human-readable response for the atlas_knowledge_add tool
 * 
 * @param data The raw knowledge addition response data (can be SingleKnowledgeResponse or BulkKnowledgeResponse)
 * @param isError Whether this response represents an error condition (primarily for single responses if not inherent in data)
 * @returns Formatted MCP tool response with appropriate structure
 */
export function formatKnowledgeAddResponse(data: any, isError = false): any {
  const isBulkResponse = data.hasOwnProperty("success") && data.hasOwnProperty("created") && data.hasOwnProperty("errors");
  
  let formattedText: string;
  let finalIsError: boolean;

  if (isBulkResponse) {
    const formatter = new BulkKnowledgeFormatter();
    formattedText = formatter.format(data as BulkKnowledgeResponse);
    finalIsError = !data.success || data.errors.length > 0;
  } else {
    const formatter = new SingleKnowledgeFormatter();
    formattedText = formatter.format(data as SingleKnowledgeResponse);
    finalIsError = isError; // For single responses, rely on the passed isError or enhance if data has success field
  }
  return createToolResponse(formattedText, finalIsError);
}
