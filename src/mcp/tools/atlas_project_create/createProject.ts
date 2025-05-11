import { ProjectService } from '../../../services/neo4j/projectService.js';
import { ProjectDependencyType } from '../../../services/neo4j/types.js'; // Import the enum
import { BaseErrorCode, McpError, ProjectErrorCode } from "../../../types/errors.js";
import { ResponseFormat, createToolResponse } from "../../../types/mcp.js";
import { logger } from "../../../utils/internal/logger.js";
import { ToolContext } from "../../../types/tool.js";
import { AtlasProjectCreateInput, AtlasProjectCreateSchema } from "./types.js";
import { formatProjectCreateResponse } from "./responseFormat.js";

export const atlasCreateProject = async (
  input: unknown,
  context: ToolContext
) => {
  let validatedInput: AtlasProjectCreateInput | undefined;
  
  try {
    // Parse and validate input against schema
    validatedInput = AtlasProjectCreateSchema.parse(input);
    
    // Handle single vs bulk project creation based on mode
    if (validatedInput.mode === 'bulk') {
      // Execute bulk creation operation
      logger.info("Initializing multiple projects", { 
        count: validatedInput.projects.length,
        requestId: context.requestContext?.requestId 
      });

      const results = {
        success: true,
        message: `Successfully created ${validatedInput.projects.length} projects`,
        created: [] as any[],
        errors: [] as any[]
      };

      // Process each project sequentially to maintain consistency
      for (let i = 0; i < validatedInput.projects.length; i++) {
        const projectData = validatedInput.projects[i];
        try {
          const createdProject = await ProjectService.createProject({
            name: projectData.name,
            description: projectData.description,
            status: projectData.status || 'active',
            urls: projectData.urls || [],
            completionRequirements: projectData.completionRequirements,
            outputFormat: projectData.outputFormat,
            taskType: projectData.taskType,
            id: projectData.id // Use client-provided ID if available
          });
          
          results.created.push(createdProject);
          
          // Create dependency relationships if specified
          if (projectData.dependencies && projectData.dependencies.length > 0) {
            for (const dependencyId of projectData.dependencies) {
              try {
                await ProjectService.addProjectDependency(
                  createdProject.id,
                  dependencyId,
                  ProjectDependencyType.REQUIRES, // Use enum member
                  'Dependency created during project creation'
                );
              } catch (error) {
                logger.warning(`Failed to create dependency for project ${createdProject.id} to ${dependencyId}`, {
                  error,
                  projectId: createdProject.id,
                  dependencyId
                });
              }
            }
          }
        } catch (error) {
          results.success = false;
          results.errors.push({
            index: i,
            project: projectData,
            error: {
              code: error instanceof McpError ? error.code : BaseErrorCode.INTERNAL_ERROR,
              message: error instanceof Error ? error.message : 'Unknown error',
              details: error instanceof McpError ? error.details : undefined
            }
          });
        }
      }
      
      if (results.errors.length > 0) {
        results.message = `Created ${results.created.length} of ${validatedInput.projects.length} projects with ${results.errors.length} errors`;
      }
      
      logger.info("Bulk project initialization completed", { 
        successCount: results.created.length,
        errorCount: results.errors.length,
        projectIds: results.created.map(p => p.id),
        requestId: context.requestContext?.requestId 
      });

      // Conditionally format response
      if (validatedInput.responseFormat === ResponseFormat.JSON) {
        return createToolResponse(JSON.stringify(results, null, 2));
      } else {
        return formatProjectCreateResponse(results);
      }
    } else {
      // Process single project creation
      const { mode, id, name, description, status, urls, completionRequirements, dependencies, outputFormat, taskType } = validatedInput;
      
      logger.info("Initializing new project", { 
        name, 
        status,
        requestId: context.requestContext?.requestId 
      });

      const project = await ProjectService.createProject({
        id, // Use client-provided ID if available
        name,
        description,
        status: status || 'active',
        urls: urls || [],
        completionRequirements,
        outputFormat,
        taskType
      });
      
      // Create dependency relationships if specified
      if (dependencies && dependencies.length > 0) {
        for (const dependencyId of dependencies) {
          try {
            await ProjectService.addProjectDependency(
              project.id,
              dependencyId,
              ProjectDependencyType.REQUIRES, // Use enum member
              'Dependency created during project creation'
            );
          } catch (error) {
            logger.warning(`Failed to create dependency for project ${project.id} to ${dependencyId}`, {
              error,
              projectId: project.id,
              dependencyId
            });
          }
        }
      }
      
      logger.info("Project initialized successfully", { 
        projectId: project.id,
        requestId: context.requestContext?.requestId
      });

      // Conditionally format response
      if (validatedInput.responseFormat === ResponseFormat.JSON) {
        return createToolResponse(JSON.stringify(project, null, 2));
      } else {
        return formatProjectCreateResponse(project);
      }
    }
  } catch (error) {
    // Handle specific error cases
    if (error instanceof McpError) {
      throw error;
    }

    logger.error("Failed to initialize project(s)", { 
      error,
      requestId: context.requestContext?.requestId 
    });

    // Handle duplicate name error specifically
    if (error instanceof Error && error.message.includes('duplicate')) {
      throw new McpError(
        ProjectErrorCode.DUPLICATE_NAME,
        `A project with this name already exists`,
        { name: validatedInput?.mode === 'single' ? validatedInput?.name : validatedInput?.projects?.[0]?.name }
      );
    }

    // Convert other errors to McpError
    throw new McpError(
      BaseErrorCode.INTERNAL_ERROR,
      `Error creating project(s): ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};
