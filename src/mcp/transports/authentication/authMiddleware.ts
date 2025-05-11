/**
 * MCP Authentication Middleware: Bearer Token Validation (JWT).
 *
 * This middleware validates JSON Web Tokens (JWT) passed via the 'Authorization' header
 * using the 'Bearer' scheme (e.g., "Authorization: Bearer <your_token>").
 * It verifies the token's signature and expiration using the secret key defined
 * in the configuration (MCP_AUTH_SECRET_KEY).
 *
 * If the token is valid, the decoded payload is attached to `req.auth` for potential
 * use in downstream authorization logic (e.g., checking scopes or permissions).
 * If the token is missing, invalid, or expired, it sends an HTTP 401 Unauthorized response.
 *
 * --- Scope and Relation to MCP Authorization Spec (2025-03-26) ---
 * - This middleware handles the *validation* of an already obtained Bearer token,
 *   as required by Section 2.6 of the MCP Auth Spec.
 * - It does *NOT* implement the full OAuth 2.1 authorization flows (e.g., Authorization
 *   Code Grant with PKCE), token endpoints (/token), authorization endpoints (/authorize),
 *   metadata discovery (/.well-known/oauth-authorization-server), or dynamic client
 *   registration (/register) described in the specification. It assumes the client
 *   obtained the JWT through an external process compliant with the spec or another
 *   agreed-upon mechanism.
 * - It correctly returns HTTP 401 errors for invalid/missing tokens as per Section 2.8.
 *
 * --- Implementation Details & Requirements ---
 * - Requires the 'jsonwebtoken' package (`npm install jsonwebtoken @types/jsonwebtoken`).
 * - The `MCP_AUTH_SECRET_KEY` environment variable MUST be set to a strong, secret value
 *   in production. The middleware includes a startup check for this.
 * - In non-production environments, if the secret key is missing, authentication checks
 *   are bypassed for development convenience (a warning is logged). THIS IS INSECURE FOR PRODUCTION.
 * - The structure of the JWT payload (e.g., containing user ID, scopes) depends on the
 *   token issuer and is not dictated by this middleware itself, but the payload is made
 *   available on `req.auth`.
 *
 * @see {@link https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-03-26/basic/authorization.mdx | MCP Authorization Specification}
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
// Import config, environment constants, and logger
import { config, environment } from '../../../config/index.js';
import { logger } from '../../../utils/index.js';

// Extend the Express Request interface to include the optional 'auth' property
// This allows attaching the decoded JWT payload to the request object.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Decoded JWT payload if authentication is successful, or a development mode indicator. */
      auth?: jwt.JwtPayload | string | { devMode: boolean; warning: string };
    }
  }
}

// --- Startup Validation ---
// Validate secret key presence on module load (fail fast principle).
// This prevents the server starting insecurely in production without the key.
if (environment === 'production' && !config.mcpAuthSecretKey) {
  logger.fatal('CRITICAL: MCP_AUTH_SECRET_KEY is not set in production environment. Authentication cannot proceed securely.');
  // Throwing an error here will typically stop the Node.js process.
  throw new Error('MCP_AUTH_SECRET_KEY must be set in production environment for JWT authentication.');
} else if (!config.mcpAuthSecretKey) {
    // Log a clear warning if running without a key in non-production environments.
    logger.warning('MCP_AUTH_SECRET_KEY is not set. Authentication middleware will bypass checks (DEVELOPMENT ONLY). This is insecure for production.');
}

/**
 * Express middleware function for verifying JWT Bearer token authentication.
 * Checks the `Authorization` header, verifies the token, and attaches the payload to `req.auth`.
 *
 * @param {Request} req - Express request object.
 * @param {Response} res - Express response object.
 * @param {NextFunction} next - Express next middleware function.
 */
