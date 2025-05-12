import { Session, int } from 'neo4j-driver'; // Import int
import { logger } from '../../utils/index.js'; // Updated import path
import { neo4jDriver } from './driver.js';
import {
  NodeLabels,
  PaginatedResult,
  RelationshipTypes, // Import RelationshipTypes
  SearchOptions
} from './types.js';
import { Neo4jUtils } from './utils.js';

/**
 * Type for search result items - Made generic
 */
export type SearchResultItem = {
  id: string;
  type: string; // Node label
  entityType?: string; // Optional: Specific classification (e.g., taskType, domain)
  title: string; // Best guess title (name, title, truncated text)
  description?: string; // Optional: Full description or text
  matchedProperty: string;
  matchedValue: string; // Potentially truncated
  createdAt?: string; // Optional
  updatedAt?: string; // Optional
  projectId?: string; // Optional
  projectName?: string; // Optional
  score: number;
};

/**
 * Service for unified search functionality across all entity types
 */
export class SearchService {
  /**
   * Perform a unified search across multiple entity types (node labels).
   * Searches common properties like name, title, description, text.
   * Applies pagination after combining and sorting results from individual label searches.
   * @param options Search options
   * @returns Paginated search results
   */
  static async search(options: SearchOptions): Promise<PaginatedResult<SearchResultItem>> {
    
    try {
      const {
        property = '', 
        value,
        entityTypes = ['project', 'task', 'knowledge'], 
        caseInsensitive = true,
        fuzzy = false,
        taskType, 
        page = 1,
        limit = 20 // This limit will be applied *after* combining results
      } = options;
      
      if (!value || value.trim() === '') {
        throw new Error('Search value cannot be empty');
      }
      
      const targetLabels = Array.isArray(entityTypes) ? entityTypes : [entityTypes];
      if (targetLabels.length === 0) {
        logger.warning("Unified search called with empty entityTypes array. Returning empty results.");
        return Neo4jUtils.paginateResults([], { page, limit });
      }

      // Prepare search value once
      const normalizedProperty = property ? property.toLowerCase() : '';
      const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escape original value
      const caseFlag = caseInsensitive ? '(?i)' : ''; // Determine case flag based on input option

      // Prepare regex value for Cypher based on fuzzy flag
      const cypherSearchValue = fuzzy
          ? `${caseFlag}.*${escapedValue}.*` // Fuzzy contains (case flag applied)
          : `${caseFlag}^${escapedValue}$`;   // Non-fuzzy exact match (case flag applied)

      const allResults: SearchResultItem[] = [];
      const searchPromises: Promise<SearchResultItem[]>[] = [];

      // Define a reasonable upper bound for results fetched per label before final pagination
      // This prevents fetching *everything* but allows enough data for good sorting.
      const perLabelLimit = Math.max(limit * 2, 50); // Fetch more than the final limit per label

      for (const label of targetLabels) {
        if (!label || typeof label !== 'string') {
          logger.warning(`Skipping invalid label in entityTypes: ${label}`);
          continue;
        }
        
        // Call helper, passing the prepared cypherSearchValue and perLabelLimit
        searchPromises.push(
          this.searchSingleLabel(
            label, 
            cypherSearchValue, // Pass prepared value
            normalizedProperty, 
            // Pass taskType filter only if applicable
            (label.toLowerCase() === 'project' || label.toLowerCase() === 'task') ? taskType : undefined,
            perLabelLimit // Limit results per label search
          )
        );
      }
      
      const settledResults = await Promise.allSettled(searchPromises);
      
      settledResults.forEach((result, index) => {
        const label = targetLabels[index]; 
        if (result.status === 'fulfilled' && result.value && Array.isArray(result.value)) { 
          allResults.push(...result.value);
        } else if (result.status === 'rejected') {
          logger.error(`Search promise rejected for label "${label}":`, { reason: result.reason });
        } else if (result.status === 'fulfilled') {
           logger.warning(`Search promise fulfilled with non-array value for label "${label}":`, { value: result.value });
        }
      });
      
      // Sort combined results by score, then by date
      allResults.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const dateA = a.updatedAt || a.createdAt || '1970-01-01T00:00:00.000Z';
        const dateB = b.updatedAt || b.createdAt || '1970-01-01T00:00:00.000Z';
        return new Date(dateB).getTime() - new Date(dateA).getTime();
      });
      
