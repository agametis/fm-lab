---
name: fm-changes
description: >-
  Writes release notes from the change stamps in `db/fm_catalog.duckdb`: what changed since a
  date, in a time window, in one work session or by one person — grouped by file and module,
  each object with a short technical description, mass events kept apart — rendered from a
  Markdown template into `output/`; the chat shows a short summary with a link. Use it for
  change logs, hand-overs and reviews; for one object use fm-summarize instead.
  Triggers (English): "/fm-changes", "what changed since March 1", "release notes for the last
  month", "what was changed in the work session at 14:00", "summarize the changes of Jane".
  Triggers (German): "was hat sich seit dem 1. März geändert", "Release Notes für den letzten
  Monat", "was wurde in der Sitzung um 14 Uhr geändert", "fasse die Änderungen von Jane
  zusammen". Also responds to equivalent requests in other languages.
metadata:
  version: "0.1.0"
---

# FileMaker Change Report

## Purpose

Turn the change stamps of a solution into **readable release notes**: which objects changed in
a window, grouped by file and by module of the cluster partition, each with a short technical
description, plus the mass events and work sessions of the window. The deliverable is a
Markdown file rendered from [`references/report-template.md`](references/report-template.md);
the chat gets a short summary and the link. The skill only reads the catalog.

## Ground rules

- **Database:** read-only, plain `duckdb db/fm_catalog.duckdb -readonly -markdown -c "…"`; with a
  session pin (`FMLAB_SOLUTION`/`FMLAB_CONTEXT`) the literal bundle path — CLAUDE.md §2. Read
  each result **once**, compact (`-markdown`).
- **Response language:** prompt language — [`_shared/response-language.md`](../_shared/response-language.md).
  FileMaker identifiers stay original; the template's English headings are rendered in the
  report language.
- **Time:** count every relative window ("last two weeks") from the **data state** (newest
  individual change), never from today — exports are weeks or months old. State the resolved
  absolute window in the report.
- **No speculation:** every statement comes from the result sets; interpretation is hedged.

## Parameters

