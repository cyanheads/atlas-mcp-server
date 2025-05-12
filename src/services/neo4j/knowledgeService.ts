import { logger } from '../../utils/index.js'; // Updated import path
import { neo4jDriver } from './driver.js';
import { generateId } from './helpers.js';
import {
  KnowledgeFilterOptions,
  Neo4jKnowledge, // This type no longer has domain/citations
  NodeLabels,
  PaginatedResult,
  RelationshipTypes
} from './types.js';
import { Neo4jUtils } from './utils.js';
import { int } from 'neo4j-driver'; // Import 'int' for pagination

/**
 * Service for managing Knowledge entities in Neo4j
 */
export class KnowledgeService {
  /**
   * Add a new knowledge item
   * @param knowledge Input data, potentially including domain and citations for relationship creation
   * @returns The created knowledge item (without domain/citations properties)
   */
  static async addKnowledge(knowledge: Omit<Neo4jKnowledge, 'id' | 'createdAt' | 'updatedAt'> & { id?: string; domain?: string; citations?: string[] }): Promise<Neo4jKnowledge> {
    const session = await neo4jDriver.getSession();
    
    try {
      const projectExists = await Neo4jUtils.nodeExists(NodeLabels.Project, 'id', knowledge.projectId);
      if (!projectExists) {
        throw new Error(`Project with ID ${knowledge.projectId} not found`);
      }
      
      const knowledgeId = knowledge.id || `know_${generateId()}`;
      const now = Neo4jUtils.getCurrentTimestamp();
      
      // Input validation for domain
      if (!knowledge.domain || typeof knowledge.domain !== 'string' || knowledge.domain.trim() === '') {
        throw new Error('Domain is required to create a knowledge item.');
      }
      
      // Create knowledge node and relationship to project
      // Removed domain and citations properties from CREATE
      const query = `
        MATCH (p:${NodeLabels.Project} {id: $projectId})
        CREATE (k:${NodeLabels.Knowledge} {
          id: $id,
          projectId: $projectId,
          text: $text,
          tags: $tags,
          createdAt: $createdAt,
          updatedAt: $updatedAt
        })
        CREATE (p)-[r:${RelationshipTypes.CONTAINS_KNOWLEDGE}]->(k)
        
        // Create domain relationship
        MERGE (d:${NodeLabels.Domain} {name: $domain})
        ON CREATE SET d.createdAt = $createdAt
        CREATE (k)-[:${RelationshipTypes.BELONGS_TO_DOMAIN}]->(d)
        
        // Return only the properties defined in Neo4jKnowledge
        RETURN k.id as id, k.projectId as projectId, k.text as text, k.tags as tags, k.createdAt as createdAt, k.updatedAt as updatedAt
      `;
      
      const params = {
        id: knowledgeId,
        projectId: knowledge.projectId,
        text: knowledge.text,
        tags: knowledge.tags || [],
        domain: knowledge.domain, // Domain needed for MERGE Domain node
        createdAt: now,
        updatedAt: now
      };
      
      const result = await session.executeWrite(async (tx) => {
        const result = await tx.run(query, params);
        return result.records;
      });
      
      const createdKnowledgeRecord = result[0];
      
      if (!createdKnowledgeRecord) {
        throw new Error('Failed to create knowledge item or retrieve its properties');
      }
      
      // Construct the Neo4jKnowledge object from the returned record
      const createdKnowledge: Neo4jKnowledge = {
        id: createdKnowledgeRecord.get('id'),
        projectId: createdKnowledgeRecord.get('projectId'),
        text: createdKnowledgeRecord.get('text'),
        tags: createdKnowledgeRecord.get('tags') || [],
        createdAt: createdKnowledgeRecord.get('createdAt'),
        updatedAt: createdKnowledgeRecord.get('updatedAt')
      };
      
      // Process citations using the input 'knowledge' object
      const inputCitations = knowledge.citations;
      if (inputCitations && Array.isArray(inputCitations) && inputCitations.length > 0) {
        await this.addCitations(knowledgeId, inputCitations);
      }
      
      logger.info('Knowledge item created successfully', { 
        knowledgeId: createdKnowledge.id,
        projectId: knowledge.projectId
      });
      
      // Return the object matching the Neo4jKnowledge interface
      return createdKnowledge;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error creating knowledge item', { error: errorMessage, knowledgeInput: knowledge }); // Log input separately
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Link two knowledge items with a specified relationship type.
   * @param sourceId ID of the source knowledge item
   * @param targetId ID of the target knowledge item
   * @param relationshipType The type of relationship to create (e.g., 'RELATED_TO', 'IS_SUBTOPIC_OF') - Validation needed
   * @returns True if the link was created successfully, false otherwise
   */
  static async linkKnowledgeToKnowledge(sourceId: string, targetId: string, relationshipType: string): Promise<boolean> {
    // TODO: Validate relationshipType against allowed types or RelationshipTypes enum
    const session = await neo4jDriver.getSession();
    logger.debug(`Attempting to link knowledge ${sourceId} to ${targetId} with type ${relationshipType}`);

    try {
      const sourceExists = await Neo4jUtils.nodeExists(NodeLabels.Knowledge, 'id', sourceId);
      const targetExists = await Neo4jUtils.nodeExists(NodeLabels.Knowledge, 'id', targetId);

      if (!sourceExists || !targetExists) {
        logger.warning(`Cannot link knowledge: Source (${sourceId} exists: ${sourceExists}) or Target (${targetId} exists: ${targetExists}) not found.`);
        return false;
      }

      // Escape relationship type for safety
      const escapedType = `\`${relationshipType.replace(/`/g, '``')}\``;

      const query = `
        MATCH (source:${NodeLabels.Knowledge} {id: $sourceId})
        MATCH (target:${NodeLabels.Knowledge} {id: $targetId})
        MERGE (source)-[r:${escapedType}]->(target)
        RETURN r
      `;

      const result = await session.executeWrite(async (tx) => {
        const runResult = await tx.run(query, { sourceId, targetId });
        return runResult.records;
      });

      const linkCreated = result.length > 0;

      if (linkCreated) {
        logger.info(`Successfully linked knowledge ${sourceId} to ${targetId} with type ${relationshipType}`);
      } else {
        logger.warning(`Failed to link knowledge ${sourceId} to ${targetId} (MERGE returned no relationship)`);
      }

      return linkCreated;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error linking knowledge items', { error: errorMessage, sourceId, targetId, relationshipType });
      throw error;
    } finally {
      await session.close();
    }
  }


