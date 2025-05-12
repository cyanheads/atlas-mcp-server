import { int } from 'neo4j-driver'; // Import 'int' for pagination
import { logger } from '../../utils/index.js'; // Updated import path
import { neo4jDriver } from './driver.js';
import { generateId, buildListQuery } from './helpers.js'; // Import buildListQuery
import {
  Neo4jTask, // This type no longer has assignedTo
  NodeLabels,
  PaginatedResult,
  RelationshipTypes,
  TaskFilterOptions
} from './types.js';
import { Neo4jUtils } from './utils.js';

/**
 * Service for managing Task entities in Neo4j
 */
export class TaskService {
  /**
   * Create a new task and optionally assign it to a user.
   * @param task Task data, including optional assignedTo for relationship creation
   * @returns The created task
   */
  static async createTask(task: Omit<Neo4jTask, 'id' | 'createdAt' | 'updatedAt'> & { id?: string; assignedTo?: string }): Promise<Neo4jTask & { assignedToUserId?: string | null }> {
    const session = await neo4jDriver.getSession();
    
    try {
      const projectExists = await Neo4jUtils.nodeExists(NodeLabels.Project, 'id', task.projectId);
      if (!projectExists) {
        throw new Error(`Project with ID ${task.projectId} not found`);
      }
      
      const taskId = task.id || `task_${generateId()}`;
      const now = Neo4jUtils.getCurrentTimestamp();
      const assignedToUserId = task.assignedTo; // Get assignee from input
      
      // No longer check if user exists here, will use MERGE later
      
      // Serialize urls to JSON string
      const query = `
        MATCH (p:${NodeLabels.Project} {id: $projectId})
        CREATE (t:${NodeLabels.Task} {
          id: $id,
          projectId: $projectId,
          title: $title,
          description: $description,
          priority: $priority,
          status: $status,
          // assignedTo removed
          urls: $urls,
          tags: $tags,
          completionRequirements: $completionRequirements,
          outputFormat: $outputFormat,
          taskType: $taskType,
          createdAt: $createdAt,
          updatedAt: $updatedAt
        })
        CREATE (p)-[:${RelationshipTypes.CONTAINS_TASK}]->(t)
        
        // Optionally create ASSIGNED_TO relationship using MERGE for the User node
        WITH t
        ${assignedToUserId ? `MERGE (u:${NodeLabels.User} {id: $assignedToUserId}) ON CREATE SET u.createdAt = $createdAt CREATE (t)-[:${RelationshipTypes.ASSIGNED_TO}]->(u)` : ''}
        
        // Return properties defined in Neo4jTask
        WITH t // Ensure t is in scope before optional match
        OPTIONAL MATCH (t)-[:${RelationshipTypes.ASSIGNED_TO}]->(assigned_user:${NodeLabels.User}) // Match to get assigned user's ID
        RETURN t.id as id,
               t.projectId as projectId,
               t.title as title,
               t.description as description,
               t.priority as priority,
               t.status as status,
               assigned_user.id as assignedToUserId, // Add this
               t.urls as urls,
               t.tags as tags,
               t.completionRequirements as completionRequirements,
               t.outputFormat as outputFormat,
               t.taskType as taskType,
               t.createdAt as createdAt,
               t.updatedAt as updatedAt
      `;
      
      // Serialize urls to JSON string
      const params: Record<string, any> = {
        id: taskId,
        projectId: task.projectId,
        title: task.title,
        description: task.description,
        priority: task.priority,
        status: task.status,
        // assignedTo removed from params
        urls: JSON.stringify(task.urls || []), // Serialize urls
        tags: task.tags || [],
        completionRequirements: task.completionRequirements,
        outputFormat: task.outputFormat,
        taskType: task.taskType,
        createdAt: now,
        updatedAt: now
      };
      
      if (assignedToUserId) {
        params.assignedToUserId = assignedToUserId;
      }
      
      const result = await session.executeWrite(async (tx) => {
        const result = await tx.run(query, params);
        // Use .get() for each field
        return result.records.length > 0 ? result.records[0] : null; 
      });
            
      if (!result) {
        throw new Error('Failed to create task or retrieve its properties');
      }
      
      // Construct the Neo4jTask object - deserialize urls
      const createdTaskData: Neo4jTask & { assignedToUserId?: string | null } = {
        id: result.get('id'),
        projectId: result.get('projectId'),
        title: result.get('title'),
        description: result.get('description'),
        priority: result.get('priority'),
        status: result.get('status'),
        urls: JSON.parse(result.get('urls') || '[]'), // Deserialize urls
        tags: result.get('tags') || [],
        completionRequirements: result.get('completionRequirements'),
        outputFormat: result.get('outputFormat'),
        taskType: result.get('taskType'),
        createdAt: result.get('createdAt'),
        updatedAt: result.get('updatedAt'),
        assignedToUserId: result.get('assignedToUserId') || null
      };
      
      logger.info('Task created successfully', { 
        taskId: createdTaskData.id,
        projectId: task.projectId,
        assignedTo: assignedToUserId 
      });
      
      return createdTaskData; 
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error creating task', { error: errorMessage, taskInput: task });
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Link a Task to a Knowledge item with a specified relationship type.
   * @param taskId ID of the source Task item
   * @param knowledgeId ID of the target Knowledge item
   * @param relationshipType The type of relationship to create (e.g., 'ADDRESSES', 'REFERENCES') - Validation needed
   * @returns True if the link was created successfully, false otherwise
   */
  static async linkTaskToKnowledge(taskId: string, knowledgeId: string, relationshipType: string): Promise<boolean> {
    // TODO: Validate relationshipType against allowed types or RelationshipTypes enum
    const session = await neo4jDriver.getSession();
    logger.debug(`Attempting to link task ${taskId} to knowledge ${knowledgeId} with type ${relationshipType}`);

    try {
      const taskExists = await Neo4jUtils.nodeExists(NodeLabels.Task, 'id', taskId);
      const knowledgeExists = await Neo4jUtils.nodeExists(NodeLabels.Knowledge, 'id', knowledgeId);

      if (!taskExists || !knowledgeExists) {
        logger.warning(`Cannot link: Task (${taskId} exists: ${taskExists}) or Knowledge (${knowledgeId} exists: ${knowledgeExists}) not found.`);
        return false;
      }

      const escapedType = `\`${relationshipType.replace(/`/g, '``')}\``;

      const query = `
        MATCH (task:${NodeLabels.Task} {id: $taskId})
        MATCH (knowledge:${NodeLabels.Knowledge} {id: $knowledgeId})
        MERGE (task)-[r:${escapedType}]->(knowledge)
        RETURN r
      `;

      const result = await session.executeWrite(async (tx) => {
        const runResult = await tx.run(query, { taskId, knowledgeId });
        return runResult.records;
      });

      const linkCreated = result.length > 0;

      if (linkCreated) {
        logger.info(`Successfully linked task ${taskId} to knowledge ${knowledgeId} with type ${relationshipType}`);
      } else {
        logger.warning(`Failed to link task ${taskId} to knowledge ${knowledgeId} (MERGE returned no relationship)`);
      }

      return linkCreated;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error linking task to knowledge item', { error: errorMessage, taskId, knowledgeId, relationshipType });
      throw error;
    } finally {
      await session.close();
    }
  }


