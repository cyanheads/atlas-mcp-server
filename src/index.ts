#!/usr/bin/env node

// Imports MUST be at the top level
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config, environment } from "./config/index.js"; // This loads .env via dotenv.config()
import { initializeAndStartServer } from "./mcp/server.js";
import { logger, McpLogLevel, requestContextService } from "./utils/index.js";
import { closeNeo4jConnection } from "./services/neo4j/index.js";

/**
 * The main MCP server instance, stored if transport is stdio for shutdown.
 * @type {McpServer | undefined}
 */
let serverInstance: McpServer | undefined;

/**
 * Gracefully shuts down the main MCP server and related services.
 * Handles process termination signals (SIGTERM, SIGINT) and critical errors.
 *
 * @param signal - The signal or event name that triggered the shutdown (e.g., "SIGTERM", "uncaughtException").
 */
const shutdown = async (signal: string) => {
  const shutdownContext = {
    operation: 'Shutdown',
    signal,
    appName: config.mcpServerName,
  };

  logger.info(`Received ${signal}. Starting graceful shutdown for ${config.mcpServerName}...`, shutdownContext);

  try {
    if (serverInstance) {
      logger.info("Closing main MCP server instance...", shutdownContext);
      await serverInstance.close();
      logger.info("Main MCP server instance closed successfully.", shutdownContext);
    } else {
      logger.info("No global MCP server instance to close (expected for HTTP transport or if not yet initialized).", shutdownContext);
    }

    logger.info("Closing Neo4j driver connection...", shutdownContext);
    await closeNeo4jConnection();
    logger.info("Neo4j driver connection closed successfully.", shutdownContext);

    logger.info(`Graceful shutdown for ${config.mcpServerName} completed successfully. Exiting.`, shutdownContext);
    process.exit(0);
  } catch (error) {
    logger.error("Critical error during shutdown", {
      ...shutdownContext,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    process.exit(1);
  }
};

/**
 * Initializes and starts the main MCP server.
 * Sets up logging, request context, initializes the server instance, starts the transport,
 * and registers signal handlers for graceful shutdown and error handling.
 */
const start = async () => {
  // --- Logger Initialization ---
  const validMcpLogLevels: McpLogLevel[] = ['debug', 'info', 'notice', 'warning', 'error', 'crit', 'alert', 'emerg'];
  const initialLogLevelConfig = config.logLevel;
  let validatedMcpLogLevel: McpLogLevel = 'info'; // Default

  if (validMcpLogLevels.includes(initialLogLevelConfig as McpLogLevel)) {
    validatedMcpLogLevel = initialLogLevelConfig as McpLogLevel;
  } else {
    // Use console.warn here as logger isn't fully initialized yet, only if TTY
    if (process.stdout.isTTY) {
      console.warn(`Invalid MCP_LOG_LEVEL "${initialLogLevelConfig}" provided via config/env. Defaulting to "info".`);
    }
  }
  // Initialize the logger with the validated MCP level and wait for it to complete.
  await logger.initialize(validatedMcpLogLevel);
  // The logger.initialize() method itself logs its status, so no redundant log here.
  // --- End Logger Initialization ---

  logger.debug("Configuration loaded successfully", { config });

  const transportType = config.mcpTransportType;
  const startupContext = requestContextService.createRequestContext({
    operation: `AtlasServerStartup_${transportType}`,
    appName: config.mcpServerName,
    appVersion: config.mcpServerVersion,
    environment: environment
  });

  logger.info(`Starting ${config.mcpServerName} v${config.mcpServerVersion} (Transport: ${transportType})...`, startupContext);

  try {
    logger.debug("Initializing and starting MCP server transport...", startupContext);

    const potentialServer = await initializeAndStartServer();

    if (transportType === 'stdio' && potentialServer instanceof McpServer) {
      serverInstance = potentialServer;
      logger.debug("Stored McpServer instance for stdio transport.", startupContext);
    } else if (transportType === 'http') {
      logger.debug("HTTP transport started. Server instances are session-specific.", startupContext);
    }

    logger.info(`${config.mcpServerName} is running with ${transportType} transport.`, {
      ...startupContext,
      startTime: new Date().toISOString(),
    });

    // --- Signal and Error Handling Setup ---
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

    process.on("uncaughtException", async (error) => {
      const errorContext = {
        ...startupContext,
        event: 'uncaughtException',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      };
      logger.error("Uncaught exception detected. Initiating shutdown...", errorContext);
      await shutdown("uncaughtException");
    });

    process.on("unhandledRejection", async (reason: unknown) => {
      const rejectionContext = {
        ...startupContext,
        event: 'unhandledRejection',
        reason: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined
      };
      logger.error("Unhandled promise rejection detected. Initiating shutdown...", rejectionContext);
      await shutdown("unhandledRejection");
    });

  } catch (error) {
    logger.error("Critical error during ATLAS MCP Server startup, exiting.", {
      ...startupContext,
      finalErrorContext: 'Startup Failure',
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
};

// --- Async IIFE to allow top-level await ---
(async () => {
  await start();
})();
