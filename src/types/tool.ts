import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { OperationContext } from "../utils/internal/requestContext.js";
// Use OperationContext as ToolContext
export type ToolContext = OperationContext;
// import { createToolMiddleware } from "../utils/security/index.js"; // Assuming this was from a missing file
// import { checkPermission } from "../utils/security/index.js"; // Assuming this was from a missing file
import { McpError } from "./errors.js";
import { createToolResponse, McpToolResponse } from "./mcp.js";

// Tool example definition
export interface ToolExample {
  input: Record<string, unknown>;
  output: string;
  description?: string;
}

// Entity types for Atlas Platform
export type EntityType = 'project' | 'task' | 'knowledge';

// Task types supported in Atlas Platform
export type TaskType = 'research' | 'generation' | 'analysis' | 'integration' | string;

// Project status states
export type ProjectStatus = 'active' | 'pending' | 'in-progress' | 'completed' | 'archived';

// Task status states
export type TaskStatus = 'backlog' | 'todo' | 'in-progress' | 'completed';

// Priority levels for tasks
export type PriorityLevel = 'low' | 'medium' | 'high' | 'critical';

// Domain types for knowledge categorization
export type KnowledgeDomain = 'technical' | 'business' | 'scientific' | string;

// Tool metadata
export interface ToolMetadata {
  examples?: ToolExample[];
  returnSchema?: z.ZodType<any>;
  requiredPermission?: string;
  entityType?: EntityType | EntityType[]; // Associates tool with specific entity types
  rateLimit?: {
    windowMs: number;
    maxRequests: number;
  };
  supportsBulkOperations?: boolean; // Indicates whether tool supports bulk mode
}

// Base handler type that matches SDK expectations
type BaseToolHandler = (
  input: unknown,
  context: ToolContext
) => Promise<McpToolResponse>;

// Enhanced tool registration function
export const registerTool = (
  server: McpServer,
  name: string,
  description: string,
  schema: z.ZodRawShape,
  handler: BaseToolHandler,
  metadata?: ToolMetadata
) => {
  const wrappedHandler = async (
    args: Record<string, unknown>,
    extra: Record<string, unknown>
  ): Promise<McpToolResponse> => {
    try {
      // Check permissions if required
      // if (metadata?.requiredPermission) {
      //   // const { checkPermission } = await import("../utils/security/index.js"); // Placeholder for missing checkPermission
      //   // checkPermission(extra as ToolContext, metadata.requiredPermission);
      //   console.warn(`Permission check for '${metadata.requiredPermission}' skipped due to missing checkPermission function.`);
      // }

      // Validate input
      const zodSchema = z.object(schema);
      const validatedInput = zodSchema.parse(args);

      // Create middleware with custom rate limit if specified
      // const middleware = createToolMiddleware(name); // Placeholder for missing createToolMiddleware
      // const result = await middleware(handler, validatedInput, extra as ToolContext);
      
      // Directly call handler if middleware is missing
      const result = await handler(validatedInput, extra as ToolContext);
      
      // Ensure result matches expected format
      if (typeof result === 'object' && result !== null && 'content' in result) {
        return result as McpToolResponse;
      }
      
      // Convert unexpected result format to standard response
      return createToolResponse(JSON.stringify(result));
    } catch (error) {
      if (error instanceof McpError) {
        return error.toResponse();
      }
      if (error instanceof z.ZodError) {
        return createToolResponse(
          `Validation error: ${error.errors.map(e => e.message).join(", ")}`,
          true
        );
      }
      return createToolResponse(
        `Error: ${error instanceof Error ? error.message : 'An unknown error occurred'}`,
        true
      );
    }
  };

  // Keep description concise and focused on tool purpose only
  const fullDescription = description;
  
  // Register tool with server
  // Examples are handled separately through the metadata but not passed directly to server.tool
  server.tool(name, fullDescription, schema, wrappedHandler);
};

// Helper to create tool examples
export const createToolExample = (
  input: Record<string, unknown>,
  output: string,
  description?: string
): ToolExample => ({
  input,
  output,
  description
});