| Parameter | Default | Effect |
|---|---|---|
| `--since=<date>` | 30 days before the data state | lower bound (inclusive) |
| `--until=<date>` | open (up to the data state) | upper bound; a closed window misses objects changed again later |
| `--session=<time>` | — | the work session of `--person` around this time (gaps ≤ 30 min) |
| `--person=<name>` | all persons | user name, matched to an `Author_Key` (C1 #2) |
| `--file=<name>` | all files | repeatable; comma-separated in the SQL variable `files` |
| `--technical` | off | include technical authors (Data Migration Tool, runtime sessions) |
| `--security` | off | include accounts and authorizations (runtime changes) |
| `--detail=<N>` | 12 | objects described in the detail tier (C3) |
| `--max-objects=<N>` | 400 | row cap of the object list |
| `--out=<name\|path>` | `output/changes_<solution>_<from>_<to>_<ts>.md` | bare name → `output/<name>.md`; existing file → ask, or `--force` |

Natural language maps onto these ("since March 1st" → `--since`, "Jane's changes last week" →
`--person` + window). Ask (AskUserQuestion) only when the window cannot be derived.

## Workflow (C0–C5)

### C0. Readiness

State solution and source (`tools/solution.sh current` when a pin is set). When C1 fails with
`Table with name ObjectChangeMeta does not exist` (catalog older than schema 1.36.0) or `stamps`
is 0, the catalog has no change stamps: stop with the hint to import the solution again
(`convert-xml`).

### C1. Resolve the window

```bash
duckdb db/fm_catalog.duckdb -readonly -markdown \
  -c "SET VARIABLE person=<'author key' | NULL>; SET VARIABLE session_at=<TIMESTAMP '…' | NULL>;" \
  -c ".read .claude/skills/fm-changes/scripts/changes_window.sql"
```

#1 gives `data_state` and the partition `engine` (NULL → modules are files), #2 the persons
(match a name case-insensitively; several matches → ask; spelling variants of one person →
name them together), #3 the session window for `--session`. Resolve `from_at`/`to_at` as
`TIMESTAMP` literals; a session uses its exact start and end.

### C2. Collect

```bash
duckdb db/fm_catalog.duckdb -readonly -markdown \
  -c "SET VARIABLE from_at=TIMESTAMP '<from>'; SET VARIABLE to_at=<TIMESTAMP '<to>' | NULL>; SET VARIABLE person=<key | NULL>; SET VARIABLE files=<'a,b' | NULL>; SET VARIABLE technical=<'include' | NULL>; SET VARIABLE security=<'include' | NULL>; SET VARIABLE engine=<'engine' | NULL>; SET VARIABLE max_objects=<N>;" \
  -c ".read .claude/skills/fm-changes/scripts/changes_report.sql"
```

Six result sets: #1 totals (incl. `sessions`), #2 per type, #3 per file × module, #4 the
objects with short facts, #5 mass events in the window, #6 work sessions. Columns of #4:
`size` (script steps · layout objects), `info` (field type · layout table occurrence · function
parameters · value-list source), `note` (script header comment or field comment), `used_by`
(objects referencing it), `calls` (scripts a script calls), `is_new` (counter 0–1),
`detail_rank`. `module` is the partition's module name; a heuristic name loses the prefix of
its own file, a different file prefix stays (the module is centred in that file).
`changed_objects = 0` → write no file; tell the user and suggest a wider window or
`--technical` when #1 shows mass events only.

### C3. Describe

- **Detail tier** — the rows of #4 with `detail_rank ≤ --detail` (scripts, custom functions,
  layouts, fields, the rest; new objects first, then most saves). Write **one sentence** per
  object in the manner of `fm-summarize --short`, from the facts of #4 alone: what it is
  (`note`, `info`, name), its size, how it is embedded (`used_by`, `calls`), new or not.
  Only for a script whose `note` is empty read its first steps once:
  `SELECT Step_Index + 1 AS step, Step_Name, left(COALESCE(Comment_Text, Calculation_Text, ''), 80) AS text FROM StepsForScripts WHERE Script_UUID = '<uuid>' AND File_Name = '<file>' ORDER BY Step_Index LIMIT 15;`
  No other per-object queries, no AC1 per object (#4 already carries date, person and saves).
- **List tier** — every other row: type, name, date and the `info`/`note`; no queries.
- Never describe the objects of a mass event individually.

### C4. Render

Read the template once, fill the placeholders, follow the instruction comments, remove them,
and write the file with the Write tool:

| Placeholder | Value |
|---|---|
| `{{solution}}` | solution id |
| `{{window_label}}` | "since 2026-07-01" · "2026-07-01 – 2026-07-31" · "work session 2026-05-29 15:23–15:25 (Jane Doe)" — in the report language |
| `{{generated_at}}` | local time `YYYY-MM-DD HH:MM` |
| `{{fmlab_version}}` / `{{skill_version}}` | `version.json` → `global_version` / this file's `metadata.version` |
| `{{data_state}}` | C1 #1, as `YYYY-MM-DD HH:MM` |
| `{{scope_note}}` | empty, or e.g. " · person: Jane Doe · files: Invoices · incl. technical authors" |
| `{{changed_objects}}` … `{{objects_in_mass_events}}`, `{{sessions}}` | C2 #1 |
| `{{parameters}}` | the resolved variables of C2 in one line |

File name: `output/changes_<solution>_<from>_<to>_<ts>.md` with dates `YYYY-MM-DD` (`open` for
an open end) and `ts=$(date +%Y-%m-%d_%H-%M-%S)`.

### C5. Chat

Only this, in the response language:

```
Changes in <solution>, <window>: <n> objects in <files> files by <persons> persons
(<new> new, <sessions> work sessions)[; <mass> mass events with <objects> objects kept apart].
Most changed: <module> (<n>), <module> (<n>).
→ Report: [output/<file>.md](output/<file>.md)
```

The bracketed part only when `mass_events > 0`. "Most changed" names modules (summed over
files) when a partition exists, otherwise files.

## Limits

- Only the **last** stamp per object exists: an open end ("since") is exact, a closed window
  misses objects changed again after its end; deletions leave no trace; a later mass event
  hides an earlier individual change.
- Persons are case-folded user names; the curated aliases of the web frontend are not
  available on the command line.
- Ranking views across the whole solution (hotspots, stale objects, security changes, data
  quality) are the dashboards of the folder *Changelog* in the web frontend.

## Triggers in other languages

The frontmatter `description` carries the English and German trigger phrases.
Equivalent phrases in further languages:

- **Spanish:** "qué cambió desde <fecha>", "notas de versión desde <fecha>".
- **French:** "qu'est-ce qui a changé depuis <date>", "notes de version depuis <date>".
- **Italian:** "cosa è cambiato dal <data>", "note di rilascio dal <data>".
- **Dutch:** "wat is er veranderd sinds <datum>", "release notes sinds <datum>".
- **Portuguese:** "o que mudou desde <data>", "notas de versão desde <data>".
- **Swedish:** "vad har ändrats sedan <datum>", "versionsinformation sedan <datum>".
- **Japanese:** "<日付>以降に何が変わった", "<日付>以降のリリースノート".
- **Korean:** "<날짜> 이후 무엇이 바뀌었나", "<날짜> 이후 릴리스 노트".
- **Chinese:** "<日期>以来有哪些更改", "<日期>以来的发布说明".
