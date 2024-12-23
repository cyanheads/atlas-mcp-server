/**
 * Path-based task management tools
 */
import { TaskManager } from '../task-manager.js';
import { Logger } from '../logging/index.js';
import { ErrorCodes, createError } from '../errors/index.js';
import { TaskType, TaskStatus, CreateTaskInput, UpdateTaskInput } from '../types/task.js';
import {
    createTaskSchema,
    updateTaskSchema,
    getTasksByStatusSchema,
    getTasksByPathSchema,
    getSubtasksSchema,
    deleteTaskSchema,
    bulkTaskSchema,
    clearAllTasksSchema,
    vacuumDatabaseSchema,
    repairRelationshipsSchema
} from './schemas.js';
import { DependencyAwareBatchProcessor } from '../task/core/batch/dependency-aware-batch-processor.js';
import { BatchData } from '../task/core/batch/common/batch-utils.js';
import { TaskStorage } from '../types/storage.js';

interface BulkOperation {
    type: 'create' | 'update' | 'delete';
    path: string;
    data?: Record<string, unknown>;
    id?: string;
    dependencies?: string[];
}

export interface Tool {
    name: string;
    description?: string;
    inputSchema: {
        type: "object";
        properties: Record<string, unknown>;
        required?: string[];
        description?: string;
    };
}

export interface ToolResponse {
    content: Array<{
        type: string;
        text: string;
    }>;
}

import { TaskValidator } from '../task/validation/task-validator.js';

export class ToolHandler {
    private readonly logger: Logger;
    private readonly tools: Map<string, Tool> = new Map();
    private readonly toolHandlers: Map<string, (args: Record<string, unknown>) => Promise<ToolResponse>> = new Map();
    private isShuttingDown: boolean = false;
    private readonly taskValidator: TaskValidator;

    constructor(private readonly taskManager: TaskManager) {
        this.logger = Logger.getInstance().child({ component: 'ToolHandler' });
        this.taskValidator = new TaskValidator(taskManager.storage);
        this.registerDefaultTools();
    }

    /**
     * Validates task hierarchy rules
     */
    private async validateTaskHierarchy(args: Record<string, unknown>, operation: 'create' | 'update'): Promise<void> {
        const taskType = (args.type || 'TASK').toString().toUpperCase();
        const parentPath = args.parentPath as string | undefined;

        // Validate task type is uppercase
        if (taskType !== taskType.toUpperCase()) {
            throw createError(
                ErrorCodes.INVALID_INPUT,
                'Task type must be uppercase (TASK, GROUP, or MILESTONE)'
            );
        }

        // Validate task type is valid
        if (!['TASK', 'GROUP', 'MILESTONE'].includes(taskType)) {
            throw createError(
                ErrorCodes.INVALID_INPUT,
                'Invalid task type. Must be TASK, GROUP, or MILESTONE'
            );
        }

        // If parent path is provided, validate parent type compatibility
        if (parentPath) {
            const parent = await this.taskManager.getTaskByPath(parentPath);
            if (!parent) {
                throw createError(
                    ErrorCodes.INVALID_INPUT,
                    `Parent task '${parentPath}' not found`
                );
            }

            // Validate parent-child type relationships
            switch (parent.type) {
                case TaskType.MILESTONE:
                    if (!['TASK', 'GROUP'].includes(taskType)) {
                        throw createError(
                            ErrorCodes.INVALID_INPUT,
                            'MILESTONE can only contain TASK or GROUP types'
                        );
                    }
                    break;
                case TaskType.GROUP:
                    if (taskType !== 'TASK') {
                        throw createError(
                            ErrorCodes.INVALID_INPUT,
                            'GROUP can only contain TASK types'
                        );
                    }
                    break;
                case TaskType.TASK:
                    throw createError(
                        ErrorCodes.INVALID_INPUT,
                        'TASK type cannot contain subtasks'
                    );
            }
        }

        // For updates, validate type changes don't break hierarchy
        if (operation === 'update' && taskType) {
            const path = args.path as string;
            const task = await this.taskManager.getTaskByPath(path);
            if (!task) {
                throw createError(
                    ErrorCodes.INVALID_INPUT,
                    `Task '${path}' not found`
                );
            }

            // Check if task has subtasks and is being changed to TASK type
            if (taskType === 'TASK') {
                const subtasks = await this.taskManager.getSubtasks(path);
                if (subtasks.length > 0) {
                    throw createError(
                        ErrorCodes.INVALID_INPUT,
                        'Cannot change to TASK type while having subtasks'
                    );
                }
            }

            // Check if changing to GROUP with non-TASK subtasks
            if (taskType === 'GROUP') {
                const subtasks = await this.taskManager.getSubtasks(path);
                const invalidSubtasks = subtasks.filter(s => s.type !== TaskType.TASK);
                if (invalidSubtasks.length > 0) {
                    throw createError(
                        ErrorCodes.INVALID_INPUT,
                        'GROUP can only contain TASK type subtasks'
                    );
                }
            }
        }
    }

