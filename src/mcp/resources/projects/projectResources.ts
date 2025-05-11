import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ProjectService } from "../../../services/neo4j/projectService.js";
import { BaseErrorCode, McpError, ProjectErrorCode } from "../../../types/errors.js";
import { logger } from "../../../utils/internal/logger.js";
import { ResourceTemplates, ResourceURIs, toProjectResource } from "../types.js";

/**
 * Register Project Resources
 * 
 * This function registers resource endpoints for the Projects entity
 * - GET atlas://projects - List all projects
 * - GET atlas://projects/{projectId} - Get specific project by ID
 * 
 * @param server The MCP server instance
 */
export function registerProjectResources(server: McpServer) {
  // List all projects
  server.resource(
    "projects-list", 
    ResourceURIs.PROJECTS, 
    {
      name: "All Projects",
      description: "List of all projects in the Atlas platform with pagination support",
      mimeType: "application/json"
    },
    async (uri) => {
    try {
      logger.info("Listing projects", { uri: uri.href });

      // Parse query parameters
      const queryParams = new URLSearchParams(uri.search);
      const filters: Record<string, any> = {};

      // Parse status parameter
      const status = queryParams.get("status");
      if (status) {
        filters.status = String(status);
      }

      // Parse taskType parameter
      const taskType = queryParams.get("taskType");
      if (taskType) {
        filters.taskType = String(taskType);
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

      // Use ProjectService instead of direct database access
      const result = await ProjectService.getProjects(filters);
      
      // Convert Neo4j projects to project resources
      const projectResources = result.data.map(toProjectResource);
      
      // Create pagination metadata using result from service
      const pagination = {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages
      };
      
      logger.info(`Found ${result.total} projects, returning page ${result.page} with ${projectResources.length} items`);
      
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({
              projects: projectResources,
              pagination
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      logger.error("Error listing projects", { 
        error,
        uri: uri.href
      });

      throw new McpError(
        BaseErrorCode.INTERNAL_ERROR,
        `Failed to list projects: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  // Get project by ID
  server.resource(
    "project-by-id", 
    ResourceTemplates.PROJECT, 
    {
      name: "Project by ID",
      description: "Retrieves a single project by its unique identifier",
      mimeType: "application/json"
    },
    async (uri, params) => {
    try {
      const projectId = params.projectId as string;
      
      logger.info("Fetching project by ID", { 
        projectId,
        uri: uri.href
      });

      if (!projectId) {
        throw new McpError(
          BaseErrorCode.VALIDATION_ERROR,
          "Project ID is required"
        );
      }

      // Use ProjectService instead of direct database access
      const project = await ProjectService.getProjectById(projectId);
      
      if (!project) {
        throw new McpError(
          ProjectErrorCode.PROJECT_NOT_FOUND,
          `Project with ID ${projectId} not found`,
          { projectId }
        );
      }
      
      // Convert to resource format
      const projectResource = toProjectResource(project);
      
      logger.info("Retrieved project successfully", { 
        projectId: project.id 
      });
      
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(projectResource, null, 2)
          }
        ]
      };
    } catch (error) {
      // Handle specific error cases
      if (error instanceof McpError) {
        throw error;
      }

      logger.error("Error fetching project by ID", { 
        error,
        params
      });

      throw new McpError(
        BaseErrorCode.INTERNAL_ERROR,
        `Failed to fetch project: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });
}
