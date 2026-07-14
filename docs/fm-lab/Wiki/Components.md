# Components

The repository is organized into separate sections for the different components and tasks within the overall workflow.

```
fm-lab/
├── .claude/                    Claude Code configuration (skills, settings)
├── .devcontainer/              VS Code Dev Container configuration (optional)
├── .fmlab/                     FM-Lab configuration (plugins, settings)
├── .git/                       Git repository metadata
├── apps/                       Frontend / application code
├── db/                         DuckDB databases (symlinks to active solution)
├── docs/                       Project documentation and optional references
├── logs/                       Log files
├── packages/                   Shared packages and modules
├── reference/                  fm-spec database (syntax and grammar definitions)
├── rest-api/                   REST API server with its own database copies
├── scripts/                    Reserved for generation of new scripts (output)
├── solutions/                  Solution bundles (FileMaker solution data)
├── solutions/<id>/xml/         FileMaker XML exports (input data)
├── solutions/<id>/db/          DuckDB object catalog (output data)
├── solutions/<id>/state/       Solution metadata (status, logs)
├── sql/                        SQL templates (convert-xml, samples, …)
├── tools/                      XML Importer and CLI utilities
│
├── .gitignore                  Git ignore rules
├── README.md                   Project overview
├── CHANGELOG.md                Version history
├── CLAUDE.md                   Project instructions for Claude
├── LICENSE                     License
└── package.json                Node.js workspace configuration
```

### XML (Input)

`solutions/<id>/xml/` — FileMaker XML exports (SaXML) from your solution, prepared for conversion.

The folder can contain multiple files belonging to the same solution.

### SQL Templates

`sql/convert-xml/` — Conversion and parser templates for universal catalogs.

This is the main ingestion logic and is executed by the DuckDB CLI, which must be installed beforehand.

### DuckDB Catalog

`solutions/<id>/db/fm_catalog.duckdb` — The generated DuckDB database containing the extracted FileMaker objects and their relationships.

A separate catalog is populated for each solution during XML conversion.

### fm-spec FileMaker Reference

`reference/fm_spec.duckdb` — DuckDB database containing reference information about FileMaker script steps and functions. It includes machine-readable syntax and grammar definitions for linting during code generation.

### REST API

- `rest-api/` — Express server for HTTP access to the analysis database.
- `rest-api/db/solutions/<id>/fm_catalog.duckdb` — DuckDB database copy for exclusive, read-only access by the REST API.
- `rest-api/templates/dashboards/` — Dashboard bundles for standard views exposed through API endpoints.
- `rest-api/templates/dashboards-custom/` — Additional dashboard bundles for custom use cases. These can be generated using a Claude Code skill.
- `rest-api/templates/dashboards-custom/static-code-analysis/` — Dashboard bundles for static code analysis, inspired by the PMD standard ruleset. They are accessible through the web frontend and provide quick access to different code metrics. All dashboards support drill-down filters and interactive navigation to code references within the object browser.
- `rest-api/templates/sql/` — SQL templates for standard queries exposed through API endpoints.
- `rest-api/templates/sql-custom/` — Additional SQL templates for custom use cases.

### Web Client

`apps/web/` — React/Vite frontend

### Tools

- `tools/` — Utility scripts for various tasks.
- `tools/fmlab.sh` — Wrapper for starting FM-Lab through Docker or the native CLI.
- `tools/init.sh` — Initializes the project on first run by installing npm packages and configuring paths and default settings. It includes a preflight check for dependencies and expected versions.
- `tools/convert_fm_xml.sh` — Runs XML batch conversion and accepts CLI options.
- `tools/start-servers.sh` — Starts the included HTTP servers.
- `tools/stop-servers.sh` — Stops the included HTTP servers.

### Docs

- `docs/` — Documentation files for FileMaker Pro and MBS plugin functions, installable through the web frontend or Claude skills.
- `docs/fm-lab/` — Location of this documentation.
- `docs/agents/` — Workflow and schema documentation referenced by CLAUDE.md.
- `docs/claris-help/` — Official FileMaker Pro documentation files, installable on demand in one or more local languages.
- `docs/mbs/` — Official documentation files for MBS plugin functions, installable on demand.
- `docs/fmIDE/` — Official documentation files for fmIDE, installable on demand.
- `docs/.../` — Optional documentation files, installable on demand.

