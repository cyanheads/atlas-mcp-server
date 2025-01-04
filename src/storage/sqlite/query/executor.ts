/**
 * SQL query executor with caching and performance monitoring
 */
import { Logger } from '../../../logging/index.js';
import { ErrorCodes, createError } from '../../../errors/index.js';
import { QueryBuilder } from './builder.js';
import { ConnectionPool } from '../connection/pool.js';

interface QueryMetrics {
  queryCount: number;
  totalTime: number;
  avgTime: number;
  slowQueries: number;
  errors: number;
  cacheHits: number;
  cacheMisses: number;
}

interface QueryCacheEntry {
  result: any;
  timestamp: number;
  hits: number;
}

interface QueryCacheOptions {
  ttl?: number;
  key?: string;
}

export class QueryExecutor {
  private readonly logger: Logger;
  private readonly pool: ConnectionPool;
  private readonly queryCache: Map<string, QueryCacheEntry>;
  private readonly metrics: QueryMetrics;
  private readonly slowQueryThreshold: number;
  private readonly maxCacheSize: number;
  private readonly defaultCacheTTL: number;

  constructor(
    pool: ConnectionPool,
    options: {
      slowQueryThreshold?: number;
      maxCacheSize?: number;
      defaultCacheTTL?: number;
    } = {}
  ) {
    this.logger = Logger.getInstance().child({ component: 'QueryExecutor' });
    this.pool = pool;
    this.queryCache = new Map();
    this.metrics = {
      queryCount: 0,
      totalTime: 0,
      avgTime: 0,
      slowQueries: 0,
      errors: 0,
      cacheHits: 0,
      cacheMisses: 0,
    };
    this.slowQueryThreshold = options.slowQueryThreshold || 100; // 100ms
    this.maxCacheSize = options.maxCacheSize || 1000;
    this.defaultCacheTTL = options.defaultCacheTTL || 60000; // 1 minute
  }

  /**
   * Execute a query with optional caching
   */
  async execute<T>(
    query: QueryBuilder | { sql: string; values: any[] },
    cache?: QueryCacheOptions
  ): Promise<T> {
    const { sql, values } = query instanceof QueryBuilder ? query.build() : query;
    const startTime = Date.now();
    const cacheKey = this.getCacheKey(sql, values, cache?.key);

    try {
      // Check cache first if enabled
      if (cache) {
        const cached = this.queryCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < (cache.ttl || this.defaultCacheTTL)) {
          cached.hits++;
          this.metrics.cacheHits++;
          return cached.result;
        }
        this.metrics.cacheMisses++;
      }

      // Get connection from pool
      const db = await this.pool.getConnection();

      try {
        // Execute query
        const result = await db.all(sql, ...values);

        // Update metrics
        const duration = Date.now() - startTime;
        this.updateMetrics(duration);

        // Log slow queries
        if (duration > this.slowQueryThreshold) {
          this.logger.warn('Slow query detected', {
            sql,
            values,
            duration,
            threshold: this.slowQueryThreshold,
          });
        }

        // Cache result if enabled
        if (cache) {
          this.cacheResult(cacheKey, result);
        }

        // Type assertion since we know the shape matches T
        return result as unknown as T;
      } finally {
        // Always release connection back to pool
        this.pool.releaseConnection(db);
      }
    } catch (error) {
      this.metrics.errors++;
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Query execution failed', {
        sql,
        values,
        error: errorMessage,
        duration: Date.now() - startTime,
      });
      throw createError(ErrorCodes.STORAGE_ERROR, 'Query execution failed', errorMessage);
    }
  }

  /**
   * Execute a query that returns a single row
   */
  async get<T>(
    query: QueryBuilder | { sql: string; values: any[] },
    cache?: QueryCacheOptions
  ): Promise<T | null> {
    const result = await this.execute<T[]>(query, cache);
    return result[0] || null;
  }

  /**
   * Execute a write query (INSERT, UPDATE, DELETE)
   */
  async run(query: QueryBuilder | { sql: string; values: any[] }): Promise<void> {
    const { sql, values } = query instanceof QueryBuilder ? query.build() : query;
    const startTime = Date.now();

    try {
      const db = await this.pool.getConnection();

      try {
        await db.run(sql, ...values);

        // Update metrics
        const duration = Date.now() - startTime;
        this.updateMetrics(duration);

        // Log slow queries
        if (duration > this.slowQueryThreshold) {
          this.logger.warn('Slow write query detected', {
            sql,
            values,
            duration,
            threshold: this.slowQueryThreshold,
          });
        }
      } finally {
        this.pool.releaseConnection(db);
      }
    } catch (error) {
      this.metrics.errors++;
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Write query failed', {
        sql,
        values,
        error: errorMessage,
        duration: Date.now() - startTime,
      });
      throw createError(ErrorCodes.STORAGE_ERROR, 'Write query failed', errorMessage);
    }
  }

  /**
   * Execute multiple queries in a transaction
   */
  async transaction<T>(callback: (executor: QueryExecutor) => Promise<T>): Promise<T> {
    const db = await this.pool.getConnection();

    try {
      await db.run('BEGIN IMMEDIATE');
      const result = await callback(this);
      await db.run('COMMIT');
      return result;
    } catch (error) {
      try {
        await db.run('ROLLBACK');
      } catch (rollbackError) {
        this.logger.error('Failed to rollback transaction', {
          error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
          originalError: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    } finally {
      this.pool.releaseConnection(db);
    }
  }

  /**
   * Get query execution metrics
   */
  getMetrics(): QueryMetrics {
    return { ...this.metrics };
  }

  /**
   * Clear query cache
   */
  clearCache(): void {
    this.queryCache.clear();
    this.logger.debug('Query cache cleared');
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    Object.assign(this.metrics, {
      queryCount: 0,
      totalTime: 0,
      avgTime: 0,
      slowQueries: 0,
      errors: 0,
      cacheHits: 0,
      cacheMisses: 0,
    });
    this.logger.debug('Query metrics reset');
  }

  private updateMetrics(duration: number): void {
    this.metrics.queryCount++;
    this.metrics.totalTime += duration;
    this.metrics.avgTime = this.metrics.totalTime / this.metrics.queryCount;
    if (duration > this.slowQueryThreshold) {
      this.metrics.slowQueries++;
    }
  }

  private getCacheKey(sql: string, values: any[], key?: string): string {
    return key || `${sql}:${JSON.stringify(values)}`;
  }

  private cacheResult(key: string, result: any): void {
    // Evict oldest entry if cache is full
    if (this.queryCache.size >= this.maxCacheSize) {
      let oldestKey = '';
      let oldestTime = Date.now();

      for (const [k, entry] of this.queryCache.entries()) {
        if (entry.timestamp < oldestTime) {
          oldestTime = entry.timestamp;
          oldestKey = k;
        }
      }

      if (oldestKey) {
        this.queryCache.delete(oldestKey);
      }
    }

    // Add new entry
    this.queryCache.set(key, {
      result,
      timestamp: Date.now(),
      hits: 1,
    });
  }
}
