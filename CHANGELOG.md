# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.8.0] - 2025-05-11

### Added
- **HTTP Transport Support**: Implemented an alternative HTTP transport layer for the MCP server, allowing connections over HTTP in addition to the existing stdio transport. This includes basic authentication middleware.
- **Enhanced Configuration System**: Integrated Zod for environment variable validation, providing type safety and clear error reporting for server configuration. Extended configuration options for server identity, logging, transport, HTTP settings, authentication, and rate limiting.
- **New Utility Modules**: Introduced new utility modules for:
    - `metrics`: Includes a `tokenCounter`.
    - `parsing`: Includes `dateParser` and `jsonParser`.
    - `security`: Includes `rateLimiter` and `sanitization` utilities.
- **Request Context Service**: Added a service for creating and managing request contexts, improving traceability and logging across operations.
- **Dependency Updates**:
    - Added `chrono-node` for advanced date parsing.
    - Added `openai`, `partial-json`, `sanitize-html`, `tiktoken` to support future AI and text processing capabilities.
    - Added `validator` for input validation.

### Changed
- **Project Version**: Bumped version from 2.7.3 to 2.8.0.
- **Dependency Updates**:
    - Updated `@modelcontextprotocol/sdk` to `^1.11.1`.
    - Updated `@types/node` to `^22.15.17`.
    - Updated `node-cron` to `^4.0.3`.
- **Server Core Refactor**: Significantly refactored the main server startup (`src/index.ts`) and MCP server logic (`src/mcp/server.ts`) for better modularity, improved error handling, and to support multiple transport types.
- **Utilities Refactor**: Reorganized the `src/utils` directory into a more modular structure with subdirectories for `internal`, `metrics`, `parsing`, and `security`. Legacy top-level utility files were removed or relocated.
- **Configuration Loading**: Improved project root detection and backup directory handling with enhanced security checks.
- **`atlas_deep_research` Tool**: (Moved from Unreleased) Introduced a new MCP tool (`atlas_deep_research`) designed to initiate and structure deep research processes within the Atlas knowledge base. This tool allows users to define a primary research topic, goal, and scope, and break it down into manageable sub-topics with initial search queries. It creates a hierarchical knowledge graph in Neo4j, consisting of a root 'research-plan' node and child 'research-subtopic' nodes, facilitating organized research efforts. The tool supports client-provided IDs, domain categorization, initial tagging, and flexible response formatting (formatted string or raw JSON). Core logic resides in `src/mcp/tools/atlas_deep_research/deepResearch.ts`, with input validation using Zod schemas in `types.ts` and response formatting handled in `responseFormat.ts`. An example demonstrating its usage and output can be found in the [`examples/deep-research-example/`](./examples/deep-research-example/) directory.

## [Unreleased]

### Added

### Changed

### Fixed

### Removed

### Security
