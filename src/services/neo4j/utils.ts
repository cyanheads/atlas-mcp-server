import { logger } from '../../utils/index.js'; // Updated import path
import { neo4jDriver } from './driver.js';
import { NodeLabels, PaginatedResult, PaginationOptions, RelationshipTypes } from './types.js';
import { Record as Neo4jRecord } from 'neo4j-driver'; // Import Record type

/**
 * Database utility functions for Neo4j
 */
export class Neo4jUtils {
  /**
   * Initialize the Neo4j database schema with constraints and indexes
   * Should be called at application startup
   */
  static async initializeSchema(): Promise<void> {
    const session = await neo4jDriver.getSession();
    try {
      logger.info('Initializing Neo4j database schema');
      
      const constraints = [
        `CREATE CONSTRAINT project_id_unique IF NOT EXISTS FOR (p:${NodeLabels.Project}) REQUIRE p.id IS UNIQUE`,
        `CREATE CONSTRAINT task_id_unique IF NOT EXISTS FOR (t:${NodeLabels.Task}) REQUIRE t.id IS UNIQUE`,
        `CREATE CONSTRAINT knowledge_id_unique IF NOT EXISTS FOR (k:${NodeLabels.Knowledge}) REQUIRE k.id IS UNIQUE`,
        `CREATE CONSTRAINT user_id_unique IF NOT EXISTS FOR (u:${NodeLabels.User}) REQUIRE u.id IS UNIQUE`,
        `CREATE CONSTRAINT citation_id_unique IF NOT EXISTS FOR (c:${NodeLabels.Citation}) REQUIRE c.id IS UNIQUE`,
        `CREATE CONSTRAINT tasktype_name_unique IF NOT EXISTS FOR (t:${NodeLabels.TaskType}) REQUIRE t.name IS UNIQUE`,
        `CREATE CONSTRAINT domain_name_unique IF NOT EXISTS FOR (d:${NodeLabels.Domain}) REQUIRE d.name IS UNIQUE`
      ];

      const indexes = [
        `CREATE INDEX project_status IF NOT EXISTS FOR (p:${NodeLabels.Project}) ON (p.status)`,
        `CREATE INDEX project_taskType IF NOT EXISTS FOR (p:${NodeLabels.Project}) ON (p.taskType)`,
        `CREATE INDEX task_status IF NOT EXISTS FOR (t:${NodeLabels.Task}) ON (t.status)`,
        `CREATE INDEX task_priority IF NOT EXISTS FOR (t:${NodeLabels.Task}) ON (t.priority)`,
        `CREATE INDEX task_projectId IF NOT EXISTS FOR (t:${NodeLabels.Task}) ON (t.projectId)`,
        `CREATE INDEX knowledge_projectId IF NOT EXISTS FOR (k:${NodeLabels.Knowledge}) ON (k.projectId)`,
        `CREATE INDEX knowledge_domain IF NOT EXISTS FOR (k:${NodeLabels.Knowledge}) ON (k.domain)`
      ];

      // Full-text indexes (check compatibility with Community Edition version)
      // These might require specific configuration or versions. Wrap in try-catch if needed.
      const fullTextIndexes = [
        `CREATE FULLTEXT INDEX project_fulltext IF NOT EXISTS FOR (p:${NodeLabels.Project}) ON EACH [p.name, p.description]`,
        `CREATE FULLTEXT INDEX task_fulltext IF NOT EXISTS FOR (t:${NodeLabels.Task}) ON EACH [t.title, t.description]`,
        `CREATE FULLTEXT INDEX knowledge_fulltext IF NOT EXISTS FOR (k:${NodeLabels.Knowledge}) ON EACH [k.text]`
      ];

      // Execute schema creation queries within a transaction
      await session.executeWrite(async tx => {
        for (const query of [...constraints, ...indexes, ...fullTextIndexes]) {
          try {
            await tx.run(query);
          } catch (error) {
            // Log index creation errors but don't necessarily fail initialization
            // Especially full-text might not be supported/enabled
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (query.includes("FULLTEXT")) {
              logger.warning(`Could not create full-text index (potentially unsupported): ${errorMessage}. Query: ${query}`);
            } else {
              logger.error(`Failed to execute schema query: ${errorMessage}. Query: ${query}`);
              // Rethrow for critical constraints/indexes
              if (!query.includes("FULLTEXT")) throw error; 
            }
          }
        }
      });
      
      logger.info('Neo4j database schema initialization attempted');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to initialize Neo4j database schema', { error: errorMessage });
      throw error;
    } finally {
      await session.close();
    }
  }
  
