import { McpToolResponse, createToolResponse } from "../../../types/mcp.js"; // Import createToolResponse
import { AtlasDeepResearchInput, DeepResearchResult } from "./types.js";

/**
 * Defines a generic interface for formatting data into a string.
 * This was previously imported but is now defined locally as the original seems to be removed.
 */
interface ResponseFormatter<T> {
  format(data: T): string;
}

/**
 * Base response formatter for the `atlas_deep_research` tool.
 * This formatter provides a basic structure for the output, primarily using
 * the data returned by the core `deepResearch` function.
 * It's designed to be used within `formatDeepResearchResponse` which adds
 * contextual information from the original tool input.
 */
export const DeepResearchBaseFormatter: ResponseFormatter<DeepResearchResult> = {
  format: (data: DeepResearchResult): string => {
    // This base format method only uses the 'data' part of the result.
    // Context from the 'input' is added by the calling function below.
    if (!data.success) {
      // Basic error formatting if the operation failed
      return `Error initiating deep research: ${data.message}`;
    }

    // Start building the Markdown output
    const lines: string[] = [
      `## Deep Research Plan Initiated`,
      `**Status:** ${data.message}`, // Display the success message from the core logic
      `**Plan Node ID:** \`${data.planNodeId}\``, // Show the ID of the created root node
    ];

    // Add details about the created sub-topic nodes
    if (data.subTopicNodes && data.subTopicNodes.length > 0) {
      lines.push(
        `\n### Sub-Topics Created (${data.subTopicNodes.length})${
          data.tasksCreated ? ' (with Tasks)' : ''
        }:`
      );
      data.subTopicNodes.forEach((node) => {
        const taskInfo = node.taskId ? `\n  - **Task ID:** \`${node.taskId}\`` : '';
        // Basic info available directly from the result data
        lines.push(
          `- **Question:** ${node.question}\n  - **Node ID:** \`${node.nodeId}\`${taskInfo}`
          // Note: Initial Search Queries are added by the contextual formatter below
        );
      });
    } else {
      lines.push("\nNo sub-topics were specified or created.");
    }

    return lines.join("\n"); // Combine lines into a single Markdown string
  },
};

/**
 * Creates the final formatted `McpToolResponse` for the `atlas_deep_research` tool.
 * This function takes the raw result from the core logic (`deepResearch`) and the
 * original tool input, then uses a *contextual* formatter to generate the final
 * Markdown output. The contextual formatter enhances the base format by including
 * details from the input (like topic, goal, scope, tags, and search queries).
 *
 * @param rawData - The `DeepResearchResult` object returned by the `deepResearch` function.
 * @param input - The original `AtlasDeepResearchInput` provided to the tool.
 * @returns The final `McpToolResponse` object ready to be sent back to the client.
 */
export function formatDeepResearchResponse(
  rawData: DeepResearchResult,
  input: AtlasDeepResearchInput
): McpToolResponse {
  // Define a contextual formatter *inside* this function.
  // This allows the formatter's `format` method to access the `input` variable via closure.
  const contextualFormatter: ResponseFormatter<DeepResearchResult> = {
    format: (data: DeepResearchResult): string => {
      // Handle error case first
      if (!data.success) {
        return `Error initiating deep research: ${data.message}`;
      }

      // Start building the Markdown output, including details from the input
      const lines: string[] = [
        `## Deep Research Plan Initiated`,
        `**Topic:** ${input.researchTopic}`, // Include Topic from input
        `**Goal:** ${input.researchGoal}`,   // Include Goal from input
      ];
      if (input.scopeDefinition) {
        lines.push(`**Scope:** ${input.scopeDefinition}`); // Include Scope if provided
      }
      lines.push(`**Project ID:** \`${input.projectId}\``); // Include Project ID
      if (input.researchDomain) {
        lines.push(`**Domain:** ${input.researchDomain}`); // Include Domain if provided
      }
      lines.push(`**Status:** ${data.message}`); // Status message from result
      lines.push(`**Plan Node ID:** \`${data.planNodeId}\``); // Root node ID from result
      if (input.initialTags && input.initialTags.length > 0) {
        lines.push(`**Initial Tags:** ${input.initialTags.join(', ')}`); // Include initial tags
      }

      // Add details about sub-topic nodes, including search queries from input
      if (data.subTopicNodes && data.subTopicNodes.length > 0) {
        lines.push(`\n### Sub-Topics Created (${data.subTopicNodes.length}):`);
        data.subTopicNodes.forEach((node) => {
          // Find the corresponding sub-topic in the input to retrieve initial search queries
          // Find the corresponding sub-topic in the input to retrieve initial search queries and task details
          const inputSubTopic = input.subTopics.find(
            (st) => st.question === node.question
          );
          const searchQueries =
            inputSubTopic?.initialSearchQueries?.join(', ') || 'N/A'; // Format queries or show N/A
          const taskInfo = node.taskId ? `\n  - **Task ID:** \`${node.taskId}\`` : ''; // Add Task ID if present
          const priorityInfo = inputSubTopic?.priority ? `\n  - **Task Priority:** ${inputSubTopic.priority}` : '';
          const assigneeInfo = inputSubTopic?.assignedTo ? `\n  - **Task Assignee:** ${inputSubTopic.assignedTo}` : '';
          const statusInfo = inputSubTopic?.initialStatus ? `\n  - **Task Status:** ${inputSubTopic.initialStatus}` : '';


          lines.push(
            `- **Question:** ${node.question}\n  - **Node ID:** \`${node.nodeId}\`${taskInfo}${priorityInfo}${assigneeInfo}${statusInfo}\n  - **Initial Search Queries:** ${searchQueries}` // Add search queries and task details
          );
        });
      } else {
        lines.push('\nNo sub-topics were specified or created.');
      }

      return lines.join("\n"); // Combine all lines into the final Markdown string
    }
  };

  const formattedText = contextualFormatter.format(rawData);
  return createToolResponse(formattedText, !rawData.success);
}
