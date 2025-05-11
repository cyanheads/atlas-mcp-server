/**
 * Handles the setup and management of the Streamable HTTP MCP transport.
 * Implements the MCP Specification 2025-03-26 for Streamable HTTP.
 * Includes Express server creation, middleware (CORS, Auth), request routing
 * (POST/GET/DELETE on a single endpoint), session handling, SSE streaming,
 * and port binding with retry logic.
 *
 * Specification Reference:
 * https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-03-26/basic/transports.mdx#streamable-http
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'; // SDK type guard for InitializeRequest
import express, { NextFunction, Request, Response } from 'express';
import http from 'http';
import { randomUUID } from 'node:crypto';
// Import config and utils
import { config } from '../../config/index.js'; // Import the validated config object
import { logger } from '../../utils/index.js';
import { mcpAuthMiddleware } from './authentication/authMiddleware.js'; // Import the auth middleware

// --- Configuration Constants (Derived from imported config) ---

/**
 * The port number for the HTTP transport, configured via MCP_HTTP_PORT.
 * Defaults to 3010 (defined in config/index.ts).
 * @constant {number} HTTP_PORT
 */
const HTTP_PORT = config.mcpHttpPort;

/**
 * The host address for the HTTP transport, configured via MCP_HTTP_HOST.
 * Defaults to '127.0.0.1' (defined in config/index.ts).
 * MCP Spec Security: Recommends binding to localhost for local servers.
 * @constant {string} HTTP_HOST
 */
const HTTP_HOST = config.mcpHttpHost;

/**
 * The single HTTP endpoint path for all MCP communication, as required by the spec.
 * Supports POST, GET, DELETE, OPTIONS methods.
 * @constant {string} MCP_ENDPOINT_PATH
 */
const MCP_ENDPOINT_PATH = '/mcp';

/**
 * Maximum number of attempts to find an available port if the initial HTTP_PORT is in use.
 * Tries ports sequentially: HTTP_PORT, HTTP_PORT + 1, ...
 * @constant {number} MAX_PORT_RETRIES
 */
const MAX_PORT_RETRIES = 15;

/**
 * Stores active StreamableHTTPServerTransport instances, keyed by their session ID.
 * Essential for routing subsequent requests to the correct stateful session.
 * @type {Record<string, StreamableHTTPServerTransport>}
 */
const httpTransports: Record<string, StreamableHTTPServerTransport> = {};

/**
 * Checks if an incoming HTTP request's origin header is permissible.
 * MCP Spec Security: Servers MUST validate the `Origin` header.
 * This function checks against `MCP_ALLOWED_ORIGINS` and allows requests
 * from localhost if the server is bound locally. Sets CORS headers if allowed.
 *
 * @param {Request} req - Express request object.
 * @param {Response} res - Express response object.
 * @returns {boolean} True if the origin is allowed, false otherwise.
 */
function isOriginAllowed(req: Request, res: Response): boolean {
  const origin = req.headers.origin;
  const host = req.hostname; // Considers Host header
  const isLocalhostBinding = ['127.0.0.1', '::1', 'localhost'].includes(host);
  const allowedOrigins = config.mcpAllowedOrigins || []; // Use parsed array from config
  const context = { operation: 'isOriginAllowed', origin, host, isLocalhostBinding, allowedOrigins };
  logger.debug('Checking origin allowance', context);

  // Determine if allowed based on config or localhost binding
  const allowed = (origin && allowedOrigins.includes(origin)) || (isLocalhostBinding && (!origin || origin === 'null'));

  if (allowed && origin) {
    // Origin is allowed and present, set specific CORS headers.
    res.setHeader('Access-Control-Allow-Origin', origin);
    // MCP Spec: Streamable HTTP uses POST, GET, DELETE. OPTIONS is for preflight.
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    // MCP Spec: Requires Mcp-Session-Id. Last-Event-ID for SSE resumption. Content-Type is standard. Authorization for security.
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id, Last-Event-ID, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true'); // Set based on whether auth/cookies are used
  } else if (allowed && !origin) {
    // Allowed (e.g., localhost binding, file:// origin), but no origin header to echo back. No specific CORS needed.
  } else if (!allowed && origin) {
    // Origin provided but not in allowed list. Log warning.
    logger.warning(`Origin denied: ${origin}`, context);
  }
  logger.debug(`Origin check result: ${allowed}`, { ...context, allowed });
  return allowed;
}

