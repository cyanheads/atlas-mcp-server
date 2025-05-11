import { Neo4jTask } from "../../../services/neo4j/types.js";
import { createToolResponse, McpToolResponse } from "../../../types/mcp.js";
import { TaskListResponse } from "./types.js";

/**
 * Formatter for task list responses
 */
class TaskListFormatter {
  format(data: TaskListResponse): string {
    // Destructure, providing default empty array for tasks if undefined/null
    const { tasks = [], total, page, limit, totalPages } = data; 
    
    // Add an explicit check if tasks is actually an array after destructuring (extra safety)
    if (!Array.isArray(tasks)) {
      // Log error or return a specific error message
      return "Error: Invalid task data received."; 
    }

    // Create a summary section with pagination info
    const summary = `Task List\n\n` +
      `Found ${total} task(s)\n` +
      `Page ${page} of ${totalPages} (${limit} per page)\n`;
    
    // Early return if no tasks found
    if (tasks.length === 0) {
      return `${summary}\nNo tasks found matching the specified criteria.`;
    }
    
    // Create a table of tasks
    let tasksSection = "Tasks:\n\n";
    
    tasksSection += tasks
      .map((taskData, index) => { // Rename to avoid conflict
        // Add safety check for null/undefined task data
        if (!taskData) {
          // Log a warning or handle appropriately if needed, here just skip
          return null; // Return null to filter out later
        }
        
        // Cast the task data to include the assignedToUserId property
        const task = taskData as Neo4jTask & { assignedToUserId: string | null };
        
        const statusEmoji = this.getStatusEmoji(task.status);
      const priorityIndicator = this.getPriorityIndicator(task.priority);
      
      // Use assignedToUserId from the task object
      const assignedToLine = task.assignedToUserId ? `   Assigned To: ${task.assignedToUserId}\n` : "";
      
      return `${index + 1}. ${statusEmoji} ${priorityIndicator} ${task.title}\n` +
        `   ID: ${task.id}\n` +
        `   Status: ${task.status}\n` +
        `   Priority: ${task.priority}\n` +
        assignedToLine + // Use the updated assignee line
        // Safely check if tags is an array and has items before joining
        (Array.isArray(task.tags) && task.tags.length > 0 ? `   Tags: ${task.tags.join(', ')}\n` : "") +
        `   Type: ${task.taskType}\n` +
        `   Created: ${new Date(task.createdAt).toLocaleString()}\n`;
      })
      .filter(Boolean) // Filter out any null entries from the map
      .join("\n");
      
    // Add help text for pagination
    let paginationHelp = "";
    if (totalPages > 1) {
      paginationHelp = `\nTo view more tasks, use 'page' parameter (current: ${page}, total pages: ${totalPages}).`;
    }
    
    return `${summary}\n${tasksSection}${paginationHelp}`;
  }
  
  /**
   * Get an emoji indicator for the task status
   */
  private getStatusEmoji(status: string): string {
    switch (status) {
      case 'backlog': return '📋';
      case 'todo': return '📝';
      case 'in_progress': return '🔄';
      case 'completed': return '✅';
      default: return '❓';
    }
  }
  
  /**
   * Get a visual indicator for the priority level
   */
  private getPriorityIndicator(priority: string): string {
    switch (priority) {
      case 'critical': return '[!!!]';
      case 'high': return '[!!]';
      case 'medium': return '[!]';
      case 'low': return '[-]';
      default: return '[?]';
    }
  }
}

/**
 * Create a formatted, human-readable response for the atlas_task_list tool
 * 
 * @param data The task list response data
 * @param isError Whether this response represents an error condition
 * @returns Formatted MCP tool response with appropriate structure
 */
export function formatTaskListResponse(data: TaskListResponse, isError = false): McpToolResponse {
  const formatter = new TaskListFormatter();
  const formattedText = formatter.format(data);
  return createToolResponse(formattedText, isError);
}