    private registerDefaultTools(): void {
        const defaultTools: Array<Tool & { handler: (args: Record<string, unknown>) => Promise<ToolResponse> }> = [
            {
                name: 'create_task',
                description: createTaskSchema.properties.type.description,
                inputSchema: {
                    type: "object",
                    properties: createTaskSchema.properties,
                    required: createTaskSchema.required
                },
                handler: async (args: Record<string, unknown>) => {
                    // Validate hierarchy rules
                    await this.validateTaskHierarchy(args, 'create');
                    
                    // Validate required fields
                    if (!args.name || typeof args.name !== 'string') {
                        throw createError(
                            ErrorCodes.INVALID_INPUT,
                            'Task name is required and must be a string'
                        );
                    }

                    // Create task input with proper type casting
                    const taskInput: CreateTaskInput = {
                        name: args.name,
                        path: args.path as string | undefined,
                        type: args.type ? (args.type as string).toUpperCase() as TaskType : TaskType.TASK,
                        description: args.description as string | undefined,
                        parentPath: args.parentPath as string | undefined,
                        dependencies: Array.isArray(args.dependencies) ? args.dependencies as string[] : [],
                        notes: Array.isArray(args.notes) ? args.notes as string[] : undefined,
                        reasoning: args.reasoning as string | undefined,
                        metadata: args.metadata as Record<string, unknown> || {}
                    };
                    
                    const result = await this.taskManager.createTask(taskInput);
                    return this.formatResponse(result);
                }
            },
            {
                name: 'update_task',
                description: updateTaskSchema.properties.updates.properties.type.description,
                inputSchema: {
                    type: "object",
                    properties: updateTaskSchema.properties,
                    required: updateTaskSchema.required
                },
                handler: async (args: Record<string, unknown>) => {
                    const { path, updates } = args as { path: string; updates: Record<string, unknown> };
                    
                    // Validate hierarchy rules if type is being updated
                    if (updates.type) {
                        await this.validateTaskHierarchy({ ...updates, path }, 'update');
                    }

                    // Validate status changes using TaskValidator
                    if (updates.status) {
                        const task = await this.taskManager.getTaskByPath(path);
                        if (!task) {
                            throw createError(
                                ErrorCodes.TASK_NOT_FOUND,
                                `Task not found: ${path}`
                            );
                        }
                        await this.taskValidator.validateUpdate(path, {
                            status: updates.status as TaskStatus
                        });
                    }
                    
                    // Create update input with proper type casting
                    const updateInput: UpdateTaskInput = {
                        name: updates.name as string | undefined,
                        type: updates.type ? (updates.type as string).toUpperCase() as TaskType : undefined,
                        description: updates.description as string | undefined,
                        status: updates.status as TaskStatus | undefined,
                        dependencies: Array.isArray(updates.dependencies) ? updates.dependencies as string[] : undefined,
                        notes: Array.isArray(updates.notes) ? updates.notes as string[] : undefined,
                        reasoning: updates.reasoning as string | undefined,
                        metadata: updates.metadata as Record<string, unknown> | undefined
                    };
                    
                    const result = await this.taskManager.updateTask(path, updateInput);
                    return this.formatResponse(result);
                }
            },
            {
                name: 'get_tasks_by_status',
                description: getTasksByStatusSchema.properties.status.description,
                inputSchema: {
                    type: "object",
                    properties: getTasksByStatusSchema.properties,
                    required: getTasksByStatusSchema.required
                },
                handler: async (args: Record<string, unknown>) => {
                    const result = await this.taskManager.getTasksByStatus(args.status as unknown as TaskStatus);
                    return this.formatResponse(result);
                }
            },
            {
                name: 'get_tasks_by_path',
                description: getTasksByPathSchema.properties.pathPattern.description,
                inputSchema: {
                    type: "object",
                    properties: getTasksByPathSchema.properties,
                    required: getTasksByPathSchema.required
                },
                handler: async (args: Record<string, unknown>) => {
                    const result = await this.taskManager.listTasks(args.pathPattern as string);
                    return this.formatResponse(result);
                }
            },
            {
                name: 'get_subtasks',
                description: getSubtasksSchema.properties.path.description,
                inputSchema: {
                    type: "object",
                    properties: getSubtasksSchema.properties,
                    required: getSubtasksSchema.required
                },
                handler: async (args: Record<string, unknown>) => {
                    const result = await this.taskManager.getSubtasks(args.path as string);
                    return this.formatResponse(result);
                }
            },
            {
                name: 'delete_task',
                description: deleteTaskSchema.properties.path.description,
                inputSchema: {
                    type: "object",
                    properties: deleteTaskSchema.properties,
                    required: deleteTaskSchema.required
                },
                handler: async (args: Record<string, unknown>) => {
                    const result = await this.taskManager.deleteTask(args.path as string);
                    return this.formatResponse(result);
                }
            },
            {
                name: 'bulk_task_operations',
                description: bulkTaskSchema.properties.operations.description,
                inputSchema: {
                    type: "object",
                    properties: bulkTaskSchema.properties,
                    required: bulkTaskSchema.required
                },
                handler: async (args: Record<string, unknown>) => {
                    const { operations } = args as { operations: BulkOperation[] };

                    // Add dependencies based on operation order
                    const operationsWithDeps = operations.map((op, index) => ({
                        ...op,
                        id: op.path,
                        // Each operation depends on the previous one
                        dependencies: index > 0 ? [operations[index - 1].path] : []
                    }));

                    const batchProcessor = new DependencyAwareBatchProcessor({
                        validator: null,
                        logger: this.logger,
                        storage: this.taskManager.storage
                    }, {
                        maxBatchSize: 1,
                        concurrentBatches: 1,
                        maxRetries: 3,
                        retryDelay: 1000
                    });
                    
                    // Process operations sequentially with dependency ordering
                    const result = await batchProcessor.processInBatches(
                        operationsWithDeps.map(op => ({
                            id: op.path,
                            data: op,
                            task: {
                                path: op.path,
                                type: 'TASK',
                                name: op.path,
                                status: 'PENDING',
                                metadata: {}
                            },
                            dependencies: op.dependencies || []
                        })),
                        1,
                        async (operation: BatchData): Promise<unknown> => {
                            const op = operation.data as BulkOperation;
                            let result: unknown;
                        try {
                            switch (op.type) {
                                case 'create': {
                                    // Extract parent path from task path if not provided
                                    const pathSegments = op.path.split('/');
                                    const parentPath = op.data?.parentPath as string || 
                                        (pathSegments.length > 1 ? pathSegments.slice(0, -1).join('/') : undefined);

                                    const taskData: CreateTaskInput = {
                                        path: op.path,
                                        name: op.data?.name as string || pathSegments[pathSegments.length - 1] || 'Unnamed Task',
                                        type: (op.data?.type as string || 'TASK').toUpperCase() as TaskType,
                                        description: op.data?.description as string,
                                        dependencies: op.data?.dependencies as string[] || [],
                                        parentPath,
                                        metadata: {
                                            ...(op.data?.metadata || {}),
                                            created: Date.now(),
                                            updated: Date.now()
                                        }
                                    };

                                    // Validate hierarchy rules
                                    await this.validateTaskHierarchy(taskData, 'create');

                                    result = await this.taskManager.createTask(taskData);
                                    break;
                                }
                                case 'update': {
                                    const updateData: UpdateTaskInput = {
                                        status: op.data?.status as TaskStatus,
                                        metadata: op.data?.metadata as Record<string, unknown>,
                                        notes: op.data?.notes as string[],
                                        dependencies: op.data?.dependencies as string[],
                                        description: op.data?.description as string,
                                        name: op.data?.name as string,
                                        type: op.data?.type ? (op.data.type as string).toUpperCase() as TaskType : undefined
                                    };

                                    // Validate hierarchy rules if type is being updated
                                    if (updateData.type) {
                                        await this.validateTaskHierarchy({ ...updateData, path: op.path }, 'update');
                                    }

                                    result = await this.taskManager.updateTask(op.path, updateData);
                                    break;
                                }
                                case 'delete':
                                    result = await this.taskManager.deleteTask(op.path);
                                    break;
                                default:
                                    throw createError(
                                        ErrorCodes.INVALID_INPUT,
                                        `Invalid operation type: ${op.type}`
                                    );
                            }
                            return result;
                        } catch (error) {
                            this.logger.error('Operation failed', {
                                operation: op,
                                error
                            });
                            throw error;
                        }
                    });

                    return this.formatResponse({
                        success: result.metadata?.successCount === operationsWithDeps.length,
                        processedCount: result.metadata?.successCount || 0,
                        failedCount: result.metadata?.errorCount || 0,
                        errors: result.errors.map(err => ({
                            operation: err,
                            error: err.message,
                            context: undefined
                        }))
                    });
                }
            },
            {
                name: 'clear_all_tasks',
                description: clearAllTasksSchema.properties.confirm.description,
                inputSchema: {
                    type: "object",
                    properties: clearAllTasksSchema.properties,
                    required: clearAllTasksSchema.required
                },
                handler: async (args: Record<string, unknown>) => {
                    await this.taskManager.clearAllTasks(args.confirm as boolean);
                    return this.formatResponse({ success: true, message: 'All tasks cleared' });
                }
            },
            {
                name: 'vacuum_database',
                description: vacuumDatabaseSchema.properties.analyze.description,
                inputSchema: {
                    type: "object",
                    properties: vacuumDatabaseSchema.properties,
                    required: vacuumDatabaseSchema.required
                },
                handler: async (args: Record<string, unknown>) => {
                    await this.taskManager.vacuumDatabase(args.analyze as boolean);
                    return this.formatResponse({ success: true, message: 'Database optimized' });
                }
            },
            {
                name: 'repair_relationships',
                description: repairRelationshipsSchema.properties.dryRun.description,
                inputSchema: {
                    type: "object",
                    properties: repairRelationshipsSchema.properties,
                    required: repairRelationshipsSchema.required
                },
                handler: async (args: Record<string, unknown>) => {
                    const result = await this.taskManager.repairRelationships(
                        args.dryRun as boolean,
                        args.pathPattern as string | undefined
                    );
                    return this.formatResponse(result);
                }
            }
        ];

        for (const tool of defaultTools) {
            this.registerTool(tool);
        }
    }

