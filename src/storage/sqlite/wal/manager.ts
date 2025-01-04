/**
 * WAL (Write-Ahead Logging) management
 */
import { Database } from 'sqlite';
import { Logger } from '../../../logging/index.js';
import { ErrorCodes, createError } from '../../../errors/index.js';
import { EventManager } from '../../../events/event-manager.js';
import { EventTypes } from '../../../types/events.js';
import { isTransientError } from '../../../utils/error-utils.js';
import { WALConfig, WALMetrics, WALState, DEFAULT_WAL_CONFIG } from './types.js';
import { CheckpointManager } from './checkpoint-manager.js';
import { MetricsCollector } from './metrics-collector.js';
import { FileHandler } from './file-handler.js';

export class WALManager {
  private static instance: WALManager;
  private readonly logger: Logger;
  private readonly eventManager: EventManager;
  private readonly checkpointManager: CheckpointManager;
  private readonly metricsCollector: MetricsCollector;
  private readonly fileHandler: FileHandler;
  private readonly config: Required<WALConfig>;
  private initializationPromise: Promise<void> | null = null;

  private state: WALState = {
    isEnabled: false,
    lastCheckpoint: 0,
    checkpointCount: 0,
    totalCheckpointTime: 0,
    maxWalSizeReached: 0,
  };

  private constructor(dbPath: string, config?: Partial<WALConfig>) {
    this.config = {
      ...DEFAULT_WAL_CONFIG,
      dbPath,
      ...config,
    };

    this.logger = Logger.getInstance().child({
      component: 'WALManager',
      context: {
        dbPath: this.config.dbPath,
        maxWalSize: this.config.maxWalSize,
        checkpointInterval: this.config.checkpointInterval,
      },
    });

    this.eventManager = EventManager.getInstance();
    this.checkpointManager = new CheckpointManager(this.config.dbPath);
    this.metricsCollector = new MetricsCollector(this.config.dbPath, this.state);
    this.fileHandler = new FileHandler(this.config.dbPath);

    this.logger.info('WAL manager created', {
      config: this.config,
      context: {
        operation: 'create',
        timestamp: Date.now(),
      },
    });
  }

  static getInstance(dbPath?: string): WALManager {
    if (!WALManager.instance) {
      if (!dbPath) {
        throw new Error('dbPath required for WALManager initialization');
      }
      WALManager.instance = new WALManager(dbPath);
    }
    return WALManager.instance;
  }

