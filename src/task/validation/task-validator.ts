import { Logger } from '../../logging/index.js';
import { TaskStorage } from '../../types/storage.js';
import { 
  CreateTaskInput, 
  UpdateTaskInput, 
  TaskType, 
  TaskStatus,
  validateDependencyStatus,
  Task
} from '../../types/task.js';
import { ErrorCodes, createError } from '../../errors/index.js';

export class TaskValidator {
  private readonly logger: Logger;

  constructor(private readonly storage: TaskStorage) {
    this.logger = Logger.getInstance().child({ component: 'TaskValidator' });
  }

  async validateCreate(input: CreateTaskInput): Promise<void> {
    try {
      // Validate required fields
      if (!input.name) {
        throw createError(
          ErrorCodes.TASK_VALIDATION,
          {
            field: 'name',
            value: input.name
          },
          'Task name is required',
          'Provide a non-empty string for the task name'
        );
      }

      // Validate task type
      if (input.type && !Object.values(TaskType).includes(input.type)) {
        throw createError(
          ErrorCodes.TASK_INVALID_TYPE,
          {
            providedType: input.type,
            allowedTypes: Object.values(TaskType)
          },
          `Invalid task type: ${input.type}`,
          `Task type must be one of: ${Object.values(TaskType).join(', ')}`
        );
      }

      // Validate parent path if provided
      if (input.parentPath) {
        const parent = await this.storage.getTask(input.parentPath);
        if (!parent) {
          throw createError(
            ErrorCodes.TASK_PARENT_NOT_FOUND,
            {
              parentPath: input.parentPath,
              taskName: input.name
            },
            `Parent task not found: ${input.parentPath}`,
            'Verify the parent task exists before creating a child task'
          );
        }

        // Validate parent-child relationship
        if (parent.type === TaskType.TASK) {
          throw createError(
            ErrorCodes.TASK_PARENT_TYPE,
            {
              parentType: parent.type,
              parentPath: input.parentPath,
              childType: input.type
            },
            'Invalid parent type: TASK cannot have child tasks',
            'Only GROUP and MILESTONE types can contain child tasks'
          );
        }

        if (parent.type === TaskType.GROUP && input.type === TaskType.MILESTONE) {
          throw createError(
            ErrorCodes.TASK_PARENT_TYPE,
            {
              parentType: parent.type,
              parentPath: input.parentPath,
              childType: input.type
            },
            'Invalid parent-child relationship: GROUP cannot contain MILESTONE tasks',
            'GROUP type can only contain TASK type children'
          );
        }
      }

      // Validate dependencies if provided
      if (input.dependencies?.length) {
        await this.validateDependencies(input.dependencies, input.name);
      }

      // Validate metadata if provided
      if (input.metadata) {
        this.validateMetadata(input.metadata, input.name);
      }

      // Validate path format if provided
      if (input.path) {
        this.validatePathFormat(input.path);
      }
    } catch (error) {
      this.logger.error('Task creation validation failed', {
        error,
        input
      });
      throw error;
    }
  }

  async validateUpdate(path: string, updates: UpdateTaskInput): Promise<void> {
    try {
      const existingTask = await this.storage.getTask(path);
      if (!existingTask) {
        throw createError(
          ErrorCodes.TASK_NOT_FOUND,
          {
            path,
            updates
          },
          `Task not found: ${path}`,
          'Verify the task exists before attempting to update'
        );
      }

      // Validate task type change
      if (updates.type && updates.type !== existingTask.type) {
        // Check if task has children when changing to TASK type
        if (updates.type === TaskType.TASK) {
          const hasChildren = await this.storage.hasChildren(path);
          if (hasChildren) {
            throw createError(
              ErrorCodes.TASK_INVALID_TYPE,
              {
                currentType: existingTask.type,
                newType: updates.type,
                path
              },
              'Cannot change to TASK type when task has children',
              'Remove or reassign child tasks before changing type to TASK'
            );
          }
        }
      }

      // Validate status change
      if (updates.status) {
        await this.validateStatusChange(existingTask, updates.status);
      }

      // Validate dependencies change
      if (updates.dependencies) {
        await this.validateDependencies(updates.dependencies, existingTask.name);
      }

      // Validate metadata updates
      if (updates.metadata) {
        this.validateMetadata(updates.metadata, existingTask.name);
      }
    } catch (error) {
      this.logger.error('Task update validation failed', {
        error,
        path,
        updates
      });
      throw error;
    }
  }

  private async validateDependencies(dependencies: string[], taskName?: string): Promise<void> {
    const missingDeps: string[] = [];
    const circularDeps: string[] = [];

    for (const depPath of dependencies) {
      const depTask = await this.storage.getTask(depPath);
      if (!depTask) {
        missingDeps.push(depPath);
      } else {
        // Check for circular dependencies
        const depDeps = await this.getAllDependencies(depPath);
        if (dependencies.some(d => depDeps.includes(d))) {
          circularDeps.push(depPath);
        }
      }
    }

    if (missingDeps.length > 0) {
      throw createError(
        ErrorCodes.TASK_DEPENDENCY,
        {
          missingDependencies: missingDeps,
          taskName
        },
        `Missing dependencies: ${missingDeps.join(', ')}`,
        'Ensure all dependency tasks exist before creating dependencies'
      );
    }

    if (circularDeps.length > 0) {
      throw createError(
        ErrorCodes.TASK_CYCLE,
        {
          circularDependencies: circularDeps,
          taskName
        },
        `Circular dependencies detected: ${circularDeps.join(', ')}`,
        'Remove circular dependencies to maintain a valid task hierarchy'
      );
    }
  }

