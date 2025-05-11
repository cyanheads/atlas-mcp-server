import {
  KnowledgeService,
  ProjectService,
  TaskService
} from '../../../services/neo4j/index.js';
import { BaseErrorCode, McpError } from '../../../types/errors.js';
import { logger } from '../../../utils/internal/logger.js';
import { Project, ProjectListRequest, ProjectListResponse, Knowledge, Task } from './types.js'; // Import Knowledge and Task

/**
 * Retrieve and filter project entities based on specified criteria
 * Provides two query modes: detailed entity retrieval or paginated collection listing
 * 
 * @param request The project query parameters including filters and pagination controls
 * @returns Promise resolving to structured project entities with optional related resources
 */
export async function listProjects(request: ProjectListRequest): Promise<ProjectListResponse> {
  try {
    const {
      mode = 'all',
      id,
      page = 1,
      limit = 20,
      includeKnowledge = false,
      includeTasks = false,
      taskType,
      status
    } = request;

    // Parameter validation
    if (mode === 'details' && !id) {
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        'Project identifier is required when using mode="details"'
      );
    }

    // Sanitize pagination parameters
    const validatedPage = Math.max(1, page);
    const validatedLimit = Math.min(Math.max(1, limit), 100);
    
    let projects: Project[] = [];
    let total = 0;
    let totalPages = 0;

    if (mode === 'details') {
      // Retrieve specific project entity by identifier
      const projectResult = await ProjectService.getProjectById(id!);
      
      if (!projectResult) {
        throw new McpError(
          BaseErrorCode.NOT_FOUND,
          `Project with identifier ${id} not found`
        );
      }

      // Cast to the tool's Project type
      projects = [projectResult as Project]; 
      total = 1;
      totalPages = 1;
    } else {
      // Get paginated list of projects with filters
      const projectsResult = await ProjectService.getProjects({
        status,
        taskType,
        page: validatedPage,
        limit: validatedLimit
      });

      // Cast each project to the tool's Project type
      projects = projectsResult.data.map(p => p as Project); 
      total = projectsResult.total;
      totalPages = projectsResult.totalPages;
    }

    // Process knowledge resource associations if requested
    if (includeKnowledge && projects.length > 0) {
      for (const project of projects) {
        if (mode === 'details') {
          // For detailed view, retrieve comprehensive knowledge resources
          const knowledgeResult = await KnowledgeService.getKnowledge({
            projectId: project.id, // Access directly
            page: 1,
            limit: 100 // Reasonable threshold for associated resources
          });

          // Add debug logging
          logger.info('Knowledge items retrieved', { 
            projectId: project.id, // Access directly
            count: knowledgeResult.data.length,
            firstItem: knowledgeResult.data[0] ? JSON.stringify(knowledgeResult.data[0]) : 'none'
          });

          // Map directly, assuming KnowledgeService returns Neo4jKnowledge objects
          project.knowledge = knowledgeResult.data.map(item => {
            // More explicit mapping with debug info
            logger.debug('Processing knowledge item', { 
              id: item.id,
              domain: item.domain,
              textLength: item.text ? item.text.length : 0
            });
            
            // Cast to the tool's Knowledge type
            return item as Knowledge; 
          });
        } else {
          // For list mode, get abbreviated knowledge items
          const knowledgeResult = await KnowledgeService.getKnowledge({
            projectId: project.id, // Access directly
            page: 1,
            limit: 5 // Just a few for summary view
          });

          // Map directly, assuming KnowledgeService returns Neo4jKnowledge objects
          project.knowledge = knowledgeResult.data.map(item => {
            // Cast to the tool's Knowledge type, potentially truncating text
            const knowledgeItem = item as Knowledge;
            return {
              ...knowledgeItem,
              // Show a preview of the text - increased to 200 characters
              text: item.text && item.text.length > 200 ? 
                    item.text.substring(0, 200) + '... (truncated)' : 
                    item.text,
            };
          });
        }
      }
    }

    // Process task entity associations if requested
    if (includeTasks && projects.length > 0) {
      for (const project of projects) {
        if (mode === 'details') {
          // For detailed view, retrieve prioritized task entities
          const tasksResult = await TaskService.getTasks({
            projectId: project.id, // Access directly
            page: 1,
            limit: 100, // Reasonable threshold for associated entities
            sortBy: 'priority',
            sortDirection: 'desc'
          });

          // Add debug logging
          logger.info('Tasks retrieved for project', { 
            projectId: project.id, // Access directly
            count: tasksResult.data.length,
            firstItem: tasksResult.data[0] ? JSON.stringify(tasksResult.data[0]) : 'none'
          });

          // Map directly, assuming TaskService returns Neo4jTask objects
          project.tasks = tasksResult.data.map(item => {
            // Debug info
            logger.debug('Processing task item', { 
              id: item.id,
              title: item.title,
              status: item.status,
              priority: item.priority
            });

            // Cast to the tool's Task type
            return item as Task; 
          });
        } else {
          // For list mode, get abbreviated task items
          const tasksResult = await TaskService.getTasks({
            projectId: project.id, // Access directly
            page: 1,
            limit: 5, // Just a few for summary view
            sortBy: 'priority',
            sortDirection: 'desc'
          });
          
          // Map directly, assuming TaskService returns Neo4jTask objects
          project.tasks = tasksResult.data.map(item => {
            // Cast to the tool's Task type
            return item as Task; 
          });
        }
      }
    }

    // Construct the response
    const response: ProjectListResponse = {
      projects,
      total,
      page: validatedPage,
      limit: validatedLimit,
      totalPages
    };

    logger.info('Project query executed successfully', {
      mode,
      count: projects.length,
      total,
      includeKnowledge,
      includeTasks
    });

    return response;
  } catch (error) {
    logger.error('Project query execution failed', { error });
    
    if (error instanceof McpError) {
      throw error;
    }
    
    throw new McpError(
      BaseErrorCode.INTERNAL_ERROR,
      `Failed to retrieve project entities: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
