# Skill: fm-changes

Writes release notes from the change stamps of a solution: what changed since a date, in a time window, in one work session or by one person — grouped by file and module, each object with a short technical description, and the mass events of the window kept apart.

| | |
|---|---|
| **Category** | Agentic analysis |
| **Slash command** | `/fm-changes [--since=<date>] [--until=<date>] [--session=<time> --person=<name>] [options]` |
| **Say it naturally** | "what changed since March 1", "release notes for the last month", "what was changed in the work session at 14:00", "summarize Jane's changes" — understood in 11 languages |
| **Input** | a date, a window, a work session or a person; without one, the 30 days before the data state |
| **Reads** | `db/fm_catalog.duckdb` (read-only): [ObjectChangeMeta](../schema/catalog-tables/ObjectChangeMeta.md), [ChangeBulkEvents](../schema/catalog-tables/ChangeBulkEvents.md), the cluster partition and the object catalogs |
| **Writes** | `output/changes_<solution>_<from>_<to>_<timestamp>.md` — the chat shows a short summary with the link |
| **Prerequisites** | a catalog with change stamps (schema 1.36.0 or later, [Skill convert-xml](Skill%20convert-xml.md)); a cluster partition ([Skill fm-graph-cluster](Skill%20fm-graph-cluster.md)) for the grouping by module, otherwise files stand in |
| **Under the hood** | `scripts/changes_window.sql` (data state, persons, work-session lookup), `scripts/changes_report.sql` (totals, objects with short facts, mass events, work sessions) and the template `references/report-template.md` |
| **Skill directory** | `.claude/skills/fm-changes/` |
| **Related** | [Skill fm-summarize](Skill%20fm-summarize.md) · [dashboard *Recent changes*](../schema/catalog-tables/ObjectChangeMeta.md#recent-changes-dashboard) · [Skill fm-deep-research](Skill%20fm-deep-research.md) |

## What it does

The report answers *what happened in this solution lately?* the way a change log does:

- **Summary** — a few paragraphs of release notes in prose: which files and modules were worked on, what is new, what changed most, who worked on it, and notable patterns such as one long session or a migration.
- **At a glance** — changed objects, new objects (counter 1), persons, files, work sessions and the mass events of the window.
- **Changes by file and module** — one section per file, inside it one per module of the cluster partition. The most telling objects (scripts and custom functions first, then layouts and fields) get a one-sentence technical description in the manner of [fm-summarize --short](Skill%20fm-summarize.md); the others are listed with their key facts: the number of steps and the header comment of a script, the type of a field, the table occurrence of a layout, the parameters of a custom function.
- **Mass events** and **work sessions** of the window as tables — the objects of a mass event are never listed one by one.
- **Data basis and limits** — what the stamps can and cannot tell for this window.

Relative windows ("the last two weeks") count from the **data state** — the newest individual change of the solution — because an export is usually older than the day it is read. The report names the resolved absolute window.

## How to use it

```
/fm-changes --since=2026-03-01
/fm-changes --since=2026-03-01 --until=2026-03-31 --file=Invoices
/fm-changes --session="2026-05-29 15:20" --person="Jane Doe"
/fm-changes --person=jane --technical --security
what changed since the end of June?
```

## Options

| Option | Default | Effect |
|---|---|---|
| `--since` / `--until` | 30 days before the data state / open end | the window; dates or date-times |
| `--session` | — | the work session of `--person` around this time (consecutive changes with gaps of at most 30 minutes) |
| `--person` | everybody | a user name; spelling variants of one person are named together |
| `--file` | all files | repeatable |
| `--technical` | off | include technical authors (FileMaker Data Migration Tool, runtime sessions) |
| `--security` | off | include accounts and authorizations |
| `--detail` | 12 | objects that get a one-sentence description |
| `--max-objects` | 400 | row cap of the object list; the report says how many are left out |
| `--out` | `output/changes_…md` | another file name or path |

## Good to know

- **Since is exact, a closed window is not.** Every object keeps only its last change stamp. "Changed since a date" is therefore answered exactly; a window with an end misses objects that were changed again after it. Deleted objects leave no trace.
- **Mass events overwrite.** An object changed individually and later stamped by a migration shows up in the mass event, not as an individual change.
- **Persons** are user names folded to lower case. The curated author aliases of the web frontend are not available on the command line, so the report names spelling variants of one person together.
- **Response language** follows your prompt; object names stay original.
- For rankings across the whole solution — hotspots, stale objects, security changes, the quality of the stamps — use the dashboards of the folder *Changelog* ([ObjectChangeMeta](../schema/catalog-tables/ObjectChangeMeta.md)).

## See also

- [ObjectChangeMeta](../schema/catalog-tables/ObjectChangeMeta.md) — the change stamps and the Changelog dashboards
- [ChangeBulkEvents](../schema/catalog-tables/ChangeBulkEvents.md) — mass events
- [Skill fm-summarize](Skill%20fm-summarize.md) — the technical description used for the detail tier
