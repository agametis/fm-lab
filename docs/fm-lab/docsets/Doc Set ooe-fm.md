# Doc Set: ooe-fm

**ooe-fm** ("One of Everything") is a community reference solution that tries to contain at least one example of every FileMaker element type and configuration variant — together with SaXML exports of the same file across many FileMaker versions. In FM-Lab it serves as the **test corpus for the XML converter** and as material for exploring the SaXML format.

|                         |                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**              | optional — entirely optional, used only for converter testing and format exploration                                                                                |
| **Original source**     | [github.com/mislavkos/ooe-fm](https://github.com/mislavkos/ooe-fm)                                                                                                  |
| **Copyright / license** | © Mislav Kos · MIT license                                                                                                                                          |
| **Storage directory**   | `docs/ooe-fm/` (full git clone)                                                                                                                                     |
| **Source format**       | git repository                                                                                                                                                      |
| **Installed format**    | repository as-is: `.fmp12` files + SaXML XML exports + helper scripts                                                                                               |
| **Scope**               | 2 FileMaker files (`Ooe.fmp12`, `BrojDva.fmp12`) · 46 SaXML exports covering SaXML 2.0.0.0–2.2.3.0 (FileMaker 18–22), in UTF-8, UTF-16LE and depth-limited variants |
| **Index DB**            | none                                                                                                                                                                |
| **Rubrics**             | none                                                                                                                                                                |
| **Pseudo object types** | none                                                                                                                                                                |

## Description

Not a documentation mirror but a **reference corpus**: the value lies in knowing what a given element looks like in SaXML, verified against real FileMaker output across the whole version range. The export series makes format evolution directly diffable — the same solution serialized by every SaXML version from FileMaker 18 through 22, including `-ddr_info` variants.

FM-Lab uses it in two ways:

- **Converter testing.** The `test-convert-xml` skill provisions its fixtures from this clone and runs the full ingestion pipeline against them into an isolated test database (`db/fm_test.duckdb`) — the production catalog stays untouched.
- **Format exploration.** When the [XML schema documentation](../xml/XML.md) leaves a question open, the exports show ground truth: import one into a scratch solution or read the XML directly.

Because it is a plain repository clone, it is not registered in the docs catalog and does not appear in the web frontend.

## Installation

- **Skill** — `install-ooe-fm`; checks the upstream commit and prompts before updating (`git pull`), `--force` re-clones.
- **CLI** — `.claude/skills/install-ooe-fm/scripts/install_ooe_fm.sh` (interactive; `--force` only).
- **Web frontend** — not available; this set is skill/CLI-only.

## Usage

- **Skill** — `test-convert-xml` runs the isolated converter test against these fixtures.
- **CLI / agents** — read the SaXML exports under `docs/ooe-fm/saxml_utf8/` directly, or run them through the [XML conversion](../Wiki/katana-engine.md) into a test database.
- **Web frontend** — none.

## See also

- [Doc Sets](Doc%20Sets.md) — the doc-set overview
- [katana-engine](../Wiki/katana-engine.md) — the XML conversion this corpus tests
- [XML](../xml/XML.md) — the SaXML structure documentation
