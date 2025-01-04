/**
 * WAL metrics collection and monitoring
 */
import { Logger } from '../../../logging/index.js';
import { WALMetrics, WALState } from './types.js';
import { promises as fs } from 'fs';
import { join, dirname, basename } from 'path';

export class MetricsCollector {
  private readonly logger: Logger;
  private maxWalSizeReached = 0;
  private lastMetricsTimestamp = 0;
  private metricsInterval: NodeJS.Timeout | null = null;
  private readonly METRICS_INTERVAL = 5000; // 5 seconds

  constructor(
    private readonly dbPath: string,
    private readonly state: WALState
  ) {
    this.logger = Logger.getInstance().child({
      component: 'MetricsCollector',
      context: { dbPath },
    });
  }

  /**
   * Start collecting metrics
   */
  startCollecting(): void {
    if (this.metricsInterval) {
      return;
    }

    this.logger.debug('Starting metrics collection', {
      interval: this.METRICS_INTERVAL,
      context: {
        operation: 'startCollecting',
        timestamp: Date.now(),
      },
    });

    this.metricsInterval = setInterval(async () => {
      try {
        const metrics = await this.collectMetrics();

        // Track max WAL size
        if (metrics.walSize > this.maxWalSizeReached) {
          this.maxWalSizeReached = metrics.walSize;
          this.logger.debug('New maximum WAL size recorded', {
            maxSize: this.maxWalSizeReached,
            context: {
              operation: 'collectMetrics',
              timestamp: Date.now(),
            },
          });
        }

        this.lastMetricsTimestamp = Date.now();
      } catch (error) {
        this.logger.error('Failed to collect metrics', {
          error,
          context: {
            operation: 'collectMetrics',
            timestamp: Date.now(),
          },
        });
      }
    }, this.METRICS_INTERVAL);

    // Don't prevent process exit
    this.metricsInterval.unref();
  }

  /**
   * Stop collecting metrics
   */
  stopCollecting(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;

      this.logger.debug('Stopped metrics collection', {
        lastCollection: this.lastMetricsTimestamp,
        context: {
          operation: 'stopCollecting',
          timestamp: Date.now(),
        },
      });
    }
  }

  /**
   * Get current WAL metrics
   */
  async getMetrics(): Promise<WALMetrics> {
    const metrics = await this.collectMetrics();

    this.logger.debug('WAL metrics retrieved', {
      metrics,
      context: {
        operation: 'getMetrics',
        timestamp: Date.now(),
      },
    });

    return metrics;
  }

  /**
   * Collect current WAL metrics
   */
  private async collectMetrics(): Promise<WALMetrics> {
    const walSize = await this.getWalSize();

    return {
      isEnabled: this.state.isEnabled,
      walSize,
      lastCheckpoint: this.state.lastCheckpoint,
      checkpointCount: this.state.checkpointCount,
      autoCheckpointSize: 1000, // Pages (matches our wal_autocheckpoint setting)
      totalCheckpointTime: this.state.totalCheckpointTime,
      averageCheckpointTime:
        this.state.checkpointCount > 0
          ? this.state.totalCheckpointTime / this.state.checkpointCount
          : 0,
      maxWalSizeReached: Math.max(this.maxWalSizeReached, walSize),
    };
  }

  /**
   * Get current WAL file size
   */
  private async getWalSize(): Promise<number> {
    try {
      const walPath = join(dirname(this.dbPath), basename(this.dbPath) + '-wal');
      const stats = await fs.stat(walPath);
      return stats.size;
    } catch (error) {
      // WAL file might not exist yet
      this.logger.debug('Could not get WAL file size', {
        error,
        context: {
          operation: 'getWalSize',
          timestamp: Date.now(),
        },
      });
      return 0;
    }
  }

  /**
   * Reset metrics
   */
  reset(): void {
    this.maxWalSizeReached = 0;
    this.lastMetricsTimestamp = 0;
    this.stopCollecting();
  }

  /**
   * Get metrics collection status
   */
  getStatus() {
    return {
      isCollecting: !!this.metricsInterval,
      lastCollection: this.lastMetricsTimestamp,
      maxWalSizeReached: this.maxWalSizeReached,
    };
  }
}
