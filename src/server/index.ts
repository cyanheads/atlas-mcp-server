/**
 * Server module for Atlas MCP Server
 * Handles server initialization, transport setup, and graceful shutdown
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ErrorCode,
    ListToolsRequestSchema,
    McpError,
    Request
} from '@modelcontextprotocol/sdk/types.js';
import { Logger } from '../logging/index.js';
import { RateLimiter } from './rate-limiter.js';
import { HealthMonitor, ComponentStatus } from './health-monitor.js';
import { MetricsCollector, MetricEvent } from './metrics-collector.js';
import { RequestTracer, TraceEvent } from './request-tracer.js';

export interface ServerConfig {
    name: string;
    version: string;
    maxRequestsPerMinute?: number;
    requestTimeout?: number;
    shutdownTimeout?: number;
}

export interface ToolHandler {
    listTools: () => Promise<any>;
    handleToolCall: (request: Request) => Promise<any>;
    getStorageMetrics: () => Promise<any>;
    clearCaches?: () => Promise<void>;
    cleanup?: () => Promise<void>;
}

/**
 * AtlasServer class encapsulates MCP server functionality
 * Handles server lifecycle, transport, and error management
 */
export class AtlasServer {
    private static instance: AtlasServer;
    private static isInitializing: boolean = false;
    private static serverPromise: Promise<void> | null = null;
    private static logger: Logger;
    private readonly server: Server;

    private static initLogger(): void {
        if (!AtlasServer.logger) {
            AtlasServer.logger = Logger.getInstance().child({ component: 'AtlasServer' });
        }
    }
    private readonly rateLimiter: RateLimiter;
    private readonly healthMonitor: HealthMonitor;
    private readonly metricsCollector: MetricsCollector;
    private readonly requestTracer: RequestTracer;
    private isShuttingDown: boolean = false;
    private isInitialized: boolean = false;
    private readonly activeRequests: Set<string> = new Set();
    private memoryMonitor?: NodeJS.Timeout;
    private readonly MAX_MEMORY_USAGE = 2 * 1024 * 1024 * 1024; // 2GB threshold
    private readonly MEMORY_CHECK_INTERVAL = 30000; // 30 seconds

    /**
     * Gets the singleton instance of AtlasServer
     */
    public static async getInstance(config: ServerConfig, toolHandler: ToolHandler): Promise<AtlasServer> {
        AtlasServer.initLogger();

        // Return existing instance if available
        if (AtlasServer.instance?.isInitialized) {
            AtlasServer.logger?.debug('Returning existing server instance');
            return AtlasServer.instance;
        }

        // If initialization is in progress, wait for it
        if (AtlasServer.isInitializing) {
            AtlasServer.logger?.debug('Server initialization in progress, waiting...');
            await AtlasServer.serverPromise;
            return AtlasServer.instance;
        }

        AtlasServer.isInitializing = true;
        AtlasServer.serverPromise = (async () => {
            try {
                AtlasServer.logger?.info('Starting server initialization');
                if (!AtlasServer.instance) {
                    AtlasServer.instance = new AtlasServer(config, toolHandler);
                }
                await AtlasServer.instance.initializeServer();
            } catch (error) {
                throw new McpError(
                    ErrorCode.InternalError,
                    `Failed to initialize AtlasServer: ${error instanceof Error ? error.message : String(error)}`
                );
            } finally {
                AtlasServer.isInitializing = false;
                AtlasServer.serverPromise = null;
            }
        })();

        await AtlasServer.serverPromise;
        return AtlasServer.instance;
    }

    /**
     * Creates a new AtlasServer instance
     */
    private constructor(
        private readonly config: ServerConfig,
        private readonly toolHandler: ToolHandler
    ) {
        // Initialize components
        this.rateLimiter = new RateLimiter(config.maxRequestsPerMinute || 600);
        this.healthMonitor = new HealthMonitor({
            checkInterval: 30000,
            failureThreshold: 3,
            shutdownGracePeriod: config.shutdownTimeout || 30000,
            clientPingTimeout: 60000
        });
        this.metricsCollector = new MetricsCollector();
        this.requestTracer = new RequestTracer();

        // Initialize MCP server
        this.server = new Server(
            {
                name: config.name,
                version: config.version,
            },
            {
                capabilities: {
                    tools: {
                        create_task: {},
                        update_task: {},
                        delete_task: {},
                        get_tasks_by_status: {},
                        get_tasks_by_path: {},
                        get_subtasks: {},
                        bulk_task_operations: {},
                        clear_all_tasks: {},
                        vacuum_database: {},
                        repair_relationships: {}
                    },
                },
            }
        );

        this.setupErrorHandling();
        this.setupToolHandlers();
        this.setupHealthCheck();
        this.setupMemoryMonitoring();
    }