  async enableWAL(db: Database): Promise<void> {
    if (this.initializationPromise) {
      try {
        await this.initializationPromise;
        return;
      } catch (error) {
        this.logger.warn('Previous initialization failed, retrying', {
          error,
          context: {
            operation: 'enableWAL',
            timestamp: Date.now(),
          },
        });
      }
    }

    const enableStart = Date.now();
    this.initializationPromise = (async () => {
      try {
        // Initialize directory first
        await this.fileHandler.initializeDirectory();

        // Check WAL support
        if (!(await this.fileHandler.checkWALSupport())) {
          throw createError(
            ErrorCodes.STORAGE_INIT,
            'WAL mode not supported on this system',
            'enableWAL',
            'The system does not support WAL mode'
          );
        }

        let retryCount = 0;
        const maxRetries = this.config.retryOptions?.maxAttempts || 5;
        let lastError: Error | undefined;

        while (retryCount < maxRetries) {
          try {
            // Check current mode first without lock
            const currentMode = await db.get<{ journal_mode: string }>('PRAGMA journal_mode');

            // If WAL is already enabled, just verify and configure
            if (currentMode?.journal_mode === 'wal') {
              this.logger.debug('WAL mode already enabled', {
                context: {
                  operation: 'enableWAL',
                  timestamp: enableStart,
                },
              });

              // Set state before configuration
              this.state.isEnabled = true;

              // Configure WAL settings without transaction
              await this.configureWALSafe(db);

              // Start monitoring
              this.metricsCollector.startCollecting();

              const duration = Date.now() - enableStart;
              this.logger.info('WAL configuration verified', {
                duration,
                context: {
                  operation: 'enableWAL',
                  timestamp: Date.now(),
                },
              });

              return;
            }

            // Set exclusive lock to prevent other connections
            await db.exec('PRAGMA locking_mode = EXCLUSIVE');

            try {
              // Enable WAL mode
              await db.exec('PRAGMA journal_mode = WAL');

              // Verify WAL mode
              const mode = await db.get<{ journal_mode: string }>('PRAGMA journal_mode');
              if (mode?.journal_mode !== 'wal') {
                throw createError(
                  ErrorCodes.STORAGE_INIT,
                  'Failed to enable WAL mode',
                  'enableWAL',
                  `Expected 'wal', got '${mode?.journal_mode}'`
                );
              }

              // Set state before configuration
              this.state.isEnabled = true;

              // Configure WAL settings
              await this.configureWAL(db);

              // Start monitoring
              this.metricsCollector.startCollecting();

              const duration = Date.now() - enableStart;
              this.logger.info('WAL mode enabled successfully', {
                duration,
                retryCount,
                context: {
                  operation: 'enableWAL',
                  timestamp: Date.now(),
                },
              });

              // Emit WAL enabled event
              this.eventManager.emitSystemEvent({
                type: EventTypes.STORAGE_WAL_ENABLED,
                timestamp: Date.now(),
                metadata: {
                  dbPath: this.config.dbPath,
                  duration,
                  metrics: {
                    connections: {
                      total: 1,
                      active: 1,
                      idle: 0,
                      errors: retryCount,
                      avgResponseTime: duration,
                    },
                    cache: {
                      hits: 0,
                      misses: 0,
                      size: 0,
                      maxSize: 0,
                      hitRate: 0,
                      evictions: 0,
                      memoryUsage: 0,
                    },
                    queries: {
                      total: 1,
                      errors: retryCount,
                      avgExecutionTime: duration,
                      slowQueries: 0,
                    },
                    timestamp: Date.now(),
                  },
                },
              });

              return;
            } finally {
              // Release exclusive lock
              await db.exec('PRAGMA locking_mode = NORMAL').catch(error => {
                this.logger.warn('Failed to release exclusive lock', {
                  error,
                  context: {
                    operation: 'enableWAL',
                    timestamp: Date.now(),
                  },
                });
              });
            }
          } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            // Only retry on transient errors
            if (!isTransientError(error)) {
              throw error;
            }

            retryCount++;
            if (retryCount < maxRetries) {
              const delay = Math.min(
                (this.config.retryOptions?.initialDelay || 100) * Math.pow(2, retryCount),
                this.config.retryOptions?.maxDelay || 2000
              );

              this.logger.debug('Retrying WAL initialization', {
                attempt: retryCount,
                maxRetries,
                delay,
                error: lastError,
                context: {
                  operation: 'enableWAL',
                  timestamp: Date.now(),
                },
              });

              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
        }

        // If we get here, all retries failed
        throw createError(
          ErrorCodes.STORAGE_INIT,
          'Failed to enable WAL mode after retries',
          'enableWAL',
          lastError?.message || 'Maximum retry attempts reached',
          {
            retryCount,
            maxRetries,
            lastError: lastError
              ? {
                  name: lastError.name,
                  message: lastError.message,
                  stack: lastError.stack,
                }
              : undefined,
          }
        );
      } catch (error) {
        const duration = Date.now() - enableStart;
        this.logger.error('Failed to enable WAL mode', {
          error,
          duration,
          context: {
            operation: 'enableWAL',
            timestamp: Date.now(),
          },
        });

        // Reset state
        this.state.isEnabled = false;
        throw error;
      } finally {
        this.initializationPromise = null;
      }
    })();

    await this.initializationPromise;
  }

  /**
   * Configure WAL settings with transaction
   */
  private async configureWAL(db: Database): Promise<void> {
    // Set synchronous mode
    await db.exec('PRAGMA synchronous = NORMAL');

    // Configure WAL behavior
    await db.exec('BEGIN IMMEDIATE');
    try {
      await db.exec('PRAGMA wal_autocheckpoint = 1000');
      await db.exec(`PRAGMA journal_size_limit = ${this.config.maxWalSize}`);
      await db.exec('PRAGMA mmap_size = 67108864'); // 64MB memory mapping
      await db.exec('PRAGMA page_size = 4096');
      await db.exec('COMMIT');
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * Configure WAL settings without transaction for existing WAL mode
   */
  private async configureWALSafe(db: Database): Promise<void> {
    try {
      // Set synchronous mode
      await db.exec('PRAGMA synchronous = NORMAL');

      // Configure WAL behavior one at a time
      await db.exec('PRAGMA wal_autocheckpoint = 1000');
      await db.exec(`PRAGMA journal_size_limit = ${this.config.maxWalSize}`);
      await db.exec('PRAGMA mmap_size = 67108864'); // 64MB memory mapping
      await db.exec('PRAGMA page_size = 4096');
    } catch (error) {
      // Log error but don't fail - these are optional optimizations
      this.logger.warn('Failed to configure WAL settings', {
        error,
        context: {
          operation: 'configureWALSafe',
          timestamp: Date.now(),
        },
      });
    }
  }

  async checkpoint(db: Database): Promise<void> {
    if (!this.state.isEnabled) {
      throw createError(
        ErrorCodes.STORAGE_ERROR,
        'WAL mode not enabled',
        'checkpoint',
        'Cannot checkpoint when WAL mode is not enabled'
      );
    }

    const result = await this.checkpointManager.executeCheckpoint(db, this.config.retryOptions);

    // Update state
    this.state.lastCheckpoint = Date.now();
    this.state.checkpointCount++;
    this.state.totalCheckpointTime += result.duration;

    // Emit checkpoint event
    this.eventManager.emitSystemEvent({
      type: EventTypes.STORAGE_WAL_CHECKPOINT,
      timestamp: Date.now(),
      metadata: {
        dbPath: this.config.dbPath,
        ...result,
      },
    });
  }

  async getMetrics(): Promise<WALMetrics> {
    return this.metricsCollector.getMetrics();
  }

  async verifyIntegrity(): Promise<boolean> {
    return this.fileHandler.verifyIntegrity();
  }

  async close(): Promise<void> {
    const closeStart = Date.now();

    try {
      this.logger.info('Closing WAL manager', {
        metrics: await this.getMetrics(),
        context: {
          operation: 'close',
          timestamp: closeStart,
        },
      });

      // Stop metrics collection
      this.metricsCollector.stopCollecting();

      // Clean up files
      await this.fileHandler.cleanup();

      // Reset state
      this.state = {
        isEnabled: false,
        lastCheckpoint: 0,
        checkpointCount: 0,
        totalCheckpointTime: 0,
        maxWalSizeReached: 0,
      };

      this.logger.info('WAL manager closed successfully', {
        duration: Date.now() - closeStart,
        context: {
          operation: 'close',
          timestamp: Date.now(),
        },
      });
    } catch (error) {
      this.logger.error('Error closing WAL manager', {
        error,
        duration: Date.now() - closeStart,
        context: {
          operation: 'close',
          timestamp: Date.now(),
        },
      });
      throw error;
    }
  }
}
