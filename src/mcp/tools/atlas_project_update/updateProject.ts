import { ProjectService } from "../../../services/neo4j/projectService.js";
import { BaseErrorCode, McpError, ProjectErrorCode } from "../../../types/errors.js";
import { ResponseFormat, createToolResponse } from "../../../types/mcp.js";
import { logger } from "../../../utils/internal/logger.js";
import { ToolContext } from "../../../types/tool.js";
import { AtlasProjectUpdateInput, AtlasProjectUpdateSchema } from "./types.js";
import { formatProjectUpdateResponse } from "./responseFormat.js";

export const atlasUpdateProject = async (
  input: unknown,
  context: ToolContext
) => {
  let validatedInput: AtlasProjectUpdateInput | undefined;
  
  try {
    // Parse and validate the input against schema
    validatedInput = AtlasProjectUpdateSchema.parse(input);
    
    // Process according to operation mode (single or bulk)
    if (validatedInput.mode === 'bulk') {
      // Execute bulk update operation
      logger.info("Applying updates to multiple projects", { 
        count: validatedInput.projects.length,
        requestId: context.requestContext?.requestId 
      });

      const results = {
        success: true,
        message: `Successfully updated ${validatedInput.projects.length} projects`,
        updated: [] as any[],
        errors: [] as any[]
      };

      // Process each project update sequentially to maintain data consistency
      for (let i = 0; i < validatedInput.projects.length; i++) {
        const projectUpdate = validatedInput.projects[i];
        try {
          // First check if project exists
          const projectExists = await ProjectService.getProjectById(projectUpdate.id);
          
          if (!projectExists) {
            throw new McpError(
              ProjectErrorCode.PROJECT_NOT_FOUND,
              `Project with ID ${projectUpdate.id} not found`
            );
          }
          
          // Update the project
          const updatedProject = await ProjectService.updateProject(
            projectUpdate.id,
            projectUpdate.updates
          );
          
          results.updated.push(updatedProject);
        } catch (error) {
          results.success = false;
          results.errors.push({
            index: i,
            project: projectUpdate,
            error: {
              code: error instanceof McpError ? error.code : BaseErrorCode.INTERNAL_ERROR,
              message: error instanceof Error ? error.message : 'Unknown error',
              details: error instanceof McpError ? error.details : undefined
            }
          });
        }
      }
      
      if (results.errors.length > 0) {
        results.message = `Updated ${results.updated.length} of ${validatedInput.projects.length} projects with ${results.errors.length} errors`;
      }
      
      logger.info("Bulk project modification completed", { 
        successCount: results.updated.length,
        errorCount: results.errors.length,
        projectIds: results.updated.map(p => p.id),
        requestId: context.requestContext?.requestId 
      });

      // Conditionally format response
      if (validatedInput.responseFormat === ResponseFormat.JSON) {
        return createToolResponse(JSON.stringify(results, null, 2));
      } else {
        return formatProjectUpdateResponse(results);
      }
    } else {
      // Process single project modification
      const { mode, id, updates } = validatedInput;
      
      logger.info("Modifying project attributes", { 
        id, 
        fields: Object.keys(updates),
        requestId: context.requestContext?.requestId 
      });

      // First check if project exists
      const projectExists = await ProjectService.getProjectById(id);
      
      if (!projectExists) {
        throw new McpError(
          ProjectErrorCode.PROJECT_NOT_FOUND,
          `Project with ID ${id} not found`
        );
      }
      
      // Update the project
      const updatedProject = await ProjectService.updateProject(id, updates);
      
      logger.info("Project modifications applied successfully", { 
        projectId: id,
        requestId: context.requestContext?.requestId 
      });

      // Conditionally format response
      if (validatedInput.responseFormat === ResponseFormat.JSON) {
        return createToolResponse(JSON.stringify(updatedProject, null, 2));
      } else {
        return formatProjectUpdateResponse(updatedProject);
      }
    }
  } catch (error) {
    // Handle specific error cases
    if (error instanceof McpError) {
      throw error;
    }

    logger.error("Failed to modify project(s)", { 
      error,
      requestId: context.requestContext?.requestId 
    });

    // Handle not found error specifically
    if (error instanceof Error && error.message.includes('not found')) {
      throw new McpError(
        ProjectErrorCode.PROJECT_NOT_FOUND,
        `Project not found: ${error.message}`
      );
    }

    // Convert generic errors to properly formatted McpError
    throw new McpError(
      BaseErrorCode.INTERNAL_ERROR,
      `Failed to modify project(s): ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};
