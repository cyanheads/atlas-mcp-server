import { nanoid } from 'nanoid';
import { KnowledgeService } from '../../../services/neo4j/knowledgeService.js';
import { ProjectService } from '../../../services/neo4j/projectService.js';
import { TaskService } from '../../../services/neo4j/taskService.js'; // Import TaskService
import { BaseErrorCode, McpError } from '../../../types/errors.js';
import { logger } from '../../../utils/internal/logger.js';
import { sanitization } from '../../../utils/security/sanitization.js';
import {
  AtlasDeepResearchInput,
  DeepResearchResult,
  DeepResearchSubTopicNodeResult,
} from './types.js';

/**
 * Generates a unique ID suitable for knowledge nodes using nanoid.
 * Includes a prefix for better identification (e.g., 'plan', 'sub').
 *
 * @param prefix - The prefix to use for the ID (defaults to 'knw').
 * @returns A unique ID string (e.g., 'plan_aBcDeFgHiJkL').
 */
function generateKnowledgeId(prefix: string = "knw"): string {
  return `${prefix}_${nanoid(12)}`; // Using 12 characters for increased uniqueness
}

/**
 * Core implementation logic for the `atlas_deep_research` tool.
 * This function orchestrates the creation of a hierarchical knowledge structure
 * in Neo4j to represent a research plan based on the provided input.
 * It creates a root node for the overall plan and child nodes for each sub-topic.
 *
 * @param input - The validated input object conforming to `AtlasDeepResearchInput`.
 * @returns A promise resolving to a `DeepResearchResult` object containing details
 *          about the created nodes/tasks and the operation's success status.
 * @throws {McpError} If the project ID is invalid, or if any database operation fails.
 */
