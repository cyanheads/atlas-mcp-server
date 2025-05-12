#!/usr/bin/env node
import { existsSync, lstatSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url'; // Added for ESM __dirname equivalent
import { importDatabase } from '../src/services/neo4j/backupRestoreService.js';
import { closeNeo4jConnection } from '../src/services/neo4j/index.js';
import { logger } from '../src/utils/index.js';

/**
 * DB Import Script
 * ================
 *
 * Description:
 *   Imports data from a specified backup directory into the Neo4j database,
 *   overwriting existing data. Validates paths for security.
 *
 * Usage:
 *   - Add to package.json: "db:import": "ts-node --esm scripts/db-import.ts"
 *   - Run directly: npm run db:import <path_to_backup_directory>
 *   - Example: npm run db:import ./backups/atlas-backup-20230101120000
 */

// Calculate __dirname in ES module scope
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define the project root directory using the calculated __dirname
const projectRoot = path.resolve(__dirname, '..');

/**
 * Validates the provided backup directory path.
 * Ensures the path is within the project root and is a directory.
 * @param backupDir Path to the backup directory.
 * @returns True if valid, false otherwise.
 */
const isValidBackupDir = (backupDir: string): boolean => {
  const resolvedBackupDir = path.resolve(backupDir); // Resolve to absolute path first

  // Security Check: Ensure the resolved path is within the project root
  if (!resolvedBackupDir.startsWith(projectRoot + path.sep)) {
    logger.error(`Invalid backup directory: Path is outside the project boundary: ${resolvedBackupDir}`);
    return false;
  }

  // Check if path exists and is a directory
  if (!existsSync(resolvedBackupDir) || !lstatSync(resolvedBackupDir).isDirectory()) {
    logger.error(`Invalid backup directory: Path does not exist or is not a directory: ${resolvedBackupDir}`);
    return false;
  }

  // Check for expected JSON files (optional, but good practice)
  const expectedFiles = ['projects.json', 'tasks.json', 'knowledge.json', 'relationships.json']; // Added relationships.json
  for (const file of expectedFiles) {
    const filePath = path.join(resolvedBackupDir, file); // Use resolved path
    const resolvedFilePath = path.resolve(filePath); // Resolve again for safety

    // Security Check: Ensure file path is within the resolved backup directory (redundant but safe)
    if (!resolvedFilePath.startsWith(resolvedBackupDir + path.sep)) {
        logger.error(`Invalid file path detected: ${resolvedFilePath} is outside the backup directory ${resolvedBackupDir}`);
        // Decide how to handle: warning or failure. Let's warn for now.
        logger.warning(`Skipping check for potentially unsafe file path: ${resolvedFilePath}`);
        continue; // Skip check for this file
    }

    if (!existsSync(resolvedFilePath)) {
      // Log a warning but don't necessarily fail, maybe some are empty
      logger.warning(`Expected backup file not found: ${resolvedFilePath}. Import might be incomplete.`);
    }
  }
  return true;
};

/**
 * Manual import script entry point.
 */
const runManualImport = async () => {
  const args = process.argv.slice(2); // Get command line arguments, excluding node and script path

  if (args.length !== 1) {
    logger.error('Usage: npm run db:import <path_to_backup_directory>');
    process.exit(1);
  }

  // Note: backupDir is resolved inside isValidBackupDir now for validation
  const userInputPath = args[0];
  const resolvedBackupDir = path.resolve(userInputPath); // Resolve once for consistent use

  logger.info(`Attempting manual database import from: ${resolvedBackupDir}`);
  logger.warning('!!! THIS WILL OVERWRITE ALL EXISTING DATA IN THE DATABASE !!!');

  // Validate the resolved path
  if (!isValidBackupDir(resolvedBackupDir)) { // Pass the already resolved path
    process.exit(1);
  }

  try {
    // Pass the validated, resolved path to the import function
    await importDatabase(resolvedBackupDir);
    logger.info(`Manual import from ${resolvedBackupDir} completed successfully.`);
  } catch (error) {
    // Ensure we log an actual Error object and provide context
    const errorToLog = error instanceof Error ? error : new Error(error === null ? "Encountered a null error" : JSON.stringify(error));
    logger.error('Manual database import failed:', errorToLog, { backupDir: resolvedBackupDir });
    process.exitCode = 1; // Indicate failure
  } finally {
    // Ensure the Neo4j connection is closed after the script runs
    logger.info('Closing Neo4j connection...');
    await closeNeo4jConnection();
    logger.info('Neo4j connection closed.');
  }
};

// Execute the import process
runManualImport();
