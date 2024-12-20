# ATLAS MCP Server

[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue.svg)](https://www.typescriptlang.org/)
[![Model Context Protocol](https://img.shields.io/badge/MCP-1.0.3-green.svg)](https://modelcontextprotocol.io/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Status](https://img.shields.io/badge/Status-Stable-green.svg)]()
[![GitHub](https://img.shields.io/github/stars/cyanheads/atlas-mcp-server?style=social)](https://github.com/cyanheads/atlas-mcp-server)

ATLAS (Adaptive Task & Logic Automation System) is a Model Context Protocol server that provides hierarchical task management capabilities to Large Language Models. This tool provides LLMs with the structure and context needed to manage complex tasks and dependencies.

<a href="https://glama.ai/mcp/servers/b8veo1exod"><img width="380" height="200" src="https://glama.ai/mcp/servers/b8veo1exod/badge" alt="atlas-mcp-server MCP server" /></a>

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Installation](#installation)
- [Configuration](#configuration)
- [Task Structure](#task-structure)
- [Tools](#tools)
- [Best Practices](#best-practices)
- [Development](#development)
- [Up Next](#up-next)
- [Contributing](#contributing)
- [License](#license)

## Overview

### Model Context Protocol Server

ATLAS implements the Model Context Protocol (MCP), created by Anthropic, which is a standardized communication protocol between LLMs and external systems. The architecture consists of:

- **Clients** (Claude Desktop, IDEs) that maintain server connections
- **Servers** that provide tools and resources to clients
- **LLMs** that interact with servers through client applications

This architecture creates a secure boundary between LLMs and external systems while enabling controlled access to functionality.

### Core Components

ATLAS is built on several robust core components organized into specialized subsystems:

#### Task Management
- **TaskStore**: Advanced task storage system with:
  * Atomic operations with transaction support
  * Optimistic concurrency control
  * Automatic rollback on failures
  * Hierarchical task validation (max 5 levels recommended)
  * Duplicate task name prevention within same parent
  * Comprehensive error context and recovery suggestions

- **Status Management**:
  * Advanced state machine with transition rules
  * Intelligent status propagation with deadlock prevention
  * Optimistic locking with automatic retry
  * Transaction-based status updates with rollback
  * Bulk operation support with relaxed rules
  * Race condition handling and lock timeouts
  * Parent-child status synchronization
  * Status transition guidance and suggestions
  * Automatic dependency-based blocking
  * Flexible completion rules for parallel work

- **Dependency System**:
  * Advanced dependency validation with caching
  * Circular dependency detection with depth limits (max 10 levels)
  * Intelligent parallel work support
  * Completion requirement enforcement
  * Dependency chain validation
  * Self-dependency prevention
  * Duplicate dependency detection
  * Batch validation for efficiency
  * Cache invalidation and cleanup
  * Dependency impact analysis
  * Deletion safety checks
  * Status-aware dependency rules

- **Transaction Handling**:
  * ACID-compliant operations with retry logic
  * Intelligent operation grouping and batching
  * Conflict detection and resolution
  * Automatic timeout handling (30s default)
  * Operation limits (1000 per transaction)
  * Transaction statistics and monitoring
  * Optimized operation ordering
  * Automatic rollback on failure
  * Transaction state persistence
  * Comprehensive error context

- **Performance Optimization**:
  * Multi-dimensional task indexing
  * Parallel index operations
  * Configurable batch processing
  * Memory-optimized data structures
  * Real-time index statistics
  * Efficient query filtering
  * Index-based relationship tracking
  * Automatic index maintenance
  * Parallel dependency processing
  * Optimized bulk operations

- **Error Handling**:
  * Detailed error context
  * Recovery suggestions
  * Operation rollback
  * State consistency checks
  * Validation error prevention
  * Clear error messages

#### System Infrastructure
- **StorageManager**: Provides durable data persistence with SQLite integration
- **SessionManager**: Handles session lifecycle and task list management
- **ConfigManager**: Manages environment-based configuration
- **ValidationSystem**: Ensures data integrity with Zod schema integration

#### Performance & Monitoring
- **RateLimiter**: Controls request rates (600 req/min)
- **HealthMonitor**: Tracks system health with comprehensive metrics
- **MetricsCollector**: Gathers detailed performance statistics
- **RequestTracer**: Traces request flow with debugging capabilities

Through the MCP protocol, ATLAS empowers LLMs to break down complex projects into manageable tasks, track their progress, and maintain dependencies — all within an organized hierarchical structure.

## Features

### Task Organization
- Hierarchical task structures with parent-child relationships
- Dependency management and validation
- Status tracking and automatic propagation
- Bulk operations for efficient task management
- Session-based task isolation

### Content Support
- Markdown documentation with rich formatting
- Code snippets with multi-language syntax highlighting
- JSON data structures with schema validation
- Rich metadata and hierarchical tagging
- Comprehensive task reasoning documentation
- Decision-making history with context preservation
- Cross-reference support between tasks
- Version tracking for content changes

### System Features
- Rate limiting (600 requests/minute) with sliding window
- Health monitoring (In Progress)
  * Basic metrics tracking implemented
  * Error rate calculation
  * Response time monitoring
  * TODO: Advanced memory and CPU analysis
  * TODO: Component-level health indicators
- Request tracing (In Progress)
  * Basic request lifecycle tracking
  * Error context capture
  * TODO: Rich metadata enrichment
  * TODO: Advanced event correlation
- Sophisticated error handling
  * Categorized error types
  * Detailed context preservation
  * Recovery suggestions
  * Error aggregation
- Graceful shutdown with resource cleanup
- Session management with persistence
- Comprehensive audit logging
- Automatic maintenance operations

### Performance
- Efficient task storage and retrieval
  * Caching with invalidation
  * Index-based searching
  * Query optimization
- Bulk operation support with transaction handling
- Request timeout handling (30-second default)
- Concurrent request management with isolation
- Resource cleanup and memory optimization
- Automatic performance tuning
- Statistical analysis of metrics
  * Response time percentiles (p95, p99)
  * Error rate tracking
  * Load analysis

## Installation

### Setup Steps

1. Clone the repository:
```bash
git clone https://github.com/cyanheads/atlas-mcp-server.git
```

2. Navigate to the project directory:
```bash
cd atlas-mcp-server
```

3. Install dependencies:
```bash
npm install
```

4. Build the project:
```bash
npm run build
```

5. Create a storage directory for tasks:
```bash
mkdir -p ~/Documents/atlas-tasks
```

The server is now ready to be configured and used with your MCP client.

## Configuration

ATLAS requires configuration in your MCP client settings:

```json
{
  "mcpServers": {
    "atlas": {
      "command": "node",
      "args": ["/path/to/atlas-mcp-server/build/index.js"],
      "env": {
        "TASK_STORAGE_DIR": "/path/to/storage/directory"
      }
    }
  }
}
```

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| TASK_STORAGE_DIR | Directory for task data storage | Yes |

## Task Structure

Tasks support rich content, metadata, and reasoning documentation within a hierarchical structure (maximum 5 levels deep). All task operations are transactional with automatic validation using Zod schemas:

```typescript
{
  "name": "Implementation Task",
  "description": "Implement core functionality",
  "type": "task",
  "notes": [
    {
      "type": "markdown",
      "content": "# Requirements\n- Feature A\n- Feature B"
    },
    {
      "type": "code",
      "language": "typescript",
      "content": "interface Feature {\n  name: string;\n  enabled: boolean;\n}"
    }
  ],
  "reasoning": {
    "approach": "Modular development with focus on reusability",
    "assumptions": [
      "System supports TypeScript",
      "Features can be toggled independently"
    ],
    "alternatives": [
      "Monolithic implementation",
      "Feature flags in configuration"
    ],
    "risks": [
      "Increased complexity from modularity",
      "Performance overhead from dynamic loading"
    ],
    "tradeoffs": [
      "Flexibility vs simplicity",
      "Runtime performance vs maintainability"
    ],
    "constraints": [
      "Must maintain backward compatibility",
      "Must work in all supported browsers"
    ],
    "dependencies_rationale": [
      "Depends on core module for type definitions",
      "Requires configuration service for feature flags"
    ],
    "impact_analysis": [
      "Affects system startup time",
      "Changes how features are loaded and managed"
    ]
  },
  "metadata": {
    "context": "Core implementation phase",
    "tags": ["core", "implementation"]
  }
}
```

The reasoning field provides structured documentation of decision-making, which is indexed for efficient search and retrieval:
- **approach**: High-level implementation strategy
- **assumptions**: Key assumptions made during planning
- **alternatives**: Other approaches that were considered
- **risks**: Potential issues and challenges
- **tradeoffs**: Key decisions and their implications
- **constraints**: Technical or business limitations
- **dependencies_rationale**: Reasoning for task dependencies
- **impact_analysis**: Analysis of changes on the system

### Task Storage Features

- **Validation**: Zod schema validation for all fields
- **Caching**: Automatic caching with invalidation
- **Indexing**: Full-text search on content and metadata
- **Transactions**: ACID compliance for all operations
- **Performance**: Optimized retrieval with batch support
- **History**: Change tracking and version management

### Example Task List (Without reasoning)

The following example demonstrates a task breakdown for a personal portfolio website project, showcasing the hierarchical structure and metadata capabilities. The task list was generated from the following prompt:
> Create a comprehensive task plan for a modern, responsive personal portfolio website that showcases a web developer's projects, skills, and professional experience, incorporating best practices in UI/UX design, performance optimization, and accessibility. The site should feature an elegant, minimalist design with smooth animations, dark/light mode support, and interactive project demonstrations, while ensuring cross-browser compatibility and optimal load times.

<details>
<summary><b>Portfolio Website Development Task List</b></summary>

```json
{
  "success": true,
  "data": [
    {
      "id": "4ylBnk6B",
      "name": "Project Setup and Architecture",
      "description": "Initial project setup, tooling configuration, and architectural decisions",
      "notes": [
        {
          "type": "markdown",
          "content": "# Setup Considerations\n- Modern build tooling (Vite/Next.js)\n- TypeScript configuration\n- ESLint and Prettier setup\n- Git repository initialization\n- Folder structure organization"
        }
      ],
      "type": "group",
      "status": "pending",
      "dependencies": [],
      "subtasks": [
        "8cz24Z95",
        "GwqwfnSf",
        "gKayn2ha"
      ],
      "metadata": {
        "created": "2024-12-20T18:51:29.310Z",
        "updated": "2024-12-20T18:52:14.316Z",
        "sessionId": "session-001",
        "taskListId": "task-001",
        "tags": [
          "setup",
          "architecture",
          "configuration"
        ],
        "resolvedSubtasks": [
          {
            "id": "8cz24Z95",
            "name": "Initialize Project with Build Tools",
            "description": "Set up the project with Vite and configure essential build tools",
            "notes": [
              {
                "type": "markdown",
                "content": "# Implementation Steps\n1. Initialize new Vite project with React/TypeScript template\n2. Configure project structure\n3. Set up path aliases\n4. Configure build optimization settings\n\n# Technical Considerations\n- Use Vite for fast development and optimized production builds\n- Configure TypeScript for type safety\n- Set up module resolution and aliases"
              }
            ],
            "type": "task",
            "status": "pending",
            "dependencies": [],
            "subtasks": [],
            "metadata": {
              "created": "2024-12-20T18:51:59.902Z",
              "updated": "2024-12-20T18:51:59.902Z",
              "sessionId": "session-001",
              "taskListId": "task-001",
              "tags": [
                "setup",
                "build-tools",
                "vite"
              ],
              "resolvedSubtasks": []
            },
            "parentId": "4ylBnk6B"
          },
          {
            "id": "GwqwfnSf",
            "name": "Configure Development Tools and Version Control",
            "description": "Set up code quality tools, linting, formatting, and version control",
            "notes": [
              {
                "type": "markdown",
                "content": "# Setup Tasks\n1. Initialize Git repository\n2. Configure ESLint with TypeScript rules\n3. Set up Prettier for code formatting\n4. Create .gitignore file\n5. Configure pre-commit hooks\n\n# Configuration Files\n- `.eslintrc.json`: ESLint configuration\n- `.prettierrc`: Prettier rules\n- `.editorconfig`: Editor settings\n- `husky`: Git hooks\n\n# Best Practices\n- Enforce consistent code style\n- Enable TypeScript strict mode\n- Set up automated code formatting\n- Configure Git hooks for pre-commit linting"
              }
            ],
            "type": "task",
            "status": "pending",
            "dependencies": [
              "8cz24Z95"
            ],
            "subtasks": [],
            "metadata": {
              "created": "2024-12-20T18:52:06.869Z",
              "updated": "2024-12-20T18:52:06.869Z",
              "sessionId": "session-001",
              "taskListId": "task-001",
              "tags": [
                "tooling",
                "git",
                "code-quality"
              ],
              "resolvedSubtasks": []
            },
            "parentId": "4ylBnk6B"
          },
          {
            "id": "gKayn2ha",
            "name": "Install and Configure Core Dependencies",
            "description": "Set up essential libraries and dependencies for the portfolio website",
            "notes": [
              {
                "type": "markdown",
                "content": "# Core Dependencies\n\n## UI Framework and Styling\n- React for UI components\n- TailwindCSS for styling\n- Framer Motion for animations\n- React Icons for iconography\n\n## State Management and Routing\n- React Router for navigation\n- Zustand/Jotai for state management\n\n## Development Dependencies\n- TypeScript for type safety\n- PostCSS for CSS processing\n- Autoprefixer for browser compatibility\n\n## Testing Framework\n- Vitest for unit testing\n- React Testing Library for component testing\n\n# Configuration Steps\n1. Install production dependencies\n2. Install development dependencies\n3. Configure TailwindCSS\n4. Set up PostCSS\n5. Configure testing environment"
              }
            ],
            "type": "task",
            "status": "pending",
            "dependencies": [
              "8cz24Z95"
            ],
            "subtasks": [],
            "metadata": {
              "created": "2024-12-20T18:52:14.315Z",
              "updated": "2024-12-20T18:52:14.315Z",
              "sessionId": "session-001",
              "taskListId": "task-001",
              "tags": [
                "dependencies",
                "libraries",
                "configuration"
              ],
              "resolvedSubtasks": []
            },
            "parentId": "4ylBnk6B"
          }
        ]
      },
      "parentId": "ROOT-session-001"
    },
    {
      "id": "QTmaDu2O",
      "name": "UI/UX Design Implementation",
      "description": "Design system, component architecture, and responsive layout implementation",
      "notes": [
        {
          "type": "markdown",
          "content": "# Design Requirements\n- Minimalist, elegant design system\n- Dark/light mode theming\n- Responsive layouts\n- Smooth animations and transitions\n- Consistent typography and spacing"
        }
      ],
      "type": "group",
      "status": "pending",
      "dependencies": [],
      "subtasks": [
        "lmtqOVNC",
        "AllDgreE"
      ],
      "metadata": {
        "created": "2024-12-20T18:51:34.428Z",
        "updated": "2024-12-20T18:52:31.900Z",
        "sessionId": "session-001",
        "taskListId": "task-001",
        "tags": [
          "design",
          "ui-ux",
          "frontend"
        ],
        "resolvedSubtasks": [
          {
            "id": "lmtqOVNC",
            "name": "Implement Design System and Theme Configuration",
            "description": "Create a comprehensive design system with dark/light mode support",
            "notes": [
              {
                "type": "markdown",
                "content": "# Design System Components\n\n## Color Palette\n- Primary and secondary colors\n- Neutral shades\n- Accent colors\n- Dark/light mode variants\n\n## Typography\n- Font families (heading and body)\n- Font sizes and line heights\n- Font weights\n- Letter spacing\n\n## Spacing System\n- Base spacing unit\n- Spacing scale\n- Layout margins and padding\n\n## Theme Implementation\n1. Create theme configuration file\n2. Implement theme context/provider\n3. Create theme switching mechanism\n4. Set up CSS custom properties\n5. Create utility classes\n\n# Technical Approach\n- Use CSS variables for dynamic theming\n- Implement theme persistence\n- Create theme toggle component\n- Set up system theme detection"
              }
            ],
            "type": "task",
            "status": "pending",
            "dependencies": [
              "gKayn2ha"
            ],
            "subtasks": [],
            "metadata": {
              "created": "2024-12-20T18:52:23.627Z",
              "updated": "2024-12-20T18:52:23.627Z",
              "sessionId": "session-001",
              "taskListId": "task-001",
              "tags": [
                "design-system",
                "theming",
                "css",
                "dark-mode"
              ],
              "resolvedSubtasks": []
            },
            "parentId": "QTmaDu2O"
          },
          {
            "id": "AllDgreE",
            "name": "Create Responsive Layout System and Core Components",
            "description": "Implement responsive layout system and reusable core components",
            "notes": [
              {
                "type": "markdown",
                "content": "# Layout System\n\n## Grid System\n- Implement responsive grid layout\n- Define breakpoints\n- Create container components\n- Set up layout utilities\n\n## Core Components\n1. Navigation\n   - Responsive navbar\n   - Mobile menu\n   - Navigation links\n\n2. Layout Components\n   - Container\n   - Section\n   - Grid\n   - Flex containers\n\n3. UI Components\n   - Buttons (primary, secondary, ghost)\n   - Cards\n   - Links\n   - Icons\n   - Input fields\n   - Loading states\n\n## Animation System\n- Define animation variables\n- Create transition utilities\n- Implement scroll animations\n- Set up interaction animations\n\n# Implementation Guidelines\n- Use CSS Grid and Flexbox\n- Mobile-first approach\n- Implement smooth transitions\n- Ensure consistent spacing\n- Create component documentation"
              }
            ],
            "type": "task",
            "status": "pending",
            "dependencies": [
              "lmtqOVNC"
            ],
            "subtasks": [],
            "metadata": {
              "created": "2024-12-20T18:52:31.899Z",
              "updated": "2024-12-20T18:52:31.899Z",
              "sessionId": "session-001",
              "taskListId": "task-001",
              "tags": [
                "components",
                "layout",
                "responsive",
                "animations"
              ],
              "resolvedSubtasks": []
            },
            "parentId": "QTmaDu2O"
          }
        ]
      },
      "parentId": "ROOT-session-001"
    },
    {
      "id": "rvxqxsd8",
      "name": "Core Features Development",
      "description": "Implementation of main portfolio features and sections",
      "notes": [
        {
          "type": "markdown",
          "content": "# Key Features\n- Project showcase with interactive demos\n- Skills and expertise section\n- Professional experience timeline\n- Contact form and social links\n- Blog/articles section (optional)"
        }
      ],
      "type": "group",
      "status": "pending",
      "dependencies": [],
      "subtasks": [
        "NUD4rYDu",
        "4ItyKXEL",
        "8CR6zCks"
      ],
      "metadata": {
        "created": "2024-12-20T18:51:39.220Z",
        "updated": "2024-12-20T18:53:00.751Z",
        "sessionId": "session-001",
        "taskListId": "task-001",
        "tags": [
          "features",
          "development",
          "core-functionality"
        ],
        "resolvedSubtasks": [
          {
            "id": "NUD4rYDu",
            "name": "Implement Project Showcase Section",
            "description": "Create an interactive project showcase with filtering and detailed project views",
            "notes": [
              {
                "type": "markdown",
                "content": "# Features\n\n## Project Grid/List\n- Responsive project grid layout\n- Project cards with hover effects\n- Image thumbnails with lazy loading\n- Category/tag filtering system\n\n## Project Details\n- Modal/page for detailed project view\n- Project description and technologies\n- Live demo links\n- GitHub repository links\n- Image gallery/carousel\n\n## Interactive Elements\n- Smooth transitions between views\n- Filter animations\n- Image loading states\n- Interactive demos embedding\n\n## Data Structure\n```typescript\ninterface Project {\n  id: string;\n  title: string;\n  description: string;\n  technologies: string[];\n  images: {\n    thumbnail: string;\n    gallery: string[];\n  };\n  links: {\n    demo?: string;\n    github?: string;\n    live?: string;\n  };\n  category: string[];\n  featured: boolean;\n}\n```\n\n# Implementation Steps\n1. Create project data structure\n2. Implement project grid component\n3. Create project card component\n4. Build filtering system\n5. Implement project detail view\n6. Add animations and transitions"
              }
            ],
            "type": "task",
            "status": "pending",
            "dependencies": [
              "AllDgreE"
            ],
            "subtasks": [],
            "metadata": {
              "created": "2024-12-20T18:52:41.144Z",
              "updated": "2024-12-20T18:52:41.144Z",
              "sessionId": "session-001",
              "taskListId": "task-001",
              "tags": [
                "projects",
                "portfolio",
                "interactive"
              ],
              "resolvedSubtasks": []
            },
            "parentId": "rvxqxsd8"
          },
          {
            "id": "4ItyKXEL",
            "name": "Create Skills and Experience Sections",
            "description": "Implement interactive skills showcase and professional experience timeline",
            "notes": [
              {
                "type": "markdown",
                "content": "# Skills Section\n\n## Skill Categories\n- Frontend Development\n- Backend Development\n- DevOps & Tools\n- Soft Skills\n\n## Visual Elements\n- Skill progress indicators\n- Interactive skill cards\n- Category grouping\n- Skill level visualization\n\n# Experience Timeline\n\n## Timeline Features\n- Vertical/horizontal timeline layout\n- Company/role cards\n- Date ranges\n- Key achievements\n- Technologies used\n\n## Interactive Elements\n- Scroll animations\n- Hover effects\n- Expandable details\n- Filter by technology/skill\n\n## Data Structures\n```typescript\ninterface Skill {\n  name: string;\n  category: string;\n  level: number; // 1-5\n  description?: string;\n  icon?: string;\n  yearStarted: number;\n}\n\ninterface Experience {\n  company: string;\n  role: string;\n  startDate: string;\n  endDate?: string;\n  description: string;\n  achievements: string[];\n  technologies: string[];\n  logo?: string;\n}\n```\n\n# Implementation Steps\n1. Create data structures\n2. Implement skills grid/list\n3. Build experience timeline\n4. Add interactive features\n5. Implement responsive layouts\n6. Add animations and transitions"
              }
            ],
            "type": "task",
            "status": "pending",
            "dependencies": [
              "AllDgreE"
            ],
            "subtasks": [],
            "metadata": {
              "created": "2024-12-20T18:52:50.632Z",
              "updated": "2024-12-20T18:52:50.632Z",
              "sessionId": "session-001",
              "taskListId": "task-001",
              "tags": [
                "skills",
                "experience",
                "timeline"
              ],
              "resolvedSubtasks": []
            },
            "parentId": "rvxqxsd8"
          },
          {
            "id": "8CR6zCks",
            "name": "Implement Contact Form and Social Integration",
            "description": "Create an interactive contact form and integrate social media links",
            "notes": [
              {
                "type": "markdown",
                "content": "# Contact Form\n\n## Form Features\n- Input validation\n- Error handling\n- Success feedback\n- Anti-spam measures\n- Loading states\n\n## Form Fields\n```typescript\ninterface ContactForm {\n  name: string;\n  email: string;\n  subject: string;\n  message: string;\n  recaptcha?: string;\n}\n```\n\n## Technical Implementation\n- Form state management\n- Client-side validation\n- Email service integration (e.g., EmailJS, SendGrid)\n- Rate limiting\n- Error boundaries\n\n# Social Integration\n\n## Features\n- Social media links\n- Professional network links\n- GitHub profile integration\n- Social sharing buttons\n\n## Components\n- Social icons grid\n- Animated hover effects\n- Click tracking\n- Dynamic link handling\n\n# Implementation Steps\n1. Create contact form component\n2. Implement form validation\n3. Set up email service\n4. Add social media integration\n5. Implement error handling\n6. Add loading states and animations\n7. Test form submission\n8. Add analytics tracking\n\n# Best Practices\n- Implement proper form accessibility\n- Add proper ARIA labels\n- Ensure keyboard navigation\n- Provide clear feedback\n- Handle all error states\n- Implement proper security measures"
              }
            ],
            "type": "task",
            "status": "pending",
            "dependencies": [
              "AllDgreE"
            ],
            "subtasks": [],
            "metadata": {
              "created": "2024-12-20T18:53:00.751Z",
              "updated": "2024-12-20T18:53:00.751Z",
              "sessionId": "session-001",
              "taskListId": "task-001",
              "tags": [
                "contact",
                "forms",
                "social-media",
                "integration"
              ],
              "resolvedSubtasks": []
            },
            "parentId": "rvxqxsd8"
          }
        ]
      },
      "parentId": "ROOT-session-001"
    },
    {
      "id": "HOjqKU2N",
      "name": "Performance Optimization",
      "description": "Optimization for speed, performance, and user experience",
      "notes": [
        {
          "type": "markdown",
          "content": "# Optimization Areas\n- Image optimization and lazy loading\n- Code splitting and bundling\n- Caching strategies\n- Performance monitoring\n- Core Web Vitals optimization"
        }
      ],
      "type": "group",
      "status": "pending",
      "dependencies": [],
      "subtasks": [
        "FIheWpfk"
      ],
      "metadata": {
        "created": "2024-12-20T18:51:44.218Z",
        "updated": "2024-12-20T18:53:11.631Z",
        "sessionId": "session-001",
        "taskListId": "task-001",
        "tags": [
          "performance",
          "optimization",
          "web-vitals"
        ],
        "resolvedSubtasks": [
          {
            "id": "FIheWpfk",
            "name": "Implement Performance Optimizations",
            "description": "Optimize website performance focusing on Core Web Vitals and loading speed",
            "notes": [
              {
                "type": "markdown",
                "content": "# Core Web Vitals Optimization\n\n## Largest Contentful Paint (LCP)\n- Optimize image loading\n- Implement responsive images\n- Use WebP format with fallbacks\n- Optimize critical rendering path\n- Implement preloading for key resources\n\n## First Input Delay (FID)\n- Optimize JavaScript execution\n- Implement code splitting\n- Defer non-critical JavaScript\n- Minimize main thread work\n- Optimize event handlers\n\n## Cumulative Layout Shift (CLS)\n- Reserve space for dynamic content\n- Optimize font loading\n- Handle image dimensions\n- Manage layout shifts\n\n# Asset Optimization\n\n## Image Optimization\n```typescript\ninterface ImageOptimization {\n  formats: ['webp', 'avif', 'jpg'];\n  sizes: ['thumbnail', 'medium', 'large'];\n  loading: 'lazy' | 'eager';\n  dimensions: {\n    width: number;\n    height: number;\n  };\n}\n```\n\n## Resource Loading\n- Implement resource hints\n- Use dynamic imports\n- Optimize bundle size\n- Configure caching strategies\n\n# Implementation Steps\n1. Set up performance monitoring\n2. Implement image optimization pipeline\n3. Configure code splitting\n4. Optimize resource loading\n5. Implement caching strategy\n6. Set up performance testing\n\n# Metrics to Track\n- Core Web Vitals\n- Time to Interactive (TTI)\n- First Contentful Paint (FCP)\n- Speed Index\n- Total Blocking Time (TBT)"
              }
            ],
            "type": "task",
            "status": "pending",
            "dependencies": [
              "4ItyKXEL",
              "8CR6zCks",
              "NUD4rYDu"
            ],
            "subtasks": [],
            "metadata": {
              "created": "2024-12-20T18:53:11.630Z",
              "updated": "2024-12-20T18:53:11.630Z",
              "sessionId": "session-001",
              "taskListId": "task-001",
              "tags": [
                "performance",
                "optimization",
                "web-vitals"
              ],
              "resolvedSubtasks": []
            },
            "parentId": "HOjqKU2N"
          }
        ]
      },
      "parentId": "ROOT-session-001"
    },
    {
      "id": "qNXLmR1P",
      "name": "Accessibility and Cross-browser Compatibility",
      "description": "Ensuring the site is accessible and works across all modern browsers",
      "notes": [
        {
          "type": "markdown",
          "content": "# Requirements\n- WCAG 2.1 compliance\n- Semantic HTML structure\n- Keyboard navigation\n- Screen reader compatibility\n- Cross-browser testing"
        }
      ],
      "type": "group",
      "status": "pending",
      "dependencies": [],
      "subtasks": [
        "hwVSfypx"
      ],
      "metadata": {
        "created": "2024-12-20T18:51:49.048Z",
        "updated": "2024-12-20T18:53:22.938Z",
        "sessionId": "session-001",
        "taskListId": "task-001",
        "tags": [
          "accessibility",
          "a11y",
          "cross-browser",
          "testing"
        ],
        "resolvedSubtasks": [
          {
            "id": "hwVSfypx",
            "name": "Implement Accessibility and Cross-browser Support",
            "description": "Ensure WCAG compliance and consistent experience across browsers",
            "notes": [
              {
                "type": "markdown",
                "content": "# Accessibility Implementation\n\n## Semantic HTML\n- Use proper heading hierarchy\n- Implement ARIA landmarks\n- Add descriptive alt text\n- Use semantic HTML elements\n\n## Keyboard Navigation\n- Implement focus management\n- Add skip links\n- Ensure logical tab order\n- Style focus indicators\n\n## Screen Reader Support\n- Add ARIA labels\n- Implement live regions\n- Manage focus announcements\n- Test with screen readers\n\n## Color and Contrast\n- Ensure sufficient contrast ratios\n- Provide visible focus states\n- Test color blindness support\n- Implement high contrast mode\n\n# Cross-browser Testing\n\n## Browser Support Matrix\n```typescript\ninterface BrowserSupport {\n  browsers: {\n    chrome: string[];\n    firefox: string[];\n    safari: string[];\n    edge: string[];\n  };\n  features: {\n    name: string;\n    support: 'full' | 'partial' | 'none';\n    fallback?: string;\n  }[];\n}\n```\n\n## Testing Checklist\n- Layout consistency\n- Animation performance\n- Touch interactions\n- Form behavior\n- Media playback\n- Font rendering\n\n# Implementation Steps\n1. Implement semantic HTML structure\n2. Add ARIA attributes and roles\n3. Implement keyboard navigation\n4. Set up cross-browser testing\n5. Add fallbacks for unsupported features\n6. Test with accessibility tools\n\n# Testing Tools\n- WAVE Evaluation Tool\n- Axe DevTools\n- NVDA/VoiceOver\n- Lighthouse\n- BrowserStack\n- Cross-browser testing suite"
              }
            ],
            "type": "task",
            "status": "pending",
            "dependencies": [
              "FIheWpfk"
            ],
            "subtasks": [],
            "metadata": {
              "created": "2024-12-20T18:53:22.937Z",
              "updated": "2024-12-20T18:53:22.937Z",
              "sessionId": "session-001",
              "taskListId": "task-001",
              "tags": [
                "accessibility",
                "a11y",
                "cross-browser",
                "testing"
              ],
              "resolvedSubtasks": []
            },
            "parentId": "qNXLmR1P"
          }
        ]
      },
      "parentId": "ROOT-session-001"
    },
    {
      "id": "GDatxR51",
      "name": "Deployment and Documentation",
      "description": "Site deployment, documentation, and maintenance plan",
      "notes": [
        {
          "type": "markdown",
          "content": "# Deployment Checklist\n- CI/CD pipeline setup\n- Domain configuration\n- SSL certification\n- Documentation\n- Backup strategy"
        }
      ],
      "type": "group",
      "status": "pending",
      "dependencies": [],
      "subtasks": [
        "jJU9mtgM"
      ],
      "metadata": {
        "created": "2024-12-20T18:51:53.339Z",
        "updated": "2024-12-20T18:53:33.815Z",
        "sessionId": "session-001",
        "taskListId": "task-001",
        "tags": [
          "deployment",
          "documentation",
          "devops"
        ],
        "resolvedSubtasks": [
          {
            "id": "jJU9mtgM",
            "name": "Set Up Deployment and Documentation",
            "description": "Configure deployment pipeline and create comprehensive documentation",
            "notes": [
              {
                "type": "markdown",
                "content": "# Deployment Configuration\n\n## CI/CD Pipeline\n- Set up GitHub Actions workflow\n- Configure build process\n- Implement automated testing\n- Set up deployment environments\n- Configure SSL/TLS\n\n## Deployment Environments\n```typescript\ninterface DeploymentConfig {\n  environments: {\n    development: {\n      url: string;\n      variables: Record<string, string>;\n    };\n    staging: {\n      url: string;\n      variables: Record<string, string>;\n    };\n    production: {\n      url: string;\n      variables: Record<string, string>;\n    };\n  };\n  buildConfig: {\n    command: string;\n    output: string;\n    optimization: boolean;\n  };\n}\n```\n\n# Documentation\n\n## Technical Documentation\n- Project setup guide\n- Architecture overview\n- Component documentation\n- API documentation\n- Performance guidelines\n\n## Maintenance Guide\n- Deployment procedures\n- Update processes\n- Backup procedures\n- Monitoring setup\n- Security guidelines\n\n## Content Management\n- Content update guide\n- Image optimization guide\n- SEO guidelines\n- Analytics setup\n\n# Implementation Steps\n1. Set up deployment pipeline\n2. Configure domain and SSL\n3. Set up monitoring tools\n4. Create technical documentation\n5. Write maintenance guides\n6. Set up backup procedures\n\n# Deployment Checklist\n- SSL configuration\n- DNS setup\n- Environment variables\n- Build optimization\n- Cache configuration\n- Security headers\n- Monitoring tools\n- Backup system\n- Analytics integration"
              }
            ],
            "type": "task",
            "status": "pending",
            "dependencies": [
              "hwVSfypx"
            ],
            "subtasks": [],
            "metadata": {
              "created": "2024-12-20T18:53:33.814Z",
              "updated": "2024-12-20T18:53:33.814Z",
              "sessionId": "session-001",
              "taskListId": "task-001",
              "tags": [
                "deployment",
                "documentation",
                "devops",
                "maintenance"
              ],
              "resolvedSubtasks": []
            },
            "parentId": "GDatxR51"
          }
        ]
      },
      "parentId": "ROOT-session-001"
    }
  ],
  "metadata": {
    "timestamp": "2024-12-20T18:53:38.418Z",
    "requestId": "zcIC0XQG",
    "sessionId": "session-001"
  }
}
```

</details>

## Tools

### Task Management

#### create_task
Creates a new task with comprehensive validation and automatic relationship management:

```typescript
{
  "parentId": string | null,  // Parent task ID (null for root, max depth: 5)
  "name": string,            // Task name (required, unique within parent)
  "description": string,     // Task description
  "notes": Array<{          // Rich content notes with type validation
    type: "markdown" | "code" | "json",
    content: string,        // Content with format validation
    language?: string,      // Required for code notes
    metadata?: object       // Optional note-specific metadata
  }>,
  "reasoning": {            // Structured decision documentation
    "approach": string,     // Implementation strategy
    "assumptions": string[],// Key assumptions
    "alternatives": string[],// Other approaches considered
    "risks": string[],      // Potential issues
    "tradeoffs": string[], // Key decisions and implications
    "constraints": string[],// Technical/business limitations
    "dependencies_rationale": string[], // Dependency reasoning
    "impact_analysis": string[] // System impact analysis
  },
  "type": "task" | "milestone" | "group", // Task type with validation rules
  "dependencies": string[], // Task IDs (validated, no cycles, max depth: 10)
  "metadata": {            // Indexed metadata for efficient querying
    "context": string,     // Task context information
    "tags": string[],      // Categorization tags
    "created": string,     // ISO timestamp
    "updated": string,     // ISO timestamp
    "sessionId": string,   // Associated session
    "taskListId": string   // Associated task list
  }
}
```

Features:
- Hierarchical validation with depth limits
- Duplicate name prevention within parent
- Circular dependency detection
- Rich content validation
- Automatic index management
- Transaction-based creation
- Status propagation handling
- Cache-aware operations

#### bulk_create_tasks
Creates multiple tasks efficiently with optimized processing:

```typescript
{
  "parentId": string | null,  // Common parent for batch (null for root)
  "tasks": Array<{
    name: string,            // Task name (required, unique within parent)
    description?: string,    // Optional description
    notes?: Note[],         // Optional rich content notes
    reasoning?: TaskReasoning, // Optional decision documentation
    type?: TaskType,        // Optional task type (default: "task")
    dependencies?: string[], // Optional dependencies
    metadata?: {            // Optional metadata
      context?: string,
      tags?: string[]
    },
    subtasks?: CreateTaskInput[] // Optional nested tasks
  }>
}
```

Features:
- Parallel processing with configurable batch size
- Atomic transaction handling
- Bulk validation optimization
- Efficient index updates
- Automatic rollback on failure
- Status propagation batching
- Memory-efficient processing
- Real-time progress tracking

#### update_task
Updates an existing task with comprehensive validation and impact analysis:

```typescript
{
  "taskId": string,         // Task ID to update
  "updates": {
    "name"?: string,        // New name (unique within parent)
    "description"?: string, // New description
    "notes"?: Note[],      // Updated notes with validation
    "reasoning"?: TaskReasoning, // Updated decision documentation
    "type"?: TaskType,     // New type with validation
    "status"?: TaskStatus, // New status with transition validation
    "dependencies"?: string[], // Updated dependencies with validation
    "metadata"?: {         // Updated metadata
      "context"?: string,
      "tags"?: string[]
    }
  }
}
```

Features:
- Optimistic concurrency control
- State machine-based status transitions
- Intelligent status propagation
- Dependency impact analysis
- Transaction-based updates
- Automatic rollback on failure
- Cache synchronization
- Index maintenance
- History preservation

#### delete_task
Safely removes a task with comprehensive cleanup and impact management:

Features:
- Recursive subtask deletion with validation
- Dependency relationship cleanup
- Status propagation to dependent tasks
- Reference removal from indexes
- Transaction-based deletion
- Automatic rollback on failure
- Cache invalidation
- Impact analysis before deletion
- Dependent task blocking
- In-progress task protection

### Task Retrieval

#### get_task
Retrieves a task by ID with comprehensive context and optimizations:

Features:
- Complete task details with rich content validation
- Status information with transition history
- Dependency data with validation state
- Metadata inheritance and context chain
- Error context with recovery suggestions
- Multi-level cache utilization
- Index-based fast retrieval
- Automatic cache refresh
- Transaction consistency
- Cross-reference resolution

#### get_subtasks
Lists subtasks with hierarchical context and relationship tracking:

Features:
- Direct child task enumeration
- Status aggregation and inheritance
- Dependency relationship validation
- Metadata context propagation
- Hierarchical depth tracking
- Index-optimized retrieval
- Parallel data fetching
- Cache-aware operations
- Batch loading support
- Real-time updates

#### get_task_tree
Retrieves the complete task hierarchy with advanced features:

Features:
- Full task tree with depth limits (max 5)
- Status aggregation and inheritance
- Dependency graph resolution
- Metadata context merging
- Optimized batch loading
- Cache utilization strategy
- Parallel tree construction
- Memory-efficient processing
- Index-based acceleration
- Real-time tree updates

#### get_tasks_by_status
Filters tasks by status with comprehensive querying:

Features:
- Multi-dimensional status filtering
- Parent/child hierarchy support
- Dependency context validation
- Metadata-based filtering
- Session/list scoping
- Index-optimized retrieval
- Parallel query processing
- Cache-aware operations
- Memory-efficient results
- Real-time updates

### Session Management

#### create_session
Creates a new session with comprehensive management features:

```typescript
{
  "name": string,           // Session name (required, unique)
  "metadata": {            // Optional session metadata
    "tags": string[],      // Categorization tags
    "context": string,     // Session context
    "created": string,     // Creation timestamp
    "updated": string,     // Last update timestamp
    "stats": {             // Session statistics
      "taskCount": number,
      "completedTasks": number,
      "activeTaskLists": number
    }
  }
}
```

Features:
- Unique session name validation
- Automatic ID generation
- Transaction-based creation
- Metadata indexing
- Statistics tracking
- Cache initialization
- Cross-session relationship handling
- Cleanup scheduling

#### create_task_list
Creates a task list with advanced organization features:

```typescript
{
  "name": string,           // List name (required, unique in session)
  "description": string,    // List description
  "metadata": {            // Optional metadata
    "tags": string[],      // Categorization tags
    "context": string,     // List context
    "created": string,     // Creation timestamp
    "updated": string,     // Last update timestamp
    "stats": {             // List statistics
      "taskCount": number,
      "completedTasks": number,
      "activeSubtasks": number
    }
  },
  "persistent": boolean    // Cross-session persistence
}
```

Features:
- Session-scoped uniqueness validation
- Automatic ID generation
- Transaction-based creation
- Metadata indexing
- Statistics tracking
- Cache initialization
- Cross-list relationship handling
- Cleanup scheduling

#### switch_session
Switches sessions with state preservation:

Features:
- Session existence validation
- State transition management
- Task context preservation
- Active session updating
- Cache synchronization
- Index updating
- Transaction handling
- Cross-session relationship maintenance
- Statistics updating
- Cleanup scheduling

#### switch_task_list
Switches task lists with context management:

Features:
- List existence validation
- State transition handling
- Context preservation
- Active list updating
- Cache synchronization
- Index updating
- Transaction handling
- Cross-list relationship maintenance
- Statistics updating
- Cleanup scheduling

#### list_sessions
Lists sessions with comprehensive information:

Features:
- Optional archive inclusion
- Rich metadata retrieval
- Statistics aggregation
- Creation/update tracking
- Task list summaries
- Cache utilization
- Parallel processing
- Memory optimization
- Real-time updates
- Filtering capabilities

#### list_task_lists
Lists task lists with detailed context:

Features:
- Optional archive inclusion
- Rich metadata retrieval
- Task statistics
- Status aggregation
- Cache utilization
- Parallel processing
- Memory optimization
- Real-time updates
- Filtering support
- Cross-reference resolution

### Storage Operations

#### Task Storage
- SQLite-based persistence with WAL mode
- ACID-compliant transactions
- Optimistic concurrency control
- Automatic schema migrations
- Connection pooling with retry logic
- Comprehensive error recovery
- Data integrity validation
- Checksum verification
- Efficient batch operations
- Recursive subtask support

#### Session Storage
- Session state persistence
- Task list management
- Active state tracking
- Cross-session relationships
- State transition validation
- Metadata indexing
- Statistics tracking
- Cache initialization
- Cleanup scheduling
- Real-time updates

#### Maintenance Operations
- Automated database analysis
- WAL checkpoint management
- Storage space optimization
- Index maintenance
- Backup rotation
- Resource monitoring
- Performance metrics
- Storage estimation
- Data persistence verification
- Directory structure management

### System Features

#### Rate Limiting
- 600 requests per minute limit
- Automatic request throttling
- Queue management
- Error handling
- Client feedback

#### Health Monitoring
- Comprehensive system health checks
  * Memory usage tracking with thresholds (90%)
  * CPU utilization monitoring
  * Active request counting
  * Component-level health status
  * Real-time health indicators

- Advanced metrics collection
  * Request count tracking
  * Error rate calculation (10% threshold)
  * Average response time monitoring (5s threshold)
  * Performance statistics aggregation
  * Resource utilization metrics

- Rate limiter monitoring
  * Current request rate tracking
  * Limit compliance verification
  * Window-based monitoring
  * Throttling effectiveness analysis

- Status aggregation and reporting
  * Component-level health status
  * Overall system health assessment
  * Timestamp-based monitoring
  * Detailed health status reports
  * Early warning indicators

#### Request Tracing
- Comprehensive lifecycle tracking
  * Request start/end timestamps
  * Duration measurement
  * Event sequence recording
  * Metadata enrichment
  * Real-time trace updates

- Advanced trace management
  * Trace limit enforcement (1000 traces)
  * Time-based cleanup (1-hour TTL)
  * Automatic trace pruning
  * Memory optimization
  * Trace persistence

- Performance analysis
  * Active request tracking
  * Completion rate monitoring
  * Error rate calculation
  * Average duration tracking
  * Resource utilization metrics

- Error tracking and debugging
  * Detailed error context capture
  * Error trace isolation
  * Debug metadata collection
  * Trace event correlation
  * Recovery context preservation

- Trace aggregation and reporting
  * Trace summaries and statistics
  * Time-range based filtering
  * Error trace filtering
  * Active trace monitoring
  * System health indicators

#### Error Handling
ATLAS provides comprehensive error handling:
- Validation errors with context
- Dependency conflict detection
- Task state inconsistencies
- System resource issues
- Transaction failures
- Rate limit violations
- Request timeout handling

## Best Practices

### Task Management
- Create parent tasks before subtasks
- Use task IDs for dependencies
- Provide clear context in metadata
- Use appropriate task types
- Document reasoning and assumptions
- Handle status transitions carefully
- Monitor dependency relationships
- Maintain task hierarchy

### Content Organization
- Use appropriate note types
- Include relevant code samples
- Maintain clear documentation
- Document decision-making process
- Keep metadata current
- Tag tasks appropriately
- Structure hierarchies logically

### Performance Optimization
- Use bulk operations for multiple tasks
- Monitor rate limits
- Handle long-running operations
- Implement proper error handling
- Optimize task retrieval
- Cache frequently accessed data
- Clean up completed tasks

### Error Recovery
- Handle validation errors gracefully
- Resolve dependency conflicts
- Manage status inconsistencies
- Recover from system issues
- Maintain data integrity
- Document error contexts
- Implement retry strategies

## Development

```bash
# Build the project
npm run build

# Watch for changes
npm run watch

# Run MCP inspector
npm run inspector

# Run tests
npm test

# Check types
npm run type-check
```

## Up Next

### Session Management Improvements
- Session file consolidation
- Distributed session locking
- Improved state synchronization
- Race condition prevention
- Cross-session data consistency
- Session cleanup optimization

### Storage Layer Enhancements
- Storage abstraction simplification
- Tighter migration integration
- Version control improvements
- Storage manager coordination
- Backup strategy optimization
- Data integrity validation

### Task Core Improvements
- Task core coordinator implementation
- Cache coherency protocol
- Transaction boundary strengthening
- Subsystem coordination
- Batch operation optimization
- Index performance tuning

### System Enhancements
- Enhanced performance monitoring
- Advanced caching strategies
- Improved error recovery
- Better dependency management
- Transaction optimizations
- Resource usage tracking

### Integration Features
- Webhook support
- External system integration
- Event streaming
- Custom tool support
- Plugin architecture
- API versioning

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

For bugs and feature requests, please [create an issue](https://github.com/cyanheads/atlas-mcp-server/issues).

## License

Apache License 2.0

---

<div align="center">
Built with the Model Context Protocol
</div>