export async function deepResearch(
  input: AtlasDeepResearchInput
): Promise<DeepResearchResult> {
  logger.info(
    `Initiating deep research plan creation for project ID: ${input.projectId}, Topic: "${input.researchTopic}"`
  );

  try {
    // 1. Validate Project Existence
    // Ensure the specified project exists before proceeding.
    const project = await ProjectService.getProjectById(input.projectId);
    if (!project) {
      throw new McpError(
        BaseErrorCode.NOT_FOUND,
        `Project with ID "${input.projectId}" not found. Cannot create research plan.`
      );
    }
    logger.debug(`Project validation successful for ID: ${input.projectId}`);

    // 2. Prepare Root Research Plan Node Data
    const planNodeId = input.planNodeId || generateKnowledgeId('plan');
    const rootTextParts: string[] = [
      `Research Plan: ${sanitization.sanitizeString(input.researchTopic)}`,
      `Goal: ${sanitization.sanitizeString(input.researchGoal)}`,
    ];
    if (input.scopeDefinition) {
      rootTextParts.push(
        `Scope: ${sanitization.sanitizeString(input.scopeDefinition)}`
      );
    }
    const rootText = rootTextParts.join('\n\n'); // Combine parts into the main text content

    // Define tags for the root node
    const rootTags = [
      'research-plan',
      'research-root',
      'status:active', // Initialize the plan as active
      `topic:${sanitization
        .sanitizeString(input.researchTopic)
        .toLowerCase()
        .replace(/\s+/g, '-') // Convert topic to a URL-friendly tag format
        .slice(0, 50)}`, // Limit tag length
      ...(input.initialTags || []), // Include any user-provided initial tags
    ];

    // 3. Create Root Research Plan Node and link to Project
    // Assuming KnowledgeService.addKnowledge handles linking if projectId is provided,
    // or we might need a specific method like addKnowledgeAndLinkToProject.
    // For now, assume addKnowledge creates the node and links it via projectId.
    // A more robust approach might involve explicit relationship creation.
    logger.debug(`Attempting to create root research plan node with ID: ${planNodeId}`);
    await KnowledgeService.addKnowledge({
      id: planNodeId,
      projectId: input.projectId,
      text: rootText,
      domain: input.researchDomain || 'research',
      tags: rootTags,
      citations: [],
    });
    // If explicit linking is needed:
    // await KnowledgeService.linkKnowledgeToProject(planNodeId, input.projectId, 'CONTAINS_PLAN');
    logger.info(`Root research plan node ${planNodeId} created and associated with project.`);

    // 4. Create Knowledge Nodes and Optional Tasks for Each Sub-Topic
    const createdSubTopicNodes: DeepResearchSubTopicNodeResult[] = [];
    const tasksToCreate = input.createTasks ?? true; // Default to true if not specified
    logger.debug(
      `Processing ${input.subTopics.length} sub-topics to create knowledge nodes ${
        tasksToCreate ? 'and tasks' : ''
      }.`
    );

    for (const subTopic of input.subTopics) {
      const subTopicNodeId = subTopic.nodeId || generateKnowledgeId('sub');
      let createdTaskId: string | undefined = undefined;

      // Sanitize search queries before joining
      const searchQueriesString = (subTopic.initialSearchQueries || [])
        .map((kw) => sanitization.sanitizeString(kw))
        .join(', ');
      // Construct the text content for the sub-topic node
      const subTopicText = `Research Question: ${sanitization.sanitizeString(
        subTopic.question
      )}\n\nInitial Search Queries: ${searchQueriesString || 'None provided'}`;

      // Define tags for the sub-topic node
      const subTopicTags = [
        'research-subtopic',
        'status:pending', // Initialize sub-topics as pending
        // `parent-plan:${planNodeId}`, // Replaced by relationship if implemented
        ...(subTopic.initialSearchQueries?.map(
          (kw: string) =>
            `search-query:${sanitization
              .sanitizeString(kw) // Create tags for each search query
              .toLowerCase()
              .replace(/\s+/g, '-')
              .slice(0, 50)}`
        ) || []),
      ];

      logger.debug(
        `Attempting to create sub-topic node with ID: ${subTopicNodeId} for question: "${subTopic.question}"`
      );
      // Create the sub-topic knowledge node and link it to the parent plan node
      // Assuming addKnowledge links to project, now link to parent knowledge node
      await KnowledgeService.addKnowledge({
        id: subTopicNodeId,
        projectId: input.projectId, // Associate with the same project
        text: subTopicText,
        domain: input.researchDomain || 'research', // Inherit domain from the root plan
        tags: subTopicTags,
        citations: [], // Sub-topics also start with no citations
      });
      // Explicitly link sub-topic to parent plan node
      await KnowledgeService.linkKnowledgeToKnowledge(
          subTopicNodeId,
          planNodeId,
          'IS_SUBTOPIC_OF' // Relationship type from child to parent
      );
      logger.info(`Sub-topic node ${subTopicNodeId} created and linked to plan ${planNodeId}.`);

      // Create Task if requested
      if (tasksToCreate) {
        logger.debug(`Creating task for sub-topic node ${subTopicNodeId}`);
        const taskTitle = `Research: ${sanitization.sanitizeString(
          subTopic.question
        )}`;
        const taskDescription = `Investigate the research question: "${sanitization.sanitizeString(
          subTopic.question
        )}"\n\nInitial Search Queries: ${
          searchQueriesString || 'None provided'
        }\n\nAssociated Knowledge Node: ${subTopicNodeId}`;

        // Use TaskService to create the task and link it to the project
        const taskResult = await TaskService.createTask({
          projectId: input.projectId,
          title: taskTitle.slice(0, 150), // Ensure title length constraint
          description: taskDescription,
          priority: subTopic.priority || 'medium',
          status: subTopic.initialStatus || 'todo',
          assignedTo: subTopic.assignedTo,
          completionRequirements: `Gather relevant information and synthesize findings related to the research question. Update associated knowledge node ${subTopicNodeId}.`,
          outputFormat: 'Update to knowledge node, potentially new linked knowledge items.',
          taskType: 'research', // Specific task type
          // tags: [`research-task`, `plan:${planNodeId}`], // Optional tags for the task
        });

        createdTaskId = taskResult.id;
        logger.info(
          `Task ${createdTaskId} created for sub-topic ${subTopicNodeId}.`
        );

        // Link Task to the Sub-Topic Knowledge Node
        await TaskService.linkTaskToKnowledge(
          createdTaskId,
          subTopicNodeId,
          'ADDRESSES' // Relationship: Task ADDRESSES Knowledge Node
        );
        logger.debug(
          `Linked task ${createdTaskId} to knowledge node ${subTopicNodeId} with ADDRESSES relationship.`
        );
      }

      // Record the details of the created sub-topic node and task
      createdSubTopicNodes.push({
        question: subTopic.question,
        nodeId: subTopicNodeId,
        taskId: createdTaskId, // Include task ID if created
        initialSearchQueries: subTopic.initialSearchQueries || [],
      });
    }

    // 5. Assemble and Return the Result
    const taskMessage = tasksToCreate
      ? `and ${createdSubTopicNodes.length} associated tasks`
      : '';
    const successMessage = `Successfully created deep research plan "${input.researchTopic}" with root research plan node ${planNodeId}, ${createdSubTopicNodes.length} sub-topic nodes ${taskMessage}.`;
    logger.info(successMessage);

    return {
      success: true,
      message: successMessage,
      planNodeId: planNodeId,
      initialTags: input.initialTags || [], // Return the initial tags applied to the root
      subTopicNodes: createdSubTopicNodes, // Return details of created sub-topic nodes and tasks
      tasksCreated: tasksToCreate, // Indicate if tasks were created
    };

  } catch (error) {
    // Log the error with context
    logger.error("Error occurred during deep research plan creation", {
      errorMessage: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      projectId: input.projectId,
      researchTopic: input.researchTopic,
    });

    // Re-throw McpError instances directly
    if (error instanceof McpError) {
      throw error;
    }
    // Wrap unexpected errors in a generic McpError
    throw new McpError(
      BaseErrorCode.INTERNAL_ERROR,
      `Failed to create deep research plan (Project: ${input.projectId}, Topic: "${input.researchTopic}"): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
