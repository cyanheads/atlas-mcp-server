import { logger } from '../../utils/index.js'; // Updated import path
import { neo4jDriver } from './driver.js';
import { buildListQuery, generateId } from './helpers.js'; // Import buildListQuery
import {
  Neo4jProject,
  NodeLabels,
  PaginatedResult,
  ProjectDependencyType, // Import the new enum
  ProjectFilterOptions,
  RelationshipTypes
} from './types.js';
import { Neo4jUtils } from './utils.js';

/**
 * Service for managing Project entities in Neo4j
 */
export class ProjectService {
  /**
   * Create a new project
   * @param project Project data
   * @returns The created project
   */
  static async createProject(project: Omit<Neo4jProject, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<Neo4jProject> {
    const session = await neo4jDriver.getSession();
    
    try {
      const projectId = project.id || `proj_${generateId()}`;
      const now = Neo4jUtils.getCurrentTimestamp();
      
      // Neo4j properties must be primitive types or arrays of primitives.
      // Serialize the 'urls' array (which contains objects) to a JSON string for storage.
      const query = `
        CREATE (p:${NodeLabels.Project} {
          id: $id,
          name: $name,
          description: $description,
          status: $status,
          urls: $urls,
          completionRequirements: $completionRequirements,
          outputFormat: $outputFormat,
          taskType: $taskType,
          createdAt: $createdAt,
          updatedAt: $updatedAt
        })
        RETURN p.id as id,
               p.name as name,
               p.description as description,
               p.status as status,
               p.urls as urls,
               p.completionRequirements as completionRequirements,
               p.outputFormat as outputFormat,
               p.taskType as taskType,
               p.createdAt as createdAt,
               p.updatedAt as updatedAt
      `;
            
      // Serialize urls to JSON string before passing as parameter
      const params = {
        id: projectId,
        name: project.name,
        description: project.description,
        status: project.status,
        urls: JSON.stringify(project.urls || []), // Serialize to JSON string
        completionRequirements: project.completionRequirements,
        outputFormat: project.outputFormat,
        taskType: project.taskType,
        createdAt: now,
        updatedAt: now
      };
      
      const result = await session.executeWrite(async (tx) => {
        const result = await tx.run(query, params);
        // Use .get() for each field to ensure type safety
        return result.records.length > 0 ? result.records[0] : null; 
      });
            
      if (!result) {
        throw new Error('Failed to create project or retrieve its properties');
      }
      
      // Explicitly construct the object and deserialize urls from JSON string
      const createdProjectData: Neo4jProject = {
        id: result.get('id'),
        name: result.get('name'),
        description: result.get('description'),
        status: result.get('status'),
        urls: JSON.parse(result.get('urls') || '[]'), // Deserialize from JSON string
        completionRequirements: result.get('completionRequirements'),
        outputFormat: result.get('outputFormat'),
        taskType: result.get('taskType'),
        createdAt: result.get('createdAt'),
        updatedAt: result.get('updatedAt')
      };
      
      // Now createdProjectData has the correct type before this line
      logger.info('Project created successfully', { projectId: createdProjectData.id }); 
      return createdProjectData; // No need for 'as Neo4jProject' here anymore
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error creating project', { error: errorMessage, project });
      throw error;
    } finally {
      await session.close();
    }
  }
  
  /**
   * Get a project by ID
   * @param id Project ID
   * @returns The project or null if not found
   */
  static async getProjectById(id: string): Promise<Neo4jProject | null> {
    const session = await neo4jDriver.getSession();
    
    try {
      // Retrieve urls as JSON string and deserialize later
      const query = `
        MATCH (p:${NodeLabels.Project} {id: $id})
        RETURN p.id as id,
               p.name as name,
               p.description as description,
               p.status as status,
               p.urls as urls,
               p.completionRequirements as completionRequirements,
               p.outputFormat as outputFormat,
               p.taskType as taskType,
               p.createdAt as createdAt,
               p.updatedAt as updatedAt
      `;
      
      const result = await session.executeRead(async (tx) => {
        const result = await tx.run(query, { id });
        return result.records;
      });
            
      if (result.length === 0) {
        return null;
      }
      
      const record = result[0];
      // Explicitly construct the object and deserialize urls from JSON string
      const projectData: Neo4jProject = {
        id: record.get('id'),
        name: record.get('name'),
        description: record.get('description'),
        status: record.get('status'),
        urls: JSON.parse(record.get('urls') || '[]'), // Deserialize from JSON string
        completionRequirements: record.get('completionRequirements'),
        outputFormat: record.get('outputFormat'),
        taskType: record.get('taskType'),
        createdAt: record.get('createdAt'),
        updatedAt: record.get('updatedAt')
      };
      
      return projectData;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error getting project by ID', { error: errorMessage, id });
      throw error;
    } finally {
      await session.close();
    }
  }
  
  /**
   * Check if all dependencies of a project are completed
   * @param projectId Project ID to check dependencies for
   * @returns True if all dependencies are completed, false otherwise
   */
  static async areAllDependenciesCompleted(projectId: string): Promise<boolean> {
    const session = await neo4jDriver.getSession();
    
    try {
      // Query remains the same
      const query = `
        MATCH (p:${NodeLabels.Project} {id: $projectId})-[:${RelationshipTypes.DEPENDS_ON}]->(dep:${NodeLabels.Project})
        WHERE dep.status <> 'completed'
        RETURN count(dep) AS incompleteCount
      `;
      
      const result = await session.executeRead(async (tx) => {
        const result = await tx.run(query, { projectId });
        // Use .get() for each field and check existence before calling toNumber()
        const record = result.records[0];
        const countField = record ? record.get('incompleteCount') : null;
        // Neo4j count() usually returns a standard JS number or a Neo4j Integer
        // Handle both cases: if it has toNumber, use it; otherwise, assume it's a number or 0.
        return countField && typeof countField.toNumber === 'function' ? countField.toNumber() : (countField || 0);
      });

      // Check if the count is exactly 0
      return result === 0;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error checking project dependencies completion status', { error: errorMessage, projectId });
      throw error;
    } finally {
      await session.close();
    }
  }
  
  /**
   * Update a project
   * @param id Project ID
   * @param updates Project updates
   * @returns The updated project
   */
  static async updateProject(id: string, updates: Partial<Omit<Neo4jProject, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Neo4jProject> {
    const session = await neo4jDriver.getSession();
    
    try {
      const exists = await Neo4jUtils.nodeExists(NodeLabels.Project, 'id', id);
      if (!exists) {
        throw new Error(`Project with ID ${id} not found`);
      }
      
      if (updates.status === 'in-progress' || updates.status === 'completed') {
        const depsCompleted = await this.areAllDependenciesCompleted(id);
        if (!depsCompleted) {
          throw new Error(`Cannot mark project as ${updates.status} because not all dependencies are completed`);
        }
      }
      
      const updateParams: Record<string, any> = {
        id,
        updatedAt: Neo4jUtils.getCurrentTimestamp()
      };
      let setClauses = ['p.updatedAt = $updatedAt'];
      
      // Serialize urls to JSON string if it's part of the updates
      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) {
          // Serialize urls array to JSON string if it's the key being updated
          updateParams[key] = (key === 'urls') ? JSON.stringify(value || []) : value; 
          setClauses.push(`p.${key} = $${key}`);
        }
      }
      
      // Retrieve urls as JSON string and deserialize later
      const query = `
        MATCH (p:${NodeLabels.Project} {id: $id})
        SET ${setClauses.join(', ')}
        RETURN p.id as id,
               p.name as name,
               p.description as description,
               p.status as status,
               p.urls as urls,
               p.completionRequirements as completionRequirements,
               p.outputFormat as outputFormat,
               p.taskType as taskType,
               p.createdAt as createdAt,
               p.updatedAt as updatedAt
      `;
      
      const result = await session.executeWrite(async (tx) => {
        const result = await tx.run(query, updateParams);
        // Use .get() for each field
        return result.records.length > 0 ? result.records[0] : null; 
      });
            
      if (!result) {
        throw new Error('Failed to update project or retrieve its properties');
      }
      
      // Explicitly construct the object and deserialize urls from JSON string
      const updatedProjectData: Neo4jProject = {
        id: result.get('id'),
        name: result.get('name'),
        description: result.get('description'),
        status: result.get('status'),
        urls: JSON.parse(result.get('urls') || '[]'), // Deserialize from JSON string
        completionRequirements: result.get('completionRequirements'),
        outputFormat: result.get('outputFormat'),
        taskType: result.get('taskType'),
        createdAt: result.get('createdAt'),
        updatedAt: result.get('updatedAt')
      };

      logger.info('Project updated successfully', { projectId: id });
      return updatedProjectData;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error updating project', { error: errorMessage, id, updates });
      throw error;
    } finally {
      await session.close();
    }
  }
  
