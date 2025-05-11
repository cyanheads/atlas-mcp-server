import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BaseErrorCode, McpError } from "../../../types/errors.js";
import { McpToolResponse, ResponseFormat } from "../../../types/mcp.js";
import { createToolExample, createToolMetadata, registerTool, ToolContext } from "../../../types/tool.js";
import { logger } from "../../../utils/internal/logger.js";
// ToolContext is now imported from ../../../types/tool.js
import { deepResearch } from "./deepResearch.js";
import { formatDeepResearchResponse } from "./responseFormat.js";
import {
  AtlasDeepResearchInput,
  AtlasDeepResearchInputSchema,
  AtlasDeepResearchOutputSchema,
  AtlasDeepResearchSchemaShape,
} from "./types.js";

/**
 * Main handler function for the `atlas_deep_research` MCP tool.
 * This function orchestrates the tool's execution:
 * 1. Validates the incoming parameters against the `AtlasDeepResearchInputSchema`.
 * 2. Calls the core `deepResearch` function to perform the business logic.
 * 3. Formats the result into the appropriate `McpToolResponse` based on the requested `responseFormat`.
 * 4. Handles errors gracefully, logging them and returning appropriate `McpError` responses.
 *
 * @param params - The raw, unvalidated input parameters received from the MCP client.
 * @param context - Optional context object containing request-specific information (e.g., request ID).
 * @returns A promise resolving to an `McpToolResponse` object.
 * @throws {McpError} If input validation fails or an unhandled error occurs during execution.
 */
async function handler(
  params: unknown,
  context?: ToolContext
): Promise<McpToolResponse> {
  const requestId = context?.requestContext?.requestId;
  logger.debug("Received atlas_deep_research request", { params, requestId });

  // 1. Validate Input
  const validationResult = AtlasDeepResearchInputSchema.safeParse(params);
  if (!validationResult.success) {
    logger.error("Invalid input for atlas_deep_research", {
      errors: validationResult.error.errors,
      requestId,
    });
    throw new McpError(
      BaseErrorCode.VALIDATION_ERROR,
      "Invalid input parameters for atlas_deep_research",
      validationResult.error.format() // Provides detailed validation errors
    );
  }
  const input: AtlasDeepResearchInput = validationResult.data;

  // Optional: Implement permission checks here if necessary
  // e.g., checkPermission(context, 'knowledge:create');

  try {
    // 2. Call Core Logic
    logger.info(`Calling deepResearch core logic for request ID: ${requestId}`);
    const result = await deepResearch(input);

    // 3. Format Response
    logger.debug(`Formatting atlas_deep_research response for request ID: ${requestId}`);
    if (input.responseFormat === ResponseFormat.JSON) {
      // Return raw JSON output if requested
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: !result.success, // Reflect the success status in the MCP response
      };
    } else {
      // Use the dedicated formatter for 'formatted' output
      return formatDeepResearchResponse(result, input);
    }
  } catch (error) {
    logger.error("Error executing atlas_deep_research", {
      errorMessage: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      requestId,
    });
    // Re-throw errors that are already McpError instances
    if (error instanceof McpError) {
      throw error;
    }
    // Wrap unexpected errors in a standard internal error response, including requestId if available
    const errorMessage = `Atlas deep research tool execution failed (Request ID: ${requestId ?? 'N/A'}): ${
      error instanceof Error ? error.message : String(error)
    }`;
    throw new McpError(
      BaseErrorCode.INTERNAL_ERROR,
      errorMessage
    );
  }
}

