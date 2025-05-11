import { ProjectResponse } from "../../../types/mcp.js";
import { createToolResponse } from "../../../types/mcp.js"; // Import the new response creator

/**
 * Defines a generic interface for formatting data into a string.
 */
interface ResponseFormatter<T> {
  format(data: T): string;
}

/**
 * Extends the ProjectResponse to include Neo4j properties structure 
 */
interface SingleProjectResponse extends ProjectResponse {
  properties?: any;
  identity?: number;
  labels?: string[];
  elementId?: string;
}

/**
 * Interface for bulk project update response
 */
interface BulkProjectResponse {
  success: boolean;
  message: string;
  updated: (ProjectResponse & { properties?: any; identity?: number; labels?: string[]; elementId?: string; })[];
  errors: {
    index: number;
    project: { // Original input for the failed update
      id: string;
      updates: any;
    };
    error: {
      code: string;
      message: string;
      details?: any;
    };
  }[];
}

/**
 * Formatter for individual project modification responses
 */
export class SingleProjectUpdateFormatter implements ResponseFormatter<SingleProjectResponse> {
  format(data: SingleProjectResponse): string {
    // Extract project properties from Neo4j structure or direct data
    const projectData = data.properties || data;
    const { name, id, status, taskType, updatedAt, description, urls, completionRequirements, outputFormat, createdAt } = projectData;
    
    // Create a structured summary section
    const summary = `Project Modified Successfully\n\n` +
      `Project: ${name || 'Unnamed Project'}\n` +
      `ID: ${id || 'Unknown ID'}\n` +
      `Status: ${status || 'Unknown Status'}\n` +
      `Type: ${taskType || 'Unknown Type'}\n` +
      `Updated: ${updatedAt ? new Date(updatedAt).toLocaleString() : 'Unknown Date'}\n`;
    
    // Create a comprehensive details section
    let details = `Project Details:\n`;
    const fieldLabels: Record<keyof SingleProjectResponse, string> = {
        id: "ID", name: "Name", description: "Description", status: "Status", urls: "URLs",
        completionRequirements: "Completion Requirements", outputFormat: "Output Format",
        taskType: "Task Type", createdAt: "Created At", updatedAt: "Updated At",
        properties: "Raw Properties", identity: "Neo4j Identity", labels: "Neo4j Labels",
        elementId: "Neo4j Element ID", dependencies: "Dependencies"
    };
    const relevantKeys: (keyof SingleProjectResponse)[] = ['id', 'name', 'description', 'status', 'taskType', 'completionRequirements', 'outputFormat', 'urls', 'createdAt', 'updatedAt'];

    relevantKeys.forEach(key => {
        if (projectData[key] !== undefined && projectData[key] !== null) {
            let value = projectData[key];
            if (Array.isArray(value)) {
                value = value.length > 0 ? value.map(item => typeof item === 'object' ? JSON.stringify(item) : item).join(', ') : "None";
            } else if (typeof value === 'string' && (key === 'createdAt' || key === 'updatedAt')) {
                try { value = new Date(value).toLocaleString(); } catch (e) { /* Keep original */ }
            }
            details += `  ${fieldLabels[key] || key}: ${value}\n`;
        }
    });
    
    return `${summary}\n${details}`;
  }
}

/**
 * Formatter for bulk project update responses
 */
export class BulkProjectUpdateFormatter implements ResponseFormatter<BulkProjectResponse> {
  format(data: BulkProjectResponse): string {
    const { success, message, updated, errors } = data;
    
    const summary = `${success && errors.length === 0 ? "Projects Updated Successfully" : "Project Updates Completed"}\n\n` +
      `Status: ${success && errors.length === 0 ? "✅ Success" : (errors.length > 0 ? "⚠️ Partial Success / Errors" : "✅ Success (No items or no errors)")}\n` +
      `Summary: ${message}\n` +
      `Updated: ${updated.length} project(s)\n` +
      `Errors: ${errors.length} error(s)\n`;
    
    let updatedSection = "";
    if (updated.length > 0) {
      updatedSection = `\n--- Modified Projects (${updated.length}) ---\n\n`;
      updatedSection += updated.map((project, index) => {
        const projectData = project.properties || project;
        return `${index + 1}. ${projectData.name || 'Unnamed Project'} (ID: ${projectData.id || 'N/A'})\n` +
          `   Status: ${projectData.status || 'N/A'}\n` +
          `   Updated: ${projectData.updatedAt ? new Date(projectData.updatedAt).toLocaleString() : 'N/A'}`;
      }).join("\n\n");
    }
    
    let errorsSection = "";
    if (errors.length > 0) {
      errorsSection = `\n--- Errors Encountered (${errors.length}) ---\n\n`;
      errorsSection += errors.map((errorItem, index) => {
        return `${index + 1}. Error updating Project ID: "${errorItem.project.id}"\n` +
          `   Error Code: ${errorItem.error.code}\n` +
          `   Message: ${errorItem.error.message}` +
          (errorItem.error.details ? `\n   Details: ${JSON.stringify(errorItem.error.details)}` : "");
      }).join("\n\n");
    }
    
    return `${summary}${updatedSection}${errorsSection}`.trim();
  }
}

/**
 * Create a formatted, human-readable response for the atlas_project_update tool
 * 
 * @param data The raw project modification response (SingleProjectResponse or BulkProjectResponse)
 * @param isError Whether this response represents an error condition (primarily for single responses)
 * @returns Formatted MCP tool response with appropriate structure
 */
export function formatProjectUpdateResponse(data: any, isError = false): any {
  const isBulkResponse = data.hasOwnProperty("success") && data.hasOwnProperty("updated") && data.hasOwnProperty("errors");
  
  let formattedText: string;
  let finalIsError: boolean;

  if (isBulkResponse) {
    const formatter = new BulkProjectUpdateFormatter();
    const bulkData = data as BulkProjectResponse;
    formattedText = formatter.format(bulkData);
    finalIsError = !bulkData.success || bulkData.errors.length > 0;
  } else {
    const formatter = new SingleProjectUpdateFormatter();
    // For single response, 'data' is the updated project object.
    // 'isError' must be determined by the caller if an error occurred before this point.
    formattedText = formatter.format(data as SingleProjectResponse);
    finalIsError = isError; 
  }
  return createToolResponse(formattedText, finalIsError);
}
