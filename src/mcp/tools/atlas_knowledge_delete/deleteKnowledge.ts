import { KnowledgeService } from "../../../services/neo4j/knowledgeService.js";
import { BaseErrorCode, McpError } from "../../../types/errors.js";
import { ResponseFormat, createToolResponse } from "../../../types/mcp.js";
import { logger } from "../../../utils/internal/logger.js";
import { ToolContext } from "../../../types/tool.js";
import { AtlasKnowledgeDeleteInput, AtlasKnowledgeDeleteSchema } from "./types.js";
import { formatKnowledgeDeleteResponse } from "./responseFormat.js";

export const atlasDeleteKnowledge = async (
  input: unknown,
  context: ToolContext
) => {
  let validatedInput: AtlasKnowledgeDeleteInput | undefined;
  
  try {
    // Parse and validate input against schema definition
    validatedInput = AtlasKnowledgeDeleteSchema.parse(input);
    
    // Select operation strategy based on request mode
    if (validatedInput.mode === 'bulk') {
      // Process bulk removal operation
      const { knowledgeIds } = validatedInput;
      
      logger.info("Initiating batch knowledge item removal", { 
        count: knowledgeIds.length,
        knowledgeIds,
        requestId: context.requestContext?.requestId 
      });

      const results = {
        success: true,
        message: `Successfully removed ${knowledgeIds.length} knowledge items`,
        deleted: [] as string[],
        errors: [] as { 
          knowledgeId: string;
          error: {
            code: string;
            message: string;
            details?: any;
          };
        }[]
      };

      // Process removal operations sequentially to maintain data integrity
      for (const knowledgeId of knowledgeIds) {
        try {
          const deleted = await KnowledgeService.deleteKnowledge(knowledgeId);
          
          if (deleted) {
            results.deleted.push(knowledgeId);
          } else {
            // Knowledge item not found
            results.success = false;
            results.errors.push({
              knowledgeId,
              error: {
                code: BaseErrorCode.NOT_FOUND,
                message: `Knowledge item with ID ${knowledgeId} not found`
              }
            });
          }
        } catch (error) {
          results.success = false;
          results.errors.push({
            knowledgeId,
            error: {
              code: error instanceof McpError ? error.code : BaseErrorCode.INTERNAL_ERROR,
              message: error instanceof Error ? error.message : 'Unknown error',
              details: error instanceof McpError ? error.details : undefined
            }
          });
        }
      }
      
      if (results.errors.length > 0) {
        results.message = `Removed ${results.deleted.length} of ${knowledgeIds.length} knowledge items with ${results.errors.length} errors`;
      }
      
      logger.info("Batch knowledge removal operation completed", { 
        successCount: results.deleted.length,
        errorCount: results.errors.length,
        requestId: context.requestContext?.requestId 
      });

      // Conditionally format response
      if (validatedInput.responseFormat === ResponseFormat.JSON) {
        return createToolResponse(JSON.stringify(results, null, 2));
      } else {
        return formatKnowledgeDeleteResponse(results);
      }
    } else {
      // Process single entity removal
      const { id } = validatedInput;
      
      logger.info("Removing knowledge item", { 
        knowledgeId: id,
        requestId: context.requestContext?.requestId 
      });

      const deleted = await KnowledgeService.deleteKnowledge(id);
      
      if (!deleted) {
        logger.warning("Target knowledge item not found for removal operation", { 
          knowledgeId: id,
          requestId: context.requestContext?.requestId 
        });
        
        throw new McpError(
          BaseErrorCode.NOT_FOUND,
          `Knowledge item with identifier ${id} not found`,
          { knowledgeId: id }
        );
      }
      
      logger.info("Knowledge item successfully removed", { 
        knowledgeId: id,
        requestId: context.requestContext?.requestId 
      });

      const result = {
        id,
        success: true,
        message: `Knowledge item with ID ${id} removed successfully`,
      };

      // Conditionally format response
      if (validatedInput.responseFormat === ResponseFormat.JSON) {
        return createToolResponse(JSON.stringify(result, null, 2));
      } else {
        return formatKnowledgeDeleteResponse(result);
      }
    }
  } catch (error) {
    // Handle specific error cases
    if (error instanceof McpError) {
      throw error;
    }

    logger.error("Knowledge item removal operation failed", { 
      error,
      requestId: context.requestContext?.requestId 
    });

    // Translate unknown errors to structured McpError format
    throw new McpError(
      BaseErrorCode.INTERNAL_ERROR,
      `Failed to remove knowledge item(s): ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};