    /**
     * Sets up error handling for the server
     */
    private setupErrorHandling(): void {
        this.server.onerror = (error: unknown) => {
            const metricEvent: MetricEvent = {
                type: 'error',
                timestamp: Date.now(),
                error: error instanceof Error ? error.message : String(error)
            };
            this.metricsCollector.recordError(metricEvent);
            
            const errorContext = {
                timestamp: new Date().toISOString(),
                error: error instanceof Error ? {
                    name: error.name,
                    message: error.message,
                    stack: error.stack
                } : error,
                metrics: this.metricsCollector.getMetrics()
            };

            AtlasServer.logger.error('[MCP Error]', errorContext);
        };

        process.on('SIGINT', async () => {
            await this.shutdown();
        });

        process.on('SIGTERM', async () => {
            await this.shutdown();
        });

        process.on('unhandledRejection', (reason, promise) => {
            AtlasServer.logger.error('Unhandled Rejection:', {
                reason,
                promise,
                metrics: this.metricsCollector.getMetrics()
            });
        });

        process.on('uncaughtException', (error) => {
            const errorMessage = error instanceof Error 
                ? { name: error.name, message: error.message, stack: error.stack }
                : error && typeof error === 'object'
                    ? JSON.stringify(error)
                    : String(error);
            
            AtlasServer.logger.error('Uncaught Exception:', {
                error: errorMessage,
                metrics: this.metricsCollector.getMetrics()
            });
            this.shutdown().finally(() => process.exit(1));
        });
    }