export function mcpAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Establish context for logging associated with this middleware execution.
  const context = { operation: 'mcpAuthMiddleware', method: req.method, path: req.path };
  logger.debug('Running MCP Authentication Middleware (Bearer Token Validation)...', context);

  // --- Development Mode Bypass ---
  // If the secret key is missing (and not in production), bypass authentication.
  if (!config.mcpAuthSecretKey) {
    // Double-check environment for safety, although the startup check should prevent this in prod.
    if (environment !== 'production') {
      logger.warning('Bypassing JWT authentication: MCP_AUTH_SECRET_KEY is not set (DEVELOPMENT ONLY).', context);
      // Attach a dummy auth object to indicate bypass for potential downstream checks.
      req.auth = { devMode: true, warning: 'Auth bypassed due to missing secret key' };
      return next(); // Proceed without authentication.
    } else {
      // Defensive coding: Should be caught by startup check, but handle anyway.
      logger.error('FATAL: MCP_AUTH_SECRET_KEY is missing in production. Cannot bypass auth.', context);
      // Send a server error response as this indicates a critical configuration issue.
      res.status(500).json({ error: 'Server configuration error: Authentication key missing.' });
      return; // Halt processing.
    }
  }

  // --- Standard JWT Bearer Token Verification ---
  const authHeader = req.headers.authorization;
  logger.debug(`Authorization header present: ${!!authHeader}`, context);

  // Check for the presence and correct format ('Bearer <token>') of the Authorization header.
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warning('Authentication failed: Missing or malformed Authorization header (Bearer scheme required).', context);
    // Respond with 401 Unauthorized as per RFC 6750 (Bearer Token Usage).
    res.status(401).json({ error: 'Unauthorized: Missing or invalid authentication token format.' });
    return; // Halt processing.
  }

  // Extract the token part from the "Bearer <token>" string.
  const token = authHeader.split(' ')[1];
  // Avoid logging the token itself for security reasons.
  logger.debug('Extracted token from Bearer header.', context);

  // Check if a token was actually present after the split.
  if (!token) {
    logger.warning('Authentication failed: Token missing after Bearer split (Malformed header).', context);
    res.status(401).json({ error: 'Unauthorized: Malformed authentication token.' });
    return; // Halt processing.
  }

  try {
    // Verify the token's signature and expiration using the configured secret key.
    // `jwt.verify` throws errors for invalid signature, expiration, etc.
    const decoded = jwt.verify(token, config.mcpAuthSecretKey);
    // Avoid logging the decoded payload directly unless necessary for specific debugging,
    // as it might contain sensitive information.
    logger.debug('JWT verified successfully.', { ...context });

    // Attach the decoded payload (which can be an object or string based on JWT content)
    // to the request object (`req.auth`) for use in subsequent middleware or route handlers
    // (e.g., for fine-grained authorization checks based on payload claims like user ID or scopes).
    req.auth = decoded;

    // Authentication successful, proceed to the next middleware or the main route handler.
    next();
  } catch (error: unknown) {
    // Handle errors thrown by `jwt.verify`.
    let errorMessage = 'Invalid token'; // Default error message.
    if (error instanceof jwt.TokenExpiredError) {
      // Specific error for expired tokens.
      errorMessage = 'Token expired';
      // After instanceof check, 'error' is typed as TokenExpiredError
      logger.warning('Authentication failed: Token expired.', { ...context, expiredAt: error.expiredAt });
    } else if (error instanceof jwt.JsonWebTokenError) {
      // General JWT errors (e.g., invalid signature, malformed token).
      // After instanceof check, 'error' is typed as JsonWebTokenError
      errorMessage = `Invalid token: ${error.message}`; // Include specific JWT error message
      logger.warning(`Authentication failed: ${errorMessage}`, { ...context });
    } else if (error instanceof Error) {
        // Handle other standard JavaScript errors
        errorMessage = `Verification error: ${error.message}`;
        logger.error('Authentication failed: Unexpected error during token verification.', { ...context, error: error.message });
    }
     else {
      // Handle non-Error exceptions
      errorMessage = 'Unknown verification error';
      logger.error('Authentication failed: Unexpected non-error exception during token verification.', { ...context, error });
    }
    // Respond with 401 Unauthorized for any token validation failure.
    res.status(401).json({ error: `Unauthorized: ${errorMessage}.` });
    // Do not call next() - halt processing for this request.
  }
}
