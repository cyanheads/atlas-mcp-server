/**
 * @file requestContext.ts
 * @description Utilities for creating and managing request contexts.
 * A request context is an object carrying a unique ID, timestamp, and other
 * relevant data for logging, tracing, and processing.
 */

import { logger } from './logger.js';
// Import utils from the main barrel file (generateUUID from ../security/idGenerator.js)
import { generateUUID } from '../index.js';
// Removed incorrect import: import { RequestContext } from './rateLimiter.js';

/**
 * Defines the structure for context information associated with a request or operation.
 */
export interface RequestContext {
  /** 
   * Unique ID for the context instance. 
   * Used for log correlation and request tracing.
   */
  requestId: string;

  /** 
   * ISO 8601 timestamp indicating when the context was created.
   */
  timestamp: string;

  /** 
   * Allows arbitrary key-value pairs for specific context needs.
   * Using `unknown` promotes type-safe access.
   * Consumers must type-check/assert when accessing extended properties.
   */
  [key: string]: unknown;
}

/**
 * Configuration interface for the request context service.
 * Extensible for future configuration.
 * Placeholder for potential service-wide settings.
 */
export interface ContextConfig {
  /** Custom configuration properties. Allows for arbitrary key-value pairs. */
  [key: string]: unknown;
}

/**
 * Represents a broader operation context, optionally including
 * a `RequestContext` and custom properties.
 * Often used to pass contextual information for an operation or task.
 */
export interface OperationContext {
  /** Optional request context data, adhering to the `RequestContext` structure. */
  requestContext?: RequestContext;

  /** Allows for additional, custom properties specific to the operation. */
  [key: string]: unknown;
}

/**
 * Service instance for managing request context operations.
 * Singleton-like object to configure the service and create contexts.
 */
const requestContextServiceInstance = {
  /**
   * Internal configuration store.
   * Initialized empty, updatable via `configure`.
   */
  config: {} as ContextConfig,

  /**
   * Configures the service with new settings, merging with existing config.
   *
   * @param config - A partial `ContextConfig` object containing settings to update.
   * @returns A shallow copy of the updated configuration.
   */
  configure(config: Partial<ContextConfig>): ContextConfig {
    this.config = {
      ...this.config,
      ...config,
    };
    logger.debug('RequestContextService configuration updated', { newConfig: this.config });
    return { ...this.config }; // Return a copy to prevent direct mutation
  },

  /**
   * Retrieves a shallow copy of the current service configuration.
   *
   * @returns A shallow copy of the current `ContextConfig`.
   */
  getConfig(): ContextConfig {
    return { ...this.config }; // Return a copy
  },

  /**
   * Creates a new request context with a unique `requestId` and `timestamp`.
   * Custom properties can be added via `additionalContext`.
   *
   * @param additionalContext - An optional record of key-value pairs to be
   *                            included in the request context. Defaults to an empty object.
   * @returns A `RequestContext` object.
   */
  createRequestContext(
    additionalContext: Record<string, unknown> = {}
  ): RequestContext {
    const requestId = generateUUID();
    const timestamp = new Date().toISOString();

    const context: RequestContext = {
      requestId,
      timestamp,
      ...additionalContext,
    };
    // logger.debug('Request context created', { requestId }); // Optional: log context creation
    return context;
  },

  // generateSecureRandomString function was previously here but removed as it was unused and redundant.
  // Its functionality, if needed for secure random strings, should be sourced from a dedicated crypto/security module.
};

/**
 * Primary export for request context functionalities.
 * Provides methods to create and manage request contexts.
 */
export const requestContextService = requestContextServiceInstance;