  /**
   * Get a knowledge item by ID, including its domain and citations via relationships.
   * @param id Knowledge ID
   * @returns The knowledge item with domain and citations added, or null if not found.
   */
  static async getKnowledgeById(id: string): Promise<(Neo4jKnowledge & { domain: string | null; citations: string[] }) | null> {
    const session = await neo4jDriver.getSession();
    
    try {
      // Fetch domain and citations via relationships
      const query = `
        MATCH (k:${NodeLabels.Knowledge} {id: $id})
        OPTIONAL MATCH (k)-[:${RelationshipTypes.BELONGS_TO_DOMAIN}]->(d:${NodeLabels.Domain})
        OPTIONAL MATCH (k)-[:${RelationshipTypes.CITES}]->(c:${NodeLabels.Citation})
        RETURN k.id as id,
               k.projectId as projectId,
               k.text as text,
               k.tags as tags,
               d.name as domainName, // Fetch domain name
               collect(DISTINCT c.source) as citationSources, // Collect distinct citation sources
               k.createdAt as createdAt,
               k.updatedAt as updatedAt
      `;
      
      const result = await session.executeRead(async (tx) => {
        const result = await tx.run(query, { id });
        return result.records;
      });
      
      if (result.length === 0) {
        return null;
      }
      const record = result[0];
      
      // Construct the base Neo4jKnowledge object
      const knowledge: Neo4jKnowledge = {
        id: record.get('id'),
        projectId: record.get('projectId'),
        text: record.get('text'),
        tags: record.get('tags') || [],
        createdAt: record.get('createdAt'),
        updatedAt: record.get('updatedAt')
      };
      
      // Add domain and citations fetched via relationships
      const domain = record.get('domainName');
      const citations = record.get('citationSources').filter((c: string | null): c is string => c !== null); // Filter nulls if no citations found

      return {
        ...knowledge,
        domain: domain, // Can be null if no domain relationship exists
        citations: citations
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error getting knowledge by ID', { error: errorMessage, id });
      throw error;
    } finally {
      await session.close();
    }
  }
  
  /**
   * Update a knowledge item, including domain and citation relationships.
   * @param id Knowledge ID
   * @param updates Updates including optional domain and citations
   * @returns The updated knowledge item (without domain/citations properties)
   */
  static async updateKnowledge(id: string, updates: Partial<Omit<Neo4jKnowledge, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>> & { domain?: string; citations?: string[] }): Promise<Neo4jKnowledge> {
    const session = await neo4jDriver.getSession();
    
    try {
      const exists = await Neo4jUtils.nodeExists(NodeLabels.Knowledge, 'id', id);
      if (!exists) {
        throw new Error(`Knowledge with ID ${id} not found`);
      }
      
      const updateParams: Record<string, any> = {
        id,
        updatedAt: Neo4jUtils.getCurrentTimestamp()
      };
      
      let setClauses = ['k.updatedAt = $updatedAt'];
      const allowedProperties: (keyof Neo4jKnowledge)[] = ['projectId', 'text', 'tags']; // Define properties that can be updated
      
      // Add update clauses for allowed properties defined in Neo4jKnowledge
      for (const [key, value] of Object.entries(updates)) {
        // Check if the key is one of the allowed properties and value is defined
        if (value !== undefined && allowedProperties.includes(key as keyof Neo4jKnowledge)) { 
          updateParams[key] = value;
          setClauses.push(`k.${key} = $${key}`);
        }
      }
      
      // Handle domain update using relationships
      let domainUpdateClause = '';
      const domainUpdateValue = updates.domain;
      if (domainUpdateValue) {
         if (typeof domainUpdateValue !== 'string' || domainUpdateValue.trim() === '') {
           throw new Error('Domain update value cannot be empty.');
         }
        updateParams.domain = domainUpdateValue;
        domainUpdateClause = `
          // Update domain relationship
          WITH k // Ensure k is in scope
          OPTIONAL MATCH (k)-[oldDomainRel:${RelationshipTypes.BELONGS_TO_DOMAIN}]->(:${NodeLabels.Domain})
          DELETE oldDomainRel
          MERGE (newDomain:${NodeLabels.Domain} {name: $domain})
          ON CREATE SET newDomain.createdAt = $updatedAt // Set timestamp if domain is new
          CREATE (k)-[:${RelationshipTypes.BELONGS_TO_DOMAIN}]->(newDomain)
        `;
      }
      
      // Construct the main update query
      const query = `
        MATCH (k:${NodeLabels.Knowledge} {id: $id})
        ${setClauses.length > 0 ? `SET ${setClauses.join(', ')}` : ''}
        ${domainUpdateClause} 
        // Return basic properties defined in Neo4jKnowledge
        RETURN k.id as id, k.projectId as projectId, k.text as text, k.tags as tags, k.createdAt as createdAt, k.updatedAt as updatedAt 
      `;
      
      const result = await session.executeWrite(async (tx) => {
        const result = await tx.run(query, updateParams);
        return result.records;
      });
      
      const updatedKnowledgeRecord = result[0];

      if (!updatedKnowledgeRecord) {
        throw new Error('Failed to update knowledge item or retrieve result');
      }

      // Update citations if provided in the input 'updates' object
      const inputCitations = updates.citations;
      if (inputCitations && Array.isArray(inputCitations)) {
        // Remove existing CITES relationships first
        await session.executeWrite(async (tx) => {
          await tx.run(`
            MATCH (k:${NodeLabels.Knowledge} {id: $id})-[r:${RelationshipTypes.CITES}]->(:${NodeLabels.Citation})
            DELETE r
          `, { id });
        });
        
        // Add new CITES relationships
        if (inputCitations.length > 0) {
          await this.addCitations(id, inputCitations);
        }
      }

      // Construct the final return object matching Neo4jKnowledge
      const finalUpdatedKnowledge: Neo4jKnowledge = {
         id: updatedKnowledgeRecord.get('id'),
         projectId: updatedKnowledgeRecord.get('projectId'),
         text: updatedKnowledgeRecord.get('text'),
         tags: updatedKnowledgeRecord.get('tags') || [],
         createdAt: updatedKnowledgeRecord.get('createdAt'),
         updatedAt: updatedKnowledgeRecord.get('updatedAt')
      };
      
      logger.info('Knowledge item updated successfully', { knowledgeId: id });
      return finalUpdatedKnowledge;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error updating knowledge item', { error: errorMessage, id, updates });
      throw error;
    } finally {
      await session.close();
    }
  }
  
  /**
   * Delete a knowledge item
   * @param id Knowledge ID
   * @returns True if deleted, false if not found
   */
  static async deleteKnowledge(id: string): Promise<boolean> {
    const session = await neo4jDriver.getSession();
    
    try {
      const exists = await Neo4jUtils.nodeExists(NodeLabels.Knowledge, 'id', id);
      if (!exists) {
        return false;
      }
      
      // Use DETACH DELETE to remove the node and all its relationships
      const query = `
        MATCH (k:${NodeLabels.Knowledge} {id: $id})
        DETACH DELETE k
      `;
      
      await session.executeWrite(async (tx) => {
        await tx.run(query, { id });
      });
      
      logger.info('Knowledge item deleted successfully', { knowledgeId: id });
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error deleting knowledge item', { error: errorMessage, id });
      throw error;
    } finally {
      await session.close();
    }
  }
  
  /**
   * Get knowledge items for a project with optional filtering and server-side pagination.
   * Returns domain and citations via relationships.
   * @param options Filter and pagination options
   * @returns Paginated list of knowledge items including domain and citations
   */
  static async getKnowledge(options: KnowledgeFilterOptions): Promise<PaginatedResult<Neo4jKnowledge & { domain: string | null; citations: string[] }>> {
    const session = await neo4jDriver.getSession();
    
    try {
      let conditions: string[] = []; 
      const params: Record<string, any> = {}; // Initialize empty params
      
      // Conditionally add projectId to params if it's not '*'
      if (options.projectId && options.projectId !== '*') {
        params.projectId = options.projectId;
      }
      
      let domainMatchClause = '';
      if (options.domain) {
        params.domain = options.domain;
        // Match the relationship for filtering
        domainMatchClause = `MATCH (k)-[:${RelationshipTypes.BELONGS_TO_DOMAIN}]->(d:${NodeLabels.Domain} {name: $domain})`;
      } else {
        // Optionally match domain to return it
        domainMatchClause = `OPTIONAL MATCH (k)-[:${RelationshipTypes.BELONGS_TO_DOMAIN}]->(d:${NodeLabels.Domain})`;
      }
      
      // Handle tags filtering
      if (options.tags && options.tags.length > 0) {
        const tagQuery = Neo4jUtils.generateArrayInListQuery('k', 'tags', 'tagsList', options.tags);
        if (tagQuery.cypher) {
          conditions.push(tagQuery.cypher);
          Object.assign(params, tagQuery.params);
        }
      }
      
      // Handle text search (using regex - consider full-text index later)
      if (options.search) {
        // Use case-insensitive regex
        params.search = `(?i).*${options.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*`; 
        conditions.push('k.text =~ $search');
      }
      
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      
      // Calculate pagination parameters
      const page = Math.max(options.page || 1, 1);
      const limit = Math.min(Math.max(options.limit || 20, 1), 100);
      const skip = (page - 1) * limit;
      
      // Add pagination params using neo4j.int
      params.skip = int(skip);
      params.limit = int(limit);

      // Construct the base MATCH clause conditionally
      const projectIdMatchFilter = (options.projectId && options.projectId !== '*') ? '{projectId: $projectId}' : '';
      const baseMatch = `MATCH (k:${NodeLabels.Knowledge} ${projectIdMatchFilter})`;

      // Query for total count matching filters
      const countQuery = `
        ${baseMatch} // Use conditional base match
        ${whereClause} // Apply filters to the knowledge node 'k' first
        WITH k // Pass the filtered knowledge nodes
        ${domainMatchClause} // Now match domain relationship if needed for filtering
        RETURN count(DISTINCT k) as total // Count distinct knowledge nodes
      `;

      // Query for paginated data
      const dataQuery = `
        ${baseMatch} // Use conditional base match
        ${whereClause} // Apply filters to the knowledge node 'k' first
        WITH k // Pass the filtered knowledge nodes
        ${domainMatchClause} // Match domain relationship
        OPTIONAL MATCH (k)-[:${RelationshipTypes.CITES}]->(c:${NodeLabels.Citation}) // Match citations
        WITH k, d, collect(DISTINCT c.source) as citationSources // Collect citations
        RETURN k.id as id,
               k.projectId as projectId,
               k.text as text,
               k.tags as tags,
               d.name as domainName, // Return domain name from relationship
               citationSources, // Return collected citations
               k.createdAt as createdAt,
               k.updatedAt as updatedAt
        ORDER BY k.createdAt DESC
        SKIP $skip 
        LIMIT $limit
      `;

      // Execute count query
      const totalResult = await session.executeRead(async (tx) => {
        // Need to remove skip/limit from params for count query
        const countParams = { ...params };
        delete countParams.skip;
        delete countParams.limit;
        const result = await tx.run(countQuery, countParams);
        // The driver seems to return a standard number for count(), use ?? 0 for safety
        return result.records[0]?.get('total') ?? 0; 
      });
      // totalResult is now the standard number returned by executeRead
      const total = totalResult; 

      // Execute data query
      const dataResult = await session.executeRead(async (tx) => {
        const result = await tx.run(dataQuery, params); // Use params with skip/limit
        return result.records;
      });
      
      // Map results including domain and citations
      const knowledgeItems = dataResult.map(record => {
        const baseKnowledge: Neo4jKnowledge = {
          id: record.get('id'),
          projectId: record.get('projectId'),
          text: record.get('text'),
          tags: record.get('tags') || [],
          createdAt: record.get('createdAt'),
          updatedAt: record.get('updatedAt')
        };
        const domain = record.get('domainName');
        const citations = record.get('citationSources').filter((c: string | null): c is string => c !== null);
        
        return {
          ...baseKnowledge,
          domain: domain,
          citations: citations
        };
      });

      // Return paginated result structure
      const totalPages = Math.ceil(total / limit);
      return {
        data: knowledgeItems,
        total,
        page,
        limit,
        totalPages
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error getting knowledge items', { error: errorMessage, options });
      throw error;
    } finally {
      await session.close();
    }
  }
  
  /**
   * Get all available domains with item counts
   * @returns Array of domains with counts
   */
  static async getDomains(): Promise<Array<{ name: string; count: number }>> {
    const session = await neo4jDriver.getSession();
    
    try {
      // This query correctly uses the relationship already
      const query = `
        MATCH (d:${NodeLabels.Domain})<-[:${RelationshipTypes.BELONGS_TO_DOMAIN}]-(k:${NodeLabels.Knowledge})
        RETURN d.name AS name, count(k) AS count
        ORDER BY count DESC, name
      `;
      
      const result = await session.executeRead(async (tx) => {
        const result = await tx.run(query);
        return result.records;
      });
      
      return result.map(record => ({
        name: record.get('name'),
        count: record.get('count').toNumber() // Convert Neo4j int
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error getting domains', { error: errorMessage });
      throw error;
    } finally {
      await session.close();
    }
  }
  
  /**
   * Get all unique tags used across knowledge items with counts
   * @param projectId Optional project ID to filter tags
   * @returns Array of tags with counts
   */
  static async getTags(projectId?: string): Promise<Array<{ tag: string; count: number }>> {
    const session = await neo4jDriver.getSession();
    
    try {
      let whereClause = '';
      const params: Record<string, any> = {};
      
      if (projectId) {
        whereClause = 'WHERE k.projectId = $projectId';
        params.projectId = projectId;
      }
      
      // This query is fine as it only reads the tags property
      const query = `
        MATCH (k:${NodeLabels.Knowledge})
        ${whereClause}
        UNWIND k.tags AS tag
        RETURN tag, count(*) AS count
        ORDER BY count DESC, tag
      `;
      
      const result = await session.executeRead(async (tx) => {
        const result = await tx.run(query, params);
        return result.records;
      });
      
      return result.map(record => ({
        tag: record.get('tag'),
        count: record.get('count').toNumber() // Convert Neo4j int
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error getting tags', { error: errorMessage, projectId });
      throw error;
    } finally {
      await session.close();
    }
  }
  
  /**
   * Add CITES relationships from a knowledge item to new Citation nodes.
   * @param knowledgeId Knowledge ID
   * @param citations Array of citation source strings
   * @returns The IDs of the created Citation nodes
   * @private
   */
  private static async addCitations(knowledgeId: string, citations: string[]): Promise<string[]> {
    if (!citations || citations.length === 0) {
      return [];
    }
    const session = await neo4jDriver.getSession();
    
    try {
      const citationData = citations.map(source => ({
        id: `cite_${generateId()}`,
        source: source,
        createdAt: Neo4jUtils.getCurrentTimestamp()
      }));
      
      const query = `
        MATCH (k:${NodeLabels.Knowledge} {id: $knowledgeId})
        UNWIND $citationData as citationProps
        CREATE (c:${NodeLabels.Citation})
        SET c = citationProps
        CREATE (k)-[:${RelationshipTypes.CITES}]->(c)
        RETURN c.id as citationId
      `;
      
      const result = await session.executeWrite(async (tx) => {
        const res = await tx.run(query, { knowledgeId, citationData });
        return res.records.map(r => r.get('citationId'));
      });
      
      logger.debug(`Added ${result.length} citations for knowledge ${knowledgeId}`);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error adding citations', { error: errorMessage, knowledgeId, citations });
      throw error;
    } finally {
      await session.close();
    }
  }
}
