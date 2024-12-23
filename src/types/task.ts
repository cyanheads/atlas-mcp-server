/**
 * Task type definitions
 */
import { sep } from 'path';

// Helper function to normalize paths for consistent handling
const normalizePath = (path: string): string => path.split(sep).join('/');

export enum TaskType {
    TASK = 'TASK',
    MILESTONE = 'MILESTONE',
    GROUP = 'GROUP'
}

export enum TaskStatus {
    PENDING = 'PENDING',
    IN_PROGRESS = 'IN_PROGRESS',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',
    BLOCKED = 'BLOCKED'
}

export interface TaskMetadata {
    priority?: 'low' | 'medium' | 'high';
    tags?: string[];
    reasoning?: string;  // LLM's reasoning about task decisions
    toolsUsed?: string[];  // Tools used by LLM to accomplish task
    resourcesAccessed?: string[];  // Resources accessed by LLM
    contextUsed?: string[];  // Key context pieces used in decision making
    created: number;
    updated: number;
    projectPath: string;
    version: number;
    [key: string]: unknown;
}

export interface Task {
    path: string;  // Max depth of 8 levels
    name: string;  // Max 200 chars
    description?: string;  // Max 2000 chars
    type: TaskType;
    status: TaskStatus;
    parentPath?: string;
    notes?: string[];  // Each note max 1000 chars
    reasoning?: string;  // Max 2000 chars - LLM's reasoning about the task
    dependencies: string[];  // Max 50 dependencies
    subtasks: string[];  // Max 100 subtasks
    metadata: TaskMetadata;  // Each string field max 1000 chars, arrays max 100 items
}

export interface CreateTaskInput extends Record<string, unknown> {
    path?: string;
    name: string;
    parentPath?: string;
    description?: string;
    type?: TaskType;
    notes?: string[];
    reasoning?: string;
    dependencies?: string[];
    metadata?: Partial<TaskMetadata>;
}

export interface UpdateTaskInput extends Record<string, unknown> {
    name?: string;
    description?: string;
    type?: TaskType;
    status?: TaskStatus;
    parentPath?: string;
    notes?: string[];
    reasoning?: string;
    dependencies?: string[];
    metadata?: Partial<TaskMetadata>;
}

export interface TaskResponse<T> {
    success: boolean;
    data?: T;
    error?: {
        code: string;
        message: string;
    };
    metadata: {
        timestamp: number;
        requestId: string;
        projectPath: string;
        affectedPaths: string[];
    };
}

// Field length constraints
export const CONSTRAINTS = {
    NAME_MAX_LENGTH: 200,
    DESCRIPTION_MAX_LENGTH: 2000,
    NOTE_MAX_LENGTH: 1000,
    REASONING_MAX_LENGTH: 2000,
    METADATA_STRING_MAX_LENGTH: 1000,
    MAX_DEPENDENCIES: 50,
    MAX_SUBTASKS: 100,
    MAX_NOTES: 100,
    MAX_ARRAY_ITEMS: 100,
    MAX_PATH_DEPTH: 8
} as const;

/**
 * Validates a task path format and depth
 */
export function validateTaskPath(path: string): { valid: boolean; error?: string } {
    // Path must be non-empty
    if (!path) {
        return { valid: false, error: 'Path cannot be empty' };
    }

    // Normalize path for validation
    const normalizedPath = normalizePath(path);

    // Path must contain only allowed characters
    if (!normalizedPath.match(/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/)) {
        return { 
            valid: false, 
            error: 'Path can only contain alphanumeric characters, underscores, dots, and hyphens' 
        };
    }
    
    // Check path depth
    if (normalizedPath.split('/').length > CONSTRAINTS.MAX_PATH_DEPTH) {
        return { 
            valid: false, 
            error: `Path depth cannot exceed ${CONSTRAINTS.MAX_PATH_DEPTH} levels` 
        };
    }

    return { valid: true };
}

/**
 * Validates field length constraints
 */
export function validateFieldLength(
    field: string | undefined,
    maxLength: number,
    fieldName: string
): { valid: boolean; error?: string } {
    if (!field) return { valid: true };
    
    if (field.length > maxLength) {
        return {
            valid: false,
            error: `${fieldName} length cannot exceed ${maxLength} characters`
        };
    }
    
    return { valid: true };
}

/**
 * Validates array size constraints
 */
export function validateArraySize<T>(
    array: T[] | undefined,
    maxSize: number,
    arrayName: string
): { valid: boolean; error?: string } {
    if (!array) return { valid: true };
    
    if (array.length > maxSize) {
        return {
            valid: false,
            error: `${arrayName} cannot contain more than ${maxSize} items`
        };
    }
    
    return { valid: true };
}

/**
 * Validates a complete task
 */
