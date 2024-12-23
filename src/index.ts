/**
 * Atlas MCP Server
 * Path-based task management system
 */
import { promises as fs } from 'fs';
import { TaskManager } from './task-manager.js';
import { Logger } from './logging/index.js';
import { StorageConfig, TaskStorage } from './types/storage.js';
import { createStorage } from './storage/index.js';
import { ToolHandler } from './tools/handler.js';
import { AtlasServer } from './server/index.js';

export class AtlasServerBootstrap {
    private readonly logger: Logger;
    private storage!: TaskStorage;
    private taskManager!: TaskManager;
    private toolHandler!: ToolHandler;
    private server!: AtlasServer;
    private readonly storageConfig: StorageConfig;
    private isShuttingDown: boolean = false;

    constructor() {
        // Set up cleanup handlers
        process.on('SIGINT', () => this.cleanup());
        process.on('SIGTERM', () => this.cleanup());
        process.on('exit', () => this.cleanup());

        // Initialize logger
        this.logger = Logger.getInstance().child({ component: 'AtlasServerBootstrap' });

        // Log environment variables
        this.logger.debug('Environment variables:', {
            ATLAS_STORAGE_DIR: process.env.ATLAS_STORAGE_DIR,
            ATLAS_STORAGE_NAME: process.env.ATLAS_STORAGE_NAME,
            LOG_LEVEL: process.env.LOG_LEVEL,
            NODE_ENV: process.env.NODE_ENV
        });

        // Validate required environment variables
        if (!process.env.ATLAS_STORAGE_DIR) {
            throw new Error('ATLAS_STORAGE_DIR environment variable is required');
        }
        if (!process.env.ATLAS_STORAGE_NAME) {
            throw new Error('ATLAS_STORAGE_NAME environment variable is required');
        }

        // Set up storage configuration
        const storageDir = process.env.ATLAS_STORAGE_DIR;
        this.storageConfig = {
            baseDir: storageDir,
            name: process.env.ATLAS_STORAGE_NAME,
            connection: {
                maxRetries: Number(process.env.ATLAS_MAX_RETRIES) || 3,
                retryDelay: Number(process.env.ATLAS_RETRY_DELAY) || 1000,
                busyTimeout: Number(process.env.ATLAS_BUSY_TIMEOUT) || 5000
            },
            performance: {
                checkpointInterval: Number(process.env.ATLAS_CHECKPOINT_INTERVAL) || 300000,
                cacheSize: Number(process.env.ATLAS_CACHE_SIZE) || 2000,
                mmapSize: Number(process.env.ATLAS_MMAP_SIZE) || 30000000000,
                pageSize: Number(process.env.ATLAS_PAGE_SIZE) || 4096,
                maxMemory: Number(process.env.ATLAS_MAX_MEMORY) || 2 * 1024 * 1024 * 1024, // 2GB default
                maxCacheMemory: Number(process.env.ATLAS_MAX_CACHE_MEMORY) || 512 * 1024 * 1024 // 512MB default
            }
        };
    }

    private async initialize(): Promise<void> {
        try {
            // Initialize storage with proper configuration
            const storageDir = `${this.storageConfig.baseDir}/ATLAS`;
            
            // Ensure storage directory exists with proper permissions
            await fs.mkdir(storageDir, { recursive: true, mode: 0o755 });
            await fs.chmod(storageDir, 0o755);  // Ensure directory is readable/writable
            
            // Configure storage
            const storageConfig = {
                ...this.storageConfig,
                baseDir: storageDir,
                name: 'atlas-tasks',
                connection: {
                    ...this.storageConfig.connection,
                    busyTimeout: 10000,
                    maxRetries: 5,
                    retryDelay: 1000
                }
            };
            this.storage = await createStorage(storageConfig);
            this.logger.info('Storage initialized', { dir: storageConfig.baseDir });

            // Initialize task manager with existing storage
            this.taskManager = new TaskManager(this.storage);
            this.logger.info('Task manager initialized');

            // Create tool handler
            this.toolHandler = new ToolHandler(this.taskManager);
            this.logger.info('Tool handler initialized');

            // Create server instance
            this.server = new AtlasServer(
                {
                    name: 'atlas-mcp-server',
                    version: '0.1.0',
                    maxRequestsPerMinute: 100,
                    requestTimeout: 30000,
                    shutdownTimeout: 30000
                },
                this.toolHandler
            );
            this.logger.info('Server instance created');
        } catch (error) {
            this.logger.fatal('Failed to initialize server components', { error });
            throw error;
        }
    }

    private async cleanup(): Promise<void> {
        if (this.isShuttingDown) {
            return;
        }
        
        this.isShuttingDown = true;
        this.logger.info('Starting cleanup...');
        
        try {
            // Close server first to stop accepting new requests
            if (this.server) {
                await this.server.shutdown();
            }

            // Clean up storage
            if (this.storage) {
                await this.storage.close();
            }

            this.logger.info('Cleanup completed successfully');
        } catch (error) {
            this.logger.error('Error during cleanup:', { error });
        }
    }

    async start(): Promise<void> {
        try {
            await this.initialize();
            await this.server.run();
            const maxMemory = this.storageConfig.performance?.maxMemory || 2 * 1024 * 1024 * 1024;
            const maxCacheMemory = this.storageConfig.performance?.maxCacheMemory || 512 * 1024 * 1024;

            this.logger.info('Atlas MCP server started', {
                storageDir: this.storageConfig.baseDir,
                storageName: this.storageConfig.name,
                version: '0.1.0',
                environment: process.env.NODE_ENV,
                logLevel: process.env.LOG_LEVEL,
                maxMemory: `${Math.round(maxMemory / 1024 / 1024)}MB`,
                maxCacheMemory: `${Math.round(maxCacheMemory / 1024 / 1024)}MB`
            });
        } catch (error) {
            this.logger.fatal('Failed to start server', { error });
            throw error;
        }
    }
}

// Start server if run directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
    const server = new AtlasServerBootstrap();
    server.start().catch((error) => {
        console.error('Failed to start server:', error);
        process.exit(1);
    });
}
