import { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { encoding_for_model, Tiktoken, TiktokenModel } from 'tiktoken';
import { BaseErrorCode, McpError } from '../../types/errors.js';
// Import utils from the main barrel file (ErrorHandler, logger, RequestContext from ../internal/*)
import { ErrorHandler, logger, RequestContext } from '../index.js';

// Define the model used specifically for token counting
const TOKENIZATION_MODEL: TiktokenModel = 'gpt-4o'; // Note this is strictly for token counting, not the model used for inference

/**
 * Calculates the number of tokens for a given text using the 'gpt-4o' tokenizer.
 * Uses ErrorHandler for consistent error management.
 *
 * @param text - The input text to tokenize.
 * @param context - Optional request context for logging and error handling.
 * @returns The number of tokens.
 * @throws {McpError} Throws an McpError if tokenization fails.
 */
export async function countTokens(
  text: string,
  context?: RequestContext
): Promise<number> {
  // Wrap the synchronous operation in tryCatch which handles both sync/async
  return ErrorHandler.tryCatch(
    () => {
      let encoding: Tiktoken | null = null;
      try {
        // Always use the defined TOKENIZATION_MODEL
        encoding = encoding_for_model(TOKENIZATION_MODEL);
        const tokens = encoding.encode(text);
        return tokens.length;
      } finally {
        encoding?.free(); // Ensure the encoder is freed if it was successfully created
      }
    },
    {
      operation: 'countTokens',
      context: context,
      input: { textSample: text.substring(0, 50) + '...' }, // Log sanitized input
      errorCode: BaseErrorCode.INTERNAL_ERROR, // Use INTERNAL_ERROR for external lib issues
      // Removed onErrorReturn as we now rethrow
    }
  );
}

/**
 * Calculates the number of tokens for chat messages using the ChatCompletionMessageParam structure
 * and the 'gpt-4o' tokenizer, considering special tokens and message overhead.
 * This implementation is based on OpenAI's guidelines for gpt-4/gpt-3.5-turbo models.
 * Uses ErrorHandler for consistent error management.
 *
 * See: https://github.com/openai/openai-cookbook/blob/main/examples/How_to_count_tokens_with_tiktoken.ipynb
 *
 * @param messages - An array of chat messages in the `ChatCompletionMessageParam` format.
 * @param context - Optional request context for logging and error handling.
 * @returns The estimated number of tokens.
 * @throws {McpError} Throws an McpError if tokenization fails.
 */
export async function countChatTokens(
  messages: ReadonlyArray<ChatCompletionMessageParam>, // Use the complex type
  context?: RequestContext
): Promise<number> {
  // Wrap the synchronous operation in tryCatch
  return ErrorHandler.tryCatch(
    () => {
      let encoding: Tiktoken | null = null;
      let num_tokens = 0;
      try {
        // Always use the defined TOKENIZATION_MODEL
        encoding = encoding_for_model(TOKENIZATION_MODEL);

        // Define tokens per message/name based on gpt-4o (same as gpt-4/gpt-3.5-turbo)
        const tokens_per_message = 3;
        const tokens_per_name = 1;

        for (const message of messages) {
          num_tokens += tokens_per_message;
          // Encode role
          num_tokens += encoding.encode(message.role).length;

          // Encode content - handle potential null or array content (vision)
          if (typeof message.content === 'string') {
            num_tokens += encoding.encode(message.content).length;
          } else if (Array.isArray(message.content)) {
            // Handle multi-part content (e.g., text + image) - simplified: encode text parts only
            for (const part of message.content) {
              if (part.type === 'text') {
                num_tokens += encoding.encode(part.text).length;
               } else {
                // Add placeholder token count for non-text parts (e.g., images) if needed
                // This requires specific model knowledge (e.g., OpenAI vision model token costs)
                logger.warning(`Non-text content part found (type: ${part.type}), token count contribution ignored.`, context);
                // num_tokens += IMAGE_TOKEN_COST; // Placeholder
              }
            }
          } // else: content is null, add 0 tokens

          // Encode name if present (often associated with 'tool' or 'function' roles in newer models)
          if ('name' in message && message.name) {
            num_tokens += tokens_per_name;
            num_tokens += encoding.encode(message.name).length;
          }

          // --- Handle tool calls (specific to newer models) ---
          // Assistant message requesting tool calls
          if (message.role === 'assistant' && 'tool_calls' in message && message.tool_calls) {
             for(const tool_call of message.tool_calls) {
                // Add tokens for the function name and arguments
                if (tool_call.function.name) {
                    num_tokens += encoding.encode(tool_call.function.name).length;
                }
                if (tool_call.function.arguments) {
                    // Arguments are often JSON strings
                    num_tokens += encoding.encode(tool_call.function.arguments).length;
                }
             }
           }

          // Tool message providing results
          if (message.role === 'tool' && 'tool_call_id' in message && message.tool_call_id) {
             num_tokens += encoding.encode(message.tool_call_id).length;
             // Content of the tool message (the result) is already handled by the string content check above
          }
        }
        num_tokens += 3; // every reply is primed with <|start|>assistant<|message|>
        return num_tokens;
      } finally {
        encoding?.free();
      }
    },
    {
      operation: 'countChatTokens',
      context: context,
      input: { messageCount: messages.length }, // Log sanitized input
      errorCode: BaseErrorCode.INTERNAL_ERROR, // Use INTERNAL_ERROR
      // Removed onErrorReturn
    }
  );
}