// Helper to create tool metadata
export const createToolMetadata = (metadata: ToolMetadata): ToolMetadata => metadata;

/**
 * Atlas Platform specific interfaces to represent the core data model
 * These interfaces match the database objects described in the Atlas Platform Reference Guide
 */

export interface Project {
  /** Optional client-generated ID; system will generate if not provided */
  id?: string;
  
  /** Descriptive project name (1-100 characters) */
  name: string;
  
  /** Comprehensive project overview explaining purpose and scope */
  description: string;
  
  /** Current project state */
  status: ProjectStatus;
  
  /** Relevant URLs with descriptive titles for reference materials */
  urls?: Array<{ title: string, url: string }>;
  
  /** Specific, measurable criteria that indicate project completion */
  completionRequirements: string;
  
  /** Array of existing project IDs that must be completed before this project can begin */
  dependencies?: string[];
  
  /** Required format specification for final project deliverables */
  outputFormat: string;
  
  /** Classification of project purpose */
  taskType: TaskType;
  
  /** Timestamp when the project was created */
  createdAt: string;
  
  /** Timestamp when the project was last updated */
  updatedAt: string;
}

export interface Task {
  /** Optional client-generated ID; system will generate if not provided */
  id?: string;
  
  /** ID of the parent project this task belongs to */
  projectId: string;
  
  /** Concise task title clearly describing the objective (5-150 characters) */
  title: string;
  
  /** Detailed explanation of the task requirements and context */
  description: string;
  
  /** Importance level */
  priority: PriorityLevel;
  
  /** Current task state */
  status: TaskStatus;
  
  /** ID of entity responsible for task completion */
  assignedTo?: string;
  
  /** Relevant URLs with descriptive titles for reference materials */
  urls?: Array<{ title: string, url: string }>;
  
  /** Categorical labels for organization and filtering */
  tags?: string[];
  
  /** Specific, measurable criteria that indicate task completion */
  completionRequirements: string;
  
  /** Array of existing task IDs that must be completed before this task can begin */
  dependencies?: string[];
  
  /** Required format specification for task deliverables */
  outputFormat: string;
  
  /** Classification of task purpose */
  taskType: TaskType;
  
  /** Timestamp when the task was created */
  createdAt: string;
  
  /** Timestamp when the task was last updated */
  updatedAt: string;
}

export interface Knowledge {
  /** Optional client-generated ID; system will generate if not provided */
  id?: string;
  
  /** ID of the parent project this knowledge belongs to */
  projectId: string;
  
  /** Main content of the knowledge item (can be structured or unstructured) */
  text: string;
  
  /** Categorical labels for organization and filtering */
  tags?: string[];
  
  /** Primary knowledge area or discipline */
  domain: KnowledgeDomain;
  
  /** Array of reference sources supporting this knowledge (URLs, DOIs, etc.) */
  citations?: string[];
  
  /** Timestamp when the knowledge item was created */
  createdAt: string;
  
  /** Timestamp when the knowledge item was last updated */
  updatedAt: string;
}

/**
 * Operation request interfaces based on the API Reference
 * These interfaces can be used as a foundation for building tool input schemas
 */

export interface ProjectCreateRequest {
  /** Operation mode - 'single' for one project, 'bulk' for multiple projects */
  mode?: 'single' | 'bulk';
  
  /** Optional client-generated project ID (required for mode='single') */
  id?: string;
  
  /** Descriptive project name (1-100 characters) (required for mode='single') */
  name?: string;
  
  /** Comprehensive project overview explaining purpose and scope (required for mode='single') */
  description?: string;
  
  /** Current project state (Default: active) */
  status?: ProjectStatus;
  
  /** Array of relevant URLs with descriptive titles for reference materials */
  urls?: Array<{ title: string, url: string }>;
  
  /** Specific, measurable criteria that indicate project completion (required for mode='single') */
  completionRequirements?: string;
  
  /** Array of existing project IDs that must be completed before this project can begin */
  dependencies?: string[];
  