    private registerTool(tool: Tool & { handler: (args: Record<string, unknown>) => Promise<ToolResponse> }): void {
        const { handler, ...toolDef } = tool;
        this.tools.set(tool.name, toolDef);
        this.toolHandlers.set(tool.name, handler);
        this.logger.debug('Registered tool', { name: tool.name });
    }

    async listTools(): Promise<{ tools: Tool[] }> {
        const tools = Array.from(this.tools.values());
        this.logger.info('Listed tools', { 
            count: tools.length,
            tools: tools.map(t => ({
                name: t.name,
                schema: t.inputSchema
            }))
        });
        return { tools };
    }

    async handleToolCall(request: { params: { name: string; arguments?: Record<string, unknown> } }): Promise<{
        _meta?: Record<string, unknown>;
        content: Array<{ type: string; text: string }>;
    }> {
        const { name, arguments: args = {} } = request.params;

        // Enhanced tool validation
        const tool = this.tools.get(name);
        if (!tool) {
            throw createError(
                ErrorCodes.TOOL_NOT_FOUND,
                { availableTools: Array.from(this.tools.keys()) },
                `Tool '${name}' is not registered`,
                `Available tools: ${Array.from(this.tools.keys()).join(', ')}`
            );
        }

        const handler = this.toolHandlers.get(name);
        if (!handler) {
            throw createError(
                ErrorCodes.TOOL_HANDLER_MISSING,
                { tool: name },
                `Handler for tool '${name}' is not implemented`,
                'This indicates a system configuration issue. Contact the administrator.'
            );
        }

        try {
            // Validate required parameters
            const missingParams = (tool.inputSchema.required || [])
                .filter(param => !(param in args));
            if (missingParams.length > 0) {
                throw createError(
                    ErrorCodes.TOOL_PARAMS_INVALID,
                    {
                        tool: name,
                        missingParams,
                        providedParams: Object.keys(args)
                    },
                    `Missing required parameters for tool '${name}'`,
                    `Required parameters: ${missingParams.join(', ')}`
                );
            }

            // Validate dependencies location
            if ((name === 'create_task' || name === 'update_task') && 
                (args as any).metadata?.dependencies) {
                throw createError(
                    ErrorCodes.TOOL_PARAMS_INVALID,
                    {
                        tool: name,
                        issue: 'dependencies_in_metadata'
                    },
                    'Invalid dependencies location',
                    'Dependencies must be specified at root level, not in metadata. Move "dependencies" out of metadata object.'
                );
            }

            // Check for database state before operations
            if (['create_task', 'update_task', 'delete_task', 'bulk_task_operations'].includes(name)) {
                if (this.isShuttingDown) {
                    throw createError(
                        ErrorCodes.TOOL_SHUTDOWN,
                        {
                            tool: name,
                            state: 'shutting_down'
                        },
                        'Cannot perform task operations while server is shutting down',
                        'Wait for system restart before retrying operations'
                    );
                }
            }

            // Validate tool state
            if (!this.taskManager.storage) {
                throw createError(
                    ErrorCodes.TOOL_STATE_INVALID,
                    {
                        tool: name,
                        issue: 'storage_not_initialized'
                    },
                    'Storage system not initialized',
                    'Database connection must be established before performing operations'
                );
            }

            this.logger.debug('Executing tool', { 
                name, 
                args,
                schema: tool.inputSchema
            });

            const result = await handler(args);

            this.logger.debug('Tool execution completed', { 
                name,
                resultType: result?.content?.[0]?.type
            });

            return {
                _meta: {
                    tool: name,
                    timestamp: Date.now()
                },
                ...result
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const errorDetails = error instanceof Error ? {
                name: error.name,
                code: (error as any).code,
                stack: error.stack
            } : {};

            this.logger.error('Tool execution failed', {
                tool: name,
                args,
                error: errorMessage,
                details: errorDetails
            });

            // Enhance error message with context
            throw createError(
                (error as any).code || ErrorCodes.INTERNAL_ERROR,
                `Tool '${name}' execution failed: ${errorMessage}`,
                JSON.stringify({
                    tool: name,
                    args,
                    error: errorMessage,
                    ...errorDetails
                }, null, 2)
            );
        }
    }

    async getStorageMetrics(): Promise<any> {
        return await this.taskManager.storage.getMetrics();
    }

    async clearCaches(): Promise<void> {
        const storage = this.taskManager.storage as TaskStorage;
        if (storage?.clearCache) {
            await storage.clearCache();
        }
    }

    async cleanup(): Promise<void> {
        if (this.isShuttingDown) {
            return;
        }

        this.isShuttingDown = true;
        this.logger.info('Starting tool handler cleanup...');

        try {
            // Clear caches first
            await this.clearCaches();

            // Checkpoint database to ensure WAL is flushed
            const storage = this.taskManager.storage as TaskStorage;
            if (storage) {
                await storage.checkpoint();
            }

            this.logger.info('Tool handler cleanup completed');
        } catch (error) {
            this.logger.error('Error during tool handler cleanup:', { error });
            throw error;
        }
    }

    private formatResponse(result: unknown): ToolResponse {
        try {
            const sanitizedResult = JSON.parse(JSON.stringify(result, (key, value) => {
                if (typeof value === 'bigint') {
                    return value.toString();
                }
                if (key.toLowerCase().includes('secret') || 
                    key.toLowerCase().includes('password') ||
                    key.toLowerCase().includes('token')) {
                    return undefined;
                }
                return value;
            }));

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(sanitizedResult, null, 2)
                }]
            };
        } catch (error) {
            this.logger.error('Failed to format response', { error });
            throw createError(
                ErrorCodes.INTERNAL_ERROR,
                'Failed to format response'
            );
        }
    }
}