  /**
   * Clear all data from the database and reinitialize the schema
   * WARNING: This permanently deletes all data
   */
  static async clearDatabase(): Promise<void> {
    const session = await neo4jDriver.getSession();
    try {
      logger.warning('Clearing all data from Neo4j database');
      
      // Delete all nodes and relationships
      await session.executeWrite(async tx => {
        await tx.run('MATCH (n) DETACH DELETE n');
      });
      
      // Recreate schema
      await this.initializeSchema();
      
      logger.info('Neo4j database cleared successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to clear Neo4j database', { error: errorMessage });
      throw error;
    } finally {
      await session.close();
    }
  }
  
  /**
   * Apply pagination to query results
   * @param data Array of data to paginate
   * @param options Pagination options
   * @returns Paginated result object
   */
  static paginateResults<T>(data: T[], options: PaginationOptions = {}): PaginatedResult<T> {
    const page = Math.max(options.page || 1, 1);
    const limit = Math.min(Math.max(options.limit || 20, 1), 100); // Ensure limit is between 1 and 100
    
    const total = data.length;
    const totalPages = Math.ceil(total / limit);
    const startIndex = (page - 1) * limit;
    const endIndex = Math.min(startIndex + limit, total); // Ensure endIndex doesn't exceed total
    
    const paginatedData = data.slice(startIndex, endIndex);
    
    return {
      data: paginatedData,
      total: total,
      page: page,
      limit: limit,
      totalPages: totalPages
    };
  }
  
  /**
   * Generate a Cypher fragment for array parameters (e.g., for IN checks)
   * @param nodeAlias Alias of the node in the query (e.g., 't' for task)
   * @param propertyName Name of the property on the node (e.g., 'tags')
   * @param paramName Name for the Cypher parameter (e.g., 'tagsList')
   * @param arrayParam Array parameter value
   * @param matchAll If true, use ALL items must be in the node's list. If false (default), use ANY item must be in the node's list.
   * @returns Object with cypher fragment and params
   */
  static generateArrayInListQuery(
    nodeAlias: string,
    propertyName: string,
    paramName: string,
    arrayParam?: string[] | string,
    matchAll: boolean = false
  ): { cypher: string; params: Record<string, any> } {
    if (!arrayParam || (Array.isArray(arrayParam) && arrayParam.length === 0)) {
      return { cypher: '', params: {} };
    }
    
    const params: Record<string, any> = {};
    const listParam = Array.isArray(arrayParam) ? arrayParam : [arrayParam];
    params[paramName] = listParam;
    
    const operator = matchAll ? 'ALL' : 'ANY';
    // Cypher syntax for checking if items from a parameter list are in a node's list property
    const cypher = `${operator}(item IN $${paramName} WHERE item IN ${nodeAlias}.${propertyName})`; 
    
    return { cypher, params };
  }
  
