import { TaskResponse, McpToolResponse, createToolResponse } from "../../../types/mcp.js";

/**
 * Extends the TaskResponse to include Neo4j properties structure 
 */
interface SingleTaskResponse extends TaskResponse {
  properties?: any;
  identity?: number;
  labels?: string[];
  elementId?: string;
}

/**
 * Interface for bulk task update response
 */
interface BulkTaskResponse {
  success: boolean;
  message: string;
  updated: (TaskResponse & { properties?: any; identity?: number; labels?: string[]; elementId?: string; })[];
  errors: {
    index: number;
    task: {
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
 * Formatter for individual task update responses
 */
class SingleTaskUpdateFormatter {
  format(data: SingleTaskResponse): string {
    // Extract task properties from Neo4j structure
    const taskData = data.properties || data;
    const { title, id, projectId, status, priority, taskType, updatedAt } = taskData;
    
    // Create a structured summary section
    const summary = `Task Updated Successfully\n\n` +
      `Task: ${title || 'Unnamed Task'}\n` +
      `ID: ${id || 'Unknown ID'}\n` +
      `Project ID: ${projectId || 'Unknown Project'}\n` +
      `Status: ${status || 'Unknown Status'}\n` +
      `Priority: ${priority || 'Unknown Priority'}\n` +
      `Type: ${taskType || 'Unknown Type'}\n` +
      `Updated: ${updatedAt ? new Date(updatedAt).toLocaleString() : 'Unknown Date'}\n`;
    
    // Create a comprehensive details section with all task attributes
    let details = `Task Details\n\n`;
    
    // Add each property with proper formatting
    if (taskData.id) details += `ID: ${taskData.id}\n`;
    if (taskData.projectId) details += `Project ID: ${taskData.projectId}\n`;
    if (taskData.title) details += `Title: ${taskData.title}\n`;
    if (taskData.description) details += `Description: ${taskData.description}\n`;
    if (taskData.priority) details += `Priority: ${taskData.priority}\n`;
    if (taskData.status) details += `Status: ${taskData.status}\n`;
    if (taskData.assignedTo) details += `Assigned To: ${taskData.assignedTo}\n`;
    
    // Format URLs array
    if (taskData.urls) {
      const urlsValue = Array.isArray(taskData.urls) && taskData.urls.length > 0 
        ? JSON.stringify(taskData.urls) 
        : "None";
      details += `URLs: ${urlsValue}\n`;
    }
    
    // Format tags array
    if (taskData.tags) {
      const tagsValue = Array.isArray(taskData.tags) && taskData.tags.length > 0 
        ? taskData.tags.join(", ") 
        : "None";
      details += `Tags: ${tagsValue}\n`;
    }
    
    if (taskData.completionRequirements) details += `Completion Requirements: ${taskData.completionRequirements}\n`;
    if (taskData.outputFormat) details += `Output Format: ${taskData.outputFormat}\n`;
    if (taskData.taskType) details += `Task Type: ${taskData.taskType}\n`;
    
    // Format dates
    if (taskData.createdAt) {
      const createdDate = typeof taskData.createdAt === 'string' && 
                        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(taskData.createdAt)
        ? new Date(taskData.createdAt).toLocaleString()
        : taskData.createdAt;
      details += `Created At: ${createdDate}\n`;
    }
    
    if (taskData.updatedAt) {
      const updatedDate = typeof taskData.updatedAt === 'string' && 
                        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(taskData.updatedAt)
        ? new Date(taskData.updatedAt).toLocaleString()
        : taskData.updatedAt;
      details += `Updated At: ${updatedDate}\n`;
    }
    
    return `${summary}\n\n${details}`;
  }
}

/**
 * Formatter for bulk task update responses
 */
class BulkTaskUpdateFormatter {
  format(data: BulkTaskResponse): string {
    const { success, message, updated, errors } = data;
    
    // Create a summary section
    const summary = `${success ? "Tasks Updated Successfully" : "Task Updates Completed with Errors"}\n\n` +
      `Status: ${success ? "✅ Success" : "⚠️ Partial Success"}\n` +
      `Summary: ${message}\n` +
      `Updated: ${updated.length} task(s)\n` +
      `Errors: ${errors.length} error(s)\n`;
    
    // List all successfully modified tasks
    let updatedSection = "";
    if (updated.length > 0) {
      updatedSection = `Updated Tasks\n\n`;
      
      updatedSection += updated.map((task, index) => {
        // Extract task properties from Neo4j structure
        const taskData = task.properties || task;
        return `${index + 1}. ${taskData.title || 'Unnamed Task'}\n\n` +
          `ID: ${taskData.id || 'Unknown ID'}\n` +
          `Project ID: ${taskData.projectId || 'Unknown Project'}\n` +
          `Type: ${taskData.taskType || 'Unknown Type'}\n` +
          `Status: ${taskData.status || 'Unknown Status'}\n` +
          `Priority: ${taskData.priority || 'Unknown Priority'}\n` +
          `Updated: ${taskData.updatedAt ? new Date(taskData.updatedAt).toLocaleString() : 'Unknown Date'}\n`;
      }).join("\n\n");
    }
    
    // List any errors that occurred
    let errorsSection = "";
    if (errors.length > 0) {
      errorsSection = `Errors\n\n`;
      
      errorsSection += errors.map((error, index) => {
        return `${index + 1}. Error updating Task ID: "${error.task.id}"\n\n` +
          `Error Code: ${error.error.code}\n` +
          `Message: ${error.error.message}\n` +
          (error.error.details ? `Details: ${JSON.stringify(error.error.details)}\n` : "");
      }).join("\n\n");
    }
    
    return `${summary}\n\n${updatedSection}\n\n${errorsSection}`.trim();
  }
}

/**
 * Create a formatted, human-readable response for the atlas_task_update tool
 * 
 * @param data The raw task update response
 * @param isError Whether this response represents an error condition
 * @returns Formatted MCP tool response with appropriate structure
 */
export function formatTaskUpdateResponse(data: any, isError = false): McpToolResponse {
  // Determine if this is a single or bulk task response
  const isBulkResponse = data.hasOwnProperty("success") && data.hasOwnProperty("updated");
  
  let formattedText: string;
  if (isBulkResponse) {
    const formatter = new BulkTaskUpdateFormatter();
    formattedText = formatter.format(data as BulkTaskResponse);
  } else {
    const formatter = new SingleTaskUpdateFormatter();
    formattedText = formatter.format(data as SingleTaskResponse);
  }
  return createToolResponse(formattedText, isError);
}
