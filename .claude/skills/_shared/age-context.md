# Age context — shared contract (fm-summarize, fm-analyze, fm-changes)

Every stamped object in the catalog says when it was last saved, by whom, and how
often since its creation. Skills that describe an object add this as **context**:
one line in standard mode, at most a half-sentence in short mode. It is never the
topic of the description.

## Query

Run **AC1** from [`scripts/age_context.sql`](scripts/age_context.sql) with the
resolved object — one cheap query, also in short mode:

```bash
duckdb db/fm_catalog.duckdb -readonly -markdown \
  -c "SET VARIABLE uuid='<Object_UUID>'; SET VARIABLE file='<File_Name>';" \
  -c ".read .claude/skills/_shared/scripts/age_context.sql"
```

(With a session pin use the literal bundle path, CLAUDE.md §2.) Columns:
`stamp_of` (`own` | `container`), `stamp_type`/`stamp_name` (the container when
inherited), `modified_at`, `modified_by`, `account`, `saves`, `author_kind`
(`NULL` person · `tool` · `runtime`), `mass_event_kind` (`NULL` = individual
change · `mass_action` · `paste_import` · `tool`), `mass_event_scope`,
`mass_event_objects`, `days_before_data_state`, `data_state`.

- **No row** → the type has no stamp (variables, built-in and plug-in functions,
  script-step types): leave the line out.
- **`Catalog Error … ObjectChangeMeta does not exist`** → catalog older than
  schema 1.36.0: leave the line out, no remark (a re-import adds the stamps).

## Wording

Write in the response language; dates as `YYYY-MM-DD`. Count ages from the
**data state** (`data_state`, the newest individual change of the solution) — an
export is weeks or months old, so "today" would overstate every age.

| Case | Standard line (example) |
|---|---|
| own stamp, individual change | **Last modified**: 2024-03-11 by Jane Doe · 14 saves · about 2 years before the data state (2026-08-04) |
| own stamp in a mass event (`mass_action`, `tool`) | **Last stamp**: 2021-04-20 from a mass event (842 objects at once) — unchanged since at least then; the last individual change before it is unknown · 14 saves |
| `paste_import` | **Created by paste or import**: 2025-11-02 (the counter restarted at 1) |
| `stamp_of = container` | **Container last modified**: script *Invoice_Print* on 2026-04-29 by Jane Doe — the step itself carries no stamp |
| `author_kind = runtime` | **Last modified at runtime**: 2026-02-28 (e.g. a password change by the user) |
| `author_kind = tool` | add "by the FileMaker Data Migration Tool" |
| `saves = 0` | "no save reported since creation" instead of the count |

Rules:

- `saves` is the lifetime counter — robust against mass events, so keep it even
  when the date is a mass stamp. A paste or import resets it to 1.
- A mass stamp is an upper bound, never "recently changed": the object was not
  saved after it, but its last individual change lies somewhere before and is
  unknown. "Unchanged since at least <date>" is correct; "changed <n> days ago"
  is not.
- A container stamp is the container's change, not the object's.
- Ages: < 60 days → "N days", < 24 months → "N months", else "N years", always
  "before the data state".
- **Short mode:** at most a half-sentence and only when it adds something — an
  old object ("unchanged for about 4 years, 3 saves"), an old mass stamp
  ("unchanged since at least 2021"), a container stamp. Leave it out for an
  ordinary recent change.

## Interpretation (fm-analyze only)

Age and saves are a **lifecycle signal**, never a verdict:

- many saves and a recent individual change → an active area of development;
- few saves and an old stamp → stable or abandoned — check the callers before
  calling it obsolete (`Used by`); "unused" needs the where-used evidence;
- a mass stamp → only "unchanged since at least <date>"; a young mass stamp
  carries no age signal at all.

For rankings across the solution (hotspots, stale objects, security changes,
work sessions) point to the dashboards of the folder *Changelog* in the web
frontend instead of computing them per object.
