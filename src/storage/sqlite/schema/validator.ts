/**
 * Database schema validation system
 */
import { Database } from 'sqlite';
import { Logger } from '../../../logging/index.js';
import { ErrorCodes, createError } from '../../../errors/index.js';

export interface ColumnDefinition {
  name: string;
  type: string;
  nullable?: boolean;
  defaultValue?: any;
  primaryKey?: boolean;
  unique?: boolean;
  references?: {
    table: string;
    column: string;
  };
}

export interface TableDefinition {
  name: string;
  columns: ColumnDefinition[];
  indexes?: {
    name: string;
    columns: string[];
    unique?: boolean;
  }[];
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export class SchemaValidator {
  private readonly logger: Logger;
  private readonly schema: Map<string, TableDefinition>;

  constructor() {
    this.logger = Logger.getInstance().child({ component: 'SchemaValidator' });
    this.schema = new Map();
  }

  /**
   * Register a table schema
   */
  registerTable(table: TableDefinition): void {
    if (this.schema.has(table.name)) {
      throw createError(
        ErrorCodes.STORAGE_ERROR,
        'Duplicate table definition',
        `Table ${table.name} is already registered`
      );
    }

    this.schema.set(table.name, table);
    this.logger.debug('Registered table schema', { table: table.name });
  }

  /**
   * Validate database schema
   */
  async validateSchema(db: Database): Promise<ValidationResult> {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
    };

    try {
      // Get actual database schema
      const tables = await this.getDatabaseSchema(db);

      // Check each registered table
      for (const [tableName, definition] of this.schema.entries()) {
        const actualTable = tables.get(tableName);

        if (!actualTable) {
          result.errors.push(`Missing table: ${tableName}`);
          result.isValid = false;
          continue;
        }

        // Validate columns
        for (const column of definition.columns) {
          const actualColumn = actualTable.columns.find(c => c.name === column.name);

          if (!actualColumn) {
            result.errors.push(`Missing column: ${tableName}.${column.name}`);
            result.isValid = false;
            continue;
          }

          // Check column type
          if (!this.isCompatibleType(actualColumn.type, column.type)) {
            result.errors.push(
              `Type mismatch for ${tableName}.${column.name}: ` +
                `expected ${column.type}, got ${actualColumn.type}`
            );
            result.isValid = false;
          }

          // Check constraints
          if (column.primaryKey && !actualColumn.primaryKey) {
            result.errors.push(`Missing primary key constraint on ${tableName}.${column.name}`);
            result.isValid = false;
          }

          if (column.unique && !actualColumn.unique) {
            result.warnings.push(`Missing unique constraint on ${tableName}.${column.name}`);
          }

          if (column.references) {
            const hasReference = await this.validateForeignKey(
              db,
              tableName,
              column.name,
              column.references
            );
            if (!hasReference) {
              result.errors.push(
                `Missing foreign key constraint on ${tableName}.${column.name} ` +
                  `referencing ${column.references.table}.${column.references.column}`
              );
              result.isValid = false;
            }
          }
        }

        // Validate indexes
        if (definition.indexes) {
          for (const index of definition.indexes) {
            const hasIndex = await this.validateIndex(db, tableName, index);
            if (!hasIndex) {
              result.warnings.push(
                `Missing index ${index.name} on ${tableName}(${index.columns.join(', ')})`
              );
            }
          }
        }
      }

      // Check for extra tables
      for (const tableName of tables.keys()) {
        if (!this.schema.has(tableName) && !tableName.startsWith('sqlite_')) {
          result.warnings.push(`Extra table found: ${tableName}`);
        }
      }

      this.logger.info('Schema validation completed', {
        isValid: result.isValid,
        errorCount: result.errors.length,
        warningCount: result.warnings.length,
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Schema validation failed', { error: errorMessage });
      throw createError(ErrorCodes.STORAGE_ERROR, 'Schema validation failed', errorMessage);
    }
  }

  /**
   * Get actual database schema
   */
  private async getDatabaseSchema(db: Database): Promise<
    Map<
      string,
      {
        name: string;
        columns: {
          name: string;
          type: string;
          primaryKey: boolean;
          unique: boolean;
        }[];
      }
    >
  > {
    const schema = new Map();

    // Get tables
    const tables = await db.all(`
            SELECT name FROM sqlite_master 
            WHERE type = 'table' 
            AND name NOT LIKE 'sqlite_%'
        `);

    for (const { name } of tables) {
      // Get table info
      const columns = await db.all(`PRAGMA table_info(${name})`);

      schema.set(name, {
        name,
        columns: columns.map(col => ({
          name: col.name,
          type: col.type.toUpperCase(),
          primaryKey: Boolean(col.pk),
          unique: Boolean(col.pk), // SQLite primary keys are unique
        })),
      });
    }

    return schema;
  }

  /**
   * Check if two SQLite types are compatible
   */
  private isCompatibleType(actual: string, expected: string): boolean {
    // Normalize types
    actual = actual.toUpperCase();
    expected = expected.toUpperCase();

    // Direct match
    if (actual === expected) return true;

    // SQLite type affinities
    const textTypes = ['TEXT', 'CLOB', 'CHAR', 'VARCHAR'];
    const numericTypes = ['INTEGER', 'INT', 'NUMERIC', 'DECIMAL', 'BOOLEAN', 'DATE', 'DATETIME'];
    const realTypes = ['REAL', 'DOUBLE', 'FLOAT'];
    const blobTypes = ['BLOB'];

    // Check type affinity compatibility
    if (textTypes.includes(actual) && textTypes.includes(expected)) return true;
    if (numericTypes.includes(actual) && numericTypes.includes(expected)) return true;
    if (realTypes.includes(actual) && realTypes.includes(expected)) return true;
    if (blobTypes.includes(actual) && blobTypes.includes(expected)) return true;

    return false;
  }

  /**
   * Validate foreign key constraint
   */
  private async validateForeignKey(
    db: Database,
    table: string,
    column: string,
    reference: { table: string; column: string }
  ): Promise<boolean> {
    const foreignKeys = await db.all(`PRAGMA foreign_key_list(${table})`);
    return foreignKeys.some(
      fk => fk.from === column && fk.table === reference.table && fk.to === reference.column
    );
  }

  /**
   * Validate index
   */
  private async validateIndex(
    db: Database,
    table: string,
    index: { name: string; columns: string[]; unique?: boolean }
  ): Promise<boolean> {
    const indexes = await db.all(`PRAGMA index_list(${table})`);
    const indexInfo = indexes.find(idx => idx.name === index.name);

    if (!indexInfo) return false;

    // Check if unique constraint matches
    if (index.unique && !indexInfo.unique) return false;

    // Check index columns
    const columns = await db.all(`PRAGMA index_info(${index.name})`);
    const indexColumns = columns.map(col => col.name);

    return index.columns.every(col => indexColumns.includes(col));
  }

  /**
   * Create a table definition
   */
  static createTableDefinition(
    name: string,
    columns: ColumnDefinition[],
    indexes?: {
      name: string;
      columns: string[];
      unique?: boolean;
    }[]
  ): TableDefinition {
    return { name, columns, indexes };
  }

  /**
   * Create a column definition
   */
  static createColumnDefinition(
    name: string,
    type: string,
    options: {
      nullable?: boolean;
      defaultValue?: any;
      primaryKey?: boolean;
      unique?: boolean;
      references?: {
        table: string;
        column: string;
      };
    } = {}
  ): ColumnDefinition {
    return { name, type, ...options };
  }
}