  private validateMetadata(metadata: Record<string, unknown>, taskName?: string): void {
    if (typeof metadata !== 'object' || metadata === null) {
      throw createError(
        ErrorCodes.TASK_VALIDATION,
        {
          field: 'metadata',
          value: metadata,
          taskName
        },
        'Invalid metadata format',
        'Metadata must be a valid JSON object'
      );
    }

    // Check for common metadata issues
    if ('dependencies' in metadata) {
      throw createError(
        ErrorCodes.TASK_VALIDATION,
        {
          field: 'metadata',
          issue: 'dependencies_in_metadata',
          taskName
        },
        'Dependencies found in metadata',
        'Dependencies should be specified at the root level, not in metadata'
      );
    }
  }

  private validatePathFormat(path: string): void {
    const MAX_DEPTH = 8;
    const PATH_PATTERN = /^[a-z0-9][a-z0-9_.-]*(?:\/[a-z0-9][a-z0-9_.-]*)*$/;

    if (!PATH_PATTERN.test(path)) {
      throw createError(
        ErrorCodes.TASK_INVALID_PATH,
        {
          path,
          pattern: PATH_PATTERN.toString()
        },
        'Invalid task path format',
        'Task path must:\n' +
        '1. Start with alphanumeric character\n' +
        '2. Contain only lowercase alphanumeric characters, underscores, dots, and hyphens\n' +
        '3. Use forward slashes for hierarchy\n' +
        '4. Not start or end with a slash'
      );
    }

    const depth = path.split('/').length;
    if (depth > MAX_DEPTH) {
      throw createError(
        ErrorCodes.TASK_INVALID_PATH,
        {
          path,
          depth,
          maxDepth: MAX_DEPTH
        },
        `Task path exceeds maximum depth of ${MAX_DEPTH}`,
        'Reduce the number of nested levels in the task path'
      );
    }
  }

  private async validateStatusChange(
    task: Task,
    newStatus: TaskStatus
  ): Promise<void> {
    // Clear any cached state
    if ('clearCache' in this.storage) {
      await (this.storage as any).clearCache();
    }

    // Get fresh task state
    const currentTask = await this.storage.getTask(task.path);
    if (!currentTask) {
      throw createError(
        ErrorCodes.TASK_NOT_FOUND,
        { path: task.path },
        `Task not found: ${task.path}`,
        'Verify the task exists before updating status'
      );
    }

    // Use fresh task state for validation
    const validTransitions: Record<TaskStatus, TaskStatus[]> = {
      [TaskStatus.PENDING]: [
        TaskStatus.IN_PROGRESS,
        TaskStatus.BLOCKED,
        TaskStatus.FAILED
      ],
      [TaskStatus.IN_PROGRESS]: [
        TaskStatus.COMPLETED,
        TaskStatus.FAILED,
        TaskStatus.BLOCKED
      ],
      [TaskStatus.COMPLETED]: [TaskStatus.IN_PROGRESS],
      [TaskStatus.FAILED]: [TaskStatus.PENDING],
      [TaskStatus.BLOCKED]: [TaskStatus.PENDING, TaskStatus.FAILED]
    };

    if (!validTransitions[currentTask.status]?.includes(newStatus)) {
      throw createError(
        ErrorCodes.TASK_STATUS,
        {
          currentStatus: currentTask.status,
          newStatus,
          validTransitions: validTransitions[currentTask.status],
          path: task.path
        },
        `Invalid status transition from ${currentTask.status} to ${newStatus}`,
        `Valid transitions from ${currentTask.status} are: ${validTransitions[currentTask.status]?.join(', ')}`
      );
    }

    // Check dependencies status
    if (currentTask.dependencies.length > 0) {
      for (const depPath of currentTask.dependencies) {
        const depTask = await this.storage.getTask(depPath);
        if (!depTask) {
          throw createError(
            ErrorCodes.TASK_DEPENDENCY,
            { path: currentTask.path, dependencyPath: depPath },
            `Dependency not found: ${depPath}`,
            'Verify all dependencies exist before updating status'
          );
        }

        // Use validateDependencyStatus for comprehensive status checks
        const updatedTask = { ...currentTask, status: newStatus };
        const validation = validateDependencyStatus(updatedTask, depTask);
        
        if (!validation.valid) {
          throw createError(
            ErrorCodes.TASK_DEPENDENCY,
            {
              path: task.path,
              dependencyPath: depPath,
              status: newStatus,
              dependencyStatus: depTask.status
            },
            'Status update blocked by dependency constraint',
            validation.reason || 'Unknown dependency issue'
          );
        }
      }
    }


    // Validate subtask status for completion
    if (newStatus === TaskStatus.COMPLETED) {
      const subtasks = await this.storage.getSubtasks(task.path);
      const incompleteSubtasks = subtasks.filter(
        st => st.status !== TaskStatus.COMPLETED
      );

      if (incompleteSubtasks.length > 0) {
        throw createError(
          ErrorCodes.TASK_STATUS,
          {
            path: task.path,
            newStatus,
            incompleteSubtasks: incompleteSubtasks.map(st => ({
              path: st.path,
              status: st.status
            }))
          },
          'Cannot complete task with incomplete subtasks',
          `Complete all subtasks first:\n${incompleteSubtasks
            .map(st => `- ${st.path} (${st.status})`)
            .join('\n')}`
        );
      }
    }
  }

  private async getAllDependencies(path: string): Promise<string[]> {
    const seen = new Set<string>();
    const dependencies: string[] = [];

    const traverse = async (taskPath: string) => {
      if (seen.has(taskPath)) return;
      seen.add(taskPath);

      const task = await this.storage.getTask(taskPath);
      if (task?.dependencies) {
        for (const depPath of task.dependencies) {
          dependencies.push(depPath);
          await traverse(depPath);
        }
      }
    };

    await traverse(path);
    return dependencies;
  }
}
