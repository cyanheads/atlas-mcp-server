import { randomBytes, randomUUID as cryptoRandomUUID } from 'crypto'; // Import cryptoRandomUUID
import { BaseErrorCode, McpError } from '../../types/errors.js'; // Corrected path
// Import utils from the main barrel file (logger from ../internal/logger.js)
import { logger } from '../index.js';

/**
 * Interface for entity prefix configuration
 */
export interface EntityPrefixConfig {
  [key: string]: string;
}

/**
 * ID Generation Options
 */
export interface IdGenerationOptions {
  length?: number;
  separator?: string;
  charset?: string;
}

/**
 * Generic ID Generator class for creating and managing unique identifiers
 */
export class IdGenerator {
  // Default charset
  private static DEFAULT_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  // Default separator
  private static DEFAULT_SEPARATOR = '_';
  // Default random part length
  private static DEFAULT_LENGTH = 6;
  // Entity prefixes
  private entityPrefixes: EntityPrefixConfig = {};
  // Reverse mapping for prefix to entity type lookup
  private prefixToEntityType: Record<string, string> = {};

  /**
   * Constructor that accepts entity prefix configuration
   * @param entityPrefixes Map of entity types to their prefixes
   */
  constructor(entityPrefixes: EntityPrefixConfig = {}) {
    this.setEntityPrefixes(entityPrefixes);
  }

  /**
   * Set or update entity prefixes and rebuild the reverse lookup
   * @param entityPrefixes Map of entity types to their prefixes
   */
  public setEntityPrefixes(entityPrefixes: EntityPrefixConfig): void {
    this.entityPrefixes = { ...entityPrefixes };
    
    // Rebuild reverse mapping
    this.prefixToEntityType = Object.entries(this.entityPrefixes).reduce((acc, [type, prefix]) => {
      acc[prefix] = type;
      acc[prefix.toLowerCase()] = type;
      return acc;
    }, {} as Record<string, string>);
    
    // Removed logger call from setEntityPrefixes to prevent logging before initialization
  }

  /**
   * Get all registered entity prefixes
   * @returns The entity prefix configuration
   */
  public getEntityPrefixes(): EntityPrefixConfig {
    return { ...this.entityPrefixes };
  }

  /**
   * Generates a cryptographically secure random alphanumeric string
   * @param length The length of the random string to generate
   * @param charset Optional custom character set
   * @returns Random alphanumeric string
   */
  public generateRandomString(
    length: number = IdGenerator.DEFAULT_LENGTH,
    charset: string = IdGenerator.DEFAULT_CHARSET
  ): string {
    const bytes = randomBytes(length);
    let result = '';
    
    for (let i = 0; i < length; i++) {
      result += charset[bytes[i] % charset.length];
    }
    
    return result;
  }

  /**
   * Generates a unique ID with an optional prefix
   * @param prefix Optional prefix to add to the ID
   * @param options Optional generation options
   * @returns A unique identifier string
   */
  public generate(prefix?: string, options: IdGenerationOptions = {}): string {
    const {
      length = IdGenerator.DEFAULT_LENGTH,
      separator = IdGenerator.DEFAULT_SEPARATOR,
      charset = IdGenerator.DEFAULT_CHARSET
    } = options;
    
    const randomPart = this.generateRandomString(length, charset);
    
    return prefix 
      ? `${prefix}${separator}${randomPart}`
      : randomPart;
  }

  /**
   * Generates a custom ID for an entity with format PREFIX_XXXXXX
   * @param entityType The type of entity to generate an ID for
   * @param options Optional generation options
   * @returns A unique identifier string (e.g., "PROJ_A6B3J0")
   * @throws {McpError} If the entity type is not registered
   */
  public generateForEntity(entityType: string, options: IdGenerationOptions = {}): string {
    const prefix = this.entityPrefixes[entityType];
    
    if (!prefix) {
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        `Unknown entity type: ${entityType}`
      );
    }
    
    return this.generate(prefix, options);
  }

  /**
   * Validates if a given ID matches the expected format for an entity type
   * @param id The ID to validate
   * @param entityType The expected entity type
   * @param options Optional validation options
   * @returns boolean indicating if the ID is valid
   */
  public isValid(id: string, entityType: string, options: IdGenerationOptions = {}): boolean {
    const prefix = this.entityPrefixes[entityType];
    const { 
      length = IdGenerator.DEFAULT_LENGTH,
      separator = IdGenerator.DEFAULT_SEPARATOR
    } = options;
    
    if (!prefix) {
      return false;
    }
    
    const pattern = new RegExp(`^${prefix}${separator}[A-Z0-9]{${length}}$`);
    return pattern.test(id);
  }

  /**
   * Strips the prefix from an ID
   * @param id The ID to strip
   * @param separator Optional custom separator
   * @returns The ID without the prefix
   */
  public stripPrefix(id: string, separator: string = IdGenerator.DEFAULT_SEPARATOR): string {
    return id.split(separator)[1] || id;
  }

  /**
   * Determines the entity type from an ID
   * @param id The ID to get the entity type for
   * @param separator Optional custom separator
   * @returns The entity type
   * @throws {McpError} If the ID format is invalid or entity type is unknown
   */
  public getEntityType(id: string, separator: string = IdGenerator.DEFAULT_SEPARATOR): string {
    const parts = id.split(separator);
    if (parts.length !== 2 || !parts[0]) {
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        `Invalid ID format: ${id}. Expected format: PREFIX${separator}XXXXXX`
      );
    }

    const prefix = parts[0];
    const entityType = this.prefixToEntityType[prefix];
    
    if (!entityType) {
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        `Unknown entity type prefix: ${prefix}`
      );
    }

    return entityType;
  }

  /**
   * Normalizes an entity ID to ensure consistent uppercase format
   * @param id The ID to normalize
   * @param separator Optional custom separator
   * @returns The normalized ID in uppercase format
   */
  public normalize(id: string, separator: string = IdGenerator.DEFAULT_SEPARATOR): string {
    const entityType = this.getEntityType(id, separator);
    const idParts = id.split(separator);
    return `${this.entityPrefixes[entityType]}${separator}${idParts[1].toUpperCase()}`;
  }
}

// Create and export a default instance with an empty entity prefix configuration
export const idGenerator = new IdGenerator();

// For standalone use as a UUID generator
export const generateUUID = (): string => {
  return cryptoRandomUUID(); // Use imported cryptoRandomUUID
};
