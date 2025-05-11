import { McpError } from '../../../types/errors.js';
import { BaseErrorCode } from '../../../types/errors.js';
import { logger } from '../../../utils/internal/logger.js';
import { 
  KnowledgeService,
  ProjectService
} from '../../../services/neo4j/index.js';
import { KnowledgeItem, KnowledgeListRequest, KnowledgeListResponse } from './types.js';

/**
 * Retrieve and filter knowledge items based on specified criteria
 * 
 * @param request The knowledge query parameters including filters and pagination controls
 * @returns Promise resolving to structured knowledge items
 */
export async function listKnowledge(request: KnowledgeListRequest): Promise<KnowledgeListResponse> {
  try {
    const {
      projectId,
      tags,
      domain,
      search,
      page = 1,
      limit = 20
    } = request;

    // Parameter validation
    if (!projectId) {
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        'Project ID is required to list knowledge items'
      );
    }

    // Verify that the project exists
    const project = await ProjectService.getProjectById(projectId);
    if (!project) {
      throw new McpError(
        BaseErrorCode.NOT_FOUND,
        `Project with ID ${projectId} not found`
      );
    }

    // Sanitize pagination parameters
    const validatedPage = Math.max(1, page);
    const validatedLimit = Math.min(Math.max(1, limit), 100);
    
    // Get knowledge items with filters
    const knowledgeResult = await KnowledgeService.getKnowledge({
      projectId,
      tags,
      domain,
      search,
      page: validatedPage,
      limit: validatedLimit
    });

    // Process knowledge items to ensure consistent structure
    const knowledgeItems: KnowledgeItem[] = knowledgeResult.data.map(item => {
      // Handle Neo4j record structure which may include properties field
      const rawItem = item as any;
      const properties = rawItem.properties || rawItem;
      
      return {
        id: properties.id,
        projectId: properties.projectId,
        text: properties.text,
        tags: properties.tags || [],
        domain: properties.domain,
        citations: properties.citations || [],
        createdAt: properties.createdAt,
        updatedAt: properties.updatedAt,
        projectName: project.name // Include project name for context
      };
    });

    // Construct the response
    const response: KnowledgeListResponse = {
      knowledge: knowledgeItems,
      total: knowledgeResult.total,
      page: validatedPage,
      limit: validatedLimit,
      totalPages: knowledgeResult.totalPages
    };

    logger.info('Knowledge query executed successfully', {
      projectId,
      count: knowledgeItems.length,
      total: knowledgeResult.total,
      hasTags: !!tags,
      hasDomain: !!domain,
      hasSearch: !!search
    });

    return response;
  } catch (error) {
    logger.error('Knowledge query execution failed', { error });
    
    if (error instanceof McpError) {
      throw error;
    }
    
    throw new McpError(
      BaseErrorCode.INTERNAL_ERROR,
      `Failed to retrieve knowledge items: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
