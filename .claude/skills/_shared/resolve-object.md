# Shared: Object resolution (name / UUID / conversation context → catalog object)

Shared contract used by `fm-open` and `fm-show` (and future consumers such as
fm-summarize / fm-analyze). Resolves the user's input to exactly one object from
the master database `db/fm_catalog.duckdb`.

## Result contract

Resolution MUST produce all four fields before the calling skill continues:

| Field | Source |
|---|---|
| `Object_UUID` | ObjectCatalog |
| `Object_Type` | ObjectCatalog |
| `Object_Name` | ObjectCatalog |
| `File_Name` | ObjectCatalog — **mandatory**: clone/modular files share the same Object_UUID, only the File_Name makes the target unambiguous |

Parameterized lookup queries live in `scripts/resolve_object.sql` (substitute the
`<PLACEHOLDER>` tokens, run each statement as a plain `duckdb db/fm_catalog.duckdb -c "…"` command).

## Priority order

### 1 — Explicit argument: UUID

Argument matches the UUID pattern (8-4-4-4-12 hex) → query Q1.

- **1 match** → done.
- **>1 match** (clone/modular files): if `--file <File>` was passed or a File_Name is
  carried in the conversation context, filter by it. Otherwise present a numbered
  selection list (Type, Name, **File_Name**) and wait — **never pick the first row blindly**.
- **0 matches** → error: `Object with UUID <UUID> not found in the database.`
  (Likely stale context after a re-import — offer a name search.)

### 2 — Explicit argument: name

Argument is not a UUID → query Q2 (exact, case-insensitive).

- **1 match** → done.
- **>1 match** → numbered selection list, wait for the user's pick.
- **0 matches** → fuzzy query Q3 (ILIKE, noisy types excluded, LIMIT 15).
  Matches → selection list. Still nothing → error: `No object matching "<Name>" found.`

### 3 — Implicit context (no argument)

Use the object most recently identified in the conversation. Search backwards through:

1. An **fm-summarize / fm-analyze** output — read the context format token (below).
2. An **ObjectCatalog query result** — UUID **and** File_Name from the row discussed.
3. A previous **/fm-open** or **/fm-show** invocation — the UUID + File_Name used there.
4. A name that was clearly mapped to a single object earlier in the conversation.

Multiple candidates → the one most recently discussed. No candidate →
`No FileMaker object found in the current context. Use: /<skill> <object name> or /<skill> <UUID>.`

## Context format token

fm-summarize and fm-analyze emit these header lines; context detection reads them.
This is the ONE place the format is defined — if it ever changes, change it here and
in both emitters:

```
**UUID**: `<Object_UUID>`
**File**: <File_Name>
```

Always read **both** lines together (UUID alone is ambiguous across clone files).

## Selection lists

Format for every ambiguity case (also used by `--list`):

```
| # | Type   | Name                    | File      |
|---|--------|-------------------------|-----------|
| 1 | Script | Umsatzsteuer Nr prüfen  | Kunden    |
| 2 | Script | Umsatzsteuer Nr prüfen  | Adressen  |
```

Then STOP and wait. A bare number as the next skill argument (e.g. `/fm-open 2`)
is an index into the most recently displayed list — do not look it up as an
object name.

## Prerequisite failure

`db/fm_catalog.duckdb` missing or ObjectCatalog empty → abort with:
`No catalog database found — run the convert-xml skill first.`
