/**
 * SQL query optimizer for better performance
 */
import { Logger } from '../../../logging/index.js';
import { ErrorCodes, createError } from '../../../errors/index.js';
import { Database } from 'sqlite';

interface QueryPlan {
  details: string[];
  cost: number;
  rows: number;
  indexes: string[];
}

interface OptimizationSuggestion {
  type: 'index' | 'rewrite' | 'schema';
  description: string;
  impact: 'high' | 'medium' | 'low';
  suggestion: string;
}

export class QueryOptimizer {
  private readonly logger: Logger;
  private readonly costThreshold: number;
  private readonly indexStats: Map<
    string,
    {
      usage: number;
      lastUsed: number;
    }
  >;

  constructor(
    options: {
      costThreshold?: number;
    } = {}
  ) {
    this.logger = Logger.getInstance().child({ component: 'QueryOptimizer' });
    this.costThreshold = options.costThreshold || 1000;
    this.indexStats = new Map();
  }

  /**
   * Analyze a query and get its execution plan
   */
  async analyzeQuery(db: Database, sql: string, values: any[] = []): Promise<QueryPlan> {
    try {
      // Get query plan
      const plan = await db.all(`EXPLAIN QUERY PLAN ${sql}`, ...values);

      // Parse plan details
      const details = plan.map(row => row.detail);
      const indexes = this.extractIndexes(details);

      // Estimate cost and rows
      const cost = this.estimateCost(details);
      const rows = this.estimateRows(details);

      // Update index usage stats
      this.updateIndexStats(indexes);

      return { details, cost, rows, indexes };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to analyze query', {
        sql,
        values,
        error: errorMessage,
      });
      throw createError(ErrorCodes.STORAGE_ERROR, 'Failed to analyze query', errorMessage);
    }
  }

  /**
   * Get optimization suggestions for a query
   */
  async optimizeQuery(
    db: Database,
    sql: string,
    values: any[] = []
  ): Promise<OptimizationSuggestion[]> {
    const suggestions: OptimizationSuggestion[] = [];
    const plan = await this.analyzeQuery(db, sql, values);

    // Check if query cost is above threshold
    if (plan.cost > this.costThreshold) {
      // Check for missing indexes
      const missingIndexes = this.findMissingIndexes(plan.details);
      if (missingIndexes.length > 0) {
        suggestions.push({
          type: 'index',
          description: 'Missing indexes detected',
          impact: 'high',
          suggestion: `Consider adding indexes for: ${missingIndexes.join(', ')}`,
        });
      }

      // Check for table scans
      if (this.hasTableScan(plan.details)) {
        suggestions.push({
          type: 'rewrite',
          description: 'Full table scan detected',
          impact: 'high',
          suggestion: 'Add WHERE clause or index to avoid table scan',
        });
      }

      // Check for suboptimal joins
      if (this.hasSuboptimalJoin(plan.details)) {
        suggestions.push({
          type: 'rewrite',
          description: 'Suboptimal join detected',
          impact: 'medium',
          suggestion: 'Consider rewriting join or adding index on join columns',
        });
      }
    }

    // Check for unused indexes
    const unusedIndexes = await this.findUnusedIndexes(db);
    if (unusedIndexes.length > 0) {
      suggestions.push({
        type: 'schema',
        description: 'Unused indexes detected',
        impact: 'low',
        suggestion: `Consider removing unused indexes: ${unusedIndexes.join(', ')}`,
      });
    }

    return suggestions;
  }

  /**
   * Get index usage statistics
   */
  getIndexStats() {
    return new Map(this.indexStats);
  }

  /**
   * Reset index usage statistics
   */
  resetIndexStats(): void {
    this.indexStats.clear();
  }

  private extractIndexes(details: string[]): string[] {
    const indexes: string[] = [];
    for (const detail of details) {
      const match = detail.match(/USING (?:INDEX|COVERING INDEX) (\w+)/i);
      if (match) {
        indexes.push(match[1]);
      }
    }
    return indexes;
  }

  private estimateCost(details: string[]): number {
    let cost = 0;
    for (const detail of details) {
      // Estimate cost based on operations
      if (detail.includes('SCAN')) cost += 100;
      if (detail.includes('SEARCH')) cost += 10;
      if (detail.includes('TEMP')) cost += 50;
      if (detail.includes('SORT')) cost += 30;
    }
    return cost;
  }

  private estimateRows(details: string[]): number {
    let maxRows = 0;
    for (const detail of details) {
      const match = detail.match(/~(\d+) rows/);
      if (match) {
        maxRows = Math.max(maxRows, parseInt(match[1], 10));
      }
    }
    return maxRows;
  }

  private updateIndexStats(indexes: string[]): void {
    const now = Date.now();
    for (const index of indexes) {
      const stats = this.indexStats.get(index) || { usage: 0, lastUsed: now };
      stats.usage++;
      stats.lastUsed = now;
      this.indexStats.set(index, stats);
    }
  }

  private findMissingIndexes(details: string[]): string[] {
    const missing: string[] = [];
    for (const detail of details) {
      // Look for operations that could benefit from an index
      if (detail.includes('SCAN') && !detail.includes('COVERING INDEX')) {
        const match = detail.match(/ON (\w+)/);
        if (match) {
          const table = match[1];
          const cols = this.extractFilterColumns(detail);
          if (cols.length > 0) {
            missing.push(`${table}(${cols.join(', ')})`);
          }
        }
      }
    }
    return missing;
  }

  private extractFilterColumns(detail: string): string[] {
    const cols: string[] = [];
    // Extract columns from WHERE/JOIN conditions
    const matches = detail.match(/(?:WHERE|ON|USING|ORDER BY) (\w+)/g);
    if (matches) {
      for (const match of matches) {
        const col = match.split(' ')[1];
        if (col && !cols.includes(col)) {
          cols.push(col);
        }
      }
    }
    return cols;
  }

  private hasTableScan(details: string[]): boolean {
    return details.some(
      d => d.includes('SCAN') && !d.includes('INDEX') && !d.includes('PRIMARY KEY')
    );
  }

  private hasSuboptimalJoin(details: string[]): boolean {
    return details.some(
      d => d.includes('NESTED LOOP') || (d.includes('JOIN') && !d.includes('USING INDEX'))
    );
  }

  private async findUnusedIndexes(db: Database): Promise<string[]> {
    const unused: string[] = [];

    // Get all indexes
    const indexes = await db.all(`
            SELECT name FROM sqlite_master 
            WHERE type = 'index' 
            AND sql IS NOT NULL
        `);

    const now = Date.now();
    const threshold = 7 * 24 * 60 * 60 * 1000; // 7 days

    for (const { name } of indexes) {
      const stats = this.indexStats.get(name);
      if (!stats || stats.usage === 0 || (now - stats.lastUsed > threshold && stats.usage < 10)) {
        unused.push(name);
      }
    }

    return unused;
  }
}
