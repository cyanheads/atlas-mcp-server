import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { KnowledgeService } from "../../../services/neo4j/knowledgeService.js";
import { ProjectService } from "../../../services/neo4j/projectService.js";
import { KnowledgeFilterOptions } from "../../../services/neo4j/types.js";
import { toKnowledgeResource, ResourceTemplates, ResourceURIs } from "../types.js";
import { logger } from "../../../utils/internal/logger.js";
import { BaseErrorCode, McpError, ProjectErrorCode } from "../../../types/errors.js";

/**
 * Register Knowledge Resources
 * 
 * This function registers resource endpoints for the Knowledge entity
 * - GET atlas://knowledge - List all knowledge items
 * - GET atlas://knowledge/{knowledgeId} - Get specific knowledge item by ID
 * - GET atlas://projects/{projectId}/knowledge - List knowledge items for a specific project
 * 
 * @param server The MCP server instance
 */
export function registerKnowledgeResources(server: McpServer) {
  // List all knowledge
  server.resource(
    "knowledge-list", 
    ResourceURIs.KNOWLEDGE, 
    {
      name: "All Knowledge",
      description: "List of all knowledge items in the Atlas platform with pagination and filtering support",
      mimeType: "application/json"
    },
    async (uri) => {
    try {
      logger.info("Listing all knowledge items", { uri: uri.href });

      // Parse query parameters
      const queryParams = new URLSearchParams(uri.search);
      // Default project ID required by knowledge service
      const projectId = queryParams.get("projectId") || "*";
      
      const filters: KnowledgeFilterOptions = {
        projectId
      };

      // Parse domain parameter
      const domain = queryParams.get("domain");
      if (domain) {
        filters.domain = String(domain);
      }

      // Parse tags parameter
      const tags = queryParams.get("tags");
      if (tags) {
        // Split comma-separated tags
        filters.tags = String(tags).split(',').map(tag => tag.trim());
      }

      // Parse search parameter
      const search = queryParams.get("search");
      if (search) {
        filters.search = String(search);
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
      const result = await KnowledgeService.getKnowledge(filters);
      
      // Map Neo4j knowledge items to resource objects
      const knowledgeResources = result.data.map(item => toKnowledgeResource(item));

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({
              knowledge: knowledgeResources,
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
      logger.error("Error listing knowledge items", { 
        error,
        uri: uri.href
      });

      throw new McpError(
        BaseErrorCode.INTERNAL_ERROR,
        `Failed to list knowledge items: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  // Get knowledge by ID
  server.resource(
    "knowledge-by-id", 
    ResourceTemplates.KNOWLEDGE, 
    {
      name: "Knowledge by ID",
      description: "Retrieves a single knowledge item by its unique identifier",
      mimeType: "application/json"
    },
    async (uri, params) => {
    try {
      const knowledgeId = params.knowledgeId as string;
      
      logger.info("Fetching knowledge by ID", { 
        knowledgeId,
        uri: uri.href
      });

      if (!knowledgeId) {
        throw new McpError(
          BaseErrorCode.VALIDATION_ERROR,
          "Knowledge ID is required"
        );
      }

      // Query the database
      const knowledge = await KnowledgeService.getKnowledgeById(knowledgeId);

      if (!knowledge) {
        throw new McpError(
          BaseErrorCode.NOT_FOUND,
          `Knowledge item with ID ${knowledgeId} not found`,
          { knowledgeId }
        );
      }

      // Convert to resource object
      const knowledgeResource = toKnowledgeResource(knowledge);

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(knowledgeResource, null, 2)
          }
        ]
      };
    } catch (error) {
      // Handle specific error cases
      if (error instanceof McpError) {
        throw error;
      }

      logger.error("Error fetching knowledge by ID", { 
        error,
        params
      });

      throw new McpError(
        BaseErrorCode.INTERNAL_ERROR,
        `Failed to fetch knowledge: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  // List knowledge by project
  server.resource(
    "knowledge-by-project", 
    ResourceTemplates.KNOWLEDGE_BY_PROJECT, 
    {
      name: "Knowledge by Project",
      description: "Retrieves all knowledge items belonging to a specific project",
      mimeType: "application/json"
    },
    async (uri, params) => {
    try {
      const projectId = params.projectId as string;
      
      logger.info("Listing knowledge for project", { 
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
      const filters: KnowledgeFilterOptions = {
        projectId
      };

      // Parse domain parameter
      const domain = queryParams.get("domain");
      if (domain) {
        filters.domain = String(domain);
      }

      // Parse tags parameter
      const tags = queryParams.get("tags");
      if (tags) {
        // Split comma-separated tags
        filters.tags = String(tags).split(',').map(tag => tag.trim());
      }

      // Parse search parameter
      const search = queryParams.get("search");
      if (search) {
        filters.search = String(search);
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
      const result = await KnowledgeService.getKnowledge(filters);
      
      // Map Neo4j knowledge items to resource objects
      const knowledgeResources = result.data.map(item => toKnowledgeResource(item));

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({
              projectId,
              projectName: project.name,
              knowledge: knowledgeResources,
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

      logger.error("Error listing knowledge for project", { 
        error,
        params
      });

      throw new McpError(
        BaseErrorCode.INTERNAL_ERROR,
        `Failed to list knowledge for project: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });
}
