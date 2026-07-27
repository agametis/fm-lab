# Doc Set: agents

The agent-facing knowledge base: reference documents that the AI agent loads on demand while working on your solution. `CLAUDE.md` (the system prompt) keeps only the operating rules and points to these files for everything deep — schema details, pipeline internals, canonical query patterns, code-generation protocols.

| | |
|---|---|
| **Status** | built-in — tracked in git, shipped with every release |
| **Original source** | this repository — maintained alongside the code it describes |
| **Copyright / license** | © Marcel Moré (FM-Lab) · MIT license |
| **Storage directory** | `docs/agents/` |
| **Source format** | Markdown |
| **Installed format** | Markdown (used as-is) |
| **Scope** | 10 reference documents |
| **Index DB** | none |
| **Rubrics** | none |
| **Pseudo object types** | none |

## Description

The set covers, per file:

- `schema-reference.md` — all catalog tables, column details and the 59 link roles
- `analysis-workflows.md` — canonical analysis patterns (where-used, dead code, cross-file dependencies) and their pitfalls
- `query-cookbook.md` — prepared catalog queries and DuckDB idioms
- `pipeline-reference.md` — ingestion pipeline phases, analysis views, DB sync and locking
- `xml-schema.md` / `xml-schema-extended.md` — structure of the FileMaker XML exports
- `codegen-workflows.md` / `codegen-registry.md` — code-generation protocol and the skill registry
- `synthetic-uuids.md` — how synthetic object UUIDs are formed
- `tooling.md` — DuckDB binary resolution, server ports, install notes

Unlike every other doc set, this one is **not** registered in the docs catalog and does not appear in the web frontend's docs browser: its audience is the agent, its entry point is the system prompt. That also makes it the ideal place to look when you want to understand *how* the agent reasons about your solution.

## Installation

None. The files are tracked in git and always present.

## Lookup and browsing

- **Agents** — loaded selectively via the pointers in `CLAUDE.md` (e.g. schema questions → `schema-reference.md`).
- **Humans** — readable directly in the repository; the user-facing counterparts live in this manual ([Schema](../schema/Schema.md), [XML](../xml/XML.md), [Ingestion Pipeline (XML Import)](../templates/Ingestion%20Pipeline%20%28XML%20Import%29.md)).

## See also

- [Doc Sets](Doc%20Sets.md) — the doc-set overview
- [Components](../Wiki/Components.md#agent-framework) — the agent framework in the component overview