/**
 * Proactively checks if a specific port is already in use. (Asynchronous)
 * @param {number} port - Port to check.
 * @param {string} host - Host address to check.
 * @param {Record<string, any>} context - Logging context.
 * @returns {Promise<boolean>} True if port is in use (EADDRINUSE), false otherwise.
 */
async function isPortInUse(port: number, host: string, context: Record<string, any>): Promise<boolean> {
  const checkContext = { ...context, operation: 'isPortInUse', port, host };
  logger.debug(`Proactively checking port usability...`, checkContext);
  return new Promise((resolve) => {
    const tempServer = http.createServer();
    tempServer
      .once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          logger.debug(`Proactive check: Port confirmed in use (EADDRINUSE).`, checkContext);
          resolve(true); // Port is definitely in use
        } else {
          logger.debug(`Proactive check: Non-EADDRINUSE error encountered: ${err.message}`, { ...checkContext, errorCode: err.code });
          resolve(false); // Other error, let main listen attempt handle it
        }
      })
      .once('listening', () => {
        logger.debug(`Proactive check: Port is available.`, checkContext);
        tempServer.close(() => resolve(false)); // Port is free
      })
      .listen(port, host);
  });
}


/**
 * Attempts to start the HTTP server, retrying on incrementing ports if EADDRINUSE occurs. (Asynchronous)
 * Uses proactive checks before attempting to bind the main server instance.
 *
 * @param {http.Server} serverInstance - The Node.js HTTP server instance.
 * @param {number} initialPort - The starting port number.
 * @param {string} host - The host address to bind to.
 * @param {number} maxRetries - Maximum number of additional ports to try.
 * @param {Record<string, any>} context - Logging context.
 * @returns {Promise<number>} Resolves with the port number successfully bound to.
 * @throws {Error} Rejects if binding fails after all retries or for non-EADDRINUSE errors.
 */
function startHttpServerWithRetry(
  serverInstance: http.Server,
  initialPort: number,
  host: string,
  maxRetries: number,
  context: Record<string, any>
): Promise<number> {
  const startContext = { ...context, operation: 'startHttpServerWithRetry', initialPort, host, maxRetries };
  logger.debug(`Attempting to start HTTP server...`, startContext);
  return new Promise(async (resolve, reject) => {
    let lastError: Error | null = null;
    for (let i = 0; i <= maxRetries; i++) {
      const currentPort = initialPort + i;
      const attemptContext = { ...startContext, port: currentPort, attempt: i + 1, maxAttempts: maxRetries + 1 };
      logger.debug(`Attempting port ${currentPort} (${attemptContext.attempt}/${attemptContext.maxAttempts})`, attemptContext);

      // 1. Proactive Check
      if (await isPortInUse(currentPort, host, attemptContext)) {
        logger.warning(`Proactive check detected port ${currentPort} is in use, retrying...`, attemptContext);
        lastError = new Error(`EADDRINUSE: Port ${currentPort} detected as in use by proactive check.`);
        await new Promise(res => setTimeout(res, 100)); // Short delay
        continue; // Try next port
      }

      // 2. Attempt Main Server Bind
      try {
        await new Promise<void>((listenResolve, listenReject) => {
          serverInstance.listen(currentPort, host, () => {
            const serverAddress = `http://${host}:${currentPort}${MCP_ENDPOINT_PATH}`;
            logger.info(`HTTP transport successfully listening on host ${host} at ${serverAddress}`, { ...attemptContext, address: serverAddress });
            listenResolve(); // Success
          }).on('error', (err: NodeJS.ErrnoException) => {
            listenReject(err); // Forward error
          });
        });
        resolve(currentPort); // Listen succeeded
        return; // Exit function
      } catch (err: any) {
        lastError = err;
        logger.debug(`Listen error on port ${currentPort}: Code=${err.code}, Message=${err.message}`, { ...attemptContext, errorCode: err.code, errorMessage: err.message });
        if (err.code === 'EADDRINUSE') {
          logger.warning(`Port ${currentPort} already in use (EADDRINUSE), retrying...`, attemptContext);
          await new Promise(res => setTimeout(res, 100)); // Short delay before retry
        } else {
          logger.error(`Failed to bind to port ${currentPort} due to non-EADDRINUSE error: ${err.message}`, { ...attemptContext, error: err.message });
          reject(err); // Non-recoverable error for this port
          return; // Exit function
        }
      }
    }
    // Loop finished without success
    logger.error(`Failed to bind to any port after ${maxRetries + 1} attempts. Last error: ${lastError?.message}`, { ...startContext, error: lastError?.message });
    reject(lastError || new Error('Failed to bind to any port after multiple retries.'));
  });
}