    /**
     * Sets up tool request handlers with middleware
     */
    private setupToolHandlers(): void {
        // Handler for listing available tools
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const traceEvent: TraceEvent = {
                type: 'list_tools',
                timestamp: Date.now()
            };
            
            try {
                await this.rateLimiter.checkLimit();
                this.activeRequests.add(requestId);
                
                // Record client activity
                this.recordClientActivity();
                
                this.requestTracer.startTrace(requestId, traceEvent);
                const response = await this.toolHandler.listTools();
                
                const metricEvent: MetricEvent = {
                    type: 'list_tools',
                    timestamp: Date.now(),
                    duration: Date.now() - traceEvent.timestamp
                };
                this.metricsCollector.recordSuccess(metricEvent);

                return response;
            } catch (error) {
                this.handleToolError(error);
                throw error; // Ensure error propagation
            } finally {
                this.activeRequests.delete(requestId);
                this.requestTracer.endTrace(requestId, {
                    ...traceEvent,
                    timestamp: Date.now()
                });
            }
        });

        // Handler for tool execution requests
        this.server.setRequestHandler(CallToolRequestSchema, async (request: Request) => {
            if (!request.params?.name) {
                throw new McpError(ErrorCode.InvalidRequest, 'Missing tool name');
            }
            const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const traceEvent: TraceEvent = {
                type: 'tool_execution',
                tool: String(request.params.name),
                timestamp: Date.now()
            };
            
            try {
                if (this.isShuttingDown) {
                    throw new McpError(
                        ErrorCode.InternalError,
                        'Server is shutting down'
                    );
                }

                await this.rateLimiter.checkLimit();
                this.activeRequests.add(requestId);
                
                // Record client activity
                this.recordClientActivity();
                
                this.requestTracer.startTrace(requestId, traceEvent);
                const response = await Promise.race([
                    this.toolHandler.handleToolCall(request),
                    this.createTimeout(this.config.requestTimeout || 30000)
                ]);
                
                const metricEvent: MetricEvent = {
                    type: 'tool_execution',
                    tool: String(request.params.name),
                    timestamp: Date.now(),
                    duration: Date.now() - traceEvent.timestamp
                };
                this.metricsCollector.recordSuccess(metricEvent);

                return response;
            } catch (error) {
                this.handleToolError(error);
                throw error; // Ensure error propagation
            } finally {
                this.activeRequests.delete(requestId);
                this.requestTracer.endTrace(requestId, {
                    ...traceEvent,
                    timestamp: Date.now()
                });
            }
        });
    }

    /**
     * Sets up health check endpoint
     */
    private setupHealthCheck(): void {
        // Start health monitor with shutdown callback
        this.healthMonitor.start(async () => {
            AtlasServer.logger.info('Health monitor triggered shutdown');
            await this.shutdown();
        });

        // Set up periodic status checks
        setInterval(async () => {
            try {
                const status: ComponentStatus = {
                    storage: await this.toolHandler.getStorageMetrics(),
                    rateLimiter: this.rateLimiter.getStatus(),
                    metrics: this.metricsCollector.getMetrics()
                };
                await this.healthMonitor.check(status);
            } catch (error) {
                AtlasServer.logger.error('Health check error:', { error });
            }
        }, 30000);
    }

    /**
     * Record client activity
     */
    private recordClientActivity(): void {
        this.healthMonitor.recordClientPing();
    }

    /**
     * Creates a timeout promise
     */
    private createTimeout(ms: number): Promise<never> {
        return new Promise((_, reject) => {
            setTimeout(() => {
                reject(new McpError(
                    ErrorCode.InternalError,
                    `Request timed out after ${ms}ms`
                ));
            }, ms);
        });
    }

    /**
     * Transforms errors into McpErrors
     */
    private handleToolError(error: unknown): void {
        const errorMessage = error instanceof Error 
            ? error.message 
            : error && typeof error === 'object'
                ? JSON.stringify(error)
                : String(error);

        const metricEvent: MetricEvent = {
            type: 'error',
            timestamp: Date.now(),
            error: errorMessage
        };
        this.metricsCollector.recordError(metricEvent);

        if (error instanceof McpError) {
            return;
        }

        const errorDetails = error instanceof Error 
            ? { name: error.name, message: error.message, stack: error.stack }
            : error && typeof error === 'object'
                ? JSON.stringify(error)
                : String(error);

        AtlasServer.logger.error('Unexpected error in tool handler:', {
            error: errorDetails,
            metrics: this.metricsCollector.getMetrics()
        });
        
        throw new McpError(
            ErrorCode.InternalError,
            error instanceof Error ? error.message : 'An unexpected error occurred',
            error instanceof Error ? error.stack : undefined
        );
    }

    /**
     * Starts the server
     */
    private async initializeServer(): Promise<void> {
        if (this.isInitialized) {
            AtlasServer.logger.debug('Server already initialized');
            return;
        }

        try {
            const transport = new StdioServerTransport();
            await this.server.connect(transport);
            
            this.isInitialized = true;
            AtlasServer.logger.info(`${this.config.name} v${this.config.version} running on stdio`, {
                metrics: this.metricsCollector.getMetrics()
            });
        } catch (error) {
            AtlasServer.logger.error('Failed to start server:', {
                error,
                metrics: this.metricsCollector.getMetrics()
            });
            throw error;
        }
    }

    /**
     * Sets up memory monitoring to prevent leaks
     */
    private setupMemoryMonitoring(): void {
        this.memoryMonitor = setInterval(() => {
            const memUsage = process.memoryUsage();
            
            // Log memory stats
            AtlasServer.logger.debug('Memory usage:', {
                heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
                heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
                rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`
            });

            // Trigger cleanup if memory usage is too high
            if (memUsage.heapUsed > this.MAX_MEMORY_USAGE) {
                AtlasServer.logger.warn('High memory usage detected, triggering cleanup', {
                    heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
                    threshold: `${Math.round(this.MAX_MEMORY_USAGE / 1024 / 1024)}MB`
                });
                
                // Force garbage collection if available
                if (global.gc) {
                    AtlasServer.logger.info('Forcing garbage collection');
                    global.gc();
                }

                // Clear caches
                this.toolHandler.clearCaches?.();
            }
        }, this.MEMORY_CHECK_INTERVAL);
    }

    /**
     * Gracefully shuts down the server and cleans up resources
     */
    async shutdown(): Promise<void> {
        if (this.isShuttingDown) {
            return;
        }

        this.isShuttingDown = true;
        AtlasServer.logger.info('Starting graceful shutdown...');

        try {
            // Wait for active requests to complete
            const timeout = this.config.shutdownTimeout || 30000;
            const shutdownStart = Date.now();

            while (this.activeRequests.size > 0) {
                if (Date.now() - shutdownStart > timeout) {
                    AtlasServer.logger.warn('Shutdown timeout reached, forcing shutdown', {
                        activeRequests: this.activeRequests.size
                    });
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            // Clear monitoring intervals
            if (this.memoryMonitor) {
                clearInterval(this.memoryMonitor);
            }
            
            // Clean up resources
            await this.toolHandler.cleanup?.();
            
            // Close server
            await this.server.close();
            
            // Force final garbage collection
            if (global.gc) {
                global.gc();
            }
            AtlasServer.logger.info('Server closed successfully', {
                metrics: this.metricsCollector.getMetrics()
            });
        } catch (error) {
            AtlasServer.logger.error('Error during shutdown:', {
                error,
                metrics: this.metricsCollector.getMetrics()
            });
            throw error;
        }
    }
}
