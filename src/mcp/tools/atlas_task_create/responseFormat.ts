import { TaskResponse } from "../../../types/mcp.js";
import { createToolResponse } from "../../../types/mcp.js"; // Import the new response creator

/**
 * Defines a generic interface for formatting data into a string.
 */
interface ResponseFormatter<T> {
  format(data: T): string;
}

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
 * Interface for bulk task creation response
 */
interface BulkTaskResponse {
  success: boolean;
  message: string;
  created: (TaskResponse & { properties?: any; identity?: number; labels?: string[]; elementId?: string; })[];
  errors: {
    index: number;
    task: any; // Original input for the failed task
    error: {
      code: string;
      message: string;
      details?: any;
    };
  }[];
}

/**
 * Formatter for single task creation responses
 */
export class SingleTaskFormatter implements ResponseFormatter<SingleTaskResponse> {
  format(data: SingleTaskResponse): string {
    // Extract task properties from Neo4j structure or direct data
    const taskData = data.properties || data;
    const { title, id, projectId, status, priority, taskType, createdAt, description, assignedTo, urls, tags, completionRequirements, dependencies, outputFormat, updatedAt } = taskData;
    
    // Create a summary section
    const summary = `Task Created Successfully\n\n` +
      `Task: ${title || 'Unnamed Task'}\n` +
      `ID: ${id || 'Unknown ID'}\n` +
      `Project ID: ${projectId || 'Unknown Project'}\n` +
      `Status: ${status || 'Unknown Status'}\n` +
      `Priority: ${priority || 'Unknown Priority'}\n` +
      `Type: ${taskType || 'Unknown Type'}\n` +
      `Created: ${createdAt ? new Date(createdAt).toLocaleString() : 'Unknown Date'}\n`;
    
    // Create a comprehensive details section
    let details = `Task Details:\n`;
    const fieldLabels: Record<keyof SingleTaskResponse, string> = {
        id: "ID", projectId: "Project ID", title: "Title", description: "Description",
        priority: "Priority", status: "Status", assignedTo: "Assigned To", urls: "URLs",
        tags: "Tags", completionRequirements: "Completion Requirements", dependencies: "Dependencies",
        outputFormat: "Output Format", taskType: "Task Type", createdAt: "Created At", updatedAt: "Updated At",
        properties: "Raw Properties", identity: "Neo4j Identity", labels: "Neo4j Labels", elementId: "Neo4j Element ID"
    };
    const relevantKeys: (keyof SingleTaskResponse)[] = [
        'id', 'projectId', 'title', 'description', 'priority', 'status', 'assignedTo', 
        'urls', 'tags', 'completionRequirements', 'dependencies', 'outputFormat', 'taskType', 
        'createdAt', 'updatedAt'
    ];
    
    relevantKeys.forEach(key => {
        if (taskData[key] !== undefined && taskData[key] !== null) {
            let value = taskData[key];
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
 * Formatter for bulk task creation responses
 */
export class BulkTaskFormatter implements ResponseFormatter<BulkTaskResponse> {
  format(data: BulkTaskResponse): string {
    const { success, message, created, errors } = data;
    
    const summary = `${success && errors.length === 0 ? "Tasks Created Successfully" : "Task Creation Completed"}\n\n` +
      `Status: ${success && errors.length === 0 ? "✅ Success" : (errors.length > 0 ? "⚠️ Partial Success / Errors" : "✅ Success (No items or no errors)")}\n` +
      `Summary: ${message}\n` +
      `Created: ${created.length} task(s)\n` +
      `Errors: ${errors.length} error(s)\n`;
    
    let createdSection = "";
    if (created.length > 0) {
      createdSection = `\n--- Created Tasks (${created.length}) ---\n\n`;
      createdSection += created.map((task, index) => {
        const taskData = task.properties || task;
        return `${index + 1}. ${taskData.title || 'Unnamed Task'} (ID: ${taskData.id || 'N/A'})\n` +
          `   Project ID: ${taskData.projectId || 'N/A'}\n` +
          `   Priority: ${taskData.priority || 'N/A'}\n` +
          `   Status: ${taskData.status || 'N/A'}\n` +
          `   Created: ${taskData.createdAt ? new Date(taskData.createdAt).toLocaleString() : 'N/A'}`;
      }).join("\n\n");
    }
    
    let errorsSection = "";
    if (errors.length > 0) {
      errorsSection = `\n--- Errors Encountered (${errors.length}) ---\n\n`;
      errorsSection += errors.map((errorItem, index) => {
        const taskTitle = errorItem.task?.title || `Input task at index ${errorItem.index}`;
        return `${index + 1}. Error for task: "${taskTitle}" (Project ID: ${errorItem.task?.projectId || 'N/A'})\n` +
          `   Error Code: ${errorItem.error.code}\n` +
          `   Message: ${errorItem.error.message}` +
          (errorItem.error.details ? `\n   Details: ${JSON.stringify(errorItem.error.details)}` : "");
      }).join("\n\n");
    }
    
    return `${summary}${createdSection}${errorsSection}`.trim();
  }
}

/**
 * Create a formatted, human-readable response for the atlas_task_create tool
 * 
 * @param data The raw task creation response data (SingleTaskResponse or BulkTaskResponse)
 * @param isError Whether this response represents an error condition (primarily for single responses)
 * @returns Formatted MCP tool response with appropriate structure
 */
export function formatTaskCreateResponse(data: any, isError = false): any {
  const isBulkResponse = data.hasOwnProperty("success") && data.hasOwnProperty("created") && data.hasOwnProperty("errors");
  
  let formattedText: string;
  let finalIsError: boolean;

  if (isBulkResponse) {
    const formatter = new BulkTaskFormatter();
    const bulkData = data as BulkTaskResponse;
    formattedText = formatter.format(bulkData);
    finalIsError = !bulkData.success || bulkData.errors.length > 0;
  } else {
    const formatter = new SingleTaskFormatter();
    // For single response, 'data' is the created task object.
    // 'isError' must be determined by the caller if an error occurred before this point.
    formattedText = formatter.format(data as SingleTaskResponse);
    finalIsError = isError; 
  }
  return createToolResponse(formattedText, finalIsError);
}