// Define Tool Examples
const examples = [
  createToolExample( // Example 1: Structured technical research with comprehensive subtasks
    {
      projectId: "proj_123abc",
      researchTopic: "Quantum-Resistant Encryption Algorithms",
      researchGoal:
        'Systematically identify and critically evaluate leading PQC algorithms, analyzing their technical strengths/limitations and projected adoption timelines.',
      scopeDefinition:
        'Focus on NIST PQC finalists and standardized algorithms with practical implementation potential. Exclude purely theoretical approaches without near-term implementation viability.',
      subTopics: [
        {
          question:
            'What are the fundamental taxonomic categories of post-quantum cryptography (PQC) and their underlying mathematical foundations?',
          initialSearchQueries: [
            'PQC taxonomic classification',
            'lattice-based cryptography NIST',
            'hash-based signature schemes',
            'code-based encryption methods',
            'multivariate cryptographic systems',
          ],
          nodeId: 'client_sub_001', // Example client-provided ID
          priority: 'high', // Strategic priority assignment
          initialStatus: 'todo',
        },
        {
          question: 'Which specific algorithms have achieved NIST PQC standardization status or finalist positions?',
          initialSearchQueries: [
            'NIST PQC Round 3 finalists',
            'CRYSTALS-Kyber specification',
            'CRYSTALS-Dilithium implementation',
            'Falcon signature scheme',
            'SPHINCS+ hash-based signatures',
          ],
          assignedTo: 'user_alice', // Clear accountability assignment
        },
        {
          question:
            'What are the quantifiable performance characteristics and resource requirements (computational overhead, key/signature sizes) for leading PQC algorithms?',
          initialSearchQueries: [
            'PQC comparative performance metrics',
            'Kyber key size benchmarks',
            'Dilithium signature size optimization',
          ],
          priority: 'medium',
        },
        {
          question:
            'What practical implementation challenges and realistic adoption timelines exist for PQC deployment across critical infrastructure?',
          initialSearchQueries: [
            'PQC integration challenges enterprise systems',
            'quantum-resistant migration strategy financial sector',
            'realistic quantum threat timeline infrastructure',
          ],
        },
      ],
      researchDomain: 'technical',
      initialTags: ['#cryptography', '#pqc', '#cybersecurity'],
      planNodeId: 'client_plan_001', // Example client-provided ID
      createTasks: true, // Enable operational workflow integration
      responseFormat: 'formatted',
    },
    // Expected formatted output (conceptual, actual output depends on formatter)
    `## Structured Deep Research Plan Initiated\n**Topic:** Quantum-Resistant Encryption Algorithms\n**Goal:** Systematically identify and critically evaluate leading PQC algorithms...\n**Plan Node ID:** plan_...\n**Sub-Topics Created:** 4 (with Operational Tasks)\n- **Question:** What are the fundamental taxonomic categories...?\n  - **Knowledge Node ID:** \`sub_...\`\n  - **Task ID:** \`task_...\`\n  - **Strategic Priority:** high\n  - **Workflow Status:** todo\n  - **Precision Search Queries:** ...\n... (additional focused sub-topics)`,
    'Initiate a comprehensive technical deep research plan on post-quantum cryptography, creating structured knowledge nodes with corresponding prioritized workflow tasks and precise search queries for systematic investigation.'
  ),
  createToolExample( // Example 2: Strategic market analysis with focused inquiries
    {
      projectId: 'proj_456def',
      researchTopic: "Strategic Market Analysis for AI-Powered Code Review Tools",
      researchGoal: 'Identify key market participants, quantify addressable market size, and identify emerging technology and adoption trends.',
      subTopics: [
        { 
          question: 'Who are the established and emerging competitors within the AI code review space?',
          initialSearchQueries: [
            'leading AI code review platforms',
            'GitHub Copilot market position',
            'emerging static analysis AI tools'
          ] 
        },
        { 
          question: 'What is the current market valuation and projected compound annual growth rate (CAGR) for developer tools with AI integration?',
          initialSearchQueries: [
            'developer tools market size analysis 2025',
            'AI code review CAGR forecast',
            'static analysis tools market growth'
          ]
        },
        { 
          question: 'What differentiated pricing models and monetization strategies are proving most effective in this market segment?',
          initialSearchQueries: [
            'AI code review pricing models comparison',
            'developer tools subscription economics',
            'open-core vs SaaS code analysis tools'
          ]
        },
      ],
      createTasks: false, // Focus on knowledge capture without operational workflow items
      responseFormat: 'json', // Request machine-processable structured output
    },
    // Expected JSON output (structure matches AtlasDeepResearchOutput)
    `{
      "success": true,
      "message": "Successfully created comprehensive research plan \\"Strategic Market Analysis for AI-Powered Code Review Tools\\" with primary knowledge node plan_... and 3 specialized sub-topic nodes.",
      "planNodeId": "plan_...",
      "initialTags": [],
      "subTopicNodes": [
        { 
          "question": "Who are the established and emerging competitors within the AI code review space?", 
          "nodeId": "sub_...", 
          "initialSearchQueries": ["leading AI code review platforms", "GitHub Copilot market position", "emerging static analysis AI tools"]
        },
        { 
          "question": "What is the current market valuation and projected compound annual growth rate (CAGR) for developer tools with AI integration?", 
          "nodeId": "sub_...", 
          "initialSearchQueries": ["developer tools market size analysis 2025", "AI code review CAGR forecast", "static analysis tools market growth"]
        },
        { 
          "question": "What differentiated pricing models and monetization strategies are proving most effective in this market segment?", 
          "nodeId": "sub_...", 
          "initialSearchQueries": ["AI code review pricing models comparison", "developer tools subscription economics", "open-core vs SaaS code analysis tools"]
        }
      ],
      "tasksCreated": false
    }`,
    'Conduct targeted market intelligence gathering on AI code review tools ecosystem, focusing on competitive landscape analysis, market sizing, and business model evaluation, with precise search parameters for each inquiry area.'
  )
];

/**
 * Registers the `atlas_deep_research` tool, including its metadata, schema,
 * handler function, and examples, with the provided MCP server instance.
 *
 * @param server - The `McpServer` instance to register the tool with.
 */
export function registerAtlasDeepResearchTool(server: McpServer): void {
  registerTool(
    server,
    'atlas_deep_research', // Tool name
    'Initiates a strategically structured deep research process by creating a hierarchical knowledge plan within the Atlas system, optionally generating linked operational tasks for systematic investigation. Facilitates methodical research workflows by emphasizing initial collection of high-specificity factual details (proper nouns, specific terminology, precise identifiers) relevant to the inquiry domain, followed by targeted recursive investigation to build comprehensive knowledge graphs. This tool operationalizes research by decomposing complex topics into discrete, manageable components with clear investigative parameters, optimizing for both depth and efficiency in knowledge acquisition. Use it to orchestrate comprehensive research initiatives, construct semantic knowledge networks with well-defined relationships, and ensure continuous knowledge base enrichment with high-precision, factually-verified information.', // Enhanced tool description
    AtlasDeepResearchSchemaShape, // Input schema shape (used to generate full schema)
    handler, // The handler function defined above
    createToolMetadata({
      examples: examples, // Tool usage examples
      // Required permissions might need adjustment if task creation is always enabled or based on input
      requiredPermission: 'knowledge:create task:create', // Combined into single string
      returnSchema: AtlasDeepResearchOutputSchema, // Schema for the structured output
      // Optional: Define rate limits if needed
      // rateLimit: { windowMs: 60 * 1000, maxRequests: 10 }
    })
  );
  logger.info("Registered atlas_deep_research tool.");
}
