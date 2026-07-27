# Doc Set: fm-lab

The FM-Lab manual itself — the documentation you are reading right now. It ships with every release under `docs/fm-lab/` and is registered in the docs catalog, so the web frontend can serve it as browsable inline help alongside the external doc sets.

| | |
|---|---|
| **Status** | built-in — shipped with every release |
| **Original source** | this repository — authored and maintained alongside the code |
| **Copyright / license** | © Marcel Moré (FM-Lab) · MIT license |
| **Storage directory** | `docs/fm-lab/` |
| **Source format** | Markdown, authored as an Obsidian vault with wiki-links |
| **Installed format** | standard Markdown + assets (wiki-links converted at publish time) |
| **Scope** | ~35 pages in 7 sections (Wiki, schema, REST API, templates, XML, doc sets) |
| **Index DB** | none |
| **Rubrics** | none — the folder structure is the navigation |
| **Pseudo object types** | none |

## Description

The manual covers the concepts ([Introduction](../Wiki/Introduction.md), [Architecture](../Wiki/Architecture.md), [How it works](../Wiki/How%20it%20works.md)), the operational guides ([Installation](../Wiki/Installation.md), [Quickstart](../Wiki/Quickstart.md), [Troubleshooting](../Wiki/Troubleshooting.md)) and the specifications ([Schema](../schema/Schema.md), [XML](../xml/XML.md), [REST API Overview](../rest-api/REST%20API%20Overview.md), [fm-spec](../Wiki/fm-spec.md), [Doc Sets](Doc%20Sets.md)). [Documentation](../Documentation.md) is the entry point with the full table of contents.

As a doc set it is deliberately simple: plain Markdown files crawled by the filesystem adapter (`markdown-fs`), no index database, no category schema — each page stands for itself.

## Installation

None. The doc set is part of the release and always present; it is updated together with FM-Lab itself.

## Lookup and browsing

- **Web frontend** — browsable under `/docs/fm-lab`, served through the `/api/docs` endpoints.
- **Agents** — read the Markdown files under `docs/fm-lab/` directly when a question concerns FM-Lab itself.
- **GitHub** — the same pages render directly in the public repository.

## See also

- [Doc Sets](Doc%20Sets.md) — the doc-set overview
- [Documentation](../Documentation.md) — the manual's table of contents
