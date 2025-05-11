import { BaseErrorCode, McpError } from "../../../types/errors.js";
import { ResponseFormat, createToolResponse } from "../../../types/mcp.js";
import { logger } from "../../../utils/internal/logger.js";
import { ToolContext } from "../../../types/tool.js";
import { formatDatabaseCleanResponse } from "./responseFormat.js";
import { AtlasDatabaseCleanInput, AtlasDatabaseCleanSchema } from "./types.js";
import { neo4jDriver } from "../../../services/neo4j/driver.js";

/**
 * Execute a complete database reset operation
 * This permanently removes all data from the Neo4j database
 * 
 * @param input No input parameters required
 * @param context Tool execution context
 * @returns Formatted response with operation results
 */
export const atlasDatabaseClean = async (
  input: unknown,
  context: ToolContext
) => {
  try {
    // Parse and validate input against schema (should be empty object)
    const validatedInput: AtlasDatabaseCleanInput = AtlasDatabaseCleanSchema.parse(input);
    
    // Log the operation start
    logger.warning("Executing complete database reset operation", {
      requestId: context.requestContext?.requestId
    });
    
    // Track execution metrics
    const startTime = Date.now();

    try {
      // Execute a very simple query that will delete all relationships and nodes
      await neo4jDriver.executeQuery("MATCH (n) DETACH DELETE n");
      
      // Calculate execution duration
      const executionTime = Date.now() - startTime;
      
      // Log successful operation
      logger.warning("Database reset completed successfully", {
        requestId: context.requestContext?.requestId,
        executionTime: `${executionTime}ms`,
      });

      const result = {
        success: true,
        message: "Database has been completely reset - all nodes and relationships removed",
        timestamp: new Date().toISOString(),
      };

      // Conditionally format response
      if (validatedInput.responseFormat === ResponseFormat.JSON) {
        return createToolResponse(JSON.stringify(result, null, 2));
      } else {
        return formatDatabaseCleanResponse(result);
      }
    } catch (error) {
      throw new Error(`Failed to execute database reset: ${error instanceof Error ? error.message : String(error)}`);
    }
  } catch (error) {
    // Log error
    logger.error("Failed to reset database", {
      error,
      requestId: context.requestContext?.requestId
    });
    
    // Handle specific error cases
    if (error instanceof McpError) {
      throw error;
    }
    
    // Convert generic errors to McpError
    throw new McpError(
      BaseErrorCode.INTERNAL_ERROR,
      `Error resetting database: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