Installing the basic documentation set is highly recommended. It provides inline help for the web client and grounded reference material for agentic workflows.

Some documentation packages include their own databases for fast indexed queries. The Claris and MBS documentation also provides dynamic context by mapping documentation entries to scripts and calculations in your solutions. These references are available for drill-down navigation and cross-referencing through the web frontend.

### Claude System Prompt

`CLAUDE.md` defines the Claude system prompt. It provides project context, describes the ingestion pipeline and workflows, establishes operational rules, and references the supporting documentation in `docs/agents/`.

### Claude Skills

`.claude/skills/` contains Claude Code skills and slash commands for installation, conversion, lookup, analysis, and code generation.

**Setup**

- `.claude/skills/install-claris-docs` — Installs the Claris FileMaker documentation.
- `.claude/skills/install-mbs-docs` — Installs the MBS plugin documentation.
- `.claude/skills/install-fmide-docs` — Installs the fmIDE documentation.

**Optional tools**

- `.claude/skills/install-ooe-fm` — Installs OOE references as a test suite for the XML converter. This component is entirely optional and not used elsewhere in the project.
- `.claude/skills/install-fm-xml-export-exploder` — Installs XML Export Exploder for reference purposes and local testing. This component is entirely optional and not used elsewhere in the project.
- `.claude/skills/skill-creator` — Helps you build your own skills that extend the agentic workflow.

**XML conversion**

- `.claude/skills/convert-xml` — Runs the XML conversion with checks and configuration options.
- `.claude/skills/test-convert-xml` — Runs a test conversion against the OOE references.

**Agentic analysis**

- `.claude/skills/fm-show` — Shows details or references for a given object in the web frontend.
- `.claude/skills/fm-open` — Opens a given object directly in your FileMaker Solution through the fmIDE `Name that Thing API`.

- `.claude/skills/fm-summarize` — Creates a concise technical briefing for a given object.
- `.claude/skills/fm-analyze` — Runs an in-depth object analysis using semantic signals and recursive graph traversal up to five levels deep. It gathers context about dependencies, structure, logic, technical rules, and semantic meaning. This helps the agent explain functionality and business rules within the solution.
- `.claude/skills/fm-graph-cluster` — Segments the FileMaker object graph into functional clusters (communities) using graph analytics algorithms. When run in `--deep-research` mode, the LLM recursively follows the graph structure of top-level clusters and builds a comprehensive architectural analysis based on technical structure and semantic signals. The output is genrated in Markdown format at `output/graph_cluster_report_<timestamp>.md`.

**Agentic code generation**

- `.claude/skills/fm-generate-script` — Provides reference-driven FileMaker script generation. It includes a seven-phase validation pipeline with linting against machine-readable FileMaker syntax and grammar definitions. It also maps referenced object IDs to known objects in the solution's DuckDB catalog. This produces robust, context-aware generated code artifacts.

**Lookup documentation and explain features**

- `.claude/skills/filemaker-function-reference` — Looks up Claris FileMaker documentation through a fast and reliable local cache and database index.
- `.claude/skills/mbs-function-reference` — Looks up MBS plugin documentation through a fast and reliable local cache and database index.

### Plugin registry

`.fmlab/` — Registry and preferences for FM-Lab plugins.

### Scripts (Output)

`scripts/` — Reserved for generated FileMaker scripts produced by agentic coding workflows.

---

## Local servers

### REST API

Provides a local HTTP server at `http://localhost:3003`

Manual start:
Use this option for custom setups, such as running the REST APl as a standalone service.

```bash
cd rest-api
cp .env.example .env   # adjust ports if needed
npm run dev
```

### Web Client

Provides a local HTTP server at `http://localhost:5173`

**Automatic startup**
Both servers are started and stopped with the corresponding scripts:
`tools/start-servers.sh`
`tools/stop-servers.sh`

**Important**
npm dependencies and shared packages must be set up in advance by the init script:
`tools/init.sh`

**Manual startup**
Use this option for active frontend development only.

```bash
cd apps/web
cp .env.example .env   # adjust VITE_API_URL if API runs on a different port
npm run dev
```
