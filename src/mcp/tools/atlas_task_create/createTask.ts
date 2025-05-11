import { TaskService } from "../../../services/neo4j/taskService.js";
import { ProjectService } from "../../../services/neo4j/projectService.js";
import { BaseErrorCode, McpError, ProjectErrorCode } from "../../../types/errors.js";
import { ResponseFormat, createToolResponse } from "../../../types/mcp.js";
import { logger } from "../../../utils/internal/logger.js";
import { ToolContext } from "../../../types/tool.js";
import { AtlasTaskCreateInput, AtlasTaskCreateSchema } from "./types.js";
import { formatTaskCreateResponse } from "./responseFormat.js";

export const atlasCreateTask = async (
  input: unknown,
  context: ToolContext
) => {
  let validatedInput: AtlasTaskCreateInput | undefined;
  
  try {
    // Parse and validate input against schema
    validatedInput = AtlasTaskCreateSchema.parse(input);
    
    // Handle single vs bulk task creation based on mode
    if (validatedInput.mode === 'bulk') {
      // Execute bulk creation operation
      logger.info("Initializing multiple tasks", { 
        count: validatedInput.tasks.length,
        requestId: context.requestContext?.requestId 
      });

      const results = {
        success: true,
        message: `Successfully created ${validatedInput.tasks.length} tasks`,
        created: [] as any[],
        errors: [] as any[]
      };

      // Process each task sequentially to maintain consistency
      for (let i = 0; i < validatedInput.tasks.length; i++) {
        const taskData = validatedInput.tasks[i];
        try {
          // Verify project exists before creating task
          const projectExists = await ProjectService.getProjectById(taskData.projectId);
          if (!projectExists) {
            throw new McpError(
              ProjectErrorCode.PROJECT_NOT_FOUND,
              `Project with ID ${taskData.projectId} not found`,
              { projectId: taskData.projectId }
            );
          }
          
          const createdTask = await TaskService.createTask({
            projectId: taskData.projectId,
            title: taskData.title,
            description: taskData.description,
            priority: taskData.priority || 'medium',
            status: taskData.status || 'todo',
            assignedTo: taskData.assignedTo,
            urls: taskData.urls || [],
            tags: taskData.tags || [],
            completionRequirements: taskData.completionRequirements,
            outputFormat: taskData.outputFormat,
            taskType: taskData.taskType,
            id: taskData.id // Use client-provided ID if available
          });
          
          results.created.push(createdTask);
          
          // Create dependency relationships if specified
          if (taskData.dependencies && taskData.dependencies.length > 0) {
            for (const dependencyId of taskData.dependencies) {
              try {
                await TaskService.addTaskDependency(
                  createdTask.id,
                  dependencyId
                );
              } catch (error) {
                logger.warning(`Failed to create dependency for task ${createdTask.id} to ${dependencyId}`, {
                  error,
                  taskId: createdTask.id,
                  dependencyId
                });
              }
            }
          }
        } catch (error) {
          results.success = false;
          results.errors.push({
            index: i,
            task: taskData,
            error: {
              code: error instanceof McpError ? error.code : BaseErrorCode.INTERNAL_ERROR,
              message: error instanceof Error ? error.message : 'Unknown error',
              details: error instanceof McpError ? error.details : undefined
            }
          });
        }
      }
      
      if (results.errors.length > 0) {
        results.message = `Created ${results.created.length} of ${validatedInput.tasks.length} tasks with ${results.errors.length} errors`;
      }
      
      logger.info("Bulk task initialization completed", { 
        successCount: results.created.length,
        errorCount: results.errors.length,
        taskIds: results.created.map(t => t.id),
        requestId: context.requestContext?.requestId 
      });

      // Conditionally format response
      if (validatedInput.responseFormat === ResponseFormat.JSON) {
        return createToolResponse(JSON.stringify(results, null, 2));
      } else {
        return formatTaskCreateResponse(results);
      }
    } else {
      // Process single task creation
      const { mode, id, projectId, title, description, priority, status, assignedTo, urls, tags, completionRequirements, dependencies, outputFormat, taskType } = validatedInput;
      
      logger.info("Initializing new task", { 
        title, 
        projectId,
        requestId: context.requestContext?.requestId 
      });

      // Verify project exists
      const projectExists = await ProjectService.getProjectById(projectId);
      if (!projectExists) {
        throw new McpError(
          ProjectErrorCode.PROJECT_NOT_FOUND,
          `Project with ID ${projectId} not found`,
          { projectId }
        );
      }

      const task = await TaskService.createTask({
        id, // Use client-provided ID if available
        projectId,
        title,
        description,
        priority: priority || 'medium',
        status: status || 'todo',
        assignedTo,
        urls: urls || [],
        tags: tags || [],
        completionRequirements,
        outputFormat,
        taskType
      });
      
      // Create dependency relationships if specified
      if (dependencies && dependencies.length > 0) {
        for (const dependencyId of dependencies) {
          try {
            await TaskService.addTaskDependency(
              task.id,
              dependencyId
            );
          } catch (error) {
            logger.warning(`Failed to create dependency for task ${task.id} to ${dependencyId}`, {
              error,
              taskId: task.id,
              dependencyId
            });
          }
        }
      }
      
      logger.info("Task initialized successfully", { 
        taskId: task.id,
        projectId,
        requestId: context.requestContext?.requestId 
      });

      // Conditionally format response
      if (validatedInput.responseFormat === ResponseFormat.JSON) {
        return createToolResponse(JSON.stringify(task, null, 2));
      } else {
        return formatTaskCreateResponse(task);
      }
    }
  } catch (error) {
    // Handle specific error cases
    if (error instanceof McpError) {
      throw error;
    }

    logger.error("Failed to initialize task(s)", { 
      error,
      requestId: context.requestContext?.requestId 
    });

    // Handle duplicate name error specifically
    if (error instanceof Error && error.message.includes('duplicate')) {
      throw new McpError(
        ProjectErrorCode.DUPLICATE_NAME,
        `A task with this title already exists in the project`,
        { 
          title: validatedInput?.mode === 'single' ? validatedInput?.title : validatedInput?.tasks?.[0]?.title,
          projectId: validatedInput?.mode === 'single' ? validatedInput?.projectId : validatedInput?.tasks?.[0]?.projectId
        }
      );
    }

    // Convert other errors to McpError
    throw new McpError(
      BaseErrorCode.INTERNAL_ERROR,
      `Error creating task(s): ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};
