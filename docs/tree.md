# atlas-mcp-server - Directory Structure

Generated on: 2025-05-22 10:39:31

```
atlas-mcp-server
├── .github
│   └── workflows
│       └── publish.yml
├── docs
│   └── tree.md
├── examples
│   ├── backup-example
│   │   ├── knowledges.json
│   │   ├── projects.json
│   │   ├── relationships.json
│   │   └── tasks.json
│   ├── deep-research-example
│   │   ├── covington_community_grant_research.md
│   │   └── full-export.json
│   ├── README.md
│   └── webui-example.png
├── scripts
│   ├── clean.ts
│   ├── db-backup.ts
│   ├── db-import.ts
│   ├── fetch-openapi-spec.ts
│   ├── make-executable.ts
│   └── tree.ts
├── src
│   ├── config
│   │   └── index.ts
│   ├── mcp
│   │   ├── resources
│   │   │   ├── knowledge
│   │   │   │   └── knowledgeResources.ts
│   │   │   ├── projects
│   │   │   │   └── projectResources.ts
│   │   │   ├── tasks
│   │   │   │   └── taskResources.ts
│   │   │   ├── index.ts
│   │   │   └── types.ts
│   │   ├── tools
│   │   │   ├── atlas_database_clean
│   │   │   │   ├── cleanDatabase.ts
│   │   │   │   ├── index.ts
│   │   │   │   ├── responseFormat.ts
│   │   │   │   └── types.ts
│   │   │   ├── atlas_deep_research
│   │   │   │   ├── deepResearch.ts
│   │   │   │   ├── index.ts
│   │   │   │   ├── responseFormat.ts
│   │   │   │   └── types.ts
│   │   │   ├── atlas_knowledge_add
│   │   │   │   ├── addKnowledge.ts
│   │   │   │   ├── index.ts
│   │   │   │   ├── responseFormat.ts
│   │   │   │   └── types.ts
│   │   │   ├── atlas_knowledge_delete
│   │   │   │   ├── deleteKnowledge.ts
│   │   │   │   ├── index.ts
│   │   │   │   ├── responseFormat.ts
│   │   │   │   └── types.ts
│   │   │   ├── atlas_knowledge_list
│   │   │   │   ├── index.ts
│   │   │   │   ├── listKnowledge.ts
│   │   │   │   ├── responseFormat.ts
│   │   │   │   └── types.ts
│   │   │   ├── atlas_project_create
│   │   │   │   ├── createProject.ts
│   │   │   │   ├── index.ts
│   │   │   │   ├── responseFormat.ts
│   │   │   │   └── types.ts
│   │   │   ├── atlas_project_delete
│   │   │   │   ├── deleteProject.ts
│   │   │   │   ├── index.ts
│   │   │   │   ├── responseFormat.ts
│   │   │   │   └── types.ts
│   │   │   ├── atlas_project_list
│   │   │   │   ├── index.ts
│   │   │   │   ├── listProjects.ts
│   │   │   │   ├── responseFormat.ts
│   │   │   │   └── types.ts
│   │   │   ├── atlas_project_update
│   │   │   │   ├── index.ts
│   │   │   │   ├── responseFormat.ts
│   │   │   │   ├── types.ts
│   │   │   │   └── updateProject.ts
│   │   │   ├── atlas_task_create
│   │   │   │   ├── createTask.ts
│   │   │   │   ├── index.ts
│   │   │   │   ├── responseFormat.ts
│   │   │   │   └── types.ts
│   │   │   ├── atlas_task_delete
│   │   │   │   ├── deleteTask.ts
│   │   │   │   ├── index.ts
│   │   │   │   ├── responseFormat.ts
│   │   │   │   └── types.ts
│   │   │   ├── atlas_task_list
│   │   │   │   ├── index.ts
│   │   │   │   ├── listTasks.ts
│   │   │   │   ├── responseFormat.ts
│   │   │   │   └── types.ts
│   │   │   ├── atlas_task_update
│   │   │   │   ├── index.ts
│   │   │   │   ├── responseFormat.ts
│   │   │   │   ├── types.ts
│   │   │   │   └── updateTask.ts
│   │   │   └── atlas_unified_search
│   │   │       ├── index.ts
│   │   │       ├── responseFormat.ts
│   │   │       ├── types.ts
│   │   │       └── unifiedSearch.ts
│   │   ├── transports
│   │   │   ├── authentication
│   │   │   │   └── authMiddleware.ts
│   │   │   ├── httpTransport.ts
│   │   │   └── stdioTransport.ts
│   │   └── server.ts
│   ├── services
│   │   ├── llm-providers
│   │   │   ├── index.ts
│   │   │   └── openRouterProvider.ts
│   │   └── neo4j
│   │       ├── backupRestoreService.ts
│   │       ├── driver.ts
│   │       ├── events.ts
│   │       ├── helpers.ts
│   │       ├── index.ts
│   │       ├── knowledgeService.ts
│   │       ├── projectService.ts
│   │       ├── searchService.ts
│   │       ├── taskService.ts
│   │       ├── types.ts
│   │       └── utils.ts
│   ├── types
│   │   ├── errors.ts
│   │   ├── mcp.ts
│   │   └── tool.ts
│   ├── utils
│   │   ├── internal
│   │   │   ├── errorHandler.ts
│   │   │   ├── index.ts
│   │   │   ├── logger.ts
│   │   │   └── requestContext.ts
│   │   ├── metrics
│   │   │   ├── index.ts
│   │   │   └── tokenCounter.ts
│   │   ├── parsing
│   │   │   ├── dateParser.ts
│   │   │   ├── index.ts
│   │   │   └── jsonParser.ts
│   │   ├── security
│   │   │   ├── idGenerator.ts
│   │   │   ├── index.ts
│   │   │   ├── rateLimiter.ts
│   │   │   └── sanitization.ts
│   │   └── index.ts
│   ├── webui
│   │   ├── index.html
│   │   ├── script.js
│   │   └── style.css
│   └── index.ts
├── .clinerules
├── .env.example
├── .gitignore
├── .repomixignore
├── CHANGELOG.md
├── docker-compose.yml
├── LICENSE
├── mcp.json
├── package-lock.json
├── package.json
├── README.md
├── repomix.config.json
├── smithery.yaml
├── tsconfig.json
├── tsconfig.typedoc.json
└── typedoc.json
```

_Note: This tree excludes files and directories matched by .gitignore and default patterns._
