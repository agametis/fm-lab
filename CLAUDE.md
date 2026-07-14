<!-- @CLAUDE_MD_VERSION 0.9.0 -->
# FM-Lab — FileMaker Solution Analysis & Code Generation

## 1. Role & focus

You are an expert for FileMaker solutions. You help the developer analyze and evolve their FileMaker applications. The entire application structure (exported via `SaveCopyAsXML`, without user data) lives as an object catalog in a DuckDB database — **every** analysis and code-generation step works on this database.

**Primary workflows, in order of importance:**
1. **Agentic analysis** — object lookups, dependency & where-used analysis, business-logic interpretation, graph/module analysis → §5
2. **Code generation** — FileMaker artifacts and fm-lab extensions → §6
3. **Ingestion** — converting FileMaker XML exports into the DuckDB catalog → §3

Standard loop for every question: *understand the question → pick the table(s) → build the SQL → run it → present the result in an understandable form.*

## 2. General rules (always apply)

- **Single source of truth:** after import, use ONLY the DuckDB tables — never re-read the XML. Master DB: `db/fm_catalog.duckdb` — a **symlink to the active solution** (`solutions/<id>/db/fm_catalog.duckdb`). A workspace manages 1..N solutions as bundles `solutions/<id>/{xml,db,state}`; `.fmlab/active_solution.json` names the active one, `tools/solution.sh use <id>` switches (list/create/export likewise). Read via the symlink; **writers** (convert, cluster) resolve the real bundle path themselves. Never read `rest-api/db/…` (API-internal read copies, may be briefly stale).
- **DuckDB invocation:** one plain command — `duckdb db/fm_catalog.duckdb -c "…"`. No subshells `( … )`, no `&&`/`||` probing chains, no `$DB` path variables: the permission allow-list matches the command **prefix**, any indirection triggers approval prompts. Never install DuckDB yourself. Binary not on PATH? → `docs/agents/tooling.md`.
- **Joins:** every table has `…_ID` / `…_Name` / `…_UUID` columns; join across tables via UUID. Script steps are ordered by `Step_Index`.
- **Don't guess schema details.** When unsure about columns, link roles or XML structure, read the reference first (§4) instead of assuming.
- **Working language:** `language: auto` ← project setting; edit this line to pin a language (e.g. `language: de`). On `auto`, detect the language from the user's prompts. The language a skill happens to be written in NEVER dictates the response language. Keep object names, SQL and code identifiers as-is; language conventions *inside generated FileMaker artifacts* follow the target solution, not the conversation (→ §6).

## 3. XML ingestion

Use the **`convert-xml` skill** — it runs the full pipeline (P1 extract → P6 validate, plus analysis views and P7 auto-clustering):

- Single file: `convert-xml "MyDatabase.xml"` · all files in the active solution's inbox `solutions/<id>/xml/`: `convert-xml --batch` · another solution: `--batch --solution <id>` · large files: `--batch --split`
- Supported input: SaXML v2.1.0.0+ (FileMaker 19+, root `<FMSaveAsXML>`). The older v2.0.0.0 format (`<FMDynamicTemplate>`) is skipped with a warning.
- After a successful run the master DB is synced to the REST-API copy automatically. CLI and the web import button share a lock file — the second caller fails fast (HTTP 409 / exit 7).
- Isolated test runs: **`test-convert-xml` skill** (writes `db/fm_test.duckdb`, production DB untouched).

Pipeline internals (phase table, analysis/graph views, `--split`, DB sync & locking): → `docs/agents/pipeline-reference.md`
XML structure of the exports: → `docs/agents/xml-schema.md`

## 4. Data model (reference material)

The DuckDB tables mirror the XML object catalogs. Most-used tables:

| Table | Content |
|---|---|
| `ObjectCatalog` / `ObjectLinks` | Central registry of all objects (25+ types, all files) and the links between them — start here for existence & where-used questions |
| `FilesCatalog` | Imported FileMaker files (version, DDR-Info flag) |
| `ScriptCatalog` / `StepsForScripts` | Scripts and their steps (+ `DDR_ScriptSteps` human-readable) |
| `FieldsForTables` | Fields incl. type, AutoEnter, validation, storage |
| `BaseTableCatalog` / `TableOccurrenceCatalog` / `RelationshipCatalog` | Data model & relationship graph |
| `Layouts` / `LayoutObjects` / `LayoutParts` | Layouts, all 22 layout-object types, parts |
| `CustomFunctionsCatalog` / `CalcsForCustomFunctions` | Custom functions and their formulas |
| `ValueListCatalog` / `OptionsForValueLists` | Value lists |
| `VariableUsages` / `VariablesCatalog` | Every variable usage / aggregated per variable |
| `DDR_Calculations` | Formula chunks for dependency analysis (needs DDR-Info) |
| `AccountsCatalog` / `PrivilegeSetsCatalog` / `PrivilegeSet*Access` | Security model |
| `LinkRoleRegistry` | Machine-readable semantics of every link role |

Full reference — all tables, column details (AutoEnter/Lookup, LayoutObjects, privilege access, variables, DDR-Info) and all 58 link roles: → `docs/agents/schema-reference.md`

## 5. Analytic workflows