  /**
   * Delete a project and all its associated tasks and knowledge items
   * @param id Project ID
   * @returns True if deleted, false if not found
   */
  static async deleteProject(id: string): Promise<boolean> {
    const session = await neo4jDriver.getSession();
    
    try {
      const exists = await Neo4jUtils.nodeExists(NodeLabels.Project, 'id', id);
      if (!exists) {
        return false;
      }
      
      // DETACH DELETE remains the same
      const query = `
        MATCH (p:${NodeLabels.Project} {id: $id})
        DETACH DELETE p
      `;
      
      await session.executeWrite(async (tx) => {
        await tx.run(query, { id });
      });
      
      logger.info('Project deleted successfully', { projectId: id });
      return true; 
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error deleting project', { error: errorMessage, id });
      throw error;
    } finally {
      await session.close();
    }
  }
  
  /**
   * Get all projects with optional filtering and pagination
   * @param options Filter and pagination options
   * @returns Paginated list of projects
   */
  static async getProjects(options: ProjectFilterOptions = {}): Promise<PaginatedResult<Neo4jProject>> {
    const session = await neo4jDriver.getSession();
    
    try {
      const nodeAlias = 'p';
      
      // Define the properties to return
      const returnProperties = [
        `${nodeAlias}.id as id`,
        `${nodeAlias}.name as name`,
        `${nodeAlias}.description as description`,
        `${nodeAlias}.status as status`,
        `${nodeAlias}.urls as urls`,
        `${nodeAlias}.completionRequirements as completionRequirements`,
        `${nodeAlias}.outputFormat as outputFormat`,
        `${nodeAlias}.taskType as taskType`,
        `${nodeAlias}.createdAt as createdAt`,
        `${nodeAlias}.updatedAt as updatedAt`
      ];

      // Use buildListQuery helper
      // Note: searchTerm filter is not currently supported by buildListQuery
      if (options.searchTerm) {
        logger.warning('searchTerm filter is not currently supported in getProjects when using buildListQuery helper.');
      }

      const { countQuery, dataQuery, params } = buildListQuery(
        NodeLabels.Project,
        returnProperties,
        { // Filters
          status: options.status,
          taskType: options.taskType
          // searchTerm is omitted here
        },
        { // Pagination
          sortBy: 'createdAt', // Default sort for projects
          sortDirection: 'desc',
          page: options.page,
          limit: options.limit
        },
        nodeAlias // Primary node alias
        // No additional MATCH clauses needed for basic project listing
      );
      
      // Execute count query
      const totalResult = await session.executeRead(async (tx) => { 
        const countParams = { ...params }; 
        delete countParams.skip; 
        delete countParams.limit;
        logger.debug('Executing Project Count Query (using buildListQuery):', { query: countQuery, params: countParams }); 
        const result = await tx.run(countQuery, countParams);
        return result.records[0]?.get('total') ?? 0; 
      });
      const total = totalResult; 
      
      logger.debug('Calculated total projects', { total });
      
      // Execute data query
      const dataResult = await session.executeRead(async (tx) => {
        logger.debug('Executing Project Data Query (using buildListQuery):', { query: dataQuery, params: params });
        const result = await tx.run(dataQuery, params); 
        return result.records;
      });
      
      // Map results - deserialize urls from JSON string
      const projects: Neo4jProject[] = dataResult.map(record => {
         // Explicitly construct the object and deserialize urls
         const projectData: Neo4jProject = {
           id: record.get('id'),
           name: record.get('name'),
           description: record.get('description'),
           status: record.get('status'),
           urls: JSON.parse(record.get('urls') || '[]'), // Deserialize from JSON string
           completionRequirements: record.get('completionRequirements'),
           outputFormat: record.get('outputFormat'),
           taskType: record.get('taskType'),
           createdAt: record.get('createdAt'),
           updatedAt: record.get('updatedAt')
         };
         return projectData;
      });
      
      const page = Math.max(options.page || 1, 1);
      const limit = Math.min(Math.max(options.limit || 20, 1), 100);
      const totalPages = Math.ceil(total / limit);
      
      return {
        data: projects,
        total,
        page,
        limit,
        totalPages
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error getting projects', { error: errorMessage, options });
      throw error;
    } finally {
      await session.close();
    }
  }
  
  /**
   * Add a dependency relationship between projects
   * @param sourceProjectId ID of the dependent project (source)
   * @param targetProjectId ID of the dependency project (target)
   * @param type Type of dependency relationship - TODO: Use enum/constant
   * @param description Description of the dependency
   * @returns The IDs of the two projects and the relationship type
   */
  static async addProjectDependency(
    sourceProjectId: string,
    targetProjectId: string,
    type: ProjectDependencyType, // Use the enum
    description: string
  ): Promise<{ id: string; sourceProjectId: string; targetProjectId: string; type: string; description: string }> {
    const session = await neo4jDriver.getSession();
    
    try {
      // Logic remains the same
      const sourceExists = await Neo4jUtils.nodeExists(NodeLabels.Project, 'id', sourceProjectId);
      const targetExists = await Neo4jUtils.nodeExists(NodeLabels.Project, 'id', targetProjectId);
      
      if (!sourceExists) throw new Error(`Source project with ID ${sourceProjectId} not found`);
      if (!targetExists) throw new Error(`Target project with ID ${targetProjectId} not found`);
      
      const dependencyExists = await Neo4jUtils.relationshipExists(
        NodeLabels.Project, 'id', sourceProjectId,
        NodeLabels.Project, 'id', targetProjectId,
        RelationshipTypes.DEPENDS_ON
      );
      
      if (dependencyExists) {
        throw new Error(`Dependency relationship already exists between projects ${sourceProjectId} and ${targetProjectId}`);
      }
      
      const circularDependencyQuery = `
        MATCH path = (target:${NodeLabels.Project} {id: $targetProjectId})-[:${RelationshipTypes.DEPENDS_ON}*]->(source:${NodeLabels.Project} {id: $sourceProjectId})
        RETURN count(path) > 0 AS hasCycle
      `;
      
      const cycleCheckResult = await session.executeRead(async (tx) => {
        const result = await tx.run(circularDependencyQuery, { sourceProjectId, targetProjectId });
        return result.records[0]?.get('hasCycle');
      });
      
      if (cycleCheckResult) {
        throw new Error('Adding this dependency would create a circular dependency chain');
      }
      
      const dependencyId = `pdep_${generateId()}`;
      const query = `
        MATCH (source:${NodeLabels.Project} {id: $sourceProjectId}),
              (target:${NodeLabels.Project} {id: $targetProjectId})
        CREATE (source)-[r:${RelationshipTypes.DEPENDS_ON} {
          id: $dependencyId,
          type: $type,
          description: $description,
          createdAt: $createdAt
        }]->(target)
        RETURN r.id as id, source.id as sourceProjectId, target.id as targetProjectId, r.type as type, r.description as description
      `;
      
      const params = {
        sourceProjectId,
        targetProjectId,
        dependencyId,
        type,
        description,
        createdAt: Neo4jUtils.getCurrentTimestamp()
      };
      
      const result = await session.executeWrite(async (tx) => {
        const result = await tx.run(query, params);
        return result.records;
      });
      
      if (!result || result.length === 0) {
        throw new Error('Failed to create project dependency relationship');
      }
      
      const record = result[0];
      const dependency = {
        id: record.get('id'),
        sourceProjectId: record.get('sourceProjectId'),
        targetProjectId: record.get('targetProjectId'),
        type: record.get('type'),
        description: record.get('description')
      };
      
      logger.info('Project dependency added successfully', { 
        sourceProjectId, 
        targetProjectId, 
        type 
      });
      
      return dependency;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error adding project dependency', { 
        error: errorMessage, 
        sourceProjectId, 
        targetProjectId, 
        type 
      });
      throw error;
    } finally {
      await session.close();
    }
  }
  
  /**
   * Remove a dependency relationship between projects
   * @param dependencyId The ID of the dependency relationship to remove
   * @returns True if removed, false if not found
   */
  static async removeProjectDependency(dependencyId: string): Promise<boolean> {
    const session = await neo4jDriver.getSession();
    
    try {
      // Query remains the same
      const query = `
        MATCH (source:${NodeLabels.Project})-[r:${RelationshipTypes.DEPENDS_ON} {id: $dependencyId}]->(target:${NodeLabels.Project})
        DELETE r
      `;
      
      const result = await session.executeWrite(async (tx) => {
        const res = await tx.run(query, { dependencyId });
        return res.summary.counters.updates().relationshipsDeleted > 0;
      });
            
      if (result) {
        logger.info('Project dependency removed successfully', { dependencyId });
      } else {
        logger.warning('Dependency not found or not removed', { dependencyId });
      }
      
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error removing project dependency', { error: errorMessage, dependencyId });
      throw error;
    } finally {
      await session.close();
    }
  }
  
  /**
   * Get all dependencies for a project (both dependencies and dependents)
   * @param projectId Project ID
   * @returns Object containing dependencies and dependents
   */
  static async getProjectDependencies(projectId: string): Promise<{
    dependencies: {
      id: string;
      sourceProjectId: string;
      targetProjectId: string;
      type: string;
      description: string;
      targetProject: {
        id: string;
        name: string;
        status: string;
      };
    }[];
    dependents: {
      id: string;
      sourceProjectId: string;
      targetProjectId: string;
      type: string;
      description: string;
      sourceProject: {
        id: string;
        name: string;
        status: string;
      };
    }[];
  }> {
    const session = await neo4jDriver.getSession();
    
    try {
      // Logic remains the same
      const exists = await Neo4jUtils.nodeExists(NodeLabels.Project, 'id', projectId);
      if (!exists) {
        throw new Error(`Project with ID ${projectId} not found`);
      }
      
      const dependenciesQuery = `
        MATCH (source:${NodeLabels.Project} {id: $projectId})-[r:${RelationshipTypes.DEPENDS_ON}]->(target:${NodeLabels.Project})
        RETURN r.id AS id, 
               source.id AS sourceProjectId, 
               target.id AS targetProjectId,
               r.type AS type,
               r.description AS description,
               target.name AS targetName,
               target.status AS targetStatus
        ORDER BY r.type, target.name
      `;
      
      const dependentsQuery = `
        MATCH (source:${NodeLabels.Project})-[r:${RelationshipTypes.DEPENDS_ON}]->(target:${NodeLabels.Project} {id: $projectId})
        RETURN r.id AS id, 
               source.id AS sourceProjectId, 
               target.id AS targetProjectId,
               r.type AS type,
               r.description AS description,
               source.name AS sourceName,
               source.status AS sourceStatus
        ORDER BY r.type, source.name
      `;
      
      const [dependenciesResult, dependentsResult] = await Promise.all([
        session.executeRead(async (tx) => (await tx.run(dependenciesQuery, { projectId })).records),
        session.executeRead(async (tx) => (await tx.run(dependentsQuery, { projectId })).records)
      ]);
      
      const dependencies = dependenciesResult.map(record => ({
        id: record.get('id'),
        sourceProjectId: record.get('sourceProjectId'),
        targetProjectId: record.get('targetProjectId'),
        type: record.get('type'),
        description: record.get('description'),
        targetProject: {
          id: record.get('targetProjectId'),
          name: record.get('targetName'),
          status: record.get('targetStatus')
        }
      }));
      
      const dependents = dependentsResult.map(record => ({
        id: record.get('id'),
        sourceProjectId: record.get('sourceProjectId'),
        targetProjectId: record.get('targetProjectId'),
        type: record.get('type'),
        description: record.get('description'),
        sourceProject: {
          id: record.get('sourceProjectId'),
          name: record.get('sourceName'),
          status: record.get('sourceStatus')
        }
      }));
      
      return { dependencies, dependents };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error getting project dependencies', { error: errorMessage, projectId });
      throw error;
    } finally {
      await session.close();
    }
  }
}
