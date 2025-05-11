import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ProjectService } from "../../../services/neo4j/projectService.js";
import { TaskService } from "../../../services/neo4j/taskService.js";
import { TaskFilterOptions } from "../../../services/neo4j/types.js";
import { BaseErrorCode, McpError, ProjectErrorCode, TaskErrorCode } from "../../../types/errors.js";
import { PriorityLevel, TaskStatus } from "../../../types/mcp.js";
import { logger } from "../../../utils/internal/logger.js";
import { ResourceTemplates, ResourceURIs, toTaskResource } from "../types.js";

/**
 * Register Task Resources
 * 
 * This function registers resource endpoints for the Tasks entity
 * - GET atlas://tasks - List all tasks
 * - GET atlas://tasks/{taskId} - Get specific task by ID
 * - GET atlas://projects/{projectId}/tasks - List tasks for a specific project
 * 
 * @param server The MCP server instance
 */
export function registerTaskResources(server: McpServer) {
  // List all tasks
  server.resource(
    "tasks-list", 
    ResourceURIs.TASKS, 
    {
      name: "All Tasks",
      description: "List of all tasks in the Atlas platform with pagination and filtering support",
      mimeType: "application/json"
    },
    async (uri) => {
    try {
      logger.info("Listing all tasks", { uri: uri.href });

      // Parse query parameters
      const queryParams = new URLSearchParams(uri.search);
      // Default project ID required by task service
      const projectId = queryParams.get("projectId") || "*";
      
      const filters: TaskFilterOptions = {
        projectId
      };

      // Parse status parameter using TaskStatus enum
      const status = queryParams.get("status");
      if (status) {
        switch (status) {
          case TaskStatus.BACKLOG:
            filters.status = 'backlog';
            break;
          case TaskStatus.TODO:
            filters.status = 'todo';
            break;
          case TaskStatus.IN_PROGRESS:
            filters.status = 'in-progress';
            break;
          case TaskStatus.COMPLETED:
            filters.status = 'completed';
            break;
          default:
            logger.warning(`Invalid status value: ${status}, ignoring filter`);
        }
      }

      // Parse priority parameter using PriorityLevel enum
      const priority = queryParams.get("priority");
      if (priority) {
        switch (priority) {
          case PriorityLevel.LOW:
            filters.priority = 'low';
            break;
          case PriorityLevel.MEDIUM:
            filters.priority = 'medium';
            break;
          case PriorityLevel.HIGH:
            filters.priority = 'high';
            break;
          case PriorityLevel.CRITICAL:
            filters.priority = 'critical';
            break;
          default:
            logger.warning(`Invalid priority value: ${priority}, ignoring filter`);
        }
      }

      // Parse assignedTo parameter
      const assignedTo = queryParams.get("assignedTo");
      if (assignedTo) {
        filters.assignedTo = String(assignedTo);
      }

      // Parse taskType parameter
      const taskType = queryParams.get("taskType");
      if (taskType) {
        filters.taskType = String(taskType);
      }

      // Parse tags parameter
      const tags = queryParams.get("tags");
      if (tags) {
        // Split comma-separated tags
        filters.tags = String(tags).split(',').map(tag => tag.trim());
      }

      // Parse sort parameters
      const sortBy = queryParams.get("sortBy");
      if (sortBy) {
        // Validate sortBy value
        const validSortByValues = ['priority', 'createdAt', 'status'];
        if (validSortByValues.includes(sortBy)) {
          filters.sortBy = sortBy as 'priority' | 'createdAt' | 'status';
        } else {
          logger.warning(`Invalid sortBy value: ${sortBy}, using default sorting`);
        }
      }

      const sortDirection = queryParams.get("sortDirection");
      if (sortDirection) {
        // Validate sortDirection value
        const validDirections = ['asc', 'desc'];
        if (validDirections.includes(sortDirection)) {
          filters.sortDirection = sortDirection as 'asc' | 'desc';
        } else {
          logger.warning(`Invalid sortDirection value: ${sortDirection}, using default direction`);
        }
      }

      // Parse pagination parameters
      const page = queryParams.has("page") 
        ? parseInt(queryParams.get("page") || "1", 10) 
        : 1;
      
      const limit = queryParams.has("limit") 
        ? parseInt(queryParams.get("limit") || "20", 10)
        : 20;

      // Add pagination to filters
      filters.page = page;
      filters.limit = limit;

      // Query the database
      const result = await TaskService.getTasks(filters);
      
      // Map Neo4j tasks to resource objects
      const taskResources = result.data.map(task => toTaskResource(task));

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({
              tasks: taskResources,
              pagination: {
                total: result.total,
                page: result.page,
                limit: result.limit,
                totalPages: result.totalPages
              }
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      logger.error("Error listing tasks", { 
        error,
        uri: uri.href
      });

      throw new McpError(
        BaseErrorCode.INTERNAL_ERROR,
        `Failed to list tasks: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  // Get task by ID
  server.resource(
    "task-by-id", 
    ResourceTemplates.TASK, 
    {
      name: "Task by ID",
      description: "Retrieves a single task by its unique identifier",
      mimeType: "application/json"
    },
    async (uri, params) => {
    try {
      const taskId = params.taskId as string;
      
      logger.info("Fetching task by ID", { 
        taskId,
        uri: uri.href
      });

      if (!taskId) {
        throw new McpError(
          BaseErrorCode.VALIDATION_ERROR,
          "Task ID is required"
        );
      }

      // Query the database
      const task = await TaskService.getTaskById(taskId);

      if (!task) {
        throw new McpError(
          TaskErrorCode.TASK_NOT_FOUND,
          `Task with ID ${taskId} not found`,
          { taskId }
        );
      }

      // Convert to resource object
      const taskResource = toTaskResource(task);

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(taskResource, null, 2)
          }
        ]
      };
    } catch (error) {
      // Handle specific error cases
      if (error instanceof McpError) {
        throw error;
      }

      logger.error("Error fetching task by ID", { 
        error,
        params
      });

      throw new McpError(
        BaseErrorCode.INTERNAL_ERROR,
        `Failed to fetch task: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  // List tasks by project
  server.resource(
    "tasks-by-project", 
    ResourceTemplates.TASKS_BY_PROJECT, 
    {
      name: "Tasks by Project",
      description: "Retrieves all tasks belonging to a specific project",
      mimeType: "application/json"
    },
    async (uri, params) => {
    try {
      const projectId = params.projectId as string;
      
      logger.info("Listing tasks for project", { 
        projectId,
        uri: uri.href
      });

      if (!projectId) {
        throw new McpError(
          BaseErrorCode.VALIDATION_ERROR,
          "Project ID is required"
        );
      }

      // Verify the project exists
      const project = await ProjectService.getProjectById(projectId);
      if (!project) {
        throw new McpError(
          ProjectErrorCode.PROJECT_NOT_FOUND,
          `Project with ID ${projectId} not found`,
          { projectId }
        );
      }

      // Parse query parameters
      const queryParams = new URLSearchParams(uri.search);
      const filters: TaskFilterOptions = {
        projectId
      };

      // Parse status parameter using TaskStatus enum
      const status = queryParams.get("status");
      if (status) {
        switch (status) {
          case TaskStatus.BACKLOG:
            filters.status = 'backlog';
            break;
          case TaskStatus.TODO:
            filters.status = 'todo';
            break;
          case TaskStatus.IN_PROGRESS:
            filters.status = 'in-progress';
            break;
          case TaskStatus.COMPLETED:
            filters.status = 'completed';
            break;
          default:
            logger.warning(`Invalid status value: ${status}, ignoring filter`);
        }
      }

      // Parse priority parameter using PriorityLevel enum
      const priority = queryParams.get("priority");
      if (priority) {
        switch (priority) {
          case PriorityLevel.LOW:
            filters.priority = 'low';
            break;
          case PriorityLevel.MEDIUM:
            filters.priority = 'medium';
            break;
          case PriorityLevel.HIGH:
            filters.priority = 'high';
            break;
          case PriorityLevel.CRITICAL:
            filters.priority = 'critical';
            break;
          default:
            logger.warning(`Invalid priority value: ${priority}, ignoring filter`);
        }
      }

      // Parse assignedTo parameter
      const assignedTo = queryParams.get("assignedTo");
      if (assignedTo) {
        filters.assignedTo = String(assignedTo);
      }

      // Parse taskType parameter
      const taskType = queryParams.get("taskType");
      if (taskType) {
        filters.taskType = String(taskType);
      }

      // Parse tags parameter
      const tags = queryParams.get("tags");
      if (tags) {
        // Split comma-separated tags
        filters.tags = String(tags).split(',').map(tag => tag.trim());
      }

      // Parse sort parameters
      const sortBy = queryParams.get("sortBy");
      if (sortBy) {
        // Validate sortBy value
        const validSortByValues = ['priority', 'createdAt', 'status'];
        if (validSortByValues.includes(sortBy)) {
          filters.sortBy = sortBy as 'priority' | 'createdAt' | 'status';
        } else {
          logger.warning(`Invalid sortBy value: ${sortBy}, using default sorting`);
        }
      }

      const sortDirection = queryParams.get("sortDirection");
      if (sortDirection) {
        // Validate sortDirection value
        const validDirections = ['asc', 'desc'];
        if (validDirections.includes(sortDirection)) {
          filters.sortDirection = sortDirection as 'asc' | 'desc';
        } else {
          logger.warning(`Invalid sortDirection value: ${sortDirection}, using default direction`);
        }
      }

      // Parse pagination parameters
      const page = queryParams.has("page") 
        ? parseInt(queryParams.get("page") || "1", 10) 
        : 1;
      
      const limit = queryParams.has("limit") 
        ? parseInt(queryParams.get("limit") || "20", 10)
        : 20;

      // Add pagination to filters
      filters.page = page;
      filters.limit = limit;

      // Query the database
      const result = await TaskService.getTasks(filters);
      
      // Map Neo4j tasks to resource objects
      const taskResources = result.data.map(task => toTaskResource(task));

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({
              projectId,
              projectName: project.name,
              tasks: taskResources,
              pagination: {
                total: result.total,
                page: result.page,
                limit: result.limit,
                totalPages: result.totalPages
              }
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      // Handle specific error cases
      if (error instanceof McpError) {
        throw error;
      }

      logger.error("Error listing tasks for project", { 
        error,
        params
      });

      throw new McpError(
        BaseErrorCode.INTERNAL_ERROR,
        `Failed to list tasks for project: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });
}
