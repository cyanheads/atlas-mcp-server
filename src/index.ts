import { Logger } from './logging/index.js';
import { TaskManager } from './task/manager/task-manager.js';
import { VisualizationManager } from './visualization/visualization-manager.js';
import { createStorage } from './storage/index.js';
import { AtlasServer } from './server/index.js';
import { EventManager } from './events/event-manager.js';
import { ConfigManager, ConfigInitializer } from './config/index.js';
import { Environment, Environments } from './types/config.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { NoteManager, NotesInitializer } from './notes/index.js';

// Get package root directory
const __filename = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(__filename), '..');
import { PlatformPaths, PlatformCapabilities, ProcessManager } from './utils/platform-utils.js';
import { LogLevels } from './types/logging.js';
import { ToolHandler } from './tools/handler.js';
import { TemplateManager } from './template/manager.js';
import { SqliteTemplateStorage } from './storage/sqlite/template-storage.js';

async function main(): Promise<void> {
  let logger: Logger | undefined;
  let server: AtlasServer | undefined;

  try {
    // Get platform-agnostic paths
    const documentsDir = PlatformPaths.getDocumentsDir();
    const baseDir =
      process.env.ATLAS_STORAGE_DIR || join(documentsDir, 'Cline', 'mcp-workspace', 'ATLAS');
    const logDir = join(baseDir, 'logs');
    const dataDir = join(baseDir, 'data');
    const templateDir = join(baseDir, 'templates');
    const notesDir = join(baseDir, 'notes');
    const notesConfigPath = join(baseDir, 'config', 'notes.json');

    // Create directories with platform-appropriate permissions
    await PlatformCapabilities.ensureDirectoryPermissions(logDir, 0o755);
    await PlatformCapabilities.ensureDirectoryPermissions(dataDir, 0o755);
    await PlatformCapabilities.ensureDirectoryPermissions(templateDir, 0o755);
    await PlatformCapabilities.ensureDirectoryPermissions(notesDir, 0o755);
    await PlatformCapabilities.ensureDirectoryPermissions(dirname(notesConfigPath), 0o755);

    // Initialize logger with comprehensive file logging
    logger = await Logger.initialize({
      console: true,
      file: true,
      minLevel: LogLevels.DEBUG,
      logDir,
      maxFileSize: 10 * 1024 * 1024, // 10MB
      maxFiles: 10,
      noColors: false,
    });

    // Set logger for process manager
    ProcessManager.setLogger(logger);

    try {
      // Log detailed startup information
      logger.info('Atlas MCP Server starting up', {
        component: 'Server',
        context: {
          operation: 'startup',
          timestamp: Date.now(),
          paths: {
            base: baseDir,
            logs: logDir,
            data: dataDir,
            templates: templateDir,
          },
          environment: process.env.NODE_ENV || 'development',
          nodeVersion: process.version,
          platform: process.platform,
          pid: process.pid,
          memory: {
            max: PlatformCapabilities.getMaxMemory(),
            current: process.memoryUsage(),
          },
        },
      });

      // Initialize event manager
      const eventManager = await EventManager.initialize();

      // Update logger with event manager
      logger.setEventManager(eventManager);

      // Initialize configuration
      const builtInConfigPath = join(packageRoot, 'config', 'default.json');
      const configPath = join(baseDir, 'config', 'config.json');

      // Initialize config with built-in and user settings
      const configInitializer = new ConfigInitializer();
      const configData = await configInitializer.initializeConfig(configPath, builtInConfigPath);

      // Initialize config manager with merged config
      const configManager = await ConfigManager.initialize({
        env: (process.env.NODE_ENV as Environment) || Environments.DEVELOPMENT,
        logging: configData.logging || {
          console: false,
          file: true,
          level: LogLevels.DEBUG,
          maxFiles: 10,
          maxSize: 10 * 1024 * 1024,
          dir: logDir,
        },
        storage: configData.storage || {
          baseDir: dataDir,
          name: process.env.ATLAS_STORAGE_NAME || 'atlas-tasks',
          connection: {
            maxRetries: 3,
            retryDelay: 1000,
            busyTimeout: 5000,
          },
          performance: {
            checkpointInterval: 30000,
            cacheSize: Math.floor(PlatformCapabilities.getMaxMemory() / (1024 * 1024)), // Convert to MB
            mmapSize: 32 * 1024 * 1024,
            pageSize: 4096,
            maxMemory: 134217728, // 128MB
          },
        },
      });

      const config = configManager.getConfig();

      // Initialize storage
      const storage = await createStorage({
        ...config.storage!,
        baseDir: dataDir,
        name: process.env.ATLAS_STORAGE_NAME || 'atlas-tasks',
      });

      // Register storage cleanup
      ProcessManager.registerCleanupHandler(async () => {
        await storage.close();
      });

      // Initialize task manager
      const taskManager = await TaskManager.getInstance(storage);

      // Initialize visualization manager
      const visualizationManager = await VisualizationManager.initialize(taskManager, {
        baseDir,
      });

      // Register visualization cleanup
      ProcessManager.registerCleanupHandler(async () => {
        await visualizationManager.cleanup();
      });

      // Initialize template storage and manager
      const templateStorage = new SqliteTemplateStorage(storage, logger);
      await templateStorage.initialize();

      // Initialize template manager with both built-in and workspace templates
      const templateManager = new TemplateManager(templateStorage, taskManager);
      const builtInTemplateDir = join(packageRoot, 'templates');

      logger.info('Template directories:', {
        builtIn: builtInTemplateDir,
        workspace: templateDir,
      });

      try {
        await templateManager.initialize([builtInTemplateDir, templateDir]);

        // List available templates
        const templates = await templateManager.listTemplates();
        logger.info('Loaded templates:', {
          count: templates.length,
          templates: templates.map(t => ({
            id: t.id,
            name: t.name,
          })),
        });
      } catch (error) {
        logger.error('Failed to initialize templates:', {
          error,
          builtInTemplateDir,
          templateDir,
        });
        throw error;
      }

      // Register task manager cleanup
      ProcessManager.registerCleanupHandler(async () => {
        await taskManager.close();
      });

      // Register template manager cleanup
      ProcessManager.registerCleanupHandler(async () => {
        await templateManager.close();
      });

      // Initialize notes
      const builtInNotesDir = join(packageRoot, 'notes');
      const notesInitializer = new NotesInitializer();
      await notesInitializer.initializeNotes(notesConfigPath, notesDir, builtInNotesDir);

      // Initialize note manager after notes are copied
      const noteManager = await NoteManager.getInstance(notesConfigPath, notesDir);

      // Initialize tool handler
      const toolHandler = new ToolHandler(taskManager, templateManager, noteManager);

      // Register note manager cleanup
      ProcessManager.registerCleanupHandler(async () => {
        await noteManager.reloadConfig();
      });

      // Run maintenance
      await storage.vacuum();
      await storage.analyze();
      await storage.checkpoint();

      // Initialize server
      server = await AtlasServer.getInstance(
        {
          name: 'atlas-mcp-server',
          version: '1.2.0',
          maxRequestsPerMinute: 600,
          requestTimeout: 30000,
          shutdownTimeout: 5000,
          health: {
            checkInterval: 300000,
            failureThreshold: 5,
            shutdownGracePeriod: 10000,
            clientPingTimeout: 300000,
          },
        },
        {
          listTools: async () => toolHandler.listTools(),
          handleToolCall: async request => {
            if (
              !request.params?.name ||
              typeof request.params.name !== 'string' ||
              !request.params.arguments
            ) {
              throw new Error('Invalid tool call request parameters');
            }
            return toolHandler.handleToolCall({
              params: {
                name: request.params.name,
                arguments: request.params.arguments as Record<string, unknown>,
              },
            });
          },
          getStorageMetrics: async () => storage.getMetrics(),
          clearCaches: async () => taskManager.clearCaches(),
          cleanup: ProcessManager.cleanup,
          // Add resource-related methods
          getTaskResource: async (uri: string) => taskManager.getTaskResource(uri),
          listTaskResources: async () => taskManager.listTaskResources(),
          getTemplateResource: async (uri: string) => templateManager.getTemplateResource(uri),
          listTemplateResources: async () => templateManager.listTemplateResources(),
          getHierarchyResource: async (rootPath: string) =>
            taskManager.getHierarchyResource(rootPath),
          getStatusResource: async (taskPath: string) => taskManager.getStatusResource(taskPath),
          getResourceTemplates: async () => templateManager.getResourceTemplates(),
          resolveResourceTemplate: async (template: string, vars: Record<string, string>) =>
            templateManager.resolveResourceTemplate(template, vars),
          // Add visualization resource
          getVisualizationResource: async () => ({
            uri: 'visualizations://current',
            name: 'Task Visualizations',
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                timestamp: new Date().toISOString(),
                files: {
                  markdown: `/visualizations/tasks-${new Date().toISOString().split('T')[0]}.md`,
                  json: `/visualizations/tasks-${new Date().toISOString().split('T')[0]}.json`,
                },
                summary: await taskManager.getMetrics(),
                format: {
                  statusIndicators: {
                    PENDING: '⏳',
                    IN_PROGRESS: '🔄',
                    COMPLETED: '✅',
                    BLOCKED: '🚫',
                    CANCELLED: '❌',
                  },
                  progressBar: {
                    length: 20,
                    filled: '█',
                    empty: '░',
                  },
                },
              },
              null,
              2
            ),
          }),
        }
      );

      // Register server cleanup
      ProcessManager.registerCleanupHandler(async () => {
        await server?.shutdown();
      });

      // Register event manager cleanup
      ProcessManager.registerCleanupHandler(async () => {
        await eventManager.shutdown();
      });

      // Set up signal handlers
      ProcessManager.setupSignalHandlers();

      // Log successful startup
      logger.info('Server initialization completed successfully', {
        component: 'Server',
        status: 'ready',
      });
    } catch (error) {
      // Log initialization error before rethrowing
      logger.error('Failed to initialize server components:', error);
      throw error;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Failed to start server:', message);

    if (logger) {
      logger.error('Fatal startup error:', {
        error: error instanceof Error ? error : { message },
        stack: error instanceof Error ? error.stack : undefined,
      });
    }

    // Ensure cleanup runs even on startup failure
    if (server) {
      await server.shutdown().catch(console.error);
    }
    await ProcessManager.cleanup().catch(console.error);

    process.exit(1);
  }
}

// Start the server
main().catch(error => {
  console.error('Unhandled error in main:', error);
  process.exit(1);
});