  /**
   * Validate that a node exists in the database
   * @param label Node label
   * @param property Property to check
   * @param value Value to check
   * @returns True if the node exists, false otherwise
   */
  static async nodeExists(
    label: NodeLabels,
    property: string,
    value: string | number // Allow number for potential future use
  ): Promise<boolean> {
    const session = await neo4jDriver.getSession();
    try {
      // Use EXISTS for potentially better performance than COUNT
      const query = `
        MATCH (n:${label} {${property}: $value})
        RETURN EXISTS { (n) } AS nodeExists
      `;
      
      const result = await session.executeRead(async (tx) => {
        const res = await tx.run(query, { value });
        return res.records[0]?.get('nodeExists');
      });
      
      return result === true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error checking node existence for ${label} {${property}: ${value}}`, { error: errorMessage });
      throw error; // Re-throw error after logging
    } finally {
      await session.close();
    }
  }
  
  /**
   * Validate relationships between nodes
   * @param startLabel Label of the start node
   * @param startProperty Property of the start node to check
   * @param startValue Value of the start node property
   * @param endLabel Label of the end node
   * @param endProperty Property of the end node to check
   * @param endValue Value of the end node property 
   * @param relationshipType Type of relationship to check
   * @returns True if the relationship exists, false otherwise
   */
  static async relationshipExists(
    startLabel: NodeLabels,
    startProperty: string,
    startValue: string | number,
    endLabel: NodeLabels,
    endProperty: string,
    endValue: string | number,
    relationshipType: RelationshipTypes
  ): Promise<boolean> {
    const session = await neo4jDriver.getSession();
    try {
      // Use EXISTS for potentially better performance
      const query = `
        MATCH (a:${startLabel} {${startProperty}: $startValue})
        MATCH (b:${endLabel} {${endProperty}: $endValue})
        RETURN EXISTS { (a)-[:${relationshipType}]->(b) } AS relExists
      `;
      
      const result = await session.executeRead(async (tx) => {
        const res = await tx.run(query, { startValue, endValue });
        return res.records[0]?.get('relExists');
      });
      
      return result === true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error checking relationship existence: (${startLabel})-[:${relationshipType}]->(${endLabel})`, { error: errorMessage });
      throw error;
    } finally {
      await session.close();
    }
  }
  
  /**
   * Generate a timestamp string in ISO format for database operations
   * @returns Current timestamp as ISO string
   */
  static getCurrentTimestamp(): string {
    return new Date().toISOString();
  }

  /**
   * Process Neo4j result records into plain JavaScript objects.
   * Assumes the record contains the node or properties under the specified key.
   * @param records Neo4j result records array (RecordShape from neo4j-driver).
   * @param primaryKey The key in the record containing the node or properties map (default: 'n').
   * @returns Processed records as an array of plain objects.
   */
  static processRecords<T>(records: Neo4jRecord[], primaryKey: string = 'n'): T[] {
    if (!records || records.length === 0) {
      return [];
    }
    
    return records.map(record => {
      // Use .toObject() which handles conversion from Neo4j types
      const obj = record.toObject(); 
      // If the query returns the node directly (e.g., RETURN n), access its properties
      // If the query returns properties directly (e.g., RETURN n.id as id), obj already has them.
      const data = obj[primaryKey]?.properties ? obj[primaryKey].properties : obj; 
      
      // Ensure 'urls' is an array if it exists (handles potential null/undefined from DB)
      if (data && 'urls' in data) {
        data.urls = data.urls || [];
      }
      // Ensure 'tags' is an array if it exists
      if (data && 'tags' in data) {
        data.tags = data.tags || [];
      }
       // Ensure 'citations' is an array if it exists
      if (data && 'citations' in data) {
        data.citations = data.citations || [];
      }

      return data as T;
    }).filter((item): item is T => item !== null && item !== undefined);
  }
  
  /**
   * Check if the database is empty (no nodes exist)
   * @returns Promise<boolean> - true if database is empty, false otherwise
   */
  static async isDatabaseEmpty(): Promise<boolean> {
    const session = await neo4jDriver.getSession();
    try {
      const query = `
        MATCH (n)
        RETURN count(n) = 0 AS isEmpty
        LIMIT 1
      `;
      
      const result = await session.executeRead(async (tx) => {
        const res = await tx.run(query);
        // If no records are returned (e.g., DB error), assume not empty for safety
        return res.records[0]?.get('isEmpty') ?? false; 
      });
      
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error checking if database is empty', { error: errorMessage });
      // If we can't check, assume it's not empty to be safe
      return false;
    } finally {
      await session.close();
    }
  }
}
