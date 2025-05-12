import { BaseErrorCode, McpError } from '../../types/errors.js';
// Import config and utils
import { environment } from '../../config/index.js'; // Import environment from config
import { logger, RequestContext } from '../index.js';

/**
 * Rate limiting configuration options
 */
export interface RateLimitConfig {
  /** Time window in milliseconds */
  windowMs: number;
  /** Maximum number of requests allowed in the window */
  maxRequests: number;
  /** Custom error message template */
  errorMessage?: string;
  /** Whether to skip rate limiting in certain environments (e.g. development) */
  skipInDevelopment?: boolean;
  /** Custom key generator function */
  keyGenerator?: (identifier: string, context?: RequestContext) => string;
  /** How often to run cleanup of expired entries (in milliseconds) */
  cleanupInterval?: number;
}

/**
 * Individual rate limit entry
 */
export interface RateLimitEntry {
  /** Current request count */
  count: number;
  /** When the window resets (timestamp) */
  resetTime: number;
}

/**
 * Generic rate limiter that can be used across the application
 */
export class RateLimiter {
  /** Map storing rate limit data */
  private limits: Map<string, RateLimitEntry>;
  /** Cleanup interval timer */
  private cleanupTimer: NodeJS.Timeout | null = null;
  /** Default configuration */
  private static DEFAULT_CONFIG: RateLimitConfig = {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 100, // 100 requests per window
    errorMessage: 'Rate limit exceeded. Please try again in {waitTime} seconds.',
    skipInDevelopment: false,
    cleanupInterval: 5 * 60 * 1000 // 5 minutes
  };

  /**
   * Create a new rate limiter
   * @param config Rate limiting configuration
   */
  constructor(private config: RateLimitConfig) {
    this.config = { ...RateLimiter.DEFAULT_CONFIG, ...config };
    this.limits = new Map();
    this.startCleanupTimer();
    
    // Removed logger call from constructor to prevent logging before initialization
  }

  /**
   * Start the cleanup timer to periodically remove expired entries
   */
  private startCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    
    const interval = this.config.cleanupInterval ?? RateLimiter.DEFAULT_CONFIG.cleanupInterval;
    
    if (interval) {
      this.cleanupTimer = setInterval(() => {
        this.cleanupExpiredEntries();
      }, interval);
      
      // Ensure the timer doesn't prevent the process from exiting
      if (this.cleanupTimer.unref) {
        this.cleanupTimer.unref();
      }
    }
  }
  
  /**
   * Clean up expired rate limit entries to prevent memory leaks
   */
  private cleanupExpiredEntries(): void {
    const now = Date.now();
    let expiredCount = 0;
    
    // Use a synchronized approach to avoid race conditions during cleanup
    for (const [key, entry] of this.limits.entries()) {
      if (now >= entry.resetTime) {
        this.limits.delete(key);
        expiredCount++;
      }
    }
    
    if (expiredCount > 0) {
      logger.debug(`Cleaned up ${expiredCount} expired rate limit entries`, {
        totalRemaining: this.limits.size
      });
    }
  }

  /**
   * Update rate limiter configuration
   * @param config New configuration options
   */
  public configure(config: Partial<RateLimitConfig>): void {
    this.config = { ...this.config, ...config };
    
    // Restart cleanup timer if interval changed
    if (config.cleanupInterval !== undefined) {
      this.startCleanupTimer();
    }
  }

  /**
   * Get current configuration
   * @returns Current rate limit configuration
   */
  public getConfig(): RateLimitConfig {
    return { ...this.config };
  }

  /**
   * Reset all rate limits
   */
  public reset(): void {
    this.limits.clear();
    logger.debug('Rate limiter reset, all limits cleared');
  }

  /**
   * Check if a request exceeds the rate limit
   * @param key Unique identifier for the request source
   * @param context Optional request context
   * @throws {McpError} If rate limit is exceeded
   */
  public check(key: string, context?: RequestContext): void {
    // Skip in development if configured, using the validated environment from config
    if (this.config.skipInDevelopment && environment === 'development') {
      return;
    }

    // Generate key using custom generator if provided
    const limitKey = this.config.keyGenerator 
      ? this.config.keyGenerator(key, context)
      : key;

    const now = Date.now();
    
    // Accessing and updating the limit entry within a single function scope
    // ensures atomicity in Node.js's single-threaded event loop for Map operations.
    const limit = () => {
      // Get current entry or create a new one if it doesn't exist or is expired
      const entry = this.limits.get(limitKey);
      
      // Create new entry or reset if expired
      if (!entry || now >= entry.resetTime) {
        const newEntry = {
          count: 1,
          resetTime: now + this.config.windowMs
        };
        this.limits.set(limitKey, newEntry);
        return newEntry;
      }
      
      // Check if limit exceeded
      if (entry.count >= this.config.maxRequests) {
        const waitTime = Math.ceil((entry.resetTime - now) / 1000);
        const errorMessage = this.config.errorMessage?.replace('{waitTime}', waitTime.toString()) ||
          `Rate limit exceeded. Please try again in ${waitTime} seconds.`;
        
        throw new McpError(
          BaseErrorCode.RATE_LIMITED,
          errorMessage,
          { waitTime, key: limitKey }
        );
      }
      
      // Increment counter and return updated entry
      entry.count++;
      return entry;
    };
    
    // Execute the rate limiting logic
    limit();
  }

  /**
   * Get rate limit information for a key
   * @param key The rate limit key
   * @returns Current rate limit status or null if no record exists
   */
  public getStatus(key: string): { current: number; limit: number; remaining: number; resetTime: number } | null {
    const entry = this.limits.get(key);
    
    if (!entry) {
      return null;
    }
    
    return {
      current: entry.count,
      limit: this.config.maxRequests,
      remaining: Math.max(0, this.config.maxRequests - entry.count),
      resetTime: entry.resetTime
    };
  }
  
  /**
   * Stop the cleanup timer when the limiter is no longer needed
   */
  public dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    
    // Clear all entries
    this.limits.clear();
  }
}

/**
 * Create and export a default rate limiter instance
 */
export const rateLimiter = new RateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 100 // 100 requests per window
});
