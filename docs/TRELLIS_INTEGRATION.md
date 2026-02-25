# Task Trellis MCP Integration with ATLAS

This guide explains how to use ATLAS MCP Server alongside Task Trellis MCP for enhanced project and task management capabilities.

## Overview

ATLAS and Task Trellis MCP are complementary tools that can work together to provide comprehensive project management:

- **ATLAS MCP Server**: Neo4j-based task management with graph database relationships, knowledge management, and deep research capabilities
- **Task Trellis MCP**: Markdown-based hierarchical task breakdown with file change tracking and dependency management

## When to Use Each

### Use ATLAS when you need:
- Graph database relationships and complex queries
- Knowledge management integrated with projects
- Deep research workflow capabilities
- Web UI for visualization
- Database backup/restore functionality
- RESTful HTTP API access

### Use Task Trellis when you need:
- Markdown-based task storage (version control friendly)
- Hierarchical task breakdown (Project → Epic → Feature → Task)
- File change tracking per task
- Lightweight local storage
- Simple workflow automation
- Git-friendly task management

### Use Both Together when you want:
- ATLAS for high-level project planning and knowledge management
- Task Trellis for detailed task execution and file tracking
- Best of both worlds: graph relationships + markdown simplicity

## Configuration

The example `mcp.json` in the repository root includes both servers. Update the configuration as needed:

### ATLAS Configuration

```json
{
  "atlas-mcp-server": {
    "command": "node",
    "args": ["dist/index.js"],
    "env": {
      "NEO4J_URI": "bolt://localhost:7687",
      "NEO4J_USER": "neo4j",
      "NEO4J_PASSWORD": "your-password",
      "MCP_TRANSPORT_TYPE": "stdio"
    }
  }
}
```

### Task Trellis Configuration

```json
{
  "task-trellis-mcp": {
    "command": "npx",
    "args": [
      "-y",
      "@langadventurellc/task-trellis-mcp",
      "--projectRootFolder",
      "/absolute/path/to/your/project",
      "--trellisFolder",
      ".trellis"
    ]
  }
}
```

**Important**: Replace `/absolute/path/to/your/project` with the actual absolute path to your project directory.

## Installation

### 1. Install ATLAS (This Repository)

```bash
# Clone and build ATLAS
git clone https://github.com/cyanheads/atlas-mcp-server.git
cd atlas-mcp-server
npm install
npm run build

# Start Neo4j (required for ATLAS)
docker-compose up -d
```

### 2. Install Task Trellis

Task Trellis can be installed via npm or used directly with npx:

```bash
# Option 1: Install globally
npm install -g @langadventurellc/task-trellis-mcp

# Option 2: Use with npx (no installation required)
# This is handled automatically in the mcp.json configuration
```

### 3. Configure Your MCP Client

Add the configuration from `mcp.json` to your MCP client configuration file:

- **Claude Desktop**: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
- **Cline/VSCode**: `.mcp/settings.json` in your workspace
- **Other MCP Clients**: Consult your client's documentation

## Example Workflows

### Workflow 1: ATLAS for Planning, Trellis for Execution

1. **In ATLAS**: Create high-level project with goals and requirements
   ```
   Use atlas_project_create to define project scope, dependencies, and knowledge base
   ```

2. **In Task Trellis**: Break down into executable tasks
   ```
   Use task-trellis:create-project to create hierarchical task structure
   ```

3. **In Task Trellis**: Execute tasks with file tracking
   ```
   Claim and complete tasks, automatically tracking file changes
   ```

4. **In ATLAS**: Update knowledge base with learnings
   ```
   Use atlas_knowledge_add to document insights and patterns discovered
   ```

### Workflow 2: Parallel Management

- Use **ATLAS** for:
  - Overall project portfolio management
  - Cross-project dependencies
  - Research and knowledge management
  - Team collaboration via web UI

- Use **Task Trellis** for:
  - Individual task execution
  - Code change tracking
  - Sprint-level work
  - Version-controlled task history

### Workflow 3: Migration Path

Start with one tool and migrate to the other as needs evolve:

- **Start with Task Trellis**: Quick setup, markdown-based
- **Migrate to ATLAS**: When you need graph relationships, knowledge management, or team collaboration
- **Keep both**: For different aspects of project management

## Tool Comparison

| Feature | ATLAS | Task Trellis | Both |
|---------|-------|--------------|------|
| Database | Neo4j (graph) | Markdown files | - |
| Task Hierarchy | 2-tier (Projects → Tasks) | 4-tier (Project → Epic → Feature → Task) | ✓ |
| Dependencies | Full graph relationships | Linear prerequisites | ✓ |
| Knowledge Management | ✓ | - | ✓ |
| File Change Tracking | - | ✓ | ✓ |
| Web UI | ✓ | - | ✓ |
| HTTP API | ✓ | - | ✓ |
| Version Control Friendly | Backup/restore | Native markdown | ✓ |
| Deep Research | ✓ | - | ✓ |
| Unified Search | ✓ | - | ✓ |

## Troubleshooting

### Both Servers Not Appearing

1. Verify both servers are configured in your MCP client config
2. Check that paths are absolute (not relative)
3. Restart your MCP client after configuration changes
4. Check server logs for errors

### Neo4j Connection Issues (ATLAS)

```bash
# Verify Neo4j is running
docker ps | grep neo4j

# Check Neo4j logs
docker-compose logs neo4j

# Restart Neo4j if needed
docker-compose restart neo4j
```

### Task Trellis Project Path Issues

- Ensure `--projectRootFolder` uses an absolute path
- Check that the path exists and has write permissions
- Verify `.trellis` folder can be created in the project root

## Additional Resources

- [ATLAS Documentation](../README.md)
- [Task Trellis Documentation](https://github.com/langadventurellc/task-trellis-mcp)
- [Model Context Protocol Specification](https://modelcontextprotocol.io/)

## Contributing

If you discover integration issues or have suggestions for better workflows using both MCPs together, please:

1. Open an issue on the respective repositories
2. Share your use case and workflow
3. Contribute documentation improvements

## License

- ATLAS MCP Server: Apache 2.0
- Task Trellis MCP: GPL-3.0-only

Both tools can be used together under their respective licenses.