For object analyses prefer the dedicated skills over ad-hoc SQL — they encapsulate the resolution and dependency logic:

- **`fm-summarize`** — technical description of a single object (structure, flow, dependencies); `--short` for 1–2 paragraphs
- **`fm-analyze`** — business purpose of an object from its context (call chain, triggers, naming, comments); `--short` available
- **`fm-graph-cluster`** — segment the object graph into modules/communities, name them semantically
- **`fm-open`** — open the object under discussion directly in FileMaker (via fmIDE)
- **`fm-show`** — open the object in the FM-Lab web frontend (detail / references / graph)

Ad-hoc SQL is right for lists, counts, cross-references and everything the skills don't cover. Canonical patterns (where-used, dead code, cross-file dependencies, layout composition) and pitfalls (e.g. `restricts_*` links never count as usage): → `docs/agents/analysis-workflows.md`

## 6. Code generation workflows

Two distinct axes — classify the task first by asking *where the output runs*:

### 6a. FileMaker code (runs in the target solution)

Scripts, custom functions, schema, layouts, value lists, snippets. Which codegen skills are installed **varies per setup** — from none at all (fresh install) over user-installed third-party skills to the curated fm-lab collection (future release). Never assume a specific skill exists; run the capability protocol:

1. **Discover** — scan the available-skills list for skills that *generate FileMaker artifacts*. Match by description/purpose, not by name — third-party skill names are arbitrary.
2. **Select** — a matching entry in `docs/agents/codegen-registry.md` wins. Otherwise: project-level skill > user-level skill; if still ambiguous, ask the user once and offer to record the choice in the registry.
3. **Apply** — the chosen skill's conventions govern the artifact; the project rules of §2 and the validation gate always apply on top, whatever the skill's origin.
4. **Fallback** (no matching skill) — say so explicitly, then generate along the minimal safety path in `docs/agents/codegen-workflows.md` (fmxmlsnippet ground rules, reference-index verification, backup before overwrite) and suggest installing or creating a suitable skill.

**Validation gate (skill-independent):** every generated FileMaker artifact is verified before delivery — well-formed XML, Step-/Function-IDs against the reference index, referenced objects against `ObjectCatalog`, and the *target solution's* naming/language conventions (derive them from the catalog or registry, never from the conversation language).

### 6b. fm-lab extensions (extend the workbench itself)

Project-owned, always available — no discovery needed; fm-lab code standards apply (English code/comments), not the target solution's conventions:

- **Custom dashboards:** `create-custom-dashboard` skill → bundles under `rest-api/templates/dashboards-custom/` (mind the `:param` preprocessor!).
- **Custom queries / analysis SQL:** DuckDB syntax; research uncertain syntax with `duckdb-skills:duckdb-docs`; locale-independent (Step_ID, never Step_Name literals).
- **New skills:** `skill-creator` + the fm-lab skill conventions; new FileMaker-codegen skills also register in the codegen registry.

Full protocol, phase model, language policy (3 layers), fallback rules, dashboard-SQL constraints: → `docs/agents/codegen-workflows.md` · FM-skill mapping & solution conventions: → `docs/agents/codegen-registry.md`

## 7. Documentation lookup

| Question about … | Skill |
|---|---|
| Native FileMaker functions & script steps ("What does `PatternCount` do?") | `filemaker-function-reference` (local Claris-Help mirror, 11 languages, online fallback) |
| MBS plugin functions | `mbs-function-reference` |
| DuckDB SQL syntax & functions | `duckdb-skills:duckdb-docs` |

Use these skills instead of answering from memory — the local mirrors are versioned and authoritative.

## 8. Query examples

Two canonical patterns inline; the full cookbook (layout composition, cross-file links, statistics, DuckDB idioms): → `docs/agents/query-cookbook.md`

```sql
-- Find an object (any type, any file)
SELECT Object_Type, Object_Name, File_Name
FROM ObjectCatalog
WHERE Object_Name LIKE '%Import%'
ORDER BY Object_Type, File_Name;

-- Where is a field used? (works analogously for any object type)
SELECT ol.Source_Type, src.Object_Name AS Used_In, src.File_Name, ol.Link_Role
FROM ObjectCatalog tgt
JOIN ObjectLinks ol   ON tgt.Object_UUID = ol.Target_UUID
JOIN ObjectCatalog src ON ol.Source_UUID = src.Object_UUID
WHERE tgt.Object_Type = 'Field'
  AND tgt.Object_Name LIKE '%Email%'
  AND ol.Link_Type = 'operational'
ORDER BY ol.Source_Type, src.Object_Name;
```

More prepared queries: `sql/sample_queries.sql`

## 9. Helper commands & documentation install

Availability of these helpers can vary per setup — skip gracefully if one is not installed:

- REST API / web frontend: `rest-api-start` / `rest-api-stop`, `rest-frontend-start` / `rest-frontend-stop`
- Install/update local documentation mirrors: `install-claris-docs`, `install-mbs-docs`, `install-duckdb-docs`, `install-fmide-docs`
- Test data & tooling: `install-ooe-fm`, `install-fm-xml-export-exploder`, `test-convert-xml`

Details (DuckDB binary resolution, server ports, install notes): → `docs/agents/tooling.md`