/**
 * Sets up and starts the Streamable HTTP transport layer for MCP. (Asynchronous)
 * Creates Express app, configures middleware (CORS, Auth, Security Headers),
 * defines the single MCP endpoint handler for POST/GET/DELETE, manages sessions,
 * and starts the HTTP server with retry logic.
 *
 * @param {() => Promise<McpServer>} createServerInstanceFn - Async factory function to create a new McpServer instance per session.
 * @param {Record<string, any>} context - Logging context.
 * @returns {Promise<void>} Resolves when the server is listening, or rejects on failure.
 * @throws {Error} If the server fails to start after retries.
 */
export async function startHttpTransport(
  createServerInstanceFn: () => Promise<McpServer>,
  context: Record<string, any>
): Promise<void> {
  const app = express();
  const transportContext = { ...context, transportType: 'HTTP' };
  logger.debug('Setting up Express app for HTTP transport...', transportContext);

  // Middleware to parse JSON request bodies. Required for MCP messages.
  app.use(express.json());

  // --- Security Middleware Pipeline ---

  // 1. CORS Preflight (OPTIONS) Handler
  // Handles OPTIONS requests sent by browsers before actual GET/POST/DELETE.
  app.options(MCP_ENDPOINT_PATH, (req, res) => {
    const optionsContext = { ...transportContext, operation: 'handleOptions', origin: req.headers.origin };
    logger.debug(`Received OPTIONS request for ${MCP_ENDPOINT_PATH}`, optionsContext);
    if (isOriginAllowed(req, res)) {
      // isOriginAllowed sets necessary Access-Control-* headers.
      logger.debug('OPTIONS request origin allowed, sending 204.', optionsContext);
      res.sendStatus(204); // OK, No Content
    } else {
      // isOriginAllowed logs the warning.
      logger.debug('OPTIONS request origin denied, sending 403.', optionsContext);
      res.status(403).send('Forbidden: Invalid Origin');
    }
  });

  // 2. General Security Headers & Origin Check Middleware (for non-OPTIONS)
  app.use((req: Request, res: Response, next: NextFunction) => {
    const securityContext = { ...transportContext, operation: 'securityMiddleware', path: req.path, method: req.method, origin: req.headers.origin };
    logger.debug(`Applying security middleware...`, securityContext);

    // Check origin again for non-OPTIONS requests and set CORS headers if allowed.
    if (!isOriginAllowed(req, res)) {
      // isOriginAllowed logs the warning.
      logger.debug('Origin check failed, sending 403.', securityContext);
      res.status(403).send('Forbidden: Invalid Origin');
      return; // Block request
    }

    // Apply standard security headers to all allowed responses.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    // Basic Content Security Policy (CSP). Adjust if server needs external connections.
    // 'connect-src 'self'' allows connections back to the server's own origin (needed for SSE).
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; object-src 'none'; style-src 'self'; img-src 'self'; media-src 'self'; frame-src 'none'; font-src 'self'; connect-src 'self'");
    // Strict-Transport-Security (HSTS) - IMPORTANT: Enable only if server is *always* served over HTTPS.
    // if (config.environment === 'production') {
    //   res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains'); // 1 year
    // }

    logger.debug('Security middleware passed.', securityContext);
    next(); // Proceed to next middleware/handler
  });

  // 3. MCP Authentication Middleware (Optional, based on config)
  // Verifies Authorization header (e.g., Bearer token) if enabled.
  app.use(mcpAuthMiddleware);

  // --- MCP Route Handlers ---

  // Handle POST requests: Used for Initialize and all subsequent client->server messages.
  // MCP Spec: Client MUST use POST. Body is single message or batch.
  // MCP Spec: Server responds 202 for notification/response-only, or JSON/SSE for requests.
  app.post(MCP_ENDPOINT_PATH, async (req, res) => {
    // Define base context for this request
    const basePostContext = { ...transportContext, operation: 'handlePost', method: 'POST' };
    logger.debug(`Received POST request on ${MCP_ENDPOINT_PATH}`, { ...basePostContext, headers: req.headers, bodyPreview: JSON.stringify(req.body).substring(0, 100) });

    // MCP Spec: Session ID MUST be included by client after initialization.
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    // Log extracted session ID, adding it to the context for this specific log message
    logger.debug(`Extracted session ID: ${sessionId}`, { ...basePostContext, sessionId });

    let transport = sessionId ? httpTransports[sessionId] : undefined;
    // Log transport lookup result, adding sessionId to context
    logger.debug(`Found existing transport for session ID: ${!!transport}`, { ...basePostContext, sessionId });

    // Check if it's an InitializeRequest using SDK helper.
    const isInitReq = isInitializeRequest(req.body);
    logger.debug(`Is InitializeRequest: ${isInitReq}`, { ...basePostContext, sessionId });
    const requestId = (req.body as any)?.id || null; // For potential error responses

    try {
      // --- Handle Initialization Request ---
      if (isInitReq) {
        if (transport) {
          // Client sent Initialize on an existing session - likely an error or recovery attempt.
          // Close the old session cleanly before creating a new one.
          logger.warning('Received InitializeRequest on an existing session ID. Closing old session and creating new.', { ...basePostContext, sessionId });
          await transport.close(); // Ensure cleanup
          delete httpTransports[sessionId!];
        }
        logger.info('Handling Initialize Request: Creating new session...', { ...basePostContext, sessionId });

        // Create new SDK transport instance for this session.
        transport = new StreamableHTTPServerTransport({
          // MCP Spec: Server MAY assign session ID on InitializeResponse via Mcp-Session-Id header.
          sessionIdGenerator: () => {
            const newId = randomUUID(); // Secure UUID generation
            logger.debug(`Generated new session ID: ${newId}`, basePostContext); // Use base context here
            return newId;
          },
          onsessioninitialized: (newId) => {
            // Store the transport instance once the session ID is confirmed and sent to client.
            logger.debug(`Session initialized callback triggered for ID: ${newId}`, { ...basePostContext, newSessionId: newId });
            httpTransports[newId] = transport!; // Store by the generated ID
            logger.info(`HTTP Session created: ${newId}`, { ...basePostContext, newSessionId: newId });
          },
        });

        // Define cleanup logic when the transport closes (client disconnect, DELETE, error).
        transport.onclose = () => {
          const closedSessionId = transport!.sessionId; // Get ID before potential deletion
          if (closedSessionId) {
            logger.debug(`onclose handler triggered for session ID: ${closedSessionId}`, { ...basePostContext, closedSessionId });
            delete httpTransports[closedSessionId]; // Remove from active transports
            logger.info(`HTTP Session closed: ${closedSessionId}`, { ...basePostContext, closedSessionId });
          } else {
            logger.debug('onclose handler triggered for transport without session ID (likely init failure).', basePostContext);
          }
        };

        // Create a dedicated McpServer instance for this new session.
        logger.debug('Creating McpServer instance for new session...', basePostContext);
        const server = await createServerInstanceFn();
        // Connect the server logic to the transport layer.
        logger.debug('Connecting McpServer to new transport...', basePostContext);
        await server.connect(transport);
        logger.debug('McpServer connected to transport.', basePostContext);
        // NOTE: SDK's connect/handleRequest handles sending the InitializeResult.

      } else if (!transport) {
        // --- Handle Non-Initialize Request without Valid Session ---
        // MCP Spec: Server SHOULD respond 400/404 if session ID is missing/invalid for non-init requests.
        logger.warning('Invalid or missing session ID for non-initialize POST request.', { ...basePostContext, sessionId });
        res.status(404).json({ jsonrpc: '2.0', error: { code: -32004, message: 'Invalid or expired session ID' }, id: requestId });
        return; // Stop processing
      }

      // --- Handle Request Content (Initialize or Subsequent Message) ---
      // Use the extracted sessionId in the context for these logs
      const currentSessionId = transport.sessionId; // Should be defined here
      logger.debug(`Processing POST request content for session ${currentSessionId}...`, { ...basePostContext, sessionId: currentSessionId, isInitReq });
      // Delegate the actual handling (parsing, routing, response/SSE generation) to the SDK transport instance.
      // The SDK transport handles returning 202 for notification/response-only POSTs internally.
      await transport.handleRequest(req, res, req.body);
      logger.debug(`Finished processing POST request content for session ${currentSessionId}.`, { ...basePostContext, sessionId: currentSessionId });

    } catch (err) {
      // Catch-all for errors during POST handling.
      // Include sessionId if available in the transport object at this point
      const errorSessionId = transport?.sessionId || sessionId; // Use extracted or from transport if available
      logger.error('Error handling POST request', {
          ...basePostContext,
          sessionId: errorSessionId, // Add sessionId to error context
          isInitReq, // Include isInitReq flag
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined
      });
      if (!res.headersSent) {
        // Send generic JSON-RPC error if possible.
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error during POST handling' }, id: requestId });
      }
      // Ensure transport is cleaned up if an error occurred during initialization before session ID assigned.
      if (isInitReq && transport && !transport.sessionId) {
          logger.debug('Cleaning up transport after initialization failure.', { ...basePostContext, sessionId: errorSessionId });
          await transport.close().catch(closeErr => logger.error('Error closing transport after init failure', { ...basePostContext, sessionId: errorSessionId, closeError: closeErr }));
      }
    }
  });

  // Unified handler for GET (SSE connection) and DELETE (session termination).
  const handleSessionReq = async (req: Request, res: Response) => {
    const method = req.method; // GET or DELETE
    // Define base context for this request
    const baseSessionReqContext = { ...transportContext, operation: `handle${method}`, method };
    logger.debug(`Received ${method} request on ${MCP_ENDPOINT_PATH}`, { ...baseSessionReqContext, headers: req.headers });

    // MCP Spec: Client MUST include Mcp-Session-Id header (after init).
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    // Log extracted session ID, adding it to the context for this specific log message
    logger.debug(`Extracted session ID: ${sessionId}`, { ...baseSessionReqContext, sessionId });

    const transport = sessionId ? httpTransports[sessionId] : undefined;
    // Log transport lookup result, adding sessionId to context
    logger.debug(`Found existing transport for session ID: ${!!transport}`, { ...baseSessionReqContext, sessionId });

    if (!transport) {
      // MCP Spec: Server MUST respond 404 if session ID invalid/expired.
      logger.warning(`Session not found for ${method} request`, { ...baseSessionReqContext, sessionId });
      res.status(404).send('Session not found or expired');
      return;
    }

    try {
      // Use the extracted sessionId in the context for these logs
      logger.debug(`Delegating ${method} request to transport for session ${sessionId}...`, { ...baseSessionReqContext, sessionId });
      // MCP Spec (GET): Client MAY issue GET to open SSE stream. Server MUST respond text/event-stream or 405.
      // MCP Spec (GET): Client SHOULD include Last-Event-ID for resumption. Resumption handling depends on SDK transport.
      // MCP Spec (DELETE): Client SHOULD send DELETE to terminate. Server MAY respond 405 if not supported.
      // This implementation supports DELETE via the SDK transport's handleRequest.
      await transport.handleRequest(req, res);
      logger.info(`Successfully handled ${method} request for session ${sessionId}`, { ...baseSessionReqContext, sessionId });
      // Note: For DELETE, the transport's handleRequest should trigger the 'onclose' handler for cleanup.
    } catch (err) {
      // Include sessionId in error context
      logger.error(`Error handling ${method} request for session ${sessionId}`, {
          ...baseSessionReqContext,
          sessionId, // Add sessionId here
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined
      });
      if (!res.headersSent) {
          // Generic error if response hasn't started (e.g., error before SSE connection).
          res.status(500).send('Internal Server Error');
      }
      // The SDK transport's handleRequest should manage errors occurring *during* an SSE stream.
    }
  };
  // Route GET and DELETE requests to the unified handler.
  app.get(MCP_ENDPOINT_PATH, handleSessionReq);
  app.delete(MCP_ENDPOINT_PATH, handleSessionReq);

  // --- Start HTTP Server ---
  logger.debug('Creating HTTP server instance...', transportContext);
  const serverInstance = http.createServer(app);
  try {
    logger.debug('Attempting to start HTTP server with retry logic...', transportContext);
    // Use configured host and port, with retry logic.
    const actualPort = await startHttpServerWithRetry(serverInstance, config.mcpHttpPort, config.mcpHttpHost, MAX_PORT_RETRIES, transportContext);
    // Determine protocol for logging (basic assumption based on HSTS possibility)
    const protocol = config.environment === 'production' ? 'https' : 'http';
    const serverAddress = `${protocol}://${config.mcpHttpHost}:${actualPort}${MCP_ENDPOINT_PATH}`;
    // Use console.log for prominent startup message only if TTY.
    if (process.stdout.isTTY) {
      console.log(`\n🚀 MCP Server running in HTTP mode at: ${serverAddress}\n   (MCP Spec: 2025-03-26 Streamable HTTP Transport)\n`);
    }
  } catch (err) {
    logger.fatal('HTTP server failed to start after multiple port retries.', { ...transportContext, error: err instanceof Error ? err.message : String(err) });
    throw err; // Propagate error to stop the application
  }
}
