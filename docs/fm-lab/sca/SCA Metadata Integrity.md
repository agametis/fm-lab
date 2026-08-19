# SCA Metadata Integrity

**Rubric:** [Static Code Analysis (neighboring rubric)](../Wiki/Static%20Code%20Analysis.md) · 2 rules · `rest-api/templates/dashboards-custom/metadata-integrity/`

Metadata-integrity rules check the invisible layer of the FileMaker file format: the native UUIDs every object carries. Duplicate UUIDs never affect runtime behavior — FileMaker itself doesn't care — but they quietly break every tool that assumes UUID uniqueness: DDR analyzers, fmIDE, diff/merge tooling, and FM-Lab's own reference resolution. FM-Lab detects and lists these defects; it deliberately does **not** repair them (Claris' repair mode assigns entirely new UUIDs and breaks external references).

## When to use it

- Solutions with a cloning history — files copied from a template file, or objects pasted between clones, are where cross-file UUID collisions come from.
- When developer tooling behaves oddly on one file (wrong objects linked, references jumping) while FileMaker itself is fine.
- Before relying on UUID-based workflows (sync frameworks, external documentation tools, FM-Lab cross-file analysis).

## Reading the results

Both rules are `warning` — real defects for tooling, invisible in production. **Clone collisions** are the cross-file case: the same UUID existing in more than one file of the solution. **Intra-file duplicates** are the export-defect case: a UUID assigned twice within one file, typically from copy/paste with old FileMaker versions. For the intra-file case FM-Lab's importer performs *UUID healing*: every occurrence is kept, the twin with the smallest internal id retains the source UUID, and the others receive a deterministic replacement (recorded in `Healed_UUID`) — the dashboard lists the healed occurrences with their context so the catalog stays internally consistent without touching your file.

## Rules

| Rule | Severity | What it flags | Source |
|---|---|---|---|
| UUID Clone Collisions | warning | Native UUIDs existing in more than one file of the solution | fm-lab |
| UUID Intra-File Duplicates | warning | UUIDs assigned twice within a single file, with the healed replacement mapping | fm-lab |

## See also

- [Static Code Analysis](../Wiki/Static%20Code%20Analysis.md) — the rubric overview
- [UUID Healing and Duplicate Census](../schema/UUID%20Healing%20and%20Duplicate%20Census.md) — how the importer handles duplicates in detail
- [ObjectCatalog](../schema/object-catalog/ObjectCatalog.md) — where object identity lives in the catalog
