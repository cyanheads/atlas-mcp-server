/**
 * Handles the setup and connection for the Stdio MCP transport.
 * Implements the MCP Specification 2025-03-26 for stdio transport.
 * This transport communicates directly over standard input (stdin) and
 * standard output (stdout), typically used when the MCP server is launched
 * as a child process by a host application.
 *
 * Specification Reference:
 * https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-03-26/basic/transports.mdx#stdio
 *
 * --- Authentication Note ---
 * As per the MCP Authorization Specification (2025-03-26, Section 1.2),
 * STDIO transports SHOULD NOT implement HTTP-based authentication flows.
 * Authorization is typically handled implicitly by the host application
 * controlling the server process. This implementation follows that guideline.
 *
 * @see {@link https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-03-26/basic/authorization.mdx | MCP Authorization Specification}
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
// Import core utilities: ErrorHandler for centralized error management and logger for logging.
import { ErrorHandler, logger } from '../../utils/index.js';

/**
 * Connects a given McpServer instance to the Stdio transport. (Asynchronous)
 * Initializes the SDK's StdioServerTransport, which handles reading newline-delimited
 * JSON-RPC messages from process.stdin and writing corresponding messages to process.stdout,
 * adhering to the MCP stdio transport specification.
 *
 * MCP Spec Points Covered by SDK's StdioServerTransport:
 * - Reads JSON-RPC messages (requests, notifications, responses, batches) from stdin.
 * - Writes JSON-RPC messages to stdout.
 * - Handles newline delimiters and ensures no embedded newlines in output messages.
 * - Ensures only valid MCP messages are written to stdout.
 *
 * Note: Logging via the `logger` utility MAY result in output to stderr, which is
 * permitted by the spec for logging purposes.
 *
 * @param {McpServer} server - The McpServer instance containing the core logic (tools, resources).
 * @param {Record<string, any>} context - Logging context for correlation.
 * @returns {Promise<void>} A promise that resolves when the connection is successfully established.
 * @throws {Error} Throws an error if the connection fails during setup (e.g., issues connecting server to transport).
 */
export async function connectStdioTransport(server: McpServer, context: Record<string, any>): Promise<void> {
  // Add a specific operation name to the context for better log filtering.
  const operationContext = { ...context, operation: 'connectStdioTransport', transportType: 'Stdio' };
  logger.debug('Attempting to connect stdio transport...', operationContext);

  try {
    logger.debug('Creating StdioServerTransport instance...', operationContext);
    // Instantiate the transport provided by the SDK for standard I/O communication.
    // This class encapsulates the logic for reading from stdin and writing to stdout
    // according to the MCP stdio spec.
    const transport = new StdioServerTransport();

    logger.debug('Connecting McpServer instance to StdioServerTransport...', operationContext);
    // Establish the link between the server's core logic and the transport layer.
    // This internally starts the necessary listeners on process.stdin.
    await server.connect(transport);

    // Log successful connection. The server is now ready to process messages via stdio.
    logger.info('MCP Server connected and listening via stdio transport.', operationContext);
    // Use console.log for prominent startup message visibility when run directly, only if TTY.
    if (process.stdout.isTTY) {
      console.log(`\n🚀 MCP Server running in STDIO mode.\n   (MCP Spec: 2025-03-26 Stdio Transport)\n`);
    }

  } catch (err) {
    // Catch and handle any critical errors during the transport connection setup.
    // Mark as critical because the server cannot function without a connected transport.
    ErrorHandler.handleError(err, { ...operationContext, critical: true });
    // Rethrow the error to signal the failure to the calling code (e.g., the main server startup).
    throw err;
  }
}
