/**
 * WAL checkpoint management
 */
import { Database } from 'sqlite';
import { Logger } from '../../../logging/index.js';
import { ErrorCodes, createError } from '../../../errors/index.js';
import { isTransientError } from '../../../utils/error-utils.js';
import { CheckpointMode, CheckpointResult, RetryOptions, DEFAULT_RETRY_OPTIONS } from './types.js';

export class CheckpointManager {
  private readonly logger: Logger;
  private checkpointCount = 0;
  private lastCheckpoint = 0;
  private totalCheckpointTime = 0;

  constructor(private readonly dbPath: string) {
    this.logger = Logger.getInstance().child({
      component: 'CheckpointManager',
      context: { dbPath },
    });
  }

  /**
   * Reset checkpoint statistics
   */
  resetStats(): void {
    this.checkpointCount = 0;
    this.lastCheckpoint = 0;
    this.totalCheckpointTime = 0;
  }

  /**
   * Get checkpoint statistics
   */
  getStats() {
    return {
      checkpointCount: this.checkpointCount,
      lastCheckpoint: this.lastCheckpoint,
      totalCheckpointTime: this.totalCheckpointTime,
      averageCheckpointTime:
        this.checkpointCount > 0 ? this.totalCheckpointTime / this.checkpointCount : 0,
    };
  }

  /**
   * Execute checkpoint with retries and mode fallback
   */
  async executeCheckpoint(
    db: Database,
    options: RetryOptions = DEFAULT_RETRY_OPTIONS
  ): Promise<CheckpointResult> {
    const checkpointStart = Date.now();
    let lastError: Error | undefined;
    let delay = options.initialDelay;

    // Try different modes in order of preference
    const modes: CheckpointMode[] = ['PASSIVE', 'RESTART', 'TRUNCATE'];

    for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
      for (const mode of modes) {
        try {
          const result = await this.tryCheckpoint(db, mode, checkpointStart);

          // Update statistics
          this.lastCheckpoint = Date.now();
          this.checkpointCount++;
          this.totalCheckpointTime += result.duration;

          this.logger.info('WAL checkpoint completed', {
            checkpointCount: this.checkpointCount,
            duration: result.duration,
            mode,
            walSizeBefore: result.walSizeBefore,
            walSizeAfter: result.walSizeAfter,
            averageCheckpointTime: this.totalCheckpointTime / this.checkpointCount,
            context: {
              operation: 'checkpoint',
              timestamp: Date.now(),
            },
          });

          return result;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));

          // Only retry on transient errors
          if (!isTransientError(error)) {
            throw error;
          }

          this.logger.debug(`Checkpoint ${mode} failed, trying next mode`, {
            attempt,
            mode,
            delay,
            error: lastError,
            context: {
              operation: 'checkpoint',
              timestamp: Date.now(),
            },
          });

          // Wait before trying next mode
          await new Promise(resolve => setTimeout(resolve, delay));
          delay = Math.min(delay * options.backoffFactor, options.maxDelay);
        }
      }
    }

    // If we get here, all attempts failed
    const duration = Date.now() - checkpointStart;
    const errorDetails =
      lastError instanceof Error
        ? { message: lastError.message, stack: lastError.stack }
        : { message: String(lastError) };

    this.logger.error('WAL checkpoint failed after all attempts', {
      error: errorDetails,
      attempts: options.maxAttempts,
      duration,
      context: {
        operation: 'checkpoint',
        timestamp: Date.now(),
      },
    });

    throw createError(
      ErrorCodes.STORAGE_ERROR,
      'WAL checkpoint failed after all attempts',
      'checkpoint',
      lastError?.message || 'Checkpoint failed',
      {
        attempts: options.maxAttempts,
        duration,
        lastError: lastError
          ? {
              name: lastError.name,
              message: lastError.message,
              stack: lastError.stack,
            }
          : undefined,
        isTransient: true,
      }
    );
  }

  /**
   * Try checkpoint with specific mode
   */
  private async tryCheckpoint(
    db: Database,
    mode: CheckpointMode,
    startTime: number
  ): Promise<CheckpointResult> {
    // Get WAL size before checkpoint
    const walSizeBefore = await this.getWalSize();

    // Execute checkpoint
    await db.exec(`PRAGMA wal_checkpoint(${mode})`);

    // Get WAL size after checkpoint
    const walSizeAfter = await this.getWalSize();

    return {
      duration: Date.now() - startTime,
      walSizeBefore,
      walSizeAfter,
      mode,
      success: true,
    };
  }

  /**
   * Get current WAL file size
   */
  private async getWalSize(): Promise<number> {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      const walPath = path.join(path.dirname(this.dbPath), path.basename(this.dbPath) + '-wal');
      const stats = await fs.stat(walPath);
      return stats.size;
    } catch (error) {
      // WAL file might not exist yet
      return 0;
    }
  }
}