      // Apply final pagination using the utility function on the combined & sorted results
      return Neo4jUtils.paginateResults(allResults, { page, limit });
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error performing unified search', { error: errorMessage, options });
      throw error; 
    } 
  }

  /**
   * Helper to search within a single node label with sorting and limit.
   * Acquires and closes its own session.
   * @private
   */
  private static async searchSingleLabel(
    labelInput: string, 
    cypherSearchValue: string, // Use pre-calculated regex/lucene value
    normalizedProperty: string,
    taskTypeFilter?: string,
    limit: number = 50 // Default limit per label search
  ): Promise<SearchResultItem[]> {
    let session: Session | null = null; 
    try {
      session = await neo4jDriver.getSession(); 

      let actualLabel: NodeLabels | undefined;
      switch (labelInput.toLowerCase()) {
        case 'project': actualLabel = NodeLabels.Project; break;
        case 'task': actualLabel = NodeLabels.Task; break;
        case 'knowledge': actualLabel = NodeLabels.Knowledge; break;
        default:
          logger.warning(`Unsupported label provided to searchSingleLabel: ${labelInput}`);
          return []; 
      }
      
      const correctlyEscapedLabel = `\`${actualLabel}\``;

      const params: Record<string, any> = {
        searchValue: cypherSearchValue, 
        label: actualLabel,
        limit: int(limit) // Use neo4j integer for limit
      };
      
      let whereConditions: string[] = [];
      
      if (taskTypeFilter) {
         whereConditions.push('n.taskType = $taskTypeFilter');
         params.taskTypeFilter = taskTypeFilter;
      }

      // Determine the property/properties to search
      let searchProperty: string | null = null;
      if (normalizedProperty) {
        searchProperty = normalizedProperty; // Use specified property
      } else {
        // Default property based on label if none specified
        switch (actualLabel) {
          case NodeLabels.Project: searchProperty = 'name'; break;
          case NodeLabels.Task: searchProperty = 'title'; break;
          case NodeLabels.Knowledge: searchProperty = 'text'; break;
        }
      }

      if (!searchProperty) {
         logger.warning(`Could not determine a default search property for label ${actualLabel}. Returning empty results.`);
         return [];
      }
      
      // Add the search condition for the determined property
      const propExistsCheck = `n.\`${searchProperty}\` IS NOT NULL`;
      let searchPart: string;
      
      // Special handling for array properties like 'tags'
      if (searchProperty === 'tags') {
        // For arrays, use ANY predicate for case-insensitive check.
        // Extract the original value for comparison.
        params.exactTagValueLower = params.searchValue.replace(/^\(\?i\)\.\*(.*)\.\*$/, '$1').toLowerCase(); // Ensure lowercase
        searchPart = `ANY(tag IN n.\`${searchProperty}\` WHERE toLower(tag) = $exactTagValueLower)`;
      } else {
        // For strings, use regex matching (already case-insensitive via (?i))
        searchPart = `n.\`${searchProperty}\` =~ $searchValue`; 
      }
      
      whereConditions.push(`(${propExistsCheck} AND ${searchPart})`);

      const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

      // Simplified Scoring based on the single search property - Remove toString()
      // Adjust scoring logic slightly for tags using ANY and toLower()
      const scoreValueParam = '$searchValue'; 
      const scoreExactTagValueLowerParam = '$exactTagValueLower'; // Use lowercase param name
      const scoringLogic = `
        CASE 
          WHEN n.\`${searchProperty}\` IS NOT NULL THEN
            CASE 
              WHEN '${searchProperty}' = 'tags' AND ANY(tag IN n.\`${searchProperty}\` WHERE toLower(tag) = ${scoreExactTagValueLowerParam}) THEN 8 // Case-insensitive tag match
              WHEN n.\`${searchProperty}\` =~ ${scoreValueParam} THEN 8 // Regex match for strings
              ELSE 5 
            END
          ELSE 5 
        END AS score
      `;
      
      // Simplified RETURN clause focusing on the searched property - Remove toString()
      const valueParam = '$searchValue'; // Re-declare for clarity in this scope
      const returnClause = `
        RETURN
          n.id AS id,
          $label AS type, 
          // Fetch domain via relationship for Knowledge nodes
          CASE $label WHEN '${NodeLabels.Knowledge}' THEN d.name ELSE COALESCE(n.taskType, '') END AS entityType, 
          COALESCE(n.name, n.title, CASE WHEN n.text IS NOT NULL AND size(toString(n.text)) > 50 THEN left(toString(n.text), 50) + '...' ELSE toString(n.text) END, n.id) AS title,
          COALESCE(n.description, n.text) AS description,
          '${searchProperty}' AS matchedProperty, // Directly use the searched property name
          CASE 
            WHEN n.\`${searchProperty}\` IS NOT NULL THEN
              CASE 
                // For tags, find and show the first matched tag (case-insensitive)
                WHEN '${searchProperty}' = 'tags' AND ANY(t IN n.\`${searchProperty}\` WHERE toLower(t) = ${scoreExactTagValueLowerParam}) THEN 
                  HEAD([tag IN n.\`${searchProperty}\` WHERE toLower(tag) = ${scoreExactTagValueLowerParam}]) // Get the actual matched tag
                // For strings, show truncated original value if matched by regex
                WHEN n.\`${searchProperty}\` =~ ${valueParam} THEN 
                  CASE 
                    WHEN size(toString(n.\`${searchProperty}\`)) > 100 THEN left(toString(n.\`${searchProperty}\`), 100) + '...' 
                    ELSE toString(n.\`${searchProperty}\`) // Ensure string conversion here for safety
                  END
                ELSE ''
              END
            ELSE '' 
          END AS matchedValue,
          n.createdAt AS createdAt,
          n.updatedAt AS updatedAt,
          // Use COALESCE for projectId as Knowledge nodes might not have it directly
          COALESCE(n.projectId, k_proj.id) AS projectId, 
          // Use COALESCE for projectName
          COALESCE(p.name, k_proj.name) AS projectName, 
          ${scoringLogic}
      `;

      // Add OPTIONAL MATCH for project and domain based on label
      let optionalMatches = `OPTIONAL MATCH (p:${NodeLabels.Project} {id: n.projectId})`; // For Task/Project
      if (actualLabel === NodeLabels.Knowledge) {
        // For Knowledge, match its project and domain
        optionalMatches = `
          OPTIONAL MATCH (k_proj:${NodeLabels.Project} {id: n.projectId}) 
          OPTIONAL MATCH (n)-[:${RelationshipTypes.BELONGS_TO_DOMAIN}]->(d:${NodeLabels.Domain}) 
        `;
      }

      // Construct final query with ORDER BY and LIMIT
      // Apply WHERE before OPTIONAL MATCH
      const query = `
        MATCH (n:${correctlyEscapedLabel}) 
        ${whereClause} // Apply primary filters first
        WITH n // Pass filtered nodes
        ${optionalMatches} // Now match optional related nodes
        ${returnClause} // Return results
        ORDER BY score DESC, COALESCE(n.updatedAt, n.createdAt) DESC
        LIMIT $limit 
      `;
      
      logger.debug(`Executing search query for label ${actualLabel}`, { query, params }); 
      const result = await session.executeRead(async (tx: any) => (await tx.run(query, params)).records);
      
      return result.map((record: any) => {
        const data = record.toObject();
        const scoreValue = data.score;
        const score = typeof scoreValue === 'number' ? scoreValue : 
                      (scoreValue && typeof scoreValue.toNumber === 'function' ? scoreValue.toNumber() : 5); 
        const description = typeof data.description === 'string' ? data.description : undefined;
        return { 
          ...data, 
          score,
          description,
          entityType: data.entityType || undefined,
          createdAt: data.createdAt || undefined,
          updatedAt: data.updatedAt || undefined,
          projectId: data.projectId || undefined,
          projectName: data.projectName || undefined,
         } as SearchResultItem;
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error searching label ${labelInput}`, { error: errorMessage, searchValue: cypherSearchValue, normalizedProperty }); 
      return []; 
    } finally {
       if (session) {
         await session.close(); 
       }
    }
  }
  
  // --- Full-text search method ---
  // This method still uses a different approach (CALL db.index...) and applies pagination at the end.
  // Optimizing this further for Community Edition might require separate count queries per index.
  // For now, leaving it as is, but acknowledging it fetches more data than necessary before pagination.
  
  /**
   * Perform a full-text search using Neo4j's built-in full-text search capabilities
   * Requires properly set up full-text indexes (project_fulltext, task_fulltext, knowledge_fulltext)
   * @param searchValue Value to search for (supports Lucene syntax)
   * @param options Search options
   * @returns Paginated search results
   */
  static async fullTextSearch(
    searchValue: string,
    options: Omit<SearchOptions, 'value' | 'fuzzy' | 'caseInsensitive'> = {}
  ): Promise<PaginatedResult<SearchResultItem>> {
    // Remove single session acquisition from here
    try {
      const {
        entityTypes = ['project', 'task', 'knowledge'],
        taskType, 
        page = 1,
        limit = 20
      } = options;
      
      if (!searchValue || searchValue.trim() === '') {
        throw new Error('Search value cannot be empty');
      }
      
      const rawEntityTypes = options.entityTypes; 
      const defaultEntityTypes = ['project', 'task', 'knowledge'];
      const typesToUse = rawEntityTypes && Array.isArray(rawEntityTypes) && rawEntityTypes.length > 0 
                         ? rawEntityTypes 
                         : defaultEntityTypes;
      const targetLabels = typesToUse.map(l => l.toLowerCase());

      const searchResults: SearchResultItem[] = [];
      // Remove searchPromises array

      // --- Run searches sequentially ---

      // Project full-text search
      if (targetLabels.includes('project')) {
        let projectSession: Session | null = null;
        try {
          projectSession = await neo4jDriver.getSession();
        const query = `
          CALL db.index.fulltext.queryNodes("project_fulltext", $searchValue) 
          YIELD node AS p, score
          ${taskType ? 'WHERE p.taskType = $taskType' : ''}
          RETURN 
            p.id AS id, 'project' AS type, p.taskType AS entityType,
            p.name AS title, p.description AS description,
            'full-text' AS matchedProperty, 
            CASE
              WHEN score > 2 THEN p.name 
              WHEN size(toString(p.description)) > 100 THEN left(toString(p.description), 100) + '...'
              ELSE toString(p.description)
            END AS matchedValue,
            p.createdAt AS createdAt, p.updatedAt AS updatedAt,
            p.id as projectId,
            p.name as projectName,
            score * 2 AS adjustedScore
        `;
        // Execute directly, not pushing to promise array
        // Use projectSession here
        await projectSession.executeRead(async (tx) => {
          const result = await tx.run(query, { searchValue, ...(taskType && { taskType }) });
          const items = result.records.map(record => {
            const data = record.toObject();
               const scoreValue = data.adjustedScore;
               const score = typeof scoreValue === 'number' ? scoreValue : 5;
               return { 
                 ...data, 
                 score,
                 description: typeof data.description === 'string' ? data.description : undefined,
                 entityType: data.entityType || undefined,
                 createdAt: data.createdAt || undefined,
                 updatedAt: data.updatedAt || undefined,
                 projectId: data.projectId || undefined, // Added projectId
                 projectName: data.projectName || undefined, // Added projectName
               } as SearchResultItem;
            });
            searchResults.push(...items);
          });
        } catch(err) {
           logger.error('Error during project full-text search query', { error: err, searchValue });
           // Optionally re-throw or just log and continue
        } finally {
          if (projectSession) await projectSession.close();
        }
      }

      // Task full-text search
      if (targetLabels.includes('task')) {
        let taskSession: Session | null = null;
        try {
          taskSession = await neo4jDriver.getSession();
        const query = `
          CALL db.index.fulltext.queryNodes("task_fulltext", $searchValue) 
          YIELD node AS t, score
          ${taskType ? 'WHERE t.taskType = $taskType' : ''}
          MATCH (p:${NodeLabels.Project} {id: t.projectId}) 
          RETURN 
            t.id AS id, 'task' AS type, t.taskType AS entityType,
            t.title AS title, t.description AS description,
            'full-text' AS matchedProperty,
            CASE
              WHEN score > 2 THEN t.title 
              WHEN size(toString(t.description)) > 100 THEN left(toString(t.description), 100) + '...'
              ELSE toString(t.description)
            END AS matchedValue,
            t.createdAt AS createdAt, t.updatedAt AS updatedAt,
            t.projectId AS projectId, p.name AS projectName, // Include project info
            score * 1.5 AS adjustedScore
        `;
        // Execute directly, use taskSession
        await taskSession.executeRead(async (tx) => {
          const result = await tx.run(query, { searchValue, ...(taskType && { taskType }) });
          const items = result.records.map(record => {
            const data = record.toObject();
               const scoreValue = data.adjustedScore;
               const score = typeof scoreValue === 'number' ? scoreValue : 5;
                return { 
                 ...data, 
                 score,
                 description: typeof data.description === 'string' ? data.description : undefined,
                 entityType: data.entityType || undefined,
                 createdAt: data.createdAt || undefined,
                 updatedAt: data.updatedAt || undefined,
                 projectId: data.projectId || undefined,
                 projectName: data.projectName || undefined,
               } as SearchResultItem;
            });
            searchResults.push(...items);
          });
        } catch(err) {
           logger.error('Error during task full-text search query', { error: err, searchValue });
        } finally {
          if (taskSession) await taskSession.close();
        }
      }

      // Knowledge full-text search
      if (targetLabels.includes('knowledge')) {
        let knowledgeSession: Session | null = null;
        try {
          knowledgeSession = await neo4jDriver.getSession();
        const query = `
          CALL db.index.fulltext.queryNodes("knowledge_fulltext", $searchValue) 
          YIELD node AS k, score
          // Match project for projectName and domain via relationship
          MATCH (p:${NodeLabels.Project} {id: k.projectId}) 
          OPTIONAL MATCH (k)-[:${RelationshipTypes.BELONGS_TO_DOMAIN}]->(d:${NodeLabels.Domain})
          RETURN 
            k.id AS id, 'knowledge' AS type, d.name AS entityType, // Use domain name
            CASE 
              WHEN k.text IS NULL THEN 'Untitled Knowledge'
              WHEN size(toString(k.text)) <= 50 THEN toString(k.text)
              ELSE substring(toString(k.text), 0, 50) + '...'
            END AS title,
            k.text AS description, 
            'text' AS matchedProperty, 
            CASE
              WHEN size(toString(k.text)) > 100 THEN left(toString(k.text), 100) + '...'
              ELSE toString(k.text)
            END AS matchedValue,
            k.createdAt AS createdAt, k.updatedAt AS updatedAt,
            k.projectId AS projectId, p.name AS projectName, // Include project info
            score AS adjustedScore
        `;
        // Execute directly, use knowledgeSession
        await knowledgeSession.executeRead(async (tx) => {
          const result = await tx.run(query, { searchValue });
          const items = result.records.map(record => {
            const data = record.toObject();
               const scoreValue = data.adjustedScore;
               const score = typeof scoreValue === 'number' ? scoreValue : 5;
                return { 
                 ...data, 
                 score,
                 description: typeof data.description === 'string' ? data.description : undefined,
                 entityType: data.entityType || undefined, // Domain name
                 createdAt: data.createdAt || undefined,
                 updatedAt: data.updatedAt || undefined,
                 projectId: data.projectId || undefined,
                 projectName: data.projectName || undefined,
               } as SearchResultItem;
            });
            searchResults.push(...items);
          });
        } catch(err) {
           logger.error('Error during knowledge full-text search query', { error: err, searchValue });
        } finally {
          if (knowledgeSession) await knowledgeSession.close();
        }
      }

      // Remove Promise.all
      // await Promise.all(searchPromises); // No longer needed

      searchResults.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const dateA = a.updatedAt || a.createdAt || '1970-01-01T00:00:00.000Z';
        const dateB = b.updatedAt || b.createdAt || '1970-01-01T00:00:00.000Z';
        return new Date(dateB).getTime() - new Date(dateA).getTime();
      });
      
      // Apply final pagination after combining and sorting
      return Neo4jUtils.paginateResults(searchResults, { page, limit });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error performing full-text search', { error: errorMessage, searchValue, options });
      if (errorMessage.includes("Unable to find index")) {
         logger.warning("Full-text index might not be configured correctly or supported in this Neo4j version.");
         throw new Error(`Full-text search failed: Index not found or query error. (${errorMessage})`);
      }
      throw error;
    } // Remove finally block that closes the single session
  }
}
