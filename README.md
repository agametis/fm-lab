# FM-Lab: AI Agent Coding Harness for FileMaker

Reliable FileMaker development starts with a shared understanding of FileMaker principles and the structure of the solution at hand — for both humans and AI agents.

FM-Lab provides that foundation by converting **FileMaker SaXML exports** into a queryable **DuckDB** catalog. It turns the XML structure of a FileMaker solution into a fast, in-memory digital twin — covering all object types and their dependencies — for deep cross-reference analysis, documentation, and AI-assisted development at scale.

![FM-Lab](Banner.jpg)

**[⚡ QUICKSTART](#-quickstart)** — from clone to catalog in five steps.

## Highlights

> “Using **agentic analytics** with FM-Lab feels less like searching through metadata and more like asking a senior developer who already understands the structure of the solution in every little detail.”

> “DuckDB is a key enabler here. Its role in this architecture is hard to overstate. It turns code analysis from digging through static files into querying a live map of the solution in memory. **This RAM-accelerated, in-process architecture** removes the drag of disk-heavy workflows and makes **deep catalog and graph analysis** practical.”

> “The Katana-XML engine delivers **a major leap in conversion speed**, making large FileMaker catalogs practical to analyze interactively in fast iteration cycles.”

## Prologue

FileMaker development is facing a new paradigm: **solution structure must be readable and understandable by both humans and AI agents**. While many major programming environments have well-established ecosystems for code analysis, documentation and refactoring, FileMaker's proprietary format makes it hard to participate in that ecosystem — there is no native API to query a solution's structure programmatically.

Several tools try to bridge this gap. Some serve human developer workflows very well, but many are not designed for scalable, agent-driven analysis or open extension. Most are closed source, which limits their adaptability in a rapidly evolving landscape.

This project takes a different approach. It converts the structure of a FileMaker solution — exported as SaXML — into a queryable DuckDB database. The relevant object types (scripts, fields, layouts, relationships, value lists, and more) land in dedicated tables, with **a universal catalog that links objects and their dependencies across the entire solution**. DuckDB's in-process engine makes this catalog fast enough for both interactive queries and **AI-driven analysis at scale**, without any database server setup. A REST API and a web client provide additional access layers for GUI and integration workflows.

The first release focuses on this core: reliable **XML conversion**, a comprehensive **object catalog,** and a modular architecture that is open source and **designed for extension**. Future releases will build on this foundation — the long-term goal is to become a solid developer tooling platform for the FileMaker space.

**Addendum:** [Claris has announced upcoming agentic coding functionality for FileMaker](https://www.claris.com/blog/2026/how-claris-is-building-for-what-comes-next) for the upcoming releases. This does not contradict the goals of this project, but rather emphasizes the need for a solid foundation for code analysis and tooling in the FileMaker ecosystem. The architecture of fm-lab is designed to be flexible and adaptable, so it can integrate with Claris's AI coding features as they evolve, while also providing value to developers who want to leverage AI tools in their workflows today.

## Analysis workflows

FM-Lab supports four complementary approaches to analyzing a FileMaker solution:

- **Interactive exploration** - browse the solution through a web frontend with rich navigation, visualizations, and drill-down views
- **Static code analysis** - detect known patterns, issues, and structural signals through targeted catalog queries
- **Graph-based analysis** - inspect object relationships using graph algorithms, visual maps, and LLM-assisted reasoning
- **Agent-based analysis** - give AI agents direct, structured access to the knowledge graph, metadata, and documentation context

## Features

- **XML Ingestion Pipeline** — converts FileMaker XML exports into a DuckDB database using a flexible SQL template system, designed for easy maintenance and updates as FileMaker evolves ♻️
- **Katana-Engine** — XML chunking and streaming for processing massive catalogs with minimal memory usage and maximum parallelism 🔪
- **Detailed Object Catalog** — detailed tables for the relevant FileMaker object types, combined with a universal catalog that links objects and their dependencies for fast cross-reference queries 🔗
- **Detailed Reference Catalog** — localized tables for documented FileMaker script steps and functions, providing reference queries and inline help docs across up to 11 locales 📄
- **DuckDB Backend** — in-process analytical database engine for fast and flexible queries without server setup, often delivering results in milliseconds, even for large solutions 🚀
- **REST API** — Express server providing HTTP access to the analysis database, enabling integration with external tools and services 🧩
- **Web Client** — React/Vite frontend for interactive exploration of the solution structure and dependencies with rich visualizations 🔎
- **Dashboard System** — library of predefined analysis patterns, with support for custom queries and custom dashboards 📁
- **Graph Explorer** — interactive navigation of the full object graph, with automatic community detection that reveals named clusters across the solution and turns thousands of objects and links into a navigable graph map 🕸️
- **Claude Skills** — slash commands for agentic analysis workflows in Claude Code, supported by helpers for XML conversion and documentation setup, enabling deep, solution-aware inspection beyond scripted analysis 🤖
- **Comprehensive Docs** — easy-to-install documentation for FileMaker Pro and MBS plugin functions 📚
- **Plugin System** — open architecture for adding new tools and integrations, starting with **[fmIDE](https://github.com/fmIDE/fmIDE)** as a first-class citizen to provide direct navigation into FileMaker's Script Workspace 🛠️
- **Prepared for AI code generation** — architecture and data model designed to support AI-driven code generation, augmented by reliable context from the object catalog and the integrated documentation 🧠

## [Architecture](docs/fm-lab/Wiki/Architecture.md)

[![Architecture](docs/fm-lab/Assets/FM-Lab-base-Architecture.jpg)](docs/fm-lab/Wiki/Architecture.md)

```
SaveAsXML → Parser → DuckDB → REST API ←→ Tools
                                       ←→ UI
                                       ←→ AI Agent
```

## [How it works](docs/fm-lab/Wiki/How%20it%20works.md)

Learn how FM-Lab turns FileMaker XML exports into a structured Object Catalog and uses it as the foundation for analysis, documentation lookup, and agentic workflows. The walkthrough explains the layers of the stack, the flow from ingestion to interaction, and why this architecture is different from simple text-based RAG approaches.

## [Components](docs/fm-lab/Wiki/Components.md)

- **XML (Input)** (`xml/`) — FileMaker XML exports (SaXML) prepared for conversion from your solution.
- **SQL Templates** (`sql/`) — Conversion templates and parser templates for universal catalogs.
- **DuckDB Catalog** (`db/`) — The generated DuckDB database containing the extracted FileMaker objects and their relationships.
- **REST API** (`rest-api/`) — Express server for HTTP access to the analysis database.
- **Web Client** (`apps/web/`) — React/Vite frontend
- **Tools** (`tools/`) — Utility scripts for various tasks.
- **Docs** (`docs/`) — Documentation files for FileMaker Pro and MBS plugin functions, installable via Web frontend or Claude Skills.
- **Claude Skills** (`.claude/skills/`) — Contains Claude Code skills and slash commands for installation, conversion, lookup and analysis.
- **Plugin registry** (`.fmlab/`) — Registry and preferences for FM-Lab plugins.

## ⚡ Quickstart

The only prerequisite on your machine is **[Docker](https://docs.docker.com/get-docker/)** — Batteries already included: DuckDB, NodeJS, PATH setup.

```bash
# 1 · Clone
git clone https://github.com/marcel-more/fm-lab.git
cd fm-lab

# 2 · Start (first run builds everything, ~2–3 min)
docker compose up
```

3. **Drop your FileMaker XML export** into the `xml/` folder of the cloned repo.
   _(FileMaker Pro ▸ Tools ▸ Save a Copy as XML — enable “Include details for analysis tools”; one file per solution file.)_
4. Open the web client at **http://localhost:5173** and **start the conversion** — one button, live progress, no terminal needed.
5. **Done.** Explore the object catalog, dependencies and the Graph Explorer.

<b>… with a sandboxed AI agent (Claude Code)</b>

```bash
# Start the agent-enabled stack
docker compose -f docker-compose.yml -f docker-compose.claude.yml up

# Open the agent and sign in once. Claude Code runs INSIDE the container
# (`which claude` on the host is empty by design); the login then persists.
docker compose exec -it api claude
#   → choose "Claude account with subscription", complete the browser sign-in, then just ask Claude about your FileMaker solution or run a skill command:
#       "List all scripts that write to the Orders table"
#       /fm-analyze "Invoice Import"
```

> **The sign-in URL wraps across several terminal lines — don't select it by hand.**
> A truncated URL fails in the browser with _"Invalid response_type"_ or _"Unknown scope"_.
> Press **`c`** to copy it, **or** paste it into a text
> editor and remove every line break — a URL never contains spaces — before opening it.
> Sign in, then paste the shown code back at the `Paste code here` prompt.
>
> **No browser at hand?** Put credentials in a `.env` next to the compose files instead —
> `ANTHROPIC_API_KEY=…` (API-key billing) or `CLAUDE_CODE_OAUTH_TOKEN=…` (from
> `claude setup-token`) — then just run `docker compose exec -it api claude`.

→ Native install, performance tuning and Windows/WSL2 notes: see **[Setup](#setup)** below.

## Compatibility

There are two ways to run FM-Lab:

- **Docker (recommended, all platforms)** — a self-contained container ships every prerequisite (DuckDB CLI, the webbed extension, Node/npm, the Leiden clustering engine) in the right version. The host needs **only Docker** — no DuckDB, no Node, no PATH setup. This is the fastest path to **Windows** support too: the entire POSIX shell layer runs inside the Linux container, so the host OS no longer matters. See [Setup with Docker](#setup-with-docker-recommended).
- **Native (macOS / Linux, power users)** — run the orchestration scripts directly on the host. Ready today for **macOS** and **Linux**; native Windows would need shell-script adjustments (which the Docker path sidesteps entirely).

All base technologies (DuckDB, Node.js, Express, React) are cross-platform.

> **Windows note:** use **Docker Desktop with the WSL2 backend**, and keep the cloned repository **inside the WSL2 distribution** (e.g. under `~/projects/…`), **not** on the Windows drive (`/mnt/c/…`). A repo on `/mnt/c` suffers slow bind-mount performance and file-watcher (inotify) problems. Inside WSL2 the bind mount is fast and reliable.

FileMaker XML exports are supported on all platforms where FileMaker Pro is available. The conversion process relies on the structure of the **SaXML** export from **FileMaker Versions 19 and above**. Future updates of FileMaker may require adjustments to the XML parsing.

## Prerequisites for the Analysis Tool (Standalone via GUI or REST API)

- [DuckDB CLI](https://duckdb.org/docs/installation/) ≥ 1.5.4
- The **webbed** community extension for DuckDB (the XML reader). `tools/init.sh` installs it automatically when missing.
- Node.js ≥ 20, npm ≥ 10
- FileMaker Pro (for the SaXML export, SaXML v2.1.0.0+ / FileMaker 19+)

## Prerequisites for Analysis with Claude Code

- [Claude Code](https://docs.claude.com/en/docs/claude-code)
- [duckdb-skills](https://github.com/duckdb/duckdb-skills) plugin for Claude Code (recommended — DuckDB documentation lookup and query assistance)

## Preparing the XML Export

Export your FileMaker solution as XML via `Tools > Save a Copy As XML` (SaXML) in FileMaker Pro. This export contains the full structure of your solution, including scripts, fields, layouts, relationships, value lists, and more — all of which will be parsed and stored in the DuckDB catalog for analysis by FM-Lab. Repeat this for every file of your solution (e.g. if you have multiple files in a multi-file solution). The XML export is the core input for FM-Lab, so it's important to ensure that it is up to date with your current solution structure.

You may want to automate this export process with a script using [Script step: Save a Copy as XML](https://help.claris.com/en/pro-help/content/save-a-copy-as-xml.html) for every file of your solution.

**Important:** Make sure to activate the option "Include details for analysis tools" when saving the XML export, this includes valuable metadata for analysis.

## Setup

```bash
# Clone the repository
git clone https://github.com/marcel-more/fm-lab.git
cd fm-lab
```

(Windows: clone **inside** your WSL2 distribution — see the [Windows note](#compatibility) above.)

### Setup with Docker (recommended)

The only prerequisite on the host is **[Docker](https://docs.docker.com/get-docker/)** (Docker Desktop on macOS/Windows, Docker Engine on Linux) — no DuckDB, no Node, no PATH setup. From the repository root:

```bash
docker compose up
```

This builds the image (DuckDB CLI + webbed extension + Node/npm + Leiden clustering engine, all pinned to tested versions) and starts both servers:

- **Web Client** → http://localhost:5173
- **REST API** → http://localhost:3003

Then prepare and convert your data:

1. Put all files of your FileMaker SaXML export into the `xml/` directory.
2. Convert — either click **XML conversion** in the web client, or run:
   ```bash
   docker compose exec api bash tools/convert_fm_xml.sh --batch
   ```
   (Or, as a one-shot job off the running stack: `docker compose run --rm ingestion`.)

Your catalog (`db/`), conversions and local settings live in the cloned repo **on the host**, so they survive container restarts. Updating is a plain `git pull` — no rebuild needed, because the repo is mounted into the container, not baked into the image.

**Tuning (optional):** create a `.env` file next to `docker-compose.yml` to override the defaults:

```bash
FMLAB_MEM_LIMIT=8g        # per-container RAM cap (raise for very large solutions)
FMLAB_DUCKDB_THREADS=4    # DuckDB thread cap (raise on hosts with more cores)
```

### Setup natively (power users)

If you prefer to run without Docker (macOS / Linux), install the [prerequisites](#prerequisites-for-the-analysis-tool-standalone-via-gui-or-rest-api) yourself, then place your XML export in `xml/` and run:

```bash
bash tools/init.sh
```

`init.sh` checks prerequisites, installs dependencies, sets up environment files, converts the XML export, and starts the local Node.js-servers — all in one step. It prints clear instructions if anything is missing.

### With Claude Code (optional)

A second container variant adds the **[Claude Code](https://docs.claude.com/en/docs/claude-code)** CLI on top of the same tool — ready to go, with the [duckdb-skills](https://github.com/duckdb/duckdb-skills) plugin bundled and a persistent login. The only manual step is providing credentials.

- **VS Code:** "Dev Containers: Reopen in Container" → pick **fm-lab + Claude Code**.
- **Plain Docker:** start with both compose files:
  ```bash
  docker compose -f docker-compose.yml -f docker-compose.claude.yml up
  # then start the agent (it runs inside the container):
  docker compose exec -it api claude
  ```

On first launch choose **"Claude account with subscription"** and complete the browser sign-in once — the login then persists across restarts in a named volume. The terminal sign-in URL wraps across lines, so copy it with **`c`** (OSC-52 terminals such as iTerm2) or repair it in a text editor (remove every line break) rather than selecting it by hand; a truncated URL fails with _"Invalid response_type"_ / _"Unknown scope"_. Alternatively provide credentials non-interactively via a `.env`: `ANTHROPIC_API_KEY` (API-key billing) or `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`). No secret is ever stored in the image.

This variant also grants the capabilities for an **opt-in egress firewall** that restricts outbound traffic to a small allowlist (npm, GitHub, the Anthropic API, the DuckDB extension host, the VS Code marketplace). It is applied automatically in the VS Code variant; without it, Claude Code's permission prompts remain your safeguard.

## Day-to-day

Once `init.sh` has run successfully, start both servers with:

```bash
bash tools/start-servers.sh
```

To start the XML conversion step, use the skill `/convert-xml` or run:

```bash
# Import all XML files from xml/

# turbo = streaming mode + only changed catalogs are processed
bash tools/convert_fm_xml.sh --turbo
# batch = standard mode
bash tools/convert_fm_xml.sh --batch

# Import a single file
bash tools/convert_fm_xml.sh "MyDatabase.xml"
```

You can also run the conversion straight from the web client: the **XML conversion** dashboard imports all files from `xml/` by button press, with live progress and a persistent log — no terminal required.

### Manual start (power users)

For custom setups — e.g. running the REST API as a standalone service:

```bash
# REST API (port 3003)
cd rest-api
cp .env.example .env   # adjust ports if needed
npm run dev

# Web Client (port 5173)
cd apps/web
cp .env.example .env   # adjust VITE_API_URL if API runs on a different port
npm run dev
```

## Further Documentation

- [`Documentation.md`](docs/fm-lab/Documentation.md) — Full project documentation (work in progress)
- [`CLAUDE.md`](CLAUDE.md) — includes documentation on tables, columns, and query patterns

## Optional Reference Data

Test data and tools for fm-lab developers are available for validation (will be downloaded from their source repositories by Claude skills on demand):

```bash
# ooe-fm — "One Of Everything" FileMaker reference database (XML parser test data)
#   /install-ooe-fm

# fm-xml-export-exploder — Rust tool for splitting FileMaker XML exports
#   /install-fm-xml-export-exploder
```

## Status

The project has grown along a clear arc — from a solid foundation toward an increasingly capable, accessible developer platform:

- **v0.1 – v0.5** · _Foundation_ — the XML conversion pipeline, the DuckDB
  object catalog, and the first AI skills.
- **v0.6.x** · _Access & exploration_ — REST API, web client, and a plugin architecture turn the catalog into an interactive surface.
- **v0.7.0 – v0.7.1** · _Dashboards_ — declarative, data-driven views as a first-class extension layer.
- **v0.7.2** · _Internationalization_ — the whole stack opens up to non-English developers, with all technical identifiers kept intact.
- **v0.7.3 – v0.7.7** · _Depth & reach_ — deeper analysis, integrated documentation sets, and the XML import moving into the browser.
- **v0.8.0 – v0.8.2** · _Katana XML engine_ — optimized and powerful XML ingestion.
- **v0.8.3 – v0.8.5** · _Graph-based analysis_ — community detection, semantic naming, and an interactive Graph Explorer.
- **v0.8.6** · _Docker installer_ - including all dependencies for easy setup. Experimental Windows support via Docker on WSL2.
- **v0.8.7 – v0.8.8** · _Static code analysis_ - predefined inspection queries for standard checks, completion of the object catalog, and expanded reference coverage.

- More details in [`CHANGELOG.md`](CHANGELOG.md) — release history

The core architecture is in place and ready for real-world use. Many more features are under active development — stay tuned for updates! 😎

## Roadmap

- Pre-configured installer with granular framework update options (beta with v0.8.6)
- Windows support (early alpha with v0.8.6)
- Granular deployment options for separate ingestion, API, and frontend services
- Multi-user mode
- Multi-solution support
- Snapshots for tracking changes over time
- Deeper integration with developer tools and workflows, including VS Code, Raycast, Obsidian, and others
- Support for additional AI agents and agent configuration formats
- AI-assisted code generation, refactoring, and documentation based on the object catalog

## Vision

_One interface to rule them all — in your personal style of workflow:_

- Your FileMaker Solution
- Your Favorite Tools
- Your Agent
- Your Project Docs
- All FileMaker-related docs and knowledge
- All possible extensions
- All in one Interface

## Fine Print

### AI-assisted development

This project was developed with significant support from AI-assisted development workflows, including Claude Code.

Spec-driven development with AI agents is used as a best practice together with human oversight and decision-making to ensure that the project remains aligned with its goals and maintains a clean architecture.

All changes were reviewed, selected, and integrated by the project maintainer.

### Disclaimer

This software is provided "as is", without warranty of any kind, express or implied. No guarantees are made regarding completeness, functionality, or stability. The authors accept no liability for data loss or unintended interactions with the user's environment. Use at your own risk.

### License

MIT — see [`LICENSE`](LICENSE).
