/**
 * Main entry point for the MCP (Model Context Protocol) server.
 * This file orchestrates the server's lifecycle:
 * 1. Initializes the core McpServer instance with its identity and capabilities.
 * 2. Registers available resources and tools, making them discoverable and usable by clients.
 * 3. Selects and starts the appropriate communication transport (stdio or Streamable HTTP)
 *    based on configuration.
 * 4. Handles top-level error management during startup.
 *
 * MCP Specification References:
 * - Lifecycle: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-03-26/basic/lifecycle.mdx
 * - Overview (Capabilities): https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-03-26/basic/index.mdx
 * - Transports: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-03-26/basic/transports.mdx
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
// Import validated configuration and environment details.
import { config, environment } from '../config/index.js';
// Import core utilities: ErrorHandler, logger, requestContextService.
import { ErrorHandler, logger, requestContextService } from '../utils/index.js'; // Corrected path
import { initializeNeo4jSchema } from '../services/neo4j/index.js'; // Corrected path

// Import tool registrations
import { registerAtlasProjectCreateTool } from './tools/atlas_project_create/index.js';
import { registerAtlasProjectDeleteTool } from './tools/atlas_project_delete/index.js';
import { registerAtlasProjectListTool } from './tools/atlas_project_list/index.js';
import { registerAtlasProjectUpdateTool } from './tools/atlas_project_update/index.js';
import { registerAtlasTaskCreateTool } from './tools/atlas_task_create/index.js';
import { registerAtlasTaskDeleteTool } from './tools/atlas_task_delete/index.js';
import { registerAtlasTaskListTool } from './tools/atlas_task_list/index.js';
import { registerAtlasTaskUpdateTool } from './tools/atlas_task_update/index.js';
import { registerAtlasDatabaseCleanTool } from './tools/atlas_database_clean/index.js';
import { registerAtlasKnowledgeAddTool } from './tools/atlas_knowledge_add/index.js';
import { registerAtlasKnowledgeDeleteTool } from './tools/atlas_knowledge_delete/index.js';
import { registerAtlasKnowledgeListTool } from './tools/atlas_knowledge_list/index.js';
import { registerAtlasUnifiedSearchTool } from './tools/atlas_unified_search/index.js';
import { registerAtlasDeepResearchTool } from './tools/atlas_deep_research/index.js';

// Import resource registrations
import { registerMcpResources } from './resources/index.js'; // Adjusted path

// Import transport setup functions.
import { startHttpTransport } from './transports/httpTransport.js';
import { connectStdioTransport } from './transports/stdioTransport.js';


/**
 * Creates and configures a new instance of the McpServer.
 *
 * This function is central to defining the server's identity and functionality
 * as presented to connecting clients during the MCP initialization phase.
 */
async function createMcpServerInstance(): Promise<McpServer> {
  const context = { operation: 'createMcpServerInstance' };
  logger.info('Initializing MCP server instance for ATLAS MCP Server', context);

  // Configure the request context service (used for correlating logs/errors).
  requestContextService.configure({
    appName: config.mcpServerName,
    appVersion: config.mcpServerVersion,
    environment,
  });

  // Initialize Neo4j database and services
  logger.info('Initializing Neo4j schema...', context);
  await initializeNeo4jSchema();
  logger.info('Neo4j schema initialized successfully', context);

  // Instantiate the core McpServer using the SDK.
  logger.debug('Instantiating McpServer with capabilities', {
    ...context,
    serverInfo: { name: config.mcpServerName, version: config.mcpServerVersion },
    capabilities: {
      logging: {}, // Indicates support for logging control and notifications
      resources: { listChanged: true }, // Supports dynamic resource lists
      tools: {
        listChanged: true, // Supports dynamic tool lists
        requestContext: true, // Enable request context for all tools
        rateLimit: { // Default rate limit settings for tools
          windowMs: config.security.rateLimitWindowMs || 60 * 1000, // Use config or default
          maxRequests: config.security.rateLimitMaxRequests || 100, // Use config or default
        },
        permissions: { // Permissions requirements for tools
          required: config.security.authRequired,
        },
      },
    }
  });

  const server = new McpServer(
    { name: config.mcpServerName, version: config.mcpServerVersion },
    {
      capabilities: {
        logging: {},
        resources: { listChanged: true },
        tools: {
          listChanged: true,
          requestContext: true,
          rateLimit: {
            windowMs: config.security.rateLimitWindowMs || 60 * 1000,
            maxRequests: config.security.rateLimitMaxRequests || 100,
          },
          permissions: {
            required: config.security.authRequired,
          },
        },
      }
    }
  );

  try {
    logger.debug('Registering ATLAS resources and tools...', context);
    // Register Atlas resources
    await registerMcpResources(server);

    // Register Atlas tools
    await registerAtlasProjectCreateTool(server);
    await registerAtlasProjectListTool(server);
    await registerAtlasProjectUpdateTool(server);
    await registerAtlasProjectDeleteTool(server);
    await registerAtlasTaskCreateTool(server);
    await registerAtlasTaskDeleteTool(server);
    await registerAtlasTaskListTool(server);
    await registerAtlasTaskUpdateTool(server);
    await registerAtlasDatabaseCleanTool(server);
    await registerAtlasKnowledgeAddTool(server);
    await registerAtlasKnowledgeDeleteTool(server);
    await registerAtlasKnowledgeListTool(server);
    await registerAtlasUnifiedSearchTool(server);
    await registerAtlasDeepResearchTool(server);

    logger.info('ATLAS Resources and tools registered successfully', context);
  } catch (err) {
    logger.error('Failed to register ATLAS resources/tools', {
      ...context,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    throw err;
  }

  return server;
}


/**
 * Selects, sets up, and starts the appropriate MCP transport layer based on configuration.
 */
async function startTransport(): Promise<McpServer | void> {
  const transportType = config.mcpTransportType;
  const context = { operation: 'startTransport', transport: transportType };
  logger.info(`Starting transport for ATLAS MCP Server: ${transportType}`, context);

  if (transportType === 'http') {
    logger.debug('Delegating to startHttpTransport for ATLAS MCP Server...', context);
    await startHttpTransport(createMcpServerInstance, context);
    return;
  }

  if (transportType === 'stdio') {
    logger.debug('Creating single McpServer instance for stdio transport (ATLAS MCP Server)...', context);
    const server = await createMcpServerInstance();
    logger.debug('Delegating to connectStdioTransport for ATLAS MCP Server...', context);
    await connectStdioTransport(server, context);
    return server;
  }

  logger.fatal(`Unsupported transport type configured for ATLAS MCP Server: ${transportType}`, context);
  throw new Error(`Unsupported transport type: ${transportType}. Must be 'stdio' or 'http'.`);
}

/**
 * Main application entry point. Initializes and starts the MCP server.
 */
export async function initializeAndStartServer(): Promise<void | McpServer> {
  const context = { operation: 'initializeAndStartServer' };
  logger.info('ATLAS MCP Server initialization sequence started.', context);
  try {
    const result = await startTransport();
    logger.info('ATLAS MCP Server initialization sequence completed successfully.', context);
    return result;
  } catch (err) {
    logger.fatal('Critical error during ATLAS MCP server initialization.', {
      ...context,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    ErrorHandler.handleError(err, { ...context, critical: true });
    logger.info('Exiting process due to critical initialization error (ATLAS MCP Server).', context);
    process.exit(1);
  }
}
