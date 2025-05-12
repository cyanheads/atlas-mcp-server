# ATLAS: Task Management System

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8.3-blue.svg)](https://www.typescriptlang.org/)
[![Model Context Protocol](https://img.shields.io/badge/MCP-1.11.1-green.svg)](https://modelcontextprotocol.io/)
[![Version](https://img.shields.io/badge/Version-2.8.0-blue.svg)](https://github.com/cyanheads/atlas-mcp-server/releases)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Status](https://img.shields.io/badge/Status-Stable-green.svg)]()
[![GitHub](https://img.shields.io/github/stars/cyanheads/atlas-mcp-server?style=social)](https://github.com/cyanheads/atlas-mcp-server)

ATLAS (Adaptive Task & Logic Automation System) is a project, knowledge, and task management system for LLM Agents.

Built on a three-tier architecture:

```
                  +------------------------------------------+
                  |                PROJECT                   |
                  |------------------------------------------|
                  | id: string                               |
                  | name: string                             |
                  | description: string                      |
                  | status: string                           |
                  | urls?: Array<{title: string, url: string}>|
                  | completionRequirements: string           |
                  | outputFormat: string                     |
                  | taskType: string                         |
                  | createdAt: string                        |
                  | updatedAt: string                        |
                  +----------------+-------------------------+
                            |                    |
                            |                    |
                            v                    v
+----------------------------------+ +----------------------------------+
|               TASK               | |            KNOWLEDGE             |
|----------------------------------| |----------------------------------|
| id: string                       | | id: string                       |
| projectId: string                | | projectId: string                |
| title: string                    | | text: string                     |
| description: string              | | tags?: string[]                  |
| priority: string                 | | domain: string                   |
| status: string                   | | citations?: string[]             |
| assignedTo?: string              | | createdAt: string                |
| urls?: Array<{title: string,     | |                                  |
|   url: string}>                  | | updatedAt: string                |
| tags?: string[]                  | |                                  |
| completionRequirements: string   | |                                  |
| outputFormat: string             | |                                  |
| taskType: string                 | |                                  |
| createdAt: string                | |                                  |
| updatedAt: string                | |                                  |
+----------------------------------+ +----------------------------------+
```

Implemented as a Model Context Protocol (MCP) server, ATLAS allows LLM agents to interact with project management database, enabling managing projects, tasks, and knowledge items.

> **Important Version Note**: [Version 1.5.4](https://github.com/cyanheads/atlas-mcp-server/releases/tag/v1.5.4) is the last version that uses SQLite as the database. Version 2.0 and onwards has been completely rewritten to use Neo4j, which requires either:
>
> - Self-hosting using Docker (docker-compose included in repository)
> - Using Neo4j AuraDB cloud service: https://neo4j.com/product/auradb/
>
> Version 2.5.0 introduces a new 3-node system (Projects, Tasks, Knowledge) that replaces the previous structure.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Installation](#installation)
- [Running the Server](#running-the-server)
- [Configuration](#configuration)
- [Project Structure](#project-structure)
- [Tools](#tools)
- [Resources](#resources)
- [Database Backup and Restore](#database-backup-and-restore)
- [Examples](#examples)
- [Contributing](#contributing)
- [License](#license)

## Overview

ATLAS implements the Model Context Protocol (MCP), enabling standardized communication between LLMs and external systems through:

- **Clients**: Claude Desktop, IDEs, and other MCP-compatible clients
- **Servers**: Tools and resources for project, task, and knowledge management
- **LLM Agents**: AI models that leverage the server's management capabilities

### System Integration

The Atlas Platform integrates these components into a cohesive system:

- **Project-Task Relationship**: Projects contain tasks that represent actionable steps needed to achieve project goals. Tasks inherit context from their parent project while providing granular tracking of individual work items.
- **Knowledge Integration**: Both projects and tasks can be enriched with knowledge items, providing team members with necessary information and context.
- **Dependency Management**: Both projects and tasks support dependency relationships, allowing for complex workflows with prerequisites and sequential execution requirements.
- **Unified Search**: The platform provides cross-entity search capabilities, allowing users to find relevant projects, tasks, or knowledge based on various criteria.

## Features

### Project Management

- **Comprehensive Tracking:** Manage project metadata, statuses, and rich content (notes, links, etc.) with built-in support for bulk operations.
- **Dependency & Relationship Handling:** Automatically validate and track inter-project dependencies.

### Task Management

- **Task Lifecycle Management:** Create, track, and update tasks through their entire lifecycle.
- **Prioritization & Categorization:** Assign priority levels and categorize tasks with tags for better organization.
- **Dependency Tracking:** Establish task dependencies to create structured workflows.

### Knowledge Management

- **Structured Knowledge Repository:** Maintain a searchable repository of project-related information.
- **Domain Categorization:** Organize knowledge by domain and tags for easy retrieval.
- **Citation Support:** Track sources and references for knowledge items.

### Graph Database Integration

- **Native Relationship Management:** Leverage Neo4j's ACID-compliant transactions and optimized queries for robust data integrity.
- **Advanced Search & Scalability:** Perform property-based searches with fuzzy matching and wildcards while maintaining high performance.

### Unified Search

- **Cross-Entity Search:** Find relevant projects, tasks, or knowledge based on content, metadata, or relationships.
- **Flexible Query Options:** Support for case-insensitive, fuzzy, and advanced filtering options.

## Installation

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/cyanheads/atlas-mcp-server.git
    cd atlas-mcp-server
    ```

2.  **Install dependencies:**

    ```bash
    npm install
    ```

3.  **Configure Neo4j:**
    Ensure you have a Neo4j instance running and accessible. You can start one using the provided Docker configuration:

    ```bash
    docker-compose up -d
    ```

    Update your `.env` file with the Neo4j connection details.

4.  **Build the project:**
    ```bash
    npm run build
    ```

## Running the Server

Most MCP Clients run the server automatically, but you can also run it manually for testing or development purposes using the following commands.

ATLAS MCP Server supports multiple transport mechanisms for communication:

- **Standard I/O (stdio):** This is the default mode and is typically used for direct integration with local MCP clients (like IDE extensions).

  ```bash
  npm run start:stdio
  ```

  This uses the `MCP_TRANSPORT_TYPE=stdio` setting.

- **Streamable HTTP:** This mode allows the server to listen for MCP requests over HTTP, suitable for remote clients or web-based integrations.
  ```bash
  npm run start:http
  ```
  This uses the `MCP_TRANSPORT_TYPE=http` setting. The server will listen on the host and port defined in your `.env` file (e.g., `MCP_HTTP_HOST` and `MCP_HTTP_PORT`, defaulting to `127.0.0.1:3010`). Ensure your firewall allows connections if accessing remotely.

## Configuration

### Environment Variables

Environment variables should be set in the client config in your MCP Client.

```bash
# Neo4j Configuration
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=password2

# Application Configuration
LOG_LEVEL=info # Log level for the server (corresponds to MCP_LOG_LEVEL). Options: emerg, alert, crit, error, warning, notice, info, debug.
NODE_ENV=development # 'development' or 'production'.

# MCP Transport Configuration
MCP_TRANSPORT_TYPE=stdio # 'stdio' or 'http'. Default: stdio.
MCP_HTTP_HOST=127.0.0.1 # Host for HTTP transport. Default: 127.0.0.1.
MCP_HTTP_PORT=3010 # Port for HTTP transport. Default: 3010.
# MCP_ALLOWED_ORIGINS=http://localhost:someport,https://your-client.com # Optional: Comma-separated list of allowed origins for HTTP CORS.

# MCP Security Configuration
# MCP_AUTH_SECRET_KEY=your_very_long_and_secure_secret_key_min_32_chars # Optional: Secret key for JWT authentication if HTTP transport is used.
MCP_RATE_LIMIT_WINDOW_MS=60000 # Rate limit window in milliseconds. Default: 60000 (1 minute).
MCP_RATE_LIMIT_MAX_REQUESTS=100 # Max requests per window per IP for HTTP transport. Default: 100.

# Database Backup Configuration
BACKUP_MAX_COUNT=10 # Maximum number of backup sets to keep. Default: 10.
BACKUP_FILE_DIR=./backups # Directory where backup files will be stored (relative to project root). Default: ./backups.
```

Refer to `src/config/index.ts` for all available environment variables and their default values.

### MCP Client Settings

How you configure your MCP client depends on the client itself and the chosen transport type.

**For Stdio Transport:**
Typically, you'll configure the client to execute the server's start script.

```json
{
  "mcpServers": {
    "atlas-mcp-server-stdio": {
      "command": "node",
      "args": ["/full/path/to/atlas-mcp-server/dist/index.js"],
      "env": {
        "NEO4J_URI": "bolt://localhost:7687",
        "NEO4J_USER": "neo4j",
        "NEO4J_PASSWORD": "password2",
        "LOG_LEVEL": "info",
        "NODE_ENV": "production",
        "MCP_TRANSPORT_TYPE": "stdio" // Ensure this is set for stdio
      }
    }
  }
}
```

**For HTTP Transport:**
If your client supports connecting to an MCP server via an HTTP URL, you would typically provide the server's endpoint (e.g., `http://localhost:3010/mcp`).

If your client launches the server for HTTP mode:

```json
{
  "mcpServers": {
    "atlas-mcp-server-http": {
      "command": "node",
      "args": ["/full/path/to/atlas-mcp-server/dist/index.js"],
      "env": {
        "NEO4J_URI": "bolt://localhost:7687",
        "NEO4J_USER": "neo4j",
        "NEO4J_PASSWORD": "password2",
        "LOG_LEVEL": "info",
        "NODE_ENV": "production",
        "MCP_TRANSPORT_TYPE": "http", // Crucial for HTTP mode
        "MCP_HTTP_PORT": "3010", // Ensure this matches your server's .env
        "MCP_HTTP_HOST": "127.0.0.1" // Ensure this matches your server's .env
        // "MCP_AUTH_SECRET_KEY": "your-secure-token" // If authentication is enabled on the server
      }
    }
  }
}
```

**Note:** Always use absolute paths for `args` when configuring client commands if the server is not in the client's immediate working directory. The `MCP_AUTH_SECRET_KEY` in the client's `env` block is illustrative; actual token handling for client-to-server communication would depend on the client's capabilities and the server's authentication mechanism (e.g., sending a JWT in an `Authorization` header).

## Project Structure

The codebase follows a modular structure:

```
src/
├── config/          # Configuration management (index.ts)
├── index.ts         # Main server entry point
├── mcp/             # MCP server implementation (server.ts)
│   ├── resources/   # MCP resource handlers (index.ts, types.ts, knowledge/, projects/, tasks/)
│   └── tools/       # MCP tool handlers (individual tool directories)
├── services/        # Core application services
│   └── neo4j/       # Neo4j database services (index.ts, driver.ts, backupRestoreService.ts, etc.)
├── types/           # Shared TypeScript type definitions (errors.ts, mcp.ts, tool.ts)
└── utils/           # Utility functions and internal services (e.g., logger, errorHandler, sanitization)
```

## Tools

ATLAS provides a comprehensive suite of tools for project, task, and knowledge management, callable via the Model Context Protocol.

### Project Operations

| Tool Name              | Description                              | Key Arguments                                                                                                                                                                                               |
| :--------------------- | :--------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `atlas_project_create` | Creates new projects (single/bulk).      | `mode` ('single'/'bulk'), project details (`name`, `description`, `status`, `urls`, `completionRequirements`, `dependencies`, `outputFormat`, `taskType`), `responseFormat` ('formatted'/'json', optional). |
| `atlas_project_list`   | Lists projects (all/details).            | `mode` ('all'/'details'), `id` (for details), filters (`status`, `taskType`), pagination (`page`, `limit`), includes (`includeKnowledge`, `includeTasks`), `responseFormat` ('formatted'/'json', optional). |
| `atlas_project_update` | Updates existing projects (single/bulk). | `mode` ('single'/'bulk'), `id`, `updates` object, `responseFormat` ('formatted'/'json', optional). Bulk mode uses `projects` array.                                                                         |
| `atlas_project_delete` | Deletes projects (single/bulk).          | `mode` ('single'/'bulk'), `id` (single) or `projectIds` array (bulk), `responseFormat` ('formatted'/'json', optional).                                                                                      |

### Task Operations

| Tool Name           | Description                           | Key Arguments                                                                                                                                                                                                                                    |
| :------------------ | :------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `atlas_task_create` | Creates new tasks (single/bulk).      | `mode` ('single'/'bulk'), `projectId`, task details (`title`, `description`, `priority`, `status`, `assignedTo`, `tags`, `completionRequirements`, `dependencies`, `outputFormat`, `taskType`), `responseFormat` ('formatted'/'json', optional). |
| `atlas_task_update` | Updates existing tasks (single/bulk). | `mode` ('single'/'bulk'), `id`, `updates` object, `responseFormat` ('formatted'/'json', optional). Bulk mode uses `tasks` array.                                                                                                                 |
| `atlas_task_delete` | Deletes tasks (single/bulk).          | `mode` ('single'/'bulk'), `id` (single) or `taskIds` array (bulk), `responseFormat` ('formatted'/'json', optional).                                                                                                                              |
| `atlas_task_list`   | Lists tasks for a specific project.   | `projectId` (required), filters (`status`, `assignedTo`, `priority`, `tags`, `taskType`), sorting (`sortBy`, `sortDirection`), pagination (`page`, `limit`), `responseFormat` ('formatted'/'json', optional).                                    |

### Knowledge Operations

| Tool Name                | Description                                   | Key Arguments                                                                                                                                                                        |
| :----------------------- | :-------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `atlas_knowledge_add`    | Adds new knowledge items (single/bulk).       | `mode` ('single'/'bulk'), `projectId`, knowledge details (`text`, `tags`, `domain`, `citations`), `responseFormat` ('formatted'/'json', optional). Bulk mode uses `knowledge` array. |
| `atlas_knowledge_delete` | Deletes knowledge items (single/bulk).        | `mode` ('single'/'bulk'), `id` (single) or `knowledgeIds` array (bulk), `responseFormat` ('formatted'/'json', optional).                                                             |
| `atlas_knowledge_list`   | Lists knowledge items for a specific project. | `projectId` (required), filters (`tags`, `domain`, `search`), pagination (`page`, `limit`), `responseFormat` ('formatted'/'json', optional).                                         |

### Search Operations

| Tool Name              | Description                              | Key Arguments                                                                                                                                                                                           |
| :--------------------- | :--------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `atlas_unified_search` | Performs unified search across entities. | `value` (search term), `property` (optional), filters (`entityTypes`, `taskType`), options (`caseInsensitive`, `fuzzy`), pagination (`page`, `limit`), `responseFormat` ('formatted'/'json', optional). |

### Research Operations

| Tool Name             | Description                                                                                                   | Key Arguments                                                                                                                                                                                                                                                                             |
| :-------------------- | :------------------------------------------------------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `atlas_deep_research` | Initiates a structured deep research process by creating a hierarchical plan within the Atlas knowledge base. | `projectId` (required), `researchTopic` (required), `researchGoal` (required), `scopeDefinition` (optional), `subTopics` (required array with questions and search queries), `researchDomain` (optional), `initialTags` (optional), `planNodeId` (optional), `responseFormat` (optional). |

### Database Operations

| Tool Name              | Description                                                                                   | Key Arguments                                                                                          |
| :--------------------- | :-------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------- |
| `atlas_database_clean` | **Destructive:** Completely resets the database, removing all projects, tasks, and knowledge. | `acknowledgement` (must be set to `true` to confirm), `responseFormat` ('formatted'/'json', optional). |

## Resources

ATLAS exposes project, task, and knowledge data through standard MCP resource endpoints.

### Direct Resources

| Resource Name       | Description                                                                              |
| :------------------ | :--------------------------------------------------------------------------------------- |
| `atlas://projects`  | List of all projects in the Atlas platform with pagination support.                      |
| `atlas://tasks`     | List of all tasks in the Atlas platform with pagination and filtering support.           |
| `atlas://knowledge` | List of all knowledge items in the Atlas platform with pagination and filtering support. |

### Resource Templates

| Resource Name                            | Description                                                                  |
| :--------------------------------------- | :--------------------------------------------------------------------------- |
| `atlas://projects/{projectId}`           | Retrieves a single project by its unique identifier (`projectId`).           |
| `atlas://tasks/{taskId}`                 | Retrieves a single task by its unique identifier (`taskId`).                 |
| `atlas://projects/{projectId}/tasks`     | Retrieves all tasks belonging to a specific project (`projectId`).           |
| `atlas://knowledge/{knowledgeId}`        | Retrieves a single knowledge item by its unique identifier (`knowledgeId`).  |
| `atlas://projects/{projectId}/knowledge` | Retrieves all knowledge items belonging to a specific project (`projectId`). |

## Database Backup and Restore

ATLAS provides functionality to back up and restore the Neo4j database content. The core logic resides in `src/services/neo4j/backupRestoreService.ts`.

### Automatic Backups (Note)

**Important:** The automatic backup functionality has been removed due to inefficiency. Please use the manual backup process described below to protect your data.

### Backup Process

- **Mechanism**: The backup process exports all `Project`, `Task`, and `Knowledge` nodes, along with their relationships, into separate JSON files.
- **Output**: Each backup creates a timestamped directory (e.g., `atlas-backup-YYYYMMDDHHMMSS`) within the configured backup path (default: `./backups/`). This directory contains `projects.json`, `tasks.json`, `knowledge.json`, and `relationships.json`.
- **Manual Backup**: You can trigger a manual backup using the provided script:
  ```bash
  npm run db:backup
  ```
  This command executes `scripts/db-backup.ts`, which calls the `exportDatabase` function.

### Restore Process

- **Mechanism**: The restore process first completely clears the existing Neo4j database. Then, it imports nodes and relationships from the JSON files located in the specified backup directory.
- **Warning**: Restoring from a backup is a destructive operation. **It will overwrite all current data in your Neo4j database.**
- **Manual Restore**: To restore the database from a backup directory, use the import script:
  ```bash
  npm run db:import <path_to_backup_directory>
  ```
  Replace `<path_to_backup_directory>` with the actual path to the backup folder (e.g., `./backups/atlas-backup-20250326120000`). This command executes `scripts/db-import.ts`, which calls the `importDatabase` function.
- **Relationship Handling**: The import process attempts to recreate relationships based on the `id` properties stored within the nodes during export. Ensure your nodes have consistent `id` properties for relationships to be restored correctly.

## Examples

The `examples/` directory contains practical examples demonstrating various features of the ATLAS MCP Server.

- **Backup Example**: Located in `examples/backup-example/`, this shows the structure and format of the JSON files generated by the `npm run db:backup` command. See the [Examples README](./examples/README.md) for more details.
- **Deep Research Example**: Located in `examples/deep-research-example/`, this demonstrates the output and structure generated by the `atlas_deep_research` tool. It includes a markdown file (`covington_community_grant_research.md`) summarizing the research plan and a JSON file (`full-export.json`) containing the raw data exported from the database after the research plan was created. See the [Examples README](./examples/README.md) for more details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes with a descriptive message
4. Push to the branch
5. Create a Pull Request

For bugs and feature requests, please create an issue.

## License

Apache License 2.0

---

<div align="center">
Built with the Model Context Protocol
</div>