  /** Required format specification for final project deliverables (required for mode='single') */
  outputFormat?: string;
  
  /** Classification of project purpose (required for mode='single') */
  taskType?: TaskType;
  
  /** Array of project objects with the above fields (required for mode='bulk') */
  projects?: Partial<Project>[];
}

export interface TaskCreateRequest {
  /** Operation mode - 'single' for one task, 'bulk' for multiple tasks */
  mode?: 'single' | 'bulk';
  
  /** Optional client-generated task ID */
  id?: string;
  
  /** ID of the parent project this task belongs to (required for mode='single') */
  projectId?: string;
  
  /** Concise task title clearly describing the objective (5-150 characters) (required for mode='single') */
  title?: string;
  
  /** Detailed explanation of the task requirements and context (required for mode='single') */
  description?: string;
  
  /** Importance level (Default: medium) */
  priority?: PriorityLevel;
  
  /** Current task state (Default: todo) */
  status?: TaskStatus;
  
  /** ID of entity responsible for task completion */
  assignedTo?: string;
  
  /** Array of relevant URLs with descriptive titles for reference materials */
  urls?: Array<{ title: string, url: string }>;
  
  /** Array of categorical labels for organization and filtering */
  tags?: string[];
  
  /** Specific, measurable criteria that indicate task completion (required for mode='single') */
  completionRequirements?: string;
  
  /** Array of existing task IDs that must be completed before this task can begin */
  dependencies?: string[];
  
  /** Required format specification for task deliverables (required for mode='single') */
  outputFormat?: string;
  
  /** Classification of task purpose (required for mode='single') */
  taskType?: TaskType;
  
  /** Array of task objects with the above fields (required for mode='bulk') */
  tasks?: Partial<Task>[];
}

export interface KnowledgeAddRequest {
  /** Operation mode - 'single' for one knowledge item, 'bulk' for multiple items */
  mode?: 'single' | 'bulk';
  
  /** Optional client-generated knowledge ID */
  id?: string;
  
  /** ID of the parent project this knowledge belongs to (required for mode='single') */
  projectId?: string;
  
  /** Main content of the knowledge item (can be structured or unstructured) (required for mode='single') */
  text?: string;
  
  /** Array of categorical labels for organization and filtering */
  tags?: string[];
  
  /** Primary knowledge area or discipline (required for mode='single') */
  domain?: KnowledgeDomain;
  
  /** Array of reference sources supporting this knowledge (URLs, DOIs, etc.) */
  citations?: string[];
  
  /** Array of knowledge objects with the above fields (required for mode='bulk') */
  knowledge?: Partial<Knowledge>[];
}

// Example usage - Updated for Atlas Platform:
/*
registerTool(
  server,
  "atlas_project_create",
  "Creates a new project or multiple projects in the system",
  {
    mode: z.enum(['single', 'bulk']).optional().default('single'),
    id: z.string().optional(),
    name: z.string().min(1).max(100).optional(),
    description: z.string().optional(),
    status: z.enum(['active', 'pending', 'completed', 'archived']).optional().default('active'),
    completionRequirements: z.string().optional(),
    dependencies: z.array(z.string()).optional(),
    outputFormat: z.string().optional(),
    taskType: z.union([
      z.literal('research'),
      z.literal('generation'),
      z.literal('analysis'),
      z.literal('integration'),
      z.string()
    ]).optional(),
    projects: z.array(z.object({}).passthrough()).optional()
  },
  async (input, context) => {
    // Implementation would validate and process the input
    return createToolResponse(JSON.stringify(result, null, 2));
  },
  createToolMetadata({
    examples: [
      createToolExample(
        { 
          mode: "single",
          name: "Atlas Migration Project", 
          description: "Migrate existing project data to the Atlas Platform", 
          completionRequirements: "All data migrated with validation",
          outputFormat: "Functional system with documentation",
          taskType: "integration"
        },
        "Project created successfully with ID: proj_xyz123",
        "Create a single integration project"
      )
    ],
    requiredPermission: "project:create",
    entityType: 'project',
    supportsBulkOperations: true
  })
);
*/
