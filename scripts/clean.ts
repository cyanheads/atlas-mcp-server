#!/usr/bin/env node

/**
 * Clean Script
 * ============
 * 
 * Description:
 *   A utility script to clean build artifacts and temporary directories from your project.
 *   By default, it removes the 'dist' and 'logs' directories if they exist.
 * 
 * Usage:
 *   - Add to package.json: "clean": "ts-node --esm scripts/clean.ts" (or similar)
 *   - Often used in rebuild scripts: "rebuild": "ts-node --esm scripts/clean.ts && npm run build"
 *   - Can be used with arguments to specify custom directories: ts-node --esm scripts/clean.ts temp coverage
 * 
 * Platform compatibility:
 *   - Works on all platforms (Windows, macOS, Linux) using Node.js path normalization
 */

import { access, rm } from 'fs/promises';
import { join } from 'path';

/**
 * Interface for clean operation result
 */
interface CleanResult {
  dir: string;
  status: 'success' | 'skipped';
  reason?: string;
}

/**
 * Check if a directory exists without using fs.Stats
 */
async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    await access(dirPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Main clean function
 */
const clean = async (): Promise<void> => {
  try {
    // Default directories to clean
    let dirsToClean: string[] = ['dist', 'logs'];
    
    // If directories are specified as command line arguments, use those instead
    const args = process.argv.slice(2);
    if (args.length > 0) {
      dirsToClean = args;
    }
    
    console.log(`Cleaning directories: ${dirsToClean.join(', ')}`);

    // Process each directory
    const results = await Promise.allSettled(
      dirsToClean.map(async (dir): Promise<CleanResult> => {  
        const dirPath = join(process.cwd(), dir);
        
        try {
          // Check if directory exists before attempting to remove it
          const exists = await directoryExists(dirPath);
          
          if (!exists) {
            return { dir, status: 'skipped', reason: 'does not exist' };
          }
          
          // Remove directory if it exists
          await rm(dirPath, { recursive: true, force: true });
          return { dir, status: 'success' };
        } catch (error) {
          throw error;
        }
      })
    );

    // Report results
    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { dir, status, reason } = result.value;
        if (status === 'success') {
          console.log(`✓ Successfully cleaned ${dir} directory`);
        } else {
          console.log(`- ${dir} directory ${reason}, skipping cleanup`);
        }
      } else {
        console.error(`× Error cleaning directory: ${result.reason}`);
      }
    }
  } catch (error) {
    console.error('× Error during cleanup:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
};

// Execute the clean function
clean();
