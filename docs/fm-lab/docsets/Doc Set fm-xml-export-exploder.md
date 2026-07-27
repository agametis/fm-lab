# Doc Set: fm-xml-export-exploder

The source repository of **fm-xml-export-exploder**, a fast Rust CLI tool that splits FileMaker XML exports into individual per-object text files — scripts in a human-readable form, layouts, custom functions and table definitions each in their own file, organized like the FileMaker workspace. Cloned locally as reference material.

| | |
|---|---|
| **Status** | optional — entirely optional, for reference and local testing |
| **Original source** | [github.com/bc-m/fm-xml-export-exploder](https://github.com/bc-m/fm-xml-export-exploder) |
| **Copyright / license** | © Malte Bastian · MIT license |
| **Storage directory** | `docs/fm-xml-export-exploder/` (full git clone) |
| **Source format** | git repository |
| **Installed format** | repository as-is: Rust sources (`src/`), test fixtures and snapshot outputs (`tests/`) |
| **Scope** | tool source code — no documentation entries |
| **Index DB** | none |
| **Rubrics** | none |
| **Pseudo object types** | none |

## Description

The exploder takes a different route through the same input FM-Lab ingests: where the [FM-Lab converter](../Wiki/katana-engine.md) builds a queryable object catalog in DuckDB, the exploder extracts the XML into a **file tree** — one text file per script, layout or function — aimed at Git versioning and text diffing of FileMaker solutions.

That makes the clone useful in two ways:

- **Reference implementation.** An independent, battle-tested parser of the same SaXML format — its source and its snapshot test fixtures (real exports next to their expected extraction results) are valuable cross-checks when investigating XML edge cases.
- **Complementary tooling.** For workflows that want a diffable file tree rather than a database, the tool can be built and run locally per the upstream README.

Because it is a plain repository clone, it is not registered in the docs catalog and does not appear in the web frontend.

## Installation

- **Skill** — `install-fm-xml-export-exploder`; checks the upstream commit and prompts before updating (`git pull`), `--force` re-clones.
- **CLI** — `.claude/skills/install-fm-xml-export-exploder/scripts/install_fm_xml_export_exploder.sh` (interactive; `--force` only).
- **Web frontend** — not available; this set is skill/CLI-only.

## Usage

- **Agents** — read the sources and test fixtures under `docs/fm-xml-export-exploder/` when comparing parser behaviour.
- **CLI** — build and run the tool per the upstream README (`fm-xml-export-exploder <input-dir> <output-dir>`).
- **Web frontend** — none.

## See also

- [Doc Sets](Doc%20Sets.md) — the doc-set overview
- [katana-engine](../Wiki/katana-engine.md) — FM-Lab's own XML ingestion
- [Doc Set ooe-fm](Doc%20Set%20ooe-fm.md) — the SaXML reference corpus
