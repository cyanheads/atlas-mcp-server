import { PathUtils } from '../../utils/path-utils.js';
import { PlatformPaths } from '../../utils/platform-utils.js';
import { createError, ErrorCodes } from '../../errors/index.js';
import { join } from 'path';

/**
 * Storage-specific path utilities
 */
export class StoragePathUtils extends PathUtils {
  private static readonly STORAGE_PATH_REGEX = /^[a-zA-Z0-9-_/.]+$/;
  private static readonly STORAGE_FILE_EXTENSIONS = ['.db', '.sqlite', '.sqlite3'];
  private static readonly MAX_FILENAME_LENGTH = 100;

  /**
   * Validates a storage file path
   */
  static validateStoragePath(path: string): void {
    // First apply base path validation
    this.validatePath(path);

    if (!this.STORAGE_PATH_REGEX.test(path)) {
      throw createError(
        ErrorCodes.VALIDATION_ERROR,
        'Storage path contains invalid characters',
        'StoragePathUtils.validateStoragePath',
        'Path can only contain letters, numbers, hyphens, underscores, and dots'
      );
    }

    const filename = this.getBaseName(path);
    if (filename.length > this.MAX_FILENAME_LENGTH) {
      throw createError(
        ErrorCodes.VALIDATION_ERROR,
        `Filename exceeds maximum length of ${this.MAX_FILENAME_LENGTH} characters`,
        'StoragePathUtils.validateStoragePath',
        'Filename is too long'
      );
    }

    const extension = this.getFileExtension(path);
    if (!this.STORAGE_FILE_EXTENSIONS.includes(extension)) {
      throw createError(
        ErrorCodes.VALIDATION_ERROR,
        'Invalid storage file extension',
        'StoragePathUtils.validateStoragePath',
        `Extension must be one of: ${this.STORAGE_FILE_EXTENSIONS.join(', ')}`
      );
    }
  }

  /**
   * Gets file extension including dot
   */
  static getFileExtension(path: string): string {
    const filename = this.getBaseName(path);
    const dotIndex = filename.lastIndexOf('.');
    return dotIndex > -1 ? filename.slice(dotIndex) : '';
  }

  /**
   * Resolves storage path relative to base directory
   */
  static resolveStoragePath(baseDir: string, name: string): string {
    // Normalize name to valid filename
    const safeName = name.replace(/[^a-zA-Z0-9-_]/g, '_');
    const filename = `${safeName}.sqlite`;

    // Join and normalize path
    const fullPath = join(baseDir, filename);
    return PlatformPaths.normalizePath(fullPath);
  }

  /**
   * Gets the WAL file path for a storage file
   */
  static getWalPath(storagePath: string): string {
    return `${storagePath}-wal`;
  }

  /**
   * Gets the SHM file path for a storage file
   */
  static getShmPath(storagePath: string): string {
    return `${storagePath}-shm`;
  }

  /**
   * Gets the journal file path for a storage file
   */
  static getJournalPath(storagePath: string): string {
    return `${storagePath}-journal`;
  }

  /**
   * Gets all associated file paths for a storage file
   */
  static getStorageFilePaths(storagePath: string): string[] {
    return [
      storagePath,
      this.getWalPath(storagePath),
      this.getShmPath(storagePath),
      this.getJournalPath(storagePath),
    ];
  }

  /**
   * Checks if path is a valid storage file
   */
  static isStorageFile(path: string): boolean {
    try {
      this.validateStoragePath(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Gets storage directory for an app
   */
  static getStorageDir(appName: string): string {
    const appDir = PlatformPaths.getAppDataDir(appName);
    return join(appDir, 'storage');
  }
}
