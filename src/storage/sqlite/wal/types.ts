/**
 * WAL-related type definitions
 */
import { Database } from 'sqlite';

export interface WALMetrics {
  isEnabled: boolean;
  walSize: number;
  lastCheckpoint: number;
  checkpointCount: number;
  autoCheckpointSize: number;
  totalCheckpointTime?: number;
  averageCheckpointTime?: number;
  maxWalSizeReached?: number;
}

export interface RetryOptions {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  backoffFactor: number;
}

export interface WALConfig {
  dbPath: string;
  maxWalSize?: number;
  checkpointInterval?: number;
  retryOptions?: RetryOptions;
}

export interface CheckpointResult {
  duration: number;
  walSizeBefore: number;
  walSizeAfter: number;
  mode: 'PASSIVE' | 'RESTART' | 'TRUNCATE';
  success: boolean;
}

export interface WALState {
  isEnabled: boolean;
  lastCheckpoint: number;
  checkpointCount: number;
  totalCheckpointTime: number;
  maxWalSizeReached: number;
}

export type CheckpointMode = 'PASSIVE' | 'RESTART' | 'TRUNCATE';

export interface WALFileInfo {
  walPath: string;
  shmPath: string;
  walSize: number;
  isPageAligned: boolean;
  lastModified: number;
}

export interface WALOperationContext {
  db: Database;
  operation: string;
  timestamp: number;
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 5,
  initialDelay: 100,
  maxDelay: 2000,
  backoffFactor: 2,
};

export const DEFAULT_WAL_CONFIG = {
  maxWalSize: 32 * 1024 * 1024, // 32MB
  checkpointInterval: 30000, // 30 seconds
  retryOptions: DEFAULT_RETRY_OPTIONS,
};
