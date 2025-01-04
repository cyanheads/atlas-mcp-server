/**
 * WAL file system operations and integrity checks
 */
import { Logger } from '../../../logging/index.js';
import { ErrorCodes, createError } from '../../../errors/index.js';
import { WALFileInfo } from './types.js';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';

export class FileHandler {
  private readonly logger: Logger;
  private readonly PAGE_SIZE = 4096; // Standard SQLite page size

  constructor(private readonly dbPath: string) {
    this.logger = Logger.getInstance().child({
      component: 'FileHandler',
      context: { dbPath },
    });
  }

  /**
   * Initialize WAL directory
   */
  async initializeDirectory(): Promise<void> {
    const dir = dirname(this.dbPath);

    try {
      // Ensure directory exists with proper permissions
      await fs.mkdir(dir, { recursive: true, mode: 0o755 });
      await fs.access(dir, fs.constants.R_OK | fs.constants.W_OK);

      const stats = await fs.stat(dir);

      this.logger.info('Database directory ready', {
        dir,
        mode: stats.mode,
        context: {
          operation: 'initializeDirectory',
          timestamp: Date.now(),
        },
      });
    } catch (error) {
      throw createError(
        ErrorCodes.STORAGE_INIT,
        'Failed to prepare database directory',
        'initializeDirectory',
        error instanceof Error ? error.message : String(error),
        {
          originalError:
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                  stack: error.stack,
                }
              : undefined,
          dir,
        }
      );
    }
  }

  /**
   * Get WAL file information
   */
  async getWALInfo(): Promise<WALFileInfo> {
    // SQLite uses 'main-wal' and 'main-shm' for the default database connection
    const walPath = join(dirname(this.dbPath), 'main-wal');
    const shmPath = join(dirname(this.dbPath), 'main-shm');

    try {
      const walStats = await fs.stat(walPath);

      return {
        walPath,
        shmPath,
        walSize: walStats.size,
        isPageAligned: walStats.size % this.PAGE_SIZE === 0,
        lastModified: walStats.mtimeMs,
      };
    } catch (error) {
      // WAL file might not exist yet
      this.logger.debug('WAL file not found or inaccessible', {
        walPath,
        error: error instanceof Error ? error.message : String(error),
        context: {
          operation: 'getWALInfo',
          timestamp: Date.now(),
        },
      });

      return {
        walPath,
        shmPath,
        walSize: 0,
        isPageAligned: true,
        lastModified: 0,
      };
    }
  }

  /**
   * Verify WAL file integrity
   */
  async verifyIntegrity(): Promise<boolean> {
    const verifyStart = Date.now();

    try {
      // Get WAL info
      const info = await this.getWALInfo();

      // Check if WAL and SHM files exist
      await Promise.all([
        fs.access(info.walPath).catch(() => {}),
        fs.access(info.shmPath).catch(() => {}),
      ]);

      // Basic integrity checks
      if (info.walSize === 0) {
        this.logger.warn('WAL file is empty', {
          walPath: info.walPath,
          context: {
            operation: 'verifyIntegrity',
            timestamp: Date.now(),
          },
        });
        return false;
      }

      if (!info.isPageAligned) {
        this.logger.warn('WAL file size is not page-aligned', {
          size: info.walSize,
          pageSize: this.PAGE_SIZE,
          walPath: info.walPath,
          context: {
            operation: 'verifyIntegrity',
            timestamp: Date.now(),
          },
        });
        return false;
      }

      this.logger.debug('WAL integrity verified', {
        walSize: info.walSize,
        duration: Date.now() - verifyStart,
        context: {
          operation: 'verifyIntegrity',
          timestamp: Date.now(),
        },
      });

      return true;
    } catch (error) {
      this.logger.warn('WAL integrity check failed', {
        error,
        duration: Date.now() - verifyStart,
        context: {
          operation: 'verifyIntegrity',
          timestamp: Date.now(),
        },
      });
      return false;
    }
  }

  /**
   * Clean up WAL files
   */
  async cleanup(): Promise<void> {
    try {
      const info = await this.getWALInfo();

      // Try to remove WAL and SHM files
      await Promise.all([
        fs.unlink(info.walPath).catch(() => {}),
        fs.unlink(info.shmPath).catch(() => {}),
      ]);

      this.logger.debug('WAL files cleaned up', {
        context: {
          operation: 'cleanup',
          timestamp: Date.now(),
        },
      });
    } catch (error) {
      this.logger.warn('Failed to clean up WAL files', {
        error,
        context: {
          operation: 'cleanup',
          timestamp: Date.now(),
        },
      });
    }
  }

  /**
   * Check if WAL mode is supported
   */
  async checkWALSupport(): Promise<boolean> {
    try {
      // Try to create and write to WAL file
      const info = await this.getWALInfo();
      await fs.writeFile(info.walPath, Buffer.alloc(this.PAGE_SIZE));
      await fs.unlink(info.walPath);
      return true;
    } catch (error) {
      this.logger.warn('WAL mode not supported', {
        error,
        context: {
          operation: 'checkWALSupport',
          timestamp: Date.now(),
        },
      });
      return false;
    }
  }

  /**
   * Get WAL directory status
   */
  async getDirectoryStatus() {
    const dir = dirname(this.dbPath);

    try {
      const stats = await fs.stat(dir);
      return {
        exists: true,
        isWritable: true,
        mode: stats.mode,
        size: stats.size,
        lastModified: stats.mtimeMs,
      };
    } catch (error) {
      return {
        exists: false,
        isWritable: false,
        mode: 0,
        size: 0,
        lastModified: 0,
      };
    }
  }
}
