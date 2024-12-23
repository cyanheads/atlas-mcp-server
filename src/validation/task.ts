/**
 * Task validation module
 */
import { z } from 'zod';
import { sep } from 'path';
import { TaskType, TaskStatus } from '../types/task.js';

// Create platform-agnostic path separator pattern
const pathSepPattern = sep === '\\' ? '\\\\' : sep;
// Path segment pattern allowing alphanumeric, underscore, dot, and hyphen
const pathSegmentPattern = '[a-zA-Z0-9_.-]+';
// Complete path pattern with platform-agnostic separator
const pathRegex = new RegExp(`^${pathSegmentPattern}(?:${pathSepPattern}${pathSegmentPattern})*$`);

// Path validation schema
const pathSchema = z.string()
    .transform((path: string) => path.split(sep).join('/'))
    .pipe(z.string().regex(pathRegex));

// Task metadata schema
const taskMetadataSchema = z.object({
    priority: z.enum(['low', 'medium', 'high']).optional(),
    tags: z.array(z.string().max(100)).max(100).optional(),
    reasoning: z.string().max(2000).optional(),
    toolsUsed: z.array(z.string().max(100)).max(100).optional(),
    resourcesAccessed: z.array(z.string().max(100)).max(100).optional(),
    contextUsed: z.array(z.string().max(1000)).max(100).optional(),
    created: z.number(),
    updated: z.number(),
    projectPath: z.string().max(1000),
    version: z.number().positive()
}).passthrough(); // Allow additional properties with size limits

// Base task schema
const baseTaskSchema = z.object({
    path: pathSchema.refine(
        (path: string) => path.split('/').length <= 8,
        'Path depth cannot exceed 8 levels'
    ),
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    type: z.nativeEnum(TaskType),
    status: z.nativeEnum(TaskStatus),
    parentPath: pathSchema.optional(),
    notes: z.array(z.string().max(1000)).max(100).optional(),
    reasoning: z.string().max(2000).optional(),
    dependencies: z.array(z.string()).max(50),
    subtasks: z.array(z.string()).max(100),
    metadata: taskMetadataSchema
});

// Create task input schema
export const createTaskSchema = z.object({
    path: pathSchema
        .refine(
            (path: string) => !path || path.split('/').length <= 8,
            'Path depth cannot exceed 8 levels'
        )
        .optional(),
    name: z.string().min(1).max(200),
    parentPath: pathSchema
        .refine(
            (path: string) => path.split('/').length <= 7, // One less than max to allow for child
            'Parent path depth cannot exceed 7 levels'
        )
        .optional(),
    description: z.string().max(2000).optional(),
    type: z.nativeEnum(TaskType).optional(),
    notes: z.array(z.string().max(1000)).max(100).optional(),
    reasoning: z.string().max(2000).optional(),
    dependencies: z.array(z.string()).max(50).optional(),
    metadata: z.object({
        priority: z.enum(['low', 'medium', 'high']).optional(),
        tags: z.array(z.string().max(100)).max(100).optional(),
        reasoning: z.string().max(2000).optional(),
        toolsUsed: z.array(z.string().max(100)).max(100).optional(),
        resourcesAccessed: z.array(z.string().max(100)).max(100).optional(),
        contextUsed: z.array(z.string().max(1000)).max(100).optional(),
        dependencies: z.array(z.string()).max(50).optional() // Support legacy format
    }).partial().optional().transform(data => {
        if (data?.dependencies) {
            // Log migration of dependencies from metadata
            console.warn('Migrating dependencies from metadata to main task structure');
        }
        return data;
    })
});

// Update task input schema
export const updateTaskSchema = z.object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    type: z.nativeEnum(TaskType).optional(),
    status: z.nativeEnum(TaskStatus).optional(),
    notes: z.array(z.string().max(1000)).max(100).optional(),
    reasoning: z.string().max(2000).optional(),
    dependencies: z.array(z.string()).max(50).optional(),
    metadata: z.object({
        priority: z.enum(['low', 'medium', 'high']).optional(),
        tags: z.array(z.string().max(100)).max(100).optional(),
        reasoning: z.string().max(2000).optional(),
        toolsUsed: z.array(z.string().max(100)).max(100).optional(),
        resourcesAccessed: z.array(z.string().max(100)).max(100).optional(),
        contextUsed: z.array(z.string().max(1000)).max(100).optional(),
        dependencies: z.array(z.string()).max(50).optional() // Support legacy format
    }).partial().optional().transform(data => {
        if (data?.dependencies) {
            // Log migration of dependencies from metadata
            console.warn('Migrating dependencies from metadata to main task structure');
        }
        const { dependencies: _, ...rest } = data || {};
        return rest;
    })
});

// Task response schema
export const taskResponseSchema = z.object({
    success: z.boolean(),
    data: z.unknown().optional(),
    error: z.object({
        code: z.string(),
        message: z.string()
    }).optional(),
    metadata: z.object({
        timestamp: z.number(),
        requestId: z.string(),
        projectPath: z.string(),
        affectedPaths: z.array(z.string())
    })
});

// Export type-safe validation functions
export function validateTask(task: unknown) {
    return baseTaskSchema.parse(task);
}

export function validateCreateTaskInput(input: unknown) {
    return createTaskSchema.parse(input);
}

export function validateUpdateTaskInput(input: unknown) {
    return updateTaskSchema.parse(input);
}

export function validateTaskResponse(response: unknown) {
    return taskResponseSchema.parse(response);
}

// Export schemas for use in other modules
export const schemas = {
    task: baseTaskSchema,
    createTask: createTaskSchema,
    updateTask: updateTaskSchema,
    taskResponse: taskResponseSchema,
    taskMetadata: taskMetadataSchema
};
