import dotenv from "dotenv";
import { readFileSync, mkdirSync, existsSync, statSync } from "fs";
import path, { dirname, join } from "path";
import { fileURLToPath } from "url";
import { z } from 'zod';

dotenv.config(); // Load environment variables from .env file

// --- Determine Project Root ---
/**
 * Finds the project root directory by searching upwards for package.json.
 * @param startDir The directory to start searching from.
 * @returns The absolute path to the project root, or throws an error if not found.
 */
const findProjectRoot = (startDir: string): string => {
    let currentDir = startDir;
    while (true) {
        const packageJsonPath = join(currentDir, 'package.json');
        if (existsSync(packageJsonPath)) {
            // console.log(`Project root found at: ${currentDir}`); // Log successful discovery
            return currentDir;
        }
        const parentDir = dirname(currentDir);
        if (parentDir === currentDir) {
            throw new Error(`Could not find project root (package.json) starting from ${startDir}`);
        }
        currentDir = parentDir;
    }
};

let projectRoot: string;
try {
    const currentModuleDir = dirname(fileURLToPath(import.meta.url));
    projectRoot = findProjectRoot(currentModuleDir);
} catch (error: any) {
    console.error(`FATAL: Error determining project root: ${error.message}`);
    projectRoot = process.cwd(); 
    console.warn(`Warning: Using process.cwd() (${projectRoot}) as fallback project root.`);
}
// --- End Determine Project Root ---

// --- Reading package.json ---
const packageJsonPath = path.resolve(projectRoot, 'package.json');
let pkg: { name: string; version: string } = { name: 'atlas-mcp-server-unknown', version: '0.0.0' }; // Default

try {
  if (!packageJsonPath.startsWith(projectRoot + path.sep)) {
    throw new Error(`package.json path resolves outside project root: ${packageJsonPath}`);
  }
  pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
} catch (error: any) {
  console.error(`FATAL: Could not read or parse package.json at ${packageJsonPath}. Error: ${error.message}`);
}
// --- End Reading package.json ---

// Define a schema for environment variables for validation and type safety
const EnvSchema = z.object({
  MCP_SERVER_NAME: z.string().optional(),
  MCP_SERVER_VERSION: z.string().optional(),
  MCP_LOG_LEVEL: z.string().default("info"),
  NODE_ENV: z.string().default("development"),
  MCP_TRANSPORT_TYPE: z.enum(['stdio', 'http']).default('stdio'),
  MCP_HTTP_PORT: z.coerce.number().int().positive().default(3010),
  MCP_HTTP_HOST: z.string().default('127.0.0.1'),
  MCP_ALLOWED_ORIGINS: z.string().optional(), // Comma-separated string
  MCP_AUTH_SECRET_KEY: z.string().min(32, "MCP_AUTH_SECRET_KEY must be at least 32 characters long for security").optional(),
  MCP_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000), // 1 minute
  MCP_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),

  NEO4J_URI: z.string().default("bolt://localhost:7687"),
  NEO4J_USER: z.string().default("neo4j"),
  NEO4J_PASSWORD: z.string().default("password"),

  BACKUP_FILE_DIR: z.string().default(path.join(projectRoot, "backups")), // Default relative to project root
  BACKUP_MAX_COUNT: z.coerce.number().int().min(0).default(10),
});

// Parse and validate environment variables
const parsedEnv = EnvSchema.safeParse(process.env);

if (!parsedEnv.success) {
  if (process.stdout.isTTY) { // Guarded console.error
    console.error("❌ Invalid environment variables:", parsedEnv.error.flatten().fieldErrors);
  }
  // For critical configs, you might want to throw an error or exit.
  // For now, we log and proceed with defaults where possible (Zod handles defaults).
}

const env = parsedEnv.success ? parsedEnv.data : EnvSchema.parse({}); // Use defaults on failure

// --- Backup Directory Handling ---
/**
 * Ensures the backup directory exists and is within the project root.
 * @param backupPath The desired path for the backup directory (can be relative or absolute).
 * @param rootDir The root directory of the project to contain the backups.
 * @returns The validated, absolute path to the backup directory, or null if invalid.
 */
const ensureBackupDir = (backupPath: string, rootDir: string): string | null => {
  const resolvedBackupPath = path.isAbsolute(backupPath) ? backupPath : path.resolve(rootDir, backupPath);

  if (!resolvedBackupPath.startsWith(rootDir + path.sep) && resolvedBackupPath !== rootDir) {
    console.error(`Error: Backup path "${backupPath}" resolves outside the project boundary: ${resolvedBackupPath}`);
    return null;
  }

  if (!existsSync(resolvedBackupPath)) {
    try {
      mkdirSync(resolvedBackupPath, { recursive: true });
      console.log(`Created backup directory: ${resolvedBackupPath}`);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`Error creating backup directory at ${resolvedBackupPath}: ${errorMessage}`);
      return null;
    }
  } else {
    try {
        const stats = statSync(resolvedBackupPath);
        if (!stats.isDirectory()) {
            console.error(`Error: Backup path ${resolvedBackupPath} exists but is not a directory.`);
            return null;
        }
    } catch (statError: any) {
        console.error(`Error accessing backup path ${resolvedBackupPath}: ${statError.message}`);
        return null;
    }
  }
  return resolvedBackupPath;
};

const validatedBackupPath = ensureBackupDir(env.BACKUP_FILE_DIR, projectRoot);

if (!validatedBackupPath) {
    console.error("FATAL: Backup directory configuration is invalid or could not be created. Exiting.");
    process.exit(1); 
}
// --- End Backup Directory Handling ---

/**
 * Main application configuration object.
 */
export const config = {
  mcpServerName: env.MCP_SERVER_NAME || pkg.name,
  mcpServerVersion: env.MCP_SERVER_VERSION || pkg.version,
  logLevel: env.MCP_LOG_LEVEL,
  environment: env.NODE_ENV,
  
  mcpTransportType: env.MCP_TRANSPORT_TYPE,
  mcpHttpPort: env.MCP_HTTP_PORT,
  mcpHttpHost: env.MCP_HTTP_HOST,
  mcpAllowedOrigins: env.MCP_ALLOWED_ORIGINS?.split(',').map(origin => origin.trim()).filter(Boolean),
  mcpAuthSecretKey: env.MCP_AUTH_SECRET_KEY,

  neo4jUri: env.NEO4J_URI,
  neo4jUser: env.NEO4J_USER,
  neo4jPassword: env.NEO4J_PASSWORD,
  
  backup: {
    maxBackups: env.BACKUP_MAX_COUNT,
    backupPath: validatedBackupPath 
  },

  // Retaining the original security structure for now, can be integrated with MCP_AUTH_SECRET_KEY later if needed
  security: {
    authRequired: !!env.MCP_AUTH_SECRET_KEY, // Example: auth is required if a secret key is provided
    rateLimitWindowMs: env.MCP_RATE_LIMIT_WINDOW_MS,
    rateLimitMaxRequests: env.MCP_RATE_LIMIT_MAX_REQUESTS,
  }
};

/**
 * The configured logging level for the application.
 */
export const logLevel = config.logLevel;

/**
 * The configured runtime environment for the application.
 */
export const environment = config.environment;
