import { format } from "date-fns";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { stat } from "fs/promises"; // Use async stat
import { Session } from "neo4j-driver";
import path from "path";
import { config } from "../../config/index.js";
import { logger } from "../../utils/index.js"; // Updated import path
import { neo4jDriver } from "./driver.js";

// Helper function to escape relationship types for Cypher queries
const escapeRelationshipType = (type: string): string => {
  // Backtick the type name and escape any backticks within the name itself.
  return `\`${type.replace(/`/g, '``')}\``;
};

// Define the validated root backup path from config
const validatedBackupRoot = config.backup.backupPath; // This path is already validated in config/index.ts

/**
 * Securely resolves a path against a base directory and ensures it stays within that base.
 * @param basePath The absolute, validated base path.
 * @param targetPath The relative or absolute path to resolve.
 * @returns The resolved absolute path if it's within the base path, otherwise null.
 */
const secureResolve = (basePath: string, targetPath: string): string | null => {
    const resolvedTarget = path.resolve(basePath, targetPath);
    if (resolvedTarget.startsWith(basePath + path.sep) || resolvedTarget === basePath) {
        return resolvedTarget;
    }
    logger.error(`Security Violation: Path "${targetPath}" resolves to "${resolvedTarget}", which is outside the allowed base directory "${basePath}".`);
    return null;
};


/**
 * Manages backup rotation, deleting the oldest backups if the count exceeds the limit.
 */
const manageBackupRotation = async (): Promise<void> => {
  const maxBackups = config.backup.maxBackups;

  // Use the validated backup root path
  if (!existsSync(validatedBackupRoot)) {
    logger.warning(`Backup root directory does not exist: ${validatedBackupRoot}. Skipping rotation.`);
    return;
  }

  try {
    logger.debug(`Checking backup rotation in ${validatedBackupRoot}. Max backups: ${maxBackups}`);

    const dirNames = readdirSync(validatedBackupRoot);

    // Asynchronously process each directory entry
    const processedDirs = await Promise.all(
      dirNames.map(async (name): Promise<{ path: string; time: number } | null> => {
        // Securely resolve each potential directory path
        const potentialDirPath = secureResolve(validatedBackupRoot, name);
        if (!potentialDirPath) return null; // Skip if path is invalid/outside root

        try {
          // Check if it's a directory using the validated path (async)
          const stats = await stat(potentialDirPath);
          if (stats.isDirectory()) {
            return { path: potentialDirPath, time: stats.mtime.getTime() };
          }
        } catch (statError: any) {
          // Log specific error if stat fails (e.g., permission denied) but ignore ENOENT (Not Found)
          if (statError.code !== 'ENOENT') {
            logger.warning(`Could not stat potential backup directory ${potentialDirPath}: ${statError.message}. Skipping.`);
          }
        }
        return null;
      })
    );

    // Filter out nulls (invalid paths or non-dirs) and sort oldest first
    const validBackupDirs = processedDirs
      .filter((dir): dir is { path: string; time: number } => dir !== null)
      .sort((a, b) => a.time - b.time);

    const backupsToDeleteCount = validBackupDirs.length - maxBackups;

    if (backupsToDeleteCount > 0) {
      logger.info(`Found ${validBackupDirs.length} valid backups. Deleting ${backupsToDeleteCount} oldest backups to maintain limit of ${maxBackups}.`);
      for (let i = 0; i < backupsToDeleteCount; i++) {
        const dirToDelete = validBackupDirs[i].path; // Path is already validated absolute path
        // Double check before deleting (redundant but safe)
        if (!dirToDelete.startsWith(validatedBackupRoot + path.sep)) {
            logger.error(`Security Error: Attempting to delete directory outside backup root: ${dirToDelete}. Aborting deletion.`);
            continue; // Skip this deletion
        }
        try {
          rmSync(dirToDelete, { recursive: true, force: true });
          logger.info(`Deleted old backup directory: ${dirToDelete}`);
        } catch (rmError) {
          const errorMsg = rmError instanceof Error ? rmError.message : String(rmError);
          logger.error(`Failed to delete old backup directory ${dirToDelete}: ${errorMsg}`);
          // Continue trying to delete others even if one fails
        }
      }
    } else {
      logger.debug(`Backup count (${validBackupDirs.length}) is within the limit (${maxBackups}). No rotation needed.`);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`Error during backup rotation management: ${errorMsg}`, { error });
    // Don't throw, allow backup process to continue if possible
  }
};

