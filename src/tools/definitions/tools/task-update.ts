import { TaskType, TaskStatus, Task, UpdateTaskInput } from '../../../types/task.js';
import { ToolFactory, ToolImplementation } from './shared/types.js';
import { formatResponse } from './shared/response-formatter.js';
import { ErrorCodes, createError } from '../../../errors/index.js';

/**
 * Update task tool implementation
 */
export const updateTaskTool: ToolFactory = (context): ToolImplementation => ({
  definition: {
    name: 'update_task',
    description: `Update task properties and status.

Status Transitions:
- PENDING → IN_PROGRESS, BLOCKED, CANCELLED
- IN_PROGRESS → COMPLETED, CANCELLED, BLOCKED
- COMPLETED → No transitions allowed
- CANCELLED → PENDING (for retry)
- BLOCKED → PENDING, IN_PROGRESS

Automatic Behaviors:
- Auto-transition to BLOCKED if dependencies block
- Parent completion requires all children complete
- Cancelled parent cancels non-completed children
- Blocked siblings prevent task completion
- Failed siblings prevent task start

Validation Rules:
- Same constraints as create_task
- Dependencies checked before status changes
- Parent-child status rules enforced
- Metadata schema validated
- Notes length and count limits applied

Best Practices:
- Document status change reasoning
- Update progress indicators
- Track technical implementation details
- Record blockers and resolutions
- Maintain dependency accuracy

Example:
{
  "path": "project/backend/auth",
  "updates": {
    "status": "IN_PROGRESS",
    "progressNotes": [
      "Database schema updated",
      "JWT library integrated",
      "Basic token generation implemented"
    ],
    "metadata": {
      "reasoning": "Moving to IN_PROGRESS as database dependencies are completed and core JWT implementation has begun. Token refresh mechanism still pending.",
      "technical_notes": [
        "Using jsonwebtoken library for JWT operations",
        "Token expiry set to 1 hour with refresh window"
      ]
    }
  }
}`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path of task to update',
        },
        updates: {
          type: 'object',
          description: `Changes to apply to the task. Field constraints:
- title: Task name (max 200 chars)
- description: Task details (max 2000 chars)
- type: TASK/MILESTONE classification
- status: Task state with validation rules
- parentPath: Parent task path (max 1000 chars, 10 levels)
- dependencies: Required tasks (max 50)
- metadata: Task tracking fields:
  - priority: low/medium/high
  - tags: max 100 tags, each max 100 chars
  - reasoning: max 2000 chars
  - tools_used: max 100 entries
  - resources_accessed: max 100 entries
  - context_used: max 100 entries, each max 1000 chars
  - technical_requirements: implementation details
  - acceptance_criteria: validation points
  - status_tracking: timestamps, block reasons
  - version_control: version numbers, states
- notes: Each category max 100 notes, each note max 1000 chars
  - planningNotes: Planning and preparation
  - progressNotes: Implementation progress
  - completionNotes: Completion details
  - troubleshootingNotes: Issue resolution

Status changes trigger:
- Automatic dependency validation
- Status propagation to parent tasks
- Dependent task blocking
- Child task status updates
- Validation of all constraints`,
          properties: {
            title: {
              type: 'string',
              description: 'New task title reflecting current focus',
            },
            description: {
              type: 'string',
              description: 'Updated task details including progress and findings',
            },
            type: {
              type: 'string',
              enum: ['TASK', 'MILESTONE'],
              description: 'Task classification (TASK/MILESTONE)',
            },
            status: {
              type: 'string',
              enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED', 'CANCELLED'],
              description: `Task execution state:
- PENDING: Not started
- IN_PROGRESS: Actively being worked on
- COMPLETED: Successfully finished
- BLOCKED: Waiting on dependencies
- CANCELLED: No longer needed`,
            },
            parentPath: {
              type: 'string',
              description: 'New parent task for hierarchy changes',
            },
            dependencies: {
              type: 'array',
              items: { type: 'string' },
              description: 'Updated list of required tasks',
            },
            planningNotes: {
              type: 'array',
              items: { type: 'string' },
              description: 'Planning and preparation notes',
            },
            progressNotes: {
              type: 'array',
              items: { type: 'string' },
              description: 'Implementation progress notes',
            },
            completionNotes: {
              type: 'array',
              items: { type: 'string' },
              description: 'Task completion notes',
            },
            troubleshootingNotes: {
              type: 'array',
              items: { type: 'string' },
              description: 'Issue resolution notes',
            },
            metadata: {
              type: 'object',
              description: `Update task metadata with any fields needed. The metadata system is flexible and accepts custom fields. Some commonly used fields include:

1. Core Fields:
   - priority: Set task urgency (low/medium/high)
   - tags: Add categorization keywords
   - reasoning: Document decision rationale

2. Technical Details:
   technicalRequirements: {
     - language: Programming language
     - framework: Frameworks/libraries
     - dependencies: Required packages
     - environment: Runtime needs
     - performance: Resource needs
     - [Add any other technical fields needed]
   }

3. Validation:
   acceptanceCriteria: {
     - criteria: Success criteria
     - testCases: Test scenarios
     - reviewers: Required reviews
     - [Add custom validation requirements]
   }
   progress: {
     - milestones: Key checkpoints
     - [Add custom progress tracking fields]
   }

4. Resources:
   resources: {
     - toolsUsed: Required tools
     - resourcesAccessed: Data sources
     - contextUsed: Documentation links
     - [Add other resource fields]
   }

5. Status:
   blockInfo: {
     - blockedBy: Blocking task
     - blockReason: Block description
     - resolution: Fix details
     - [Add custom status fields]
   }

6. Version Control:
   versionControl: {
     - branch: Working branch
     - commit: Commit hash
     - [Add other VCS fields]
   }

7. Custom Fields:
   - Add any additional fields needed
   - Use nested objects for organization
   - No strict schema requirements
   - Fields can be added/removed as needed`,
              // Allow any properties in metadata
              additionalProperties: true,
            },
          },
        },
      },
      required: ['path', 'updates'],
    },
  },
  handler: async (args: Record<string, unknown>) => {
    const { path, updates } = args as { path: string; updates: Record<string, unknown> };

    // First fetch the existing task to preserve required fields
    const existingTask: Task | null = await context.taskManager.getTask(path);
    if (!existingTask) {
      throw createError(
        ErrorCodes.TASK_NOT_FOUND,
        `Task not found at path: ${path}`,
        'update_task'
      );
    }

    // Create update object starting with existing required fields
    const updateData: UpdateTaskInput = {
      name: existingTask.name,
      type: existingTask.type,
      description: existingTask.description,
      dependencies: existingTask.dependencies,
      metadata: { ...existingTask.metadata },
      statusMetadata: { ...existingTask.statusMetadata },
      planningNotes: [...existingTask.planningNotes],
      progressNotes: [...existingTask.progressNotes],
      completionNotes: [...existingTask.completionNotes],
      troubleshootingNotes: [...existingTask.troubleshootingNotes],
    };

    // Apply updates only if they are provided
    if (typeof updates.title === 'string') {
      updateData.name = updates.title;
    }
    if (typeof updates.name === 'string') {
      updateData.name = updates.name;
    }
    if (updates.type) {
      updateData.type = (updates.type as string).toUpperCase() as TaskType;
    }
    if (updates.description !== undefined) {
      updateData.description = updates.description as string;
    }
    if (updates.status !== undefined) {
      updateData.status = updates.status as TaskStatus;
    }
    if (Array.isArray(updates.dependencies)) {
      updateData.dependencies = updates.dependencies as string[];
    }
    if (Array.isArray(updates.planningNotes)) {
      updateData.planningNotes = updates.planningNotes as string[];
    }
    if (Array.isArray(updates.progressNotes)) {
      updateData.progressNotes = updates.progressNotes as string[];
    }
    if (Array.isArray(updates.completionNotes)) {
      updateData.completionNotes = updates.completionNotes as string[];
    }
    if (Array.isArray(updates.troubleshootingNotes)) {
      updateData.troubleshootingNotes = updates.troubleshootingNotes as string[];
    }
    if (updates.metadata) {
      updateData.metadata = {
        ...updateData.metadata,
        ...(updates.metadata as Record<string, unknown>),
      };
    }
    if (updates.statusMetadata) {
      updateData.statusMetadata = {
        ...updateData.statusMetadata,
        ...(updates.statusMetadata as Record<string, unknown>),
      };
    }

    // Update the task with merged data
    const result: Task = await context.taskManager.updateTask(path, updateData);
    return formatResponse(result, context.logger);
  },
});
