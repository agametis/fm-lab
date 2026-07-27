# Doc Set: duckdb

The official **DuckDB documentation** as a single-file local mirror — kept as a **fallback**: the primary way to look up DuckDB syntax in FM-Lab is the official DuckDB docs plugin skill, not this doc set.

| | |
|---|---|
| **Status** | recommended as fallback — install only if the docs plugin skill is unavailable |
| **Original source** | [duckdb.org](https://duckdb.org/docs) — official single-file build (`blobs.duckdb.org/docs/duckdb-docs.md`) |
| **Copyright / license** | © the DuckDB project — documentation source ([duckdb-web](https://github.com/duckdb/duckdb-web)) under MIT license |
| **Storage directory** | `docs/duckdb/Documents/duckdb-docs.md` |
| **Source format** | single Markdown file (~6 MB) |
| **Installed format** | Markdown (used as-is) + `.version` marker |
| **Scope** | 1 file — the complete DuckDB documentation and guides |
| **Index DB** | none |
| **Rubrics** | none |
| **Pseudo object types** | none |

## Fallback to the official DuckDB docs plugin

FM-Lab's recommended lookup path for DuckDB SQL syntax is the **`duckdb-docs` skill from the official [duckdb-skills](https://github.com/duckdb/duckdb-skills) plugin** (shipped with the FM-Lab Docker image). It provides on-demand, indexed search over a self-refreshing local documentation store — strictly better for agent lookups than scanning a 6 MB Markdown file.

**Install this doc set only when that plugin skill is not available** in your setup. When the plugin is present, the local mirror is redundant for agent lookups; its one remaining purpose is feeding the web frontend's Docs card. The installer detects an installed plugin and warns before downloading, but does not refuse.

## Description

The mirror is the vendor's official single-file documentation build — all DuckDB docs and guides concatenated into one searchable Markdown document with stable heading anchors. There is no index database, no category schema and no pseudo-object integration: as a fallback it is meant for full-text search, not structured retrieval.

## Installation

- **Skill** — `install-duckdb-docs`; warns if the docs plugin is already present, prompts before replacing.
- **CLI** — `.claude/skills/install-duckdb-docs/scripts/install_duckdb_docs.sh` with `--check` (also reports whether the plugin is present) and `--force`.
- **Web frontend** — the Docs pages install and update the set via `POST /api/docs/install/duckdb`.

## Lookup and browsing

- **Skill** — primary: the `duckdb-skills:duckdb-docs` plugin skill. Fallback: search the local file `docs/duckdb/Documents/duckdb-docs.md`.
- **CLI** — full-text search over the single Markdown file.
- **Web frontend** — appears as a Docs card (install status and updates); the content itself is not indexed for browsing.

## See also

- [Doc Sets](Doc%20Sets.md) — the doc-set overview
- [Dependencies](../Wiki/Dependencies.md) — DuckDB's role in the FM-Lab stack
- [duckdb-skills](https://github.com/duckdb/duckdb-skills) — the official plugin providing the recommended `duckdb-docs` skill
