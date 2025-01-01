import { TaskType, TaskStatus, UpdateTaskInput } from '../../../types/task.js';
import { ToolFactory, ToolImplementation } from './shared/types.js';
import { formatResponse } from './shared/response-formatter.js';
import { DependencyAwareBatchProcessor } from '../../../task/core/batch/dependency-aware-batch-processor.js';
import { BatchData } from '../../../task/core/batch/common/batch-utils.js';
import { ErrorCodes, createError } from '../../../errors/index.js';

/**
 * Bulk task operations tool implementation
 */
export const bulkTaskOperationsTool: ToolFactory = (context): ToolImplementation => ({
  definition: {
    name: 'bulk_task_operations',
    description: `Execute multiple task operations atomically.

When to Use:
- Creating related tasks
- Implementing new features
- Restructuring task hierarchy
- Updating multiple dependencies

Best Practices:
- Group related operations
- Order logically
- Maintain dependencies
- Handle failures gracefully
- Document operation reasoning

Example:
{
  "operations": [
    {
      "type": "create",
      "path": "project/backend/oauth2",
      "data": {
        "title": "Implement OAuth2 Authentication",
        "type": "MILESTONE",
        "description": "Replace JWT auth with OAuth2 implementation",
        "metadata": {
          "reasoning": "OAuth2 provides better security and standardization"
        }
      }
    },
    {
      "type": "create",
      "path": "project/backend/oauth2/provider-setup",
      "data": {
        "title": "Configure OAuth2 Providers",
        "dependencies": ["project/backend/oauth2"],
        "metadata": {
          "reasoning": "Provider setup required before implementation"
        }
      }
    },
    {
      "type": "update",
      "path": "project/backend/auth",
      "data": {
        "status": "CANCELLED",
        "metadata": {
          "reasoning": "Replaced by OAuth2 implementation"
        }
      }
    }
  ],
  "reasoning": "Transitioning authentication system to OAuth2. Creating necessary task structure and updating existing tasks to reflect the change."
}`,
    inputSchema: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          description: `Sequence of atomic task operations:
Operations execute in dependency order and roll back on failure.
Each operation must include:
- type: Operation type (create/update/delete)
- path: Target task path
- data: Operation-specific data

Create operations support:
- title: Task name (required)
- description: Task details
- type: TASK/MILESTONE
- dependencies: Required tasks
- metadata: Additional context

Update operations support:
- All task fields can be modified
- Status changes validate dependencies
- Moving tasks updates relationships

Delete operations:
- Remove task and all children
- Update dependent task references
Note: Operations are atomic - all succeed or all fail`,
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['create', 'update', 'delete'],
                description: `Operation type:
- create: Add new task with full context
- update: Modify existing task properties
- delete: Remove task and children`,
              },
              path: {
                type: 'string',
                description: `Task path for operation:
- Must be valid path format
- Create: Sets new task location
- Update: Identifies target task
- Delete: Specifies task to remove`,
              },
              data: {
                type: 'object',
                description: `Operation-specific data:
Create/Update fields:
- title: Task name
- description: Task details
- type: TASK/MILESTONE
- status: Task state
- dependencies: Required tasks
- metadata: Additional context
Delete: No additional data needed`,
              },
            },
            required: ['type', 'path'],
          },
        },
        reasoning: {
          type: 'string',
          description: `Explanation for bulk operation. Best practices:
- Document overall goal
- Explain relationships between operations
- Note impact on existing tasks
- Record migration details if applicable`,
        },
      },
      required: ['operations'],
    },
  },
  handler: async (args: Record<string, unknown>) => {
    const { operations } = args as {
      operations: Array<{
        type: 'create' | 'update' | 'delete';
        path: string;
        data?: Record<string, unknown>;
      }>;
    };

    const batchProcessor = new DependencyAwareBatchProcessor(
      {
        validator: null,
        logger: context.logger,
        storage: context.taskManager.getStorage(),
      },
      {
        maxBatchSize: 1,
        concurrentBatches: 1,
        maxRetries: 3,
        retryDelay: 1000,
      }
    );

    const result = await batchProcessor.processInBatches(
      operations.map(op => ({
        id: op.path,
        data: op,
        dependencies: (op.data?.dependencies as string[]) || [],
      })),
      1,
      async (operation: BatchData) => {
        const op = operation.data as { type: string; path: string; data?: Record<string, unknown> };

        switch (op.type) {
          case 'create': {
            await context.taskManager.createTask({
              path: op.path,
              name: (op.data?.title as string) || op.path.split('/').pop() || '',
              type: ((op.data?.type as string) || 'TASK').toUpperCase() as TaskType,
              description: op.data?.description as string,
              dependencies: (op.data?.dependencies as string[]) || [],
              metadata: (op.data?.metadata as Record<string, unknown>) || {},
              statusMetadata: {},
              notes: [],
            });
            break;
          }
          case 'update': {
            // First get existing task to preserve required fields
            const existingTask = await context.taskManager.getTask(op.path);
            if (!existingTask) {
              throw createError(
                ErrorCodes.TASK_NOT_FOUND,
                `Task not found at path: ${op.path}`,
                'bulk_task_operations'
              );
            }

            // Create update object preserving all required fields
            const updateData: UpdateTaskInput = {
              // Required fields
              name: existingTask.name,
              type: existingTask.type,
              status: existingTask.status,

              // Optional fields
              description: existingTask.description,
              dependencies: existingTask.dependencies,
              metadata: { ...existingTask.metadata },
              statusMetadata: { ...existingTask.statusMetadata },
              notes: existingTask.notes,
              planningNotes: existingTask.planningNotes,
              progressNotes: existingTask.progressNotes,
              completionNotes: existingTask.completionNotes,
              troubleshootingNotes: existingTask.troubleshootingNotes,
            };

            // Apply updates only if they are provided
            if (typeof op.data?.title === 'string') {
              updateData.name = op.data.title;
            }
            if (op.data?.type) {
              updateData.type = (op.data.type as string).toUpperCase() as TaskType;
            }
            if (op.data?.description !== undefined) {
              updateData.description = op.data.description as string;
            }
            if (op.data?.status !== undefined) {
              updateData.status = op.data.status as TaskStatus;
            }
            if (Array.isArray(op.data?.dependencies)) {
              updateData.dependencies = op.data.dependencies as string[];
            }
            if (op.data?.metadata) {
              updateData.metadata = {
                ...updateData.metadata,
                ...(op.data.metadata as Record<string, unknown>),
              };
            }
            if (op.data?.statusMetadata) {
              updateData.statusMetadata = {
                ...updateData.statusMetadata,
                ...(op.data.statusMetadata as Record<string, unknown>),
              };
            }

            await context.taskManager.updateTask(op.path, updateData);
            break;
          }
          case 'delete':
            await context.taskManager.deleteTask(op.path);
            break;
          default:
            throw createError(
              ErrorCodes.INVALID_INPUT,
              `Invalid operation type: ${op.type}`,
              'bulk_task_operations'
            );
        }
      }
    );

    return formatResponse(
      {
        success: result.metadata?.successCount === operations.length,
        processedCount: result.metadata?.successCount || 0,
        failedCount: result.metadata?.errorCount || 0,
        errors: result.errors,
      },
      context.logger
    );
  },
});