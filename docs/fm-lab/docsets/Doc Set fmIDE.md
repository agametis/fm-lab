# Doc Set: fmIDE

The documentation wiki of **fmIDE**, the FileMaker developer-tooling project FM-Lab integrates with for deep links into FileMaker Pro (the *Name that Thing* API) and for ActionScript-based code delivery.

|                         |                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| **Status**              | recommended — install on demand                                                                |
| **Original source**     | [github.com/fmIDE/fmIDE/wiki](https://github.com/fmIDE/fmIDE/wiki) — the project's GitHub wiki |
| **Copyright / license** | © Russell Watson, the fmIDE project — project repository under MIT license                     |
| **Storage directory**   | `docs/fmIDE/`                                                                                  |
| **Source format**       | git clone of the wiki repository                                                               |
| **Installed format**    | Markdown pages + `images/` (used as-is)                                                        |
| **Scope**               | 19 wiki pages                                                                                  |
| **Index DB**            | none — filesystem crawl                                                                        |
| **Rubrics**             | none — each page stands for itself                                                             |
| **Pseudo object types** | none                                                                                           |

## Description

The wiki covers fmIDE's installation and setup, the *Name that Thing* API (including its `fmp://` URL forms and parameters), deep linking, ActionScripts, naming conventions and troubleshooting. Within FM-Lab it is the grounding material for the fmIDE touchpoints:

- the **fm-open** skill, which opens the object under discussion directly in FileMaker Pro through an fmIDE `fmp://` URL,
- the **ActionScript** delivery path of the code-generation pipeline, whose action vocabulary is mapped in [fm-spec](../Wiki/fm-spec.md) (`action_catalog`, `step_action_map`).

Having the wiki local means the agent can answer fmIDE questions (URL syntax, parameter names, setup steps) from the authoritative source while offline.

## Installation

- **Skill** — `install-fmide-docs`; checks the upstream commit and prompts before replacing.
- **CLI** — `.claude/skills/install-fmide-docs/scripts/install_fmide_docs.sh` with `--check` and `--force`.
- **Web frontend** — the Docs pages install and update the set via `POST /api/docs/install/fmide` with live progress.

## Lookup and browsing

- **Skill** — no dedicated lookup skill; the agent reads the Markdown pages under `docs/fmIDE/` directly when fmIDE questions come up.
- **CLI** — plain files: open or search `docs/fmIDE/*.md`.
- **Web frontend** — the docs browser at `/docs/fmide` lists and renders the wiki pages.

## See also

- [Doc Sets](Doc%20Sets.md) — the doc-set overview
- [fm-spec](../Wiki/fm-spec.md) — the action layer mapping fmIDE actions to script steps