export function validateTask(task: Task): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate path
    const pathValidation = validateTaskPath(task.path);
    if (!pathValidation.valid && pathValidation.error) {
        errors.push(pathValidation.error);
    }

    // Validate field lengths
    const fieldValidations = [
        validateFieldLength(task.name, CONSTRAINTS.NAME_MAX_LENGTH, 'Name'),
        validateFieldLength(task.description, CONSTRAINTS.DESCRIPTION_MAX_LENGTH, 'Description'),
        validateFieldLength(task.reasoning, CONSTRAINTS.REASONING_MAX_LENGTH, 'Reasoning')
    ];

    fieldValidations.forEach(validation => {
        if (!validation.valid && validation.error) {
            errors.push(validation.error);
        }
    });

    // Validate array sizes
    const arrayValidations = [
        validateArraySize(task.dependencies, CONSTRAINTS.MAX_DEPENDENCIES, 'Dependencies'),
        validateArraySize(task.subtasks, CONSTRAINTS.MAX_SUBTASKS, 'Subtasks'),
        validateArraySize(task.notes, CONSTRAINTS.MAX_NOTES, 'Notes')
    ];

    arrayValidations.forEach(validation => {
        if (!validation.valid && validation.error) {
            errors.push(validation.error);
        }
    });

    // Validate notes length
    task.notes?.forEach((note, index) => {
        const noteValidation = validateFieldLength(note, CONSTRAINTS.NOTE_MAX_LENGTH, `Note ${index + 1}`);
        if (!noteValidation.valid && noteValidation.error) {
            errors.push(noteValidation.error);
        }
    });

    // Validate metadata
    if (task.metadata) {
        Object.entries(task.metadata).forEach(([key, value]) => {
            if (typeof value === 'string' && value.length > CONSTRAINTS.METADATA_STRING_MAX_LENGTH) {
                errors.push(`Metadata field '${key}' exceeds maximum length of ${CONSTRAINTS.METADATA_STRING_MAX_LENGTH} characters`);
            }
            if (Array.isArray(value) && value.length > CONSTRAINTS.MAX_ARRAY_ITEMS) {
                errors.push(`Metadata array '${key}' exceeds maximum size of ${CONSTRAINTS.MAX_ARRAY_ITEMS} items`);
            }
        });
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Validates parent-child task type relationships
 */
export function isValidTaskHierarchy(parentType: TaskType, childType: TaskType): { valid: boolean; reason?: string } {
    switch (parentType) {
        case TaskType.MILESTONE:
            // Milestones can contain tasks and groups
            return {
                valid: childType === TaskType.TASK || childType === TaskType.GROUP,
                reason: childType !== TaskType.TASK && childType !== TaskType.GROUP ?
                    `MILESTONE can only contain TASK or GROUP types, not ${childType}` : undefined
            };
        case TaskType.GROUP:
            // Groups can contain tasks
            return {
                valid: childType === TaskType.TASK,
                reason: childType !== TaskType.TASK ?
                    `GROUP can only contain TASK type, not ${childType}` : undefined
            };
        case TaskType.TASK:
            // Tasks cannot contain other tasks
            return {
                valid: false,
                reason: `TASK type cannot contain any subtasks (attempted to add ${childType})`
            };
        default:
            return {
                valid: false,
                reason: `Unknown task type: ${parentType}`
            };
    }
}

/**
 * Validates task dependency status
 */
export function validateDependencyStatus(
    task: Task,
    dependency: Task
): { valid: boolean; reason?: string } {
    // Cannot complete a task if its dependencies aren't completed
    if (task.status === TaskStatus.COMPLETED && dependency.status !== TaskStatus.COMPLETED) {
        return {
            valid: false,
            reason: `Cannot complete task '${task.path}' because its dependency '${dependency.path}' is not completed (current status: ${dependency.status})`
        };
    }

    // Cannot set a task to IN_PROGRESS if any dependency is FAILED
    if (task.status === TaskStatus.IN_PROGRESS && dependency.status === TaskStatus.FAILED) {
        return {
            valid: false,
            reason: `Cannot set task '${task.path}' to IN_PROGRESS because its dependency '${dependency.path}' has FAILED`
        };
    }

    // If any dependency is BLOCKED, the dependent task should be BLOCKED
    if (dependency.status === TaskStatus.BLOCKED && task.status !== TaskStatus.BLOCKED) {
        return {
            valid: false,
            reason: `Task '${task.path}' should be BLOCKED because its dependency '${dependency.path}' is BLOCKED`
        };
    }

    // If any dependency is PENDING and task is being completed, block it
    if (task.status === TaskStatus.COMPLETED && dependency.status === TaskStatus.PENDING) {
        return {
            valid: false,
            reason: `Cannot complete task '${task.path}' because its dependency '${dependency.path}' hasn't been started yet (status: PENDING)`
        };
    }

    // If any dependency is IN_PROGRESS and task is being completed, block it
    if (task.status === TaskStatus.COMPLETED && dependency.status === TaskStatus.IN_PROGRESS) {
        return {
            valid: false,
            reason: `Cannot complete task '${task.path}' because its dependency '${dependency.path}' is still in progress`
        };
    }

    return { valid: true };
}

/**
 * Gets the task name from a path
 */
export function getTaskName(path: string): string {
    const normalizedPath = normalizePath(path);
    const segments = normalizedPath.split('/');
    return segments[segments.length - 1];
}

/**
 * Gets the parent path from a task path
 */
export function getParentPath(path: string): string | undefined {
    const normalizedPath = normalizePath(path);
    const segments = normalizedPath.split('/');
    return segments.length > 1 ? segments.slice(0, -1).join('/') : undefined;
}