  /**
   * Get a task by ID, including the assigned user ID via relationship.
   * @param id Task ID
   * @returns The task with assignedToUserId property, or null if not found.
   */
  static async getTaskById(id: string): Promise<(Neo4jTask & { assignedToUserId: string | null }) | null> {
    const session = await neo4jDriver.getSession();
    
    try {
      // Retrieve urls as JSON string
      const query = `
        MATCH (t:${NodeLabels.Task} {id: $id})
        OPTIONAL MATCH (t)-[:${RelationshipTypes.ASSIGNED_TO}]->(u:${NodeLabels.User})
        RETURN t.id as id,
               t.projectId as projectId,
               t.title as title,
               t.description as description,
               t.priority as priority,
               t.status as status,
               u.id as assignedToUserId, 
               t.urls as urls,
               t.tags as tags,
               t.completionRequirements as completionRequirements,
               t.outputFormat as outputFormat,
               t.taskType as taskType,
               t.createdAt as createdAt,
               t.updatedAt as updatedAt
      `;
      
      const result = await session.executeRead(async (tx) => {
        const result = await tx.run(query, { id });
        return result.records;
      });
            
      if (result.length === 0) {
        return null;
      }
      
      const record = result[0];
      
      // Construct the base Neo4jTask object - deserialize urls
      const taskData: Neo4jTask = {
        id: record.get('id'),
        projectId: record.get('projectId'),
        title: record.get('title'),
        description: record.get('description'),
        priority: record.get('priority'),
        status: record.get('status'),
        urls: JSON.parse(record.get('urls') || '[]'), // Deserialize urls
        tags: record.get('tags') || [],
        completionRequirements: record.get('completionRequirements'),
        outputFormat: record.get('outputFormat'),
        taskType: record.get('taskType'),
        createdAt: record.get('createdAt'),
        updatedAt: record.get('updatedAt')
      };
      
      const assignedToUserId = record.get('assignedToUserId');

      return {
        ...taskData,
        assignedToUserId: assignedToUserId 
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error getting task by ID', { error: errorMessage, id });
      throw error;
    } finally {
      await session.close();
    }
  }
  
  /**
   * Check if all dependencies of a task are completed
   * @param taskId Task ID to check dependencies for
   * @returns True if all dependencies are completed, false otherwise
   */
  static async areAllDependenciesCompleted(taskId: string): Promise<boolean> {
    const session = await neo4jDriver.getSession();
    
    try {
      const query = `
        MATCH (t:${NodeLabels.Task} {id: $taskId})-[:${RelationshipTypes.DEPENDS_ON}]->(dep:${NodeLabels.Task})
        WHERE dep.status <> 'completed'
        RETURN count(dep) AS incompleteCount
      `;
      
      const result = await session.executeRead(async (tx) => {
        const result = await tx.run(query, { taskId });
        // Use standard number directly, Neo4j count() returns a number, not an Integer object
        return result.records[0]?.get('incompleteCount') || 0; 
      });
      
      return result === 0;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error checking task dependencies completion status', { error: errorMessage, taskId });
      throw error;
    } finally {
      await session.close();
    }
  }
  
  /**
   * Update a task's properties and handle assignment changes via relationships.
   * @param id Task ID
   * @param updates Task updates, including optional assignedTo for relationship changes
   * @returns The updated task (without assignedTo property)
   */
  static async updateTask(id: string, updates: Partial<Omit<Neo4jTask, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>> & { assignedTo?: string | null }): Promise<Neo4jTask> {
    const session = await neo4jDriver.getSession();
    
    try {
      const exists = await Neo4jUtils.nodeExists(NodeLabels.Task, 'id', id);
      if (!exists) {
        throw new Error(`Task with ID ${id} not found`);
      }
      
      if (updates.status === 'in-progress' || updates.status === 'completed') {
        const depsCompleted = await this.areAllDependenciesCompleted(id);
        if (!depsCompleted) {
          throw new Error(`Cannot mark task as ${updates.status} because not all dependencies are completed`);
        }
      }
      
      const updateParams: Record<string, any> = {
        id,
        updatedAt: Neo4jUtils.getCurrentTimestamp()
      };
      let setClauses = ['t.updatedAt = $updatedAt'];
      const allowedProperties: (keyof Neo4jTask)[] = ['projectId', 'title', 'description', 'priority', 'status', 'urls', 'tags', 'completionRequirements', 'outputFormat', 'taskType'];

      // Handle property updates - serialize urls if present
      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined && key !== 'assignedTo' && allowedProperties.includes(key as keyof Neo4jTask)) {
          // Serialize urls array to JSON string if it's the key being updated
          updateParams[key] = (key === 'urls') ? JSON.stringify(value || []) : value; 
          setClauses.push(`t.${key} = $${key}`);
        }
      }

      // Handle assignment change (logic remains the same)
      let assignmentClause = '';
      const newAssigneeId = updates.assignedTo; 
      if (newAssigneeId !== undefined) { // Check if assignedTo is part of the update
        if (newAssigneeId === null) {
          // Unassign: Delete existing relationship
          assignmentClause = `
            WITH t
            OPTIONAL MATCH (t)-[oldRel:${RelationshipTypes.ASSIGNED_TO}]->(:${NodeLabels.User})
            DELETE oldRel
          `;
        } else {
          // Assign/Reassign: Use MERGE for the user node
          updateParams.newAssigneeId = newAssigneeId;
          assignmentClause = `
            WITH t
            OPTIONAL MATCH (t)-[oldRel:${RelationshipTypes.ASSIGNED_TO}]->(:${NodeLabels.User})
            DELETE oldRel
            WITH t
            MERGE (newUser:${NodeLabels.User} {id: $newAssigneeId})
            ON CREATE SET newUser.createdAt = $updatedAt
            CREATE (t)-[:${RelationshipTypes.ASSIGNED_TO}]->(newUser)
          `;
        }
      }
      
      // Retrieve urls as JSON string
      const query = `
        MATCH (t:${NodeLabels.Task} {id: $id})
        ${setClauses.length > 0 ? `SET ${setClauses.join(', ')}` : ''}
        ${assignmentClause}
        // Return properties defined in Neo4jTask
        RETURN t.id as id,
               t.projectId as projectId,
               t.title as title,
               t.description as description,
               t.priority as priority,
               t.status as status,
               t.urls as urls,
               t.tags as tags,
               t.completionRequirements as completionRequirements,
               t.outputFormat as outputFormat,
               t.taskType as taskType,
               t.createdAt as createdAt,
               t.updatedAt as updatedAt
      `;
      
      const result = await session.executeWrite(async (tx) => {
        const result = await tx.run(query, updateParams);
        // Use .get() for each field
        return result.records.length > 0 ? result.records[0] : null; 
      });
            
      if (!result) {
        throw new Error('Failed to update task or retrieve its properties');
      }
      
      // Construct the Neo4jTask object - deserialize urls
      const updatedTaskData: Neo4jTask = {
        id: result.get('id'),
        projectId: result.get('projectId'),
        title: result.get('title'),
        description: result.get('description'),
        priority: result.get('priority'),
        status: result.get('status'),
        urls: JSON.parse(result.get('urls') || '[]'), // Deserialize urls
        tags: result.get('tags') || [],
        completionRequirements: result.get('completionRequirements'),
        outputFormat: result.get('outputFormat'),
        taskType: result.get('taskType'),
        createdAt: result.get('createdAt'),
        updatedAt: result.get('updatedAt')
      };

      logger.info('Task updated successfully', { taskId: id });
      return updatedTaskData; 
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error updating task', { error: errorMessage, id, updates });
      throw error;
    } finally {
      await session.close();
    }
  }
  
  /**
   * Delete a task
   * @param id Task ID
   * @returns True if deleted, false if not found
   */
  static async deleteTask(id: string): Promise<boolean> {
    const session = await neo4jDriver.getSession();
    
    try {
      const exists = await Neo4jUtils.nodeExists(NodeLabels.Task, 'id', id);
      if (!exists) {
        return false;
      }
      
      const query = `
        MATCH (t:${NodeLabels.Task} {id: $id})
        DETACH DELETE t
      `;
      
      await session.executeWrite(async (tx) => {
        await tx.run(query, { id });
      });
      
      logger.info('Task deleted successfully', { taskId: id });
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error deleting task', { error: errorMessage, id });
      throw error;
    } finally {
      await session.close();
    }
  }
  
  /**
   * Get tasks for a project with optional filtering and server-side pagination.
   * Includes assigned user ID via relationship.
   * @param options Filter and pagination options
   * @returns Paginated list of tasks including assignedToUserId
   */
  static async getTasks(options: TaskFilterOptions): Promise<PaginatedResult<Neo4jTask & { assignedToUserId: string | null }>> {
    const session = await neo4jDriver.getSession();

    try {
      const nodeAlias = 't';
      const userAlias = 'u'; // Alias for the User node
      
      // Define how to match the assigned user relationship
      let assignmentMatchClause = `OPTIONAL MATCH (${nodeAlias})-[:${RelationshipTypes.ASSIGNED_TO}]->(${userAlias}:${NodeLabels.User})`;
      if (options.assignedTo) {
        // If filtering by assignee, make the MATCH non-optional and filter by user ID
        assignmentMatchClause = `MATCH (${nodeAlias})-[:${RelationshipTypes.ASSIGNED_TO}]->(${userAlias}:${NodeLabels.User} {id: $assignedTo})`;
      }

      // Define the properties to return from the query
      const returnProperties = [
        `${nodeAlias}.id as id`,
        `${nodeAlias}.projectId as projectId`,
        `${nodeAlias}.title as title`,
        `${nodeAlias}.description as description`,
        `${nodeAlias}.priority as priority`,
        `${nodeAlias}.status as status`,
        `${userAlias}.id as assignedToUserId`, // Get user ID from the relationship
        `${nodeAlias}.urls as urls`,
        `${nodeAlias}.tags as tags`,
        `${nodeAlias}.completionRequirements as completionRequirements`,
        `${nodeAlias}.outputFormat as outputFormat`,
        `${nodeAlias}.taskType as taskType`,
        `${nodeAlias}.createdAt as createdAt`,
        `${nodeAlias}.updatedAt as updatedAt`
      ];

      // Use the buildListQuery helper
      const { countQuery, dataQuery, params } = buildListQuery(
        NodeLabels.Task,
        returnProperties,
        { // Filters
          projectId: options.projectId, // Pass projectId filter
          status: options.status,
          priority: options.priority,
          assignedTo: options.assignedTo, // Pass assignedTo for potential filtering in helper/match clause
          tags: options.tags,
          taskType: options.taskType
        },
        { // Pagination
          sortBy: options.sortBy,
          sortDirection: options.sortDirection,
          page: options.page,
          limit: options.limit
        },
        nodeAlias, // Primary node alias
        assignmentMatchClause // Additional MATCH clause for assignment
      );
      
      // Execute count query
      const totalResult = await session.executeRead(async (tx) => {
        // buildListQuery returns params including skip/limit, remove them for count
        const countParams = { ...params };
        delete countParams.skip;
        delete countParams.limit;
        logger.debug('Executing Task Count Query (using buildListQuery):', { query: countQuery, params: countParams });
        const result = await tx.run(countQuery, countParams);
        return result.records[0]?.get('total') ?? 0;
      });
      const total = totalResult; 
      
      // Execute data query
      const dataResult = await session.executeRead(async (tx) => {
        logger.debug('Executing Task Data Query (using buildListQuery):', { query: dataQuery, params: params });
        const result = await tx.run(dataQuery, params);
        return result.records;
      });
      
      // Map results - deserialize urls
      const tasks = dataResult.map(record => {
        // Construct the base Neo4jTask object
        const taskData: Neo4jTask = {
          id: record.get('id'),
          projectId: record.get('projectId'),
          title: record.get('title'),
          description: record.get('description'),
          priority: record.get('priority'),
          status: record.get('status'),
          urls: JSON.parse(record.get('urls') || '[]'), // Deserialize urls
          tags: record.get('tags') || [],
          completionRequirements: record.get('completionRequirements'),
          outputFormat: record.get('outputFormat'),
          taskType: record.get('taskType'),
          createdAt: record.get('createdAt'),
          updatedAt: record.get('updatedAt')
        };
        // Get the assigned user ID from the record
        const assignedToUserId = record.get('assignedToUserId');
        // Combine base task data with the user ID
        return {
          ...taskData,
          assignedToUserId: assignedToUserId 
        };
      });
      
      const page = Math.max(options.page || 1, 1);
      const limit = Math.min(Math.max(options.limit || 20, 1), 100);
      const totalPages = Math.ceil(total / limit);
      
      return {
        data: tasks,
        total,
        page,
        limit,
        totalPages
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error getting tasks', { error: errorMessage, options });
      throw error;
    } finally {
      await session.close();
    }
  }
  
  /**
   * Add a dependency relationship between tasks
   * @param sourceTaskId ID of the dependent task (source)
   * @param targetTaskId ID of the dependency task (target)
   * @returns The IDs of the two tasks and the relationship ID
   */
  static async addTaskDependency(
    sourceTaskId: string,
    targetTaskId: string
  ): Promise<{ id: string; sourceTaskId: string; targetTaskId: string }> {
    const session = await neo4jDriver.getSession();
    
    try {
      // Logic remains the same
      const sourceExists = await Neo4jUtils.nodeExists(NodeLabels.Task, 'id', sourceTaskId);
      const targetExists = await Neo4jUtils.nodeExists(NodeLabels.Task, 'id', targetTaskId);
      
      if (!sourceExists) throw new Error(`Source task with ID ${sourceTaskId} not found`);
      if (!targetExists) throw new Error(`Target task with ID ${targetTaskId} not found`);
      
      const dependencyExists = await Neo4jUtils.relationshipExists(
        NodeLabels.Task, 'id', sourceTaskId,
        NodeLabels.Task, 'id', targetTaskId,
        RelationshipTypes.DEPENDS_ON
      );
      
      if (dependencyExists) {
        throw new Error(`Dependency relationship already exists between tasks ${sourceTaskId} and ${targetTaskId}`);
      }
      
      const circularDependencyQuery = `
        MATCH path = (target:${NodeLabels.Task} {id: $targetTaskId})-[:${RelationshipTypes.DEPENDS_ON}*]->(source:${NodeLabels.Task} {id: $sourceTaskId})
        RETURN count(path) > 0 AS hasCycle
      `;
      
      const cycleCheckResult = await session.executeRead(async (tx) => {
        const result = await tx.run(circularDependencyQuery, { sourceTaskId, targetTaskId });
        return result.records[0]?.get('hasCycle');
      });
      
      if (cycleCheckResult) {
        throw new Error('Adding this dependency would create a circular dependency chain');
      }
      
      const dependencyId = `tdep_${generateId()}`;
      const query = `
        MATCH (source:${NodeLabels.Task} {id: $sourceTaskId}),
              (target:${NodeLabels.Task} {id: $targetTaskId})
        CREATE (source)-[r:${RelationshipTypes.DEPENDS_ON} {
          id: $dependencyId,
          createdAt: $createdAt
        }]->(target)
        RETURN r.id as id, source.id as sourceTaskId, target.id as targetTaskId
      `;
      
      const params = {
        sourceTaskId,
        targetTaskId,
        dependencyId,
        createdAt: Neo4jUtils.getCurrentTimestamp()
      };
      
      const result = await session.executeWrite(async (tx) => {
        const result = await tx.run(query, params);
        return result.records;
      });
      
      if (!result || result.length === 0) {
        throw new Error('Failed to create task dependency relationship');
      }
      
      const record = result[0];
      const dependency = {
        id: record.get('id'),
        sourceTaskId: record.get('sourceTaskId'),
        targetTaskId: record.get('targetTaskId')
      };
      
      logger.info('Task dependency added successfully', { sourceTaskId, targetTaskId });
      return dependency;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error adding task dependency', { error: errorMessage, sourceTaskId, targetTaskId });
      throw error;
    } finally {
      await session.close();
    }
  }
  
  /**
   * Remove a dependency relationship between tasks
   * @param dependencyId The ID of the dependency relationship to remove
   * @returns True if removed, false if not found
   */
  static async removeTaskDependency(dependencyId: string): Promise<boolean> {
    const session = await neo4jDriver.getSession();
    
    try {
      const query = `
        MATCH (source:${NodeLabels.Task})-[r:${RelationshipTypes.DEPENDS_ON} {id: $dependencyId}]->(target:${NodeLabels.Task})
        DELETE r
      `;
      
      const result = await session.executeWrite(async (tx) => {
        const res = await tx.run(query, { dependencyId });
        return res.summary.counters.updates().relationshipsDeleted > 0; 
      });
            
      if (result) {
        logger.info('Task dependency removed successfully', { dependencyId });
      } else {
        logger.warning('Task dependency not found or not removed', { dependencyId });
      }
      
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error removing task dependency', { error: errorMessage, dependencyId });
      throw error;
    } finally {
      await session.close();
    }
  }
  
  /**
   * Get task dependencies (both dependencies and dependents)
   * @param taskId Task ID
   * @returns Object containing dependencies and dependents
   */
  static async getTaskDependencies(taskId: string): Promise<{
    dependencies: {
      id: string; // Relationship ID
      taskId: string; // Target Task ID
      title: string;
      status: string;
      priority: string;
    }[];
    dependents: {
      id: string; // Relationship ID
      taskId: string; // Source Task ID
      title: string;
      status: string;
      priority: string;
    }[];
  }> {
    const session = await neo4jDriver.getSession();
    
    try {
      // Logic remains the same
      const exists = await Neo4jUtils.nodeExists(NodeLabels.Task, 'id', taskId);
      if (!exists) {
        throw new Error(`Task with ID ${taskId} not found`);
      }
      
      const dependenciesQuery = `
        MATCH (source:${NodeLabels.Task} {id: $taskId})-[r:${RelationshipTypes.DEPENDS_ON}]->(target:${NodeLabels.Task})
        RETURN r.id as id, 
               target.id AS taskId, 
               target.title AS title,
               target.status AS status,
               target.priority AS priority
        ORDER BY target.priority DESC, target.title
      `;
      
      const dependentsQuery = `
        MATCH (source:${NodeLabels.Task})-[r:${RelationshipTypes.DEPENDS_ON}]->(target:${NodeLabels.Task} {id: $taskId})
        RETURN r.id as id, 
               source.id AS taskId, 
               source.title AS title,
               source.status AS status,
               source.priority AS priority
        ORDER BY source.priority DESC, source.title
      `;
      
      const [dependenciesResult, dependentsResult] = await Promise.all([
        session.executeRead(async (tx) => (await tx.run(dependenciesQuery, { taskId })).records),
        session.executeRead(async (tx) => (await tx.run(dependentsQuery, { taskId })).records)
      ]);
      
      const dependencies = dependenciesResult.map(record => ({
        id: record.get('id'),
        taskId: record.get('taskId'),
        title: record.get('title'),
        status: record.get('status'),
        priority: record.get('priority')
      }));
      
      const dependents = dependentsResult.map(record => ({
        id: record.get('id'),
        taskId: record.get('taskId'),
        title: record.get('title'),
        status: record.get('status'),
        priority: record.get('priority')
      }));
      
      return { dependencies, dependents };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error getting task dependencies', { error: errorMessage, taskId });
      throw error;
    } finally {
      await session.close();
    }
  }
  
  /**
   * Assign a task to a user by creating an ASSIGNED_TO relationship.
   * @param taskId Task ID
   * @param userId User ID
   * @returns The updated task (without assignedTo property)
   */
  static async assignTask(taskId: string, userId: string): Promise<Neo4jTask> {
    const session = await neo4jDriver.getSession();
    
    try {
      // Logic remains the same
      const taskExists = await Neo4jUtils.nodeExists(NodeLabels.Task, 'id', taskId);
      if (!taskExists) throw new Error(`Task with ID ${taskId} not found`);
      
      const userExists = await Neo4jUtils.nodeExists(NodeLabels.User, 'id', userId);
      if (!userExists) throw new Error(`User with ID ${userId} not found`); 
      
      const query = `
        MATCH (t:${NodeLabels.Task} {id: $taskId}), (u:${NodeLabels.User} {id: $userId})
        
        OPTIONAL MATCH (t)-[r:${RelationshipTypes.ASSIGNED_TO}]->(:${NodeLabels.User})
        DELETE r
        
        CREATE (t)-[:${RelationshipTypes.ASSIGNED_TO}]->(u)
        
        SET t.updatedAt = $updatedAt 
        
        // Return properties defined in Neo4jTask
        RETURN t.id as id,
               t.projectId as projectId,
               t.title as title,
               t.description as description,
               t.priority as priority,
               t.status as status,
               // assignedTo removed
               t.urls as urls,
               t.tags as tags,
               t.completionRequirements as completionRequirements,
               t.outputFormat as outputFormat,
               t.taskType as taskType,
               t.createdAt as createdAt,
               t.updatedAt as updatedAt
      `;
      
      const params = {
        taskId,
        userId,
        updatedAt: Neo4jUtils.getCurrentTimestamp()
      };
      
      const result = await session.executeWrite(async (tx) => {
        const result = await tx.run(query, params);
        // Use .get() for each field
        return result.records.length > 0 ? result.records[0] : null; 
      });
            
      if (!result) {
        throw new Error('Failed to assign task or retrieve its properties');
      }
      
      // Construct the Neo4jTask object - deserialize urls
      const updatedTaskData: Neo4jTask = {
        id: result.get('id'),
        projectId: result.get('projectId'),
        title: result.get('title'),
        description: result.get('description'),
        priority: result.get('priority'),
        status: result.get('status'),
        urls: JSON.parse(result.get('urls') || '[]'), // Deserialize urls
        tags: result.get('tags') || [],
        completionRequirements: result.get('completionRequirements'),
        outputFormat: result.get('outputFormat'),
        taskType: result.get('taskType'),
        createdAt: result.get('createdAt'),
        updatedAt: result.get('updatedAt')
      };
      
      logger.info('Task assigned successfully', { taskId, userId });
      return updatedTaskData; 
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error assigning task', { error: errorMessage, taskId, userId });
      throw error;
    } finally {
      await session.close();
    }
  }
  
  /**
   * Unassign a task by deleting the ASSIGNED_TO relationship.
   * @param taskId Task ID
   * @returns The updated task (without assignedTo property)
   */
  static async unassignTask(taskId: string): Promise<Neo4jTask> {
    const session = await neo4jDriver.getSession();
    
    try {
      // Logic remains the same
      const taskExists = await Neo4jUtils.nodeExists(NodeLabels.Task, 'id', taskId);
      if (!taskExists) throw new Error(`Task with ID ${taskId} not found`);
      
      const query = `
        MATCH (t:${NodeLabels.Task} {id: $taskId})
        
        OPTIONAL MATCH (t)-[r:${RelationshipTypes.ASSIGNED_TO}]->(:${NodeLabels.User})
        DELETE r
        
        SET t.updatedAt = $updatedAt 
        
        // Return properties defined in Neo4jTask
        RETURN t.id as id,
               t.projectId as projectId,
               t.title as title,
               t.description as description,
               t.priority as priority,
               t.status as status,
               // assignedTo removed
               t.urls as urls,
               t.tags as tags,
               t.completionRequirements as completionRequirements,
               t.outputFormat as outputFormat,
               t.taskType as taskType,
               t.createdAt as createdAt,
               t.updatedAt as updatedAt
      `;
      
      const params = {
        taskId,
        updatedAt: Neo4jUtils.getCurrentTimestamp()
      };
      
      const result = await session.executeWrite(async (tx) => {
        const result = await tx.run(query, params);
        // Use .get() for each field
        return result.records.length > 0 ? result.records[0] : null; 
      });
            
      if (!result) {
        throw new Error('Failed to unassign task or retrieve its properties');
      }
      
      // Construct the Neo4jTask object - deserialize urls
      const updatedTaskData: Neo4jTask = {
        id: result.get('id'),
        projectId: result.get('projectId'),
        title: result.get('title'),
        description: result.get('description'),
        priority: result.get('priority'),
        status: result.get('status'),
        urls: JSON.parse(result.get('urls') || '[]'), // Deserialize urls
        tags: result.get('tags') || [],
        completionRequirements: result.get('completionRequirements'),
        outputFormat: result.get('outputFormat'),
        taskType: result.get('taskType'),
        createdAt: result.get('createdAt'),
        updatedAt: result.get('updatedAt')
      };
      
      logger.info('Task unassigned successfully', { taskId });
      return updatedTaskData; 
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error unassigning task', { error: errorMessage, taskId });
      throw error;
    } finally {
      await session.close();
    }
  }
}
