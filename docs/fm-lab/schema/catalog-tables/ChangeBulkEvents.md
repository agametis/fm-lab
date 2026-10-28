# ChangeBulkEvents

Part of the [FM-Lab schema](../Schema.md) · Change metadata · `db/fm_catalog.duckdb` (solution catalog)
**Derived from:** [ObjectChangeMeta](ObjectChangeMeta.md) (built during the import, no XML source of its own)

A mass event is one action that stamps many objects at once: a migration, a paste or import of many scripts, a find & replace, a tool run. In real solutions such events often account for most of the change stamps — then "last modified" mostly reflects them and not the individual edits. A mass event is not noise but one action. This table lists every mass event of the solution, one per row. The stamps it covers point to it through `ObjectChangeMeta.Bulk_Event_ID`. Views over the change metadata hide mass events by default and show them as a marker instead.

## Columns

| Column | Type |
|---|---|
| `Bulk_Event_ID` | `BIGINT` |
| `Scope` | `VARCHAR` |
| `Kind` | `VARCHAR` |
| `Start_At` | `TIMESTAMP` |
| `End_At` | `TIMESTAMP` |
| `Files` | `BIGINT` |
| `Objects` | `BIGINT` |
| `Bursts` | `BIGINT` |
| `Mod1_Share` | `DOUBLE` |
| `File_Names` | `VARCHAR[]` |
| `Object_Types` | `VARCHAR[]` |
| `Authors` | `VARCHAR[]` |

## How events are detected

1. **Bursts.** The stamps of a file, sorted by time, form one burst as long as the gap to the previous stamp is at most `Burst_Gap_Seconds` (`ObjectChangeMeta.Burst_ID`).
2. **Mass event of a file.** A burst with at least `Mass_Min_Objects` objects, or a burst whose stamps all come from a `tool` author (any size).
3. **Mass event across files.** Mass events of different files form a chain while each one starts at most `Solution_Window_Seconds` after the latest end so far. Tool events and other events are chained separately. A chain over at least `Solution_Min_Files` files is one event with `Scope = 'solution'`; otherwise each file event stays on its own (`Scope = 'file'`).
4. **Kind.**
   - `tool` — every stamp comes from a `tool` author.
   - `paste_import` — at least `Paste_Min_Share` of the objects have `Modifications = 1`. Pasted or imported objects start as new objects with counter 1.
   - `mass_action` — everything else, e.g. a migration, a find & replace or the default objects of a newly created file.

`Mod1_Share` is the share of objects with `Modifications = 1` and explains the `paste_import` decision. `Authors` holds the `Author_Key` values of [ObjectChangeMeta](ObjectChangeMeta.md).

## ChangeBulkConfig

The parameters of the detection, one row, written with the defaults on every import:

| Column | Default | Meaning |
|---|---:|---|
| `Burst_Gap_Seconds` | 10 | A new burst starts after a longer gap |
| `Mass_Min_Objects` | 25 | Minimum burst size of a mass event |
| `Solution_Window_Seconds` | 900 | Maximum gap between the file events of one event across files |
| `Solution_Min_Files` | 2 | Minimum number of files of an event across files |
| `Paste_Min_Share` | 0.8 | Share of `Modifications = 1` from which an event counts as `paste_import` |

The defaults are calibrated on real solutions. Gaps between 5 and 10 seconds give the same result; from 30 seconds on, ordinary work sessions merge into bursts of several minutes. Bursts of 10–24 objects are mostly single developer actions (pasting fields, moving a group of table occurrences) and stay individual changes. Events across files took at most two minutes, already across two files.

## ChangeTechnicalAuthors

Authors that are not developers, as `LIKE` patterns against `ObjectChangeMeta.Author_Key` (lower case):

| `Author_Pattern` | `Author_Kind` | Meaning |
|---|---|---|
| `fmdatamigration` | `tool` | FileMaker Data Migration Tool — its bursts are always a mass event |
| `[webdirect-%]` | `runtime` | WebDirect session: a runtime change by an end user, typically an account. No mass event, but no developer activity either |

The result is in `ObjectChangeMeta.Author_Kind`. Further authors, and corrections per solution, are curated as aliases in the REST API (view `v_change_meta_authors`, see [ObjectChangeMeta](ObjectChangeMeta.md)).

## Notes

- `Bulk_Event_ID` is **renumbered on every import** (ordered by start time). To recognize an event across imports — for example to give it a label — use `Scope` and `Start_At`.
- Timestamps are the local time of the editing client without time zone. In a team working across time zones, an event across files can fall apart into file events.
- The catalog stamps in [CatalogChangeMeta](CatalogChangeMeta.md) are not part of the detection: there a counter that grows without a new timestamp is normal.
- The import check `v_check_change_meta` reports the number of events and the share of stamps inside them (`bulk_events`, `solution_events`, `bulk_pct`), next to the coarser share of stamps in minutes with 50 or more stamps of one file (`mass_minute_pct`).

```sql
-- Mass events of the solution, largest first
SELECT Start_At, End_At, Scope, Kind, Files, Objects, Object_Types, Authors
FROM ChangeBulkEvents
ORDER BY Objects DESC;

-- Share of individual changes per file
SELECT File_Name,
       count(*) AS stamps,
       round(100.0 * count(*) FILTER (WHERE Bulk_Event_ID IS NULL) / count(*), 1) AS individual_pct
FROM ObjectChangeMeta
GROUP BY File_Name
ORDER BY stamps DESC;
```

**See also:** [ObjectChangeMeta](ObjectChangeMeta.md) · [CatalogChangeMeta](CatalogChangeMeta.md)
