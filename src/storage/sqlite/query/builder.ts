/**
 * Type-safe SQL query builder
 */
import { Logger } from '../../../logging/index.js';

type SqlValue = string | number | boolean | null | undefined;
type SqlValues = Record<string, SqlValue>;

interface QueryPart {
  sql: string;
  values: SqlValue[];
}

export class QueryBuilder {
  private parts: QueryPart[] = [];
  private readonly logger: Logger;

  constructor() {
    this.logger = Logger.getInstance().child({ component: 'QueryBuilder' });
  }

  /**
   * Start SELECT query
   */
  select(columns: string | string[] = '*'): this {
    const cols = Array.isArray(columns) ? columns.join(', ') : columns;
    this.parts.push({
      sql: `SELECT ${cols}`,
      values: [],
    });
    return this;
  }

  /**
   * Add FROM clause
   */
  from(table: string): this {
    this.parts.push({
      sql: `FROM ${table}`,
      values: [],
    });
    return this;
  }

  /**
   * Add WHERE clause with parameterized values
   */
  where(conditions: SqlValues): this {
    const entries = Object.entries(conditions).filter(([_, value]) => value !== undefined);
    if (entries.length === 0) return this;

    const clauses = entries.map(([key]) => `${key} = ?`);
    const values = entries.map(([_, value]) => value);

    this.parts.push({
      sql: `WHERE ${clauses.join(' AND ')}`,
      values,
    });
    return this;
  }

  /**
   * Add raw WHERE clause
   */
  whereRaw(sql: string, values: SqlValue[] = []): this {
    this.parts.push({
      sql: `WHERE ${sql}`,
      values,
    });
    return this;
  }

  /**
   * Add ORDER BY clause
   */
  orderBy(column: string, direction: 'ASC' | 'DESC' = 'ASC'): this {
    this.parts.push({
      sql: `ORDER BY ${column} ${direction}`,
      values: [],
    });
    return this;
  }

  /**
   * Add LIMIT clause
   */
  limit(limit: number): this {
    this.parts.push({
      sql: 'LIMIT ?',
      values: [limit],
    });
    return this;
  }

  /**
   * Add OFFSET clause
   */
  offset(offset: number): this {
    this.parts.push({
      sql: 'OFFSET ?',
      values: [offset],
    });
    return this;
  }

  /**
   * Start INSERT query
   */
  insertInto(table: string, data: SqlValues): this {
    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = Array(values.length).fill('?').join(', ');

    this.parts.push({
      sql: `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
      values,
    });
    return this;
  }

  /**
   * Start UPDATE query
   */
  update(table: string, data: SqlValues): this {
    const entries = Object.entries(data).filter(([_, value]) => value !== undefined);
    const setClause = entries.map(([key]) => `${key} = ?`).join(', ');
    const values = entries.map(([_, value]) => value);

    this.parts.push({
      sql: `UPDATE ${table} SET ${setClause}`,
      values,
    });
    return this;
  }

  /**
   * Start DELETE query
   */
  deleteFrom(table: string): this {
    this.parts.push({
      sql: `DELETE FROM ${table}`,
      values: [],
    });
    return this;
  }

  /**
   * Add JOIN clause
   */
  join(table: string, condition: string): this {
    this.parts.push({
      sql: `JOIN ${table} ON ${condition}`,
      values: [],
    });
    return this;
  }

  /**
   * Add LEFT JOIN clause
   */
  leftJoin(table: string, condition: string): this {
    this.parts.push({
      sql: `LEFT JOIN ${table} ON ${condition}`,
      values: [],
    });
    return this;
  }

  /**
   * Add GROUP BY clause
   */
  groupBy(columns: string | string[]): this {
    const cols = Array.isArray(columns) ? columns.join(', ') : columns;
    this.parts.push({
      sql: `GROUP BY ${cols}`,
      values: [],
    });
    return this;
  }

  /**
   * Add HAVING clause
   */
  having(conditions: SqlValues): this {
    const entries = Object.entries(conditions).filter(([_, value]) => value !== undefined);
    if (entries.length === 0) return this;

    const clauses = entries.map(([key]) => `${key} = ?`);
    const values = entries.map(([_, value]) => value);

    this.parts.push({
      sql: `HAVING ${clauses.join(' AND ')}`,
      values,
    });
    return this;
  }

  /**
   * Build the final query
   */
  build(): { sql: string; values: SqlValue[] } {
    const sql = this.parts.map(p => p.sql).join(' ');
    const values = this.parts.flatMap(p => p.values);

    this.logger.debug('Built query', { sql, values });

    return { sql, values };
  }

  /**
   * Reset the builder
   */
  reset(): this {
    this.parts = [];
    return this;
  }

  /**
   * Create a new builder instance
   */
  static create(): QueryBuilder {
    return new QueryBuilder();
  }
}