/**
 * Interface for the full export containing all entities and their relationships in a nested structure.
 * Nodes are stored in an object keyed by their label.
 */
interface FullExport {
  nodes: { [label: string]: Record<string, any>[] };
  relationships: {
    startNodeId: string;
    endNodeId: string;
    type: string;
    properties: Record<string, any>;
  }[];
}

/**
 * Exports all Project, Task, and Knowledge nodes and relationships to JSON files.
 * Also creates a full-export.json file containing all data in a single file.
 * Also manages backup rotation.
 * @returns The path to the directory containing the backup files.
 * @throws Error if the export step fails. Rotation errors are logged but don't throw.
 */
export const exportDatabase = async (): Promise<string> => {
  // First, manage rotation before creating the new backup
  await manageBackupRotation();

  let session: Session | null = null; // Initialize session variable
  const timestamp = format(new Date(), "yyyyMMddHHmmss");
  const backupDirName = `atlas-backup-${timestamp}`;
  
  // Securely create the backup directory path
  const backupDir = secureResolve(validatedBackupRoot, backupDirName);
  if (!backupDir) {
      throw new Error(`Failed to create secure backup directory path for ${backupDirName} within ${validatedBackupRoot}`);
  }

  // Create full export object to store all data
  const fullExport: FullExport = {
    nodes: {}, // Store nodes keyed by label
    relationships: []
  };

  try {
    session = await neo4jDriver.getSession(); // Get session from singleton
    logger.info(`Starting database export to ${backupDir}...`);
    
    // Create the validated backup directory
    if (!existsSync(backupDir)) {
      mkdirSync(backupDir, { recursive: true });
      logger.debug(`Created backup directory: ${backupDir}`);
    }

    // Fetch all distinct node labels from the database
    logger.debug("Fetching all node labels from database...");
    const labelsResult = await session.run("CALL db.labels() YIELD label RETURN label");
    const nodeLabels: string[] = labelsResult.records.map(record => record.get("label"));
    logger.info(`Found labels: ${nodeLabels.join(', ')}`);

    // Export nodes for each label
    for (const label of nodeLabels) {
      logger.debug(`Exporting nodes with label: ${label}`);
      const escapedLabel = `\`${label.replace(/`/g, '``')}\``;
      const nodeResult = await session.run(`MATCH (n:${escapedLabel}) RETURN n`);
      const nodes = nodeResult.records.map(record => record.get("n").properties);

      const fileName = `${label.toLowerCase()}s.json`;
      const filePath = secureResolve(backupDir, fileName); // Securely resolve file path
      if (!filePath) {
          logger.error(`Skipping export for label ${label}: Could not create secure path for ${fileName} in ${backupDir}`);
          continue; // Skip this label if path is insecure
      }

      writeFileSync(filePath, JSON.stringify(nodes, null, 2));
      logger.info(`Successfully exported ${nodes.length} ${label} nodes to ${filePath}`);
      fullExport.nodes[label] = nodes;
    }

    // Export Relationships
    logger.debug("Exporting relationships...");
    const relResult = await session.run(`
      MATCH (start)-[r]->(end)
      WHERE start.id IS NOT NULL AND end.id IS NOT NULL
      RETURN 
        start.id as startNodeAppId, 
        end.id as endNodeAppId, 
        type(r) as relType, 
        properties(r) as relProps
    `);
    const relationships = relResult.records.map(record => ({
      startNodeId: record.get("startNodeAppId"), 
      endNodeId: record.get("endNodeAppId"),
      type: record.get("relType"),
      properties: record.get("relProps") || {}
    }));

    const relFileName = 'relationships.json';
    const relFilePath = secureResolve(backupDir, relFileName); // Securely resolve path
    if (!relFilePath) {
        throw new Error(`Failed to create secure path for ${relFileName} in ${backupDir}`);
    }
    writeFileSync(relFilePath, JSON.stringify(relationships, null, 2));
    logger.info(`Successfully exported ${relationships.length} relationships to ${relFilePath}`);
    fullExport.relationships = relationships;
    
    // Write full export to file
    const fullExportFileName = 'full-export.json';
    const fullExportPath = secureResolve(backupDir, fullExportFileName); // Securely resolve path
    if (!fullExportPath) {
        throw new Error(`Failed to create secure path for ${fullExportFileName} in ${backupDir}`);
    }
    writeFileSync(fullExportPath, JSON.stringify(fullExport, null, 2));
    logger.info(`Successfully created full database export to ${fullExportPath}`);

    logger.info(`Database export completed successfully to ${backupDir}`);
    return backupDir; // Return the validated, absolute path
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Database export failed: ${errorMessage}`, { error });
    // Clean up partially created backup directory on failure (use validated path)
    if (backupDir && existsSync(backupDir)) { // Check if backupDir was successfully resolved
      // Double check before deleting
      if (!backupDir.startsWith(validatedBackupRoot + path.sep)) {
          logger.error(`Security Error: Attempting cleanup of directory outside backup root: ${backupDir}. Aborting cleanup.`);
      } else {
          try {
            rmSync(backupDir, { recursive: true, force: true });
            logger.warning(`Removed partially created backup directory due to export failure: ${backupDir}`);
          } catch (rmError) {
            const rmErrorMsg = rmError instanceof Error ? rmError.message : String(rmError);
            logger.error(`Failed to remove partial backup directory ${backupDir}: ${rmErrorMsg}`);
          }
      }
    }
    throw new Error(`Database export failed: ${errorMessage}`);
  } finally {
    if (session) {
      await session.close(); // Close session if it was opened
    }
  }
};

/**
 * Imports data from JSON files, overwriting the existing database.
 * Can import from either full-export.json (if it exists) or individual entity files.
 * @param backupDirInput The path to the directory containing the backup JSON files (relative to project root or absolute).
 * @throws Error if any step fails or if the backup directory is invalid.
 */
export const importDatabase = async (backupDirInput: string): Promise<void> => {
  // --- Validate Input Backup Directory ---
  const backupDir = secureResolve(validatedBackupRoot, path.relative(validatedBackupRoot, path.resolve(backupDirInput))); // Resolve and ensure it's within the root backup dir
  if (!backupDir) {
      throw new Error(`Invalid backup directory provided: "${backupDirInput}". It must be within "${validatedBackupRoot}".`);
  }
  // --- Validate Input Backup Directory (Async) ---
  try {
      const stats = await stat(backupDir); // Use async stat
      if (!stats.isDirectory()) {
          throw new Error(`Backup path "${backupDir}" exists but is not a directory.`);
      }
  } catch (error: any) {
      if (error.code === 'ENOENT') { // Handle file not found specifically
          throw new Error(`Backup directory "${backupDir}" does not exist.`);
      }
      // Rethrow other errors (e.g., permissions)
      throw new Error(`Failed to access backup directory "${backupDir}": ${error.message}`);
  }
  // --- End Validation ---

  let session: Session | null = null; // Initialize session variable
  logger.warning(`Starting database import from validated directory ${backupDir}. THIS WILL OVERWRITE ALL EXISTING DATA.`);

  try {
    session = await neo4jDriver.getSession(); // Get session from singleton
    // 1. Clear the database within a transaction
    logger.info("Clearing existing database...");
    await session.executeWrite(async tx => {
      logger.debug("Executing clear database transaction...");
      await tx.run("MATCH (n) DETACH DELETE n");
      logger.debug("Clear database transaction executed.");
    });
    logger.info("Existing database cleared.");

    // Variables to store relationships to import
    let relationships: Array<{ startNodeId: string; endNodeId: string; type: string; properties: Record<string, any> }> = [];

    // Check if full-export.json exists (use validated path)
    const fullExportPath = secureResolve(backupDir, 'full-export.json');
    
    if (fullExportPath && existsSync(fullExportPath)) {
      logger.info(`Found full-export.json at ${fullExportPath}. Using consolidated import.`);
      
      // Import from full export file
      const fullExportContent = readFileSync(fullExportPath, 'utf-8'); // Safe to read validated path
      const fullExport: FullExport = JSON.parse(fullExportContent);

      // 2a. Import nodes from full export
      for (const label in fullExport.nodes) {
        if (Object.prototype.hasOwnProperty.call(fullExport.nodes, label)) {
          const nodesToImport = fullExport.nodes[label];
          if (!nodesToImport || nodesToImport.length === 0) {
            logger.info(`No ${label} nodes to import from full-export.json.`);
            continue;
          }
          logger.debug(`Importing ${nodesToImport.length} ${label} nodes from full-export.json`);
          const escapedLabel = `\`${label.replace(/`/g, '``')}\``; 
          const query = `UNWIND $nodes as nodeProps CREATE (n:${escapedLabel}) SET n = nodeProps`;
          // Wrap node creation in executeWrite
          await session.executeWrite(async tx => {
            logger.debug(`Executing node creation transaction for label ${label} (full-export)...`);
            await tx.run(query, { nodes: nodesToImport });
            logger.debug(`Node creation transaction for label ${label} (full-export) executed.`);
          });
          logger.info(`Successfully imported ${nodesToImport.length} ${label} nodes from full-export.json`);
        }
      }

      // 3a. Import relationships from full export
      if (fullExport.relationships && fullExport.relationships.length > 0) {
        logger.info(`Found ${fullExport.relationships.length} relationships in full-export.json.`);
        relationships = fullExport.relationships;
      } else {
        logger.info(`No relationships found in full-export.json.`);
      }
    } else {
      logger.info(`No full-export.json found or path invalid. Using individual entity files from ${backupDir}.`);

      // 2b. Import nodes from individual files
      const filesInBackupDir = readdirSync(backupDir); // Read from validated dir
      const nodeFiles = filesInBackupDir.filter(file => 
        file.toLowerCase().endsWith('.json') && 
        file !== 'relationships.json' && 
        file !== 'full-export.json'
      );

      for (const nodeFile of nodeFiles) {
        const filePath = secureResolve(backupDir, nodeFile); // Securely resolve path
        if (!filePath) {
            logger.warning(`Skipping potentially insecure node file path: ${nodeFile} in ${backupDir}`);
            continue;
        }
        
        // Infer label from filename
        const inferredLabelFromFile = path.basename(nodeFile, '.json');
        const label = inferredLabelFromFile.endsWith('s') 
          ? inferredLabelFromFile.charAt(0).toUpperCase() + inferredLabelFromFile.slice(1, -1) 
          : inferredLabelFromFile.charAt(0).toUpperCase() + inferredLabelFromFile.slice(1);

        if (!existsSync(filePath)) { // Check validated path
          logger.warning(`Node file ${nodeFile} (inferred label ${label}) not found at ${filePath}. Skipping.`);
          continue;
        }

        logger.debug(`Importing nodes with inferred label: ${label} from ${filePath}`);
        const fileContent = readFileSync(filePath, 'utf-8'); // Read validated path
        const nodesToImport: Record<string, any>[] = JSON.parse(fileContent);

        if (nodesToImport.length === 0) {
          logger.info(`No ${label} nodes to import from ${filePath}.`);
          continue;
        }

        const escapedLabel = `\`${label.replace(/`/g, '``')}\``; 
        const query = `UNWIND $nodes as nodeProps CREATE (n:${escapedLabel}) SET n = nodeProps`;
        // Wrap node creation in executeWrite
        await session.executeWrite(async tx => {
           logger.debug(`Executing node creation transaction for label ${label} (individual file)...`);
           await tx.run(query, { nodes: nodesToImport });
           logger.debug(`Node creation transaction for label ${label} (individual file) executed.`);
        });
        logger.info(`Successfully imported ${nodesToImport.length} ${label} nodes from ${filePath}`);
      }

      // 3b. Import Relationships from relationships.json
      const relFilePath = secureResolve(backupDir, 'relationships.json'); // Securely resolve path
      if (relFilePath && existsSync(relFilePath)) { // Check validated path
        logger.info(`Importing relationships from ${relFilePath}...`);
        const relFileContent = readFileSync(relFilePath, 'utf-8'); // Read validated path
        relationships = JSON.parse(relFileContent);
        
        if (relationships.length === 0) {
          logger.info(`No relationships found to import in ${relFilePath}.`);
        }
      } else {
        logger.warning(`Relationships file not found or path invalid: ${relFilePath}. Skipping relationship import.`);
      }
    }

    // Process relationships (common code)
    if (relationships.length > 0) {
      logger.info(`Attempting to import ${relationships.length} relationships individually...`);
      let importedCount = 0;
      let failedCount = 0;
      const batchSize = 500; 
      
      for (let i = 0; i < relationships.length; i += batchSize) {
        const batch = relationships.slice(i, i + batchSize);
        logger.debug(`Processing relationship batch ${i / batchSize + 1}...`);
        try {
          await session.executeWrite(async tx => {
            logger.debug(`Executing relationship creation transaction batch ${i / batchSize + 1}...`);
            for (const rel of batch) {
              if (!rel.startNodeId || !rel.endNodeId || !rel.type) {
                logger.warning(`Skipping relationship due to missing data: ${JSON.stringify(rel)}`);
                failedCount++;
                continue;
              }
              const escapedType = escapeRelationshipType(rel.type);
              const relQuery = `
                MATCH (start {id: $startNodeId})
                MATCH (end {id: $endNodeId})
                CREATE (start)-[r:${escapedType}]->(end)
                SET r = $properties
              `;
              try {
                logger.debug(`Running query for relationship: ${rel.type} from ${rel.startNodeId} to ${rel.endNodeId}`);
                await tx.run(relQuery, {
                  startNodeId: rel.startNodeId,
                  endNodeId: rel.endNodeId,
                  properties: rel.properties || {}
                });
                logger.debug(`Query executed for relationship: ${rel.type}`);
                importedCount++;
              } catch (relError) {
                const errorMsg = relError instanceof Error ? relError.message : String(relError);
                logger.error(`Failed to create relationship ${rel.type} from ${rel.startNodeId} to ${rel.endNodeId}: ${errorMsg}`, { relationship: rel });
                failedCount++;
              }
            }
            logger.debug(`Relationship creation transaction batch ${i / batchSize + 1} finished.`);
          });
          logger.debug(`Completed relationship batch ${i / batchSize + 1}.`);
        } catch (batchError) {
          const errorMsg = batchError instanceof Error ? batchError.message : String(batchError);
          logger.error(`Failed to process relationship batch starting at index ${i}: ${errorMsg}`);
          failedCount += batch.length - (batch.filter(rel => !rel.startNodeId || !rel.endNodeId || !rel.type).length); 
        }
      }
      logger.info(`Relationship import summary: Attempted=${relationships.length}, Succeeded=${importedCount}, Failed=${failedCount}`);
    } else {
      logger.info(`No relationships to import.`);
    }

    logger.info("Database import completed successfully.");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Database import failed: ${errorMessage}`, { error });
    throw new Error(`Database import failed: ${errorMessage}`);
  } finally {
    if (session) {
      await session.close(); // Close session if it was opened
    }
  }
};
