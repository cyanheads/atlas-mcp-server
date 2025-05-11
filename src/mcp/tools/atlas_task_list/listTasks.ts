import { TaskService } from '../../../services/neo4j/taskService.js';
import { ProjectService } from '../../../services/neo4j/projectService.js';
import { BaseErrorCode, McpError, ProjectErrorCode } from '../../../types/errors.js';
import { logger } from '../../../utils/internal/logger.js';
import { ToolContext } from '../../../types/tool.js';
import { TaskListRequestInput, TaskListRequestSchema } from './types.js';
import { formatTaskListResponse } from './responseFormat.js';

export const atlasListTasks = async (
  input: unknown,
  context: ToolContext
) => {
  try {
    // Parse and validate input against schema
    const validatedInput = TaskListRequestSchema.parse(input);
    
    // Log operation
    logger.info("Listing tasks for project", { 
      projectId: validatedInput.projectId,
      requestId: context.requestContext?.requestId 
    });

    // First check if the project exists
    const projectExists = await ProjectService.getProjectById(validatedInput.projectId);
    
    if (!projectExists) {
      throw new McpError(
        ProjectErrorCode.PROJECT_NOT_FOUND,
        `Project with ID ${validatedInput.projectId} not found`,
        { projectId: validatedInput.projectId }
      );
    }

    // Call the task service to get tasks with filters
    const tasksResult = await TaskService.getTasks({
      projectId: validatedInput.projectId,
      status: validatedInput.status,
      assignedTo: validatedInput.assignedTo,
      priority: validatedInput.priority,
      tags: validatedInput.tags,
      taskType: validatedInput.taskType,
      sortBy: validatedInput.sortBy,
      sortDirection: validatedInput.sortDirection,
      page: validatedInput.page,
      limit: validatedInput.limit
    });
    
    logger.info("Tasks retrieved successfully", { 
      projectId: validatedInput.projectId,
      taskCount: tasksResult.data.length,
      totalTasks: tasksResult.total,
      requestId: context.requestContext?.requestId 
    });

    // Create the response object with task data
    const responseData = {
      tasks: tasksResult.data,
      total: tasksResult.total,
      page: tasksResult.page,
      limit: tasksResult.limit,
      totalPages: tasksResult.totalPages
    };

    // Return the raw response data object
    return responseData; 
  } catch (error) {
    // Handle specific error cases
    if (error instanceof McpError) {
      throw error;
    }

    logger.error("Failed to list tasks", { 
      error,
      requestId: context.requestContext?.requestId 
    });

    // Convert other errors to McpError
    throw new McpError(
      BaseErrorCode.INTERNAL_ERROR,
      `Error listing tasks: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};
