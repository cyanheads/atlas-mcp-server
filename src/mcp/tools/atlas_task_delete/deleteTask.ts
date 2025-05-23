import { TaskService } from "../../../services/neo4j/taskService.js";
import { BaseErrorCode, McpError } from "../../../types/errors.js";
import { ResponseFormat, createToolResponse } from "../../../types/mcp.js";
import { logger, requestContextService } from "../../../utils/index.js"; // Import requestContextService
import { ToolContext } from "../../../types/tool.js";
import { AtlasTaskDeleteInput, AtlasTaskDeleteSchema } from "./types.js";
import { formatTaskDeleteResponse } from "./responseFormat.js";

export const atlasDeleteTask = async (input: unknown, context: ToolContext) => {
  let validatedInput: AtlasTaskDeleteInput | undefined;
  const reqContext =
    context.requestContext ??
    requestContextService.createRequestContext({ toolName: "atlasDeleteTask" });

  try {
    // Parse and validate input against schema definition
    validatedInput = AtlasTaskDeleteSchema.parse(input);

    // Select operation strategy based on request mode
    if (validatedInput.mode === "bulk") {
      // Process bulk removal operation
      const { taskIds } = validatedInput;

      logger.info("Initiating batch task removal", {
        ...reqContext,
        count: taskIds.length,
        taskIds,
      });

      const results = {
        success: true,
        message: `Successfully removed ${taskIds.length} tasks`,
        deleted: [] as string[],
        errors: [] as {
          taskId: string;
          error: {
            code: string;
            message: string;
            details?: any;
          };
        }[],
      };

      // Process removal operations sequentially to maintain data integrity
      for (const taskId of taskIds) {
        try {
          const deleted = await TaskService.deleteTask(taskId);

          if (deleted) {
            results.deleted.push(taskId);
          } else {
            // Task not found
            results.success = false;
            results.errors.push({
              taskId,
              error: {
                code: BaseErrorCode.NOT_FOUND,
                message: `Task with ID ${taskId} not found`,
              },
            });
          }
        } catch (error) {
          results.success = false;
          results.errors.push({
            taskId,
            error: {
              code:
                error instanceof McpError
                  ? error.code
                  : BaseErrorCode.INTERNAL_ERROR,
              message: error instanceof Error ? error.message : "Unknown error",
              details: error instanceof McpError ? error.details : undefined,
            },
          });
        }
      }

      if (results.errors.length > 0) {
        results.message = `Removed ${results.deleted.length} of ${taskIds.length} tasks with ${results.errors.length} errors`;
      }

      logger.info("Batch task removal operation completed", {
        ...reqContext,
        successCount: results.deleted.length,
        errorCount: results.errors.length,
      });

      // Conditionally format response
      if (validatedInput.responseFormat === ResponseFormat.JSON) {
        return createToolResponse(JSON.stringify(results, null, 2));
      } else {
        return formatTaskDeleteResponse(results);
      }
    } else {
      // Process single entity removal
      const { id } = validatedInput;

      logger.info("Removing task entity", {
        ...reqContext,
        taskId: id,
      });

      const deleted = await TaskService.deleteTask(id);

      if (!deleted) {
        logger.warning("Target task not found for removal operation", {
          ...reqContext,
          taskId: id,
        });

        throw new McpError(
          BaseErrorCode.NOT_FOUND,
          `Task with identifier ${id} not found`,
          { taskId: id },
        );
      }

      logger.info("Task successfully removed", {
        ...reqContext,
        taskId: id,
      });

      const result = {
        id,
        success: true,
        message: `Task with ID ${id} removed successfully`,
      };

      // Conditionally format response
      if (validatedInput.responseFormat === ResponseFormat.JSON) {
        return createToolResponse(JSON.stringify(result, null, 2));
      } else {
        return formatTaskDeleteResponse(result);
      }
    }
  } catch (error) {
    // Handle specific error cases
    if (error instanceof McpError) {
      throw error;
    }

    logger.error("Task removal operation failed", error as Error, {
      ...reqContext,
      inputReceived: validatedInput ?? input,
    });

    // Translate unknown errors to structured McpError format
    throw new McpError(
      BaseErrorCode.INTERNAL_ERROR,
      `Failed to remove task(s): ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
};
