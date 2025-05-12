#!/usr/bin/env node
import { exportDatabase } from '../src/services/neo4j/backupRestoreService.js';
import { closeNeo4jConnection } from '../src/services/neo4j/index.js';
import { logger } from '../src/utils/index.js';

/**
 * Manual backup script entry point.
 */
const runManualBackup = async () => {
  logger.info('Starting manual database backup...');

  try {
    const backupPath = await exportDatabase();
    logger.info(`Manual backup completed successfully. Backup created at: ${backupPath}`);
  } catch (error) {
    logger.error('Manual database backup failed:', { error });
    process.exitCode = 1; // Indicate failure
  } finally {
    // Ensure the Neo4j connection is closed after the script runs
    logger.info('Closing Neo4j connection...');
    await closeNeo4jConnection();
    logger.info('Neo4j connection closed.');
  }
};

// Execute the backup process
runManualBackup();
