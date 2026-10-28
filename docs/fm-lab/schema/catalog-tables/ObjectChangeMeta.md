# ObjectChangeMeta

Part of the [FM-Lab schema](../Schema.md) · Change metadata · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** the attributes of each object's `<UUID>` element (see [XML](../../xml/XML.md))

When was an object last changed, by whom, and how often? FileMaker records this on almost every object of the export: the `<UUID>` element carries `timestamp`, `userName`, `accountName` and `modifications`. The source tables keep these values raw (`Modified_At`, `Modified_By`, `Modified_Account`, `Modifications`). `ObjectChangeMeta` collects them across all object types in one table — one row per object with a stamp of its own, with a typed timestamp, and keyed like the [ObjectCatalog](../object-catalog/ObjectCatalog.md).

## Columns

| Column | Type |
|---|---|
| `Object_UUID` | `VARCHAR` |
| `File_Name` | `VARCHAR` |
| `Object_Type` | `VARCHAR` |
| `Object_ID` | `BIGINT` |
| `Object_Name` | `VARCHAR` |
| `Source_Table` | `VARCHAR` |
| `Modified_At` | `TIMESTAMP` |
| `Modified_At_Raw` | `VARCHAR` |
| `Modified_By` | `VARCHAR` |
| `Modified_Account` | `VARCHAR` |
| `Modifications` | `BIGINT` |
| `Author_Key` | `VARCHAR` |
| `Author_Kind` | `VARCHAR` |
| `Burst_ID` | `BIGINT` |
| `Bulk_Event_ID` | `BIGINT` |

## Coverage

| Object types with a stamp of their own | Source table |
|---|---|
| Script, Folder (Script Workspace) | [ScriptCatalog](ScriptCatalog.md) |
| Layout, Folder (layout list) | [Layouts](Layouts.md) |
| CustomFunction, Folder | [CustomFunctionsCatalog](CustomFunctionsCatalog.md) |
| Field | [FieldsForTables](FieldsForTables.md) |
| BaseTable · TableOccurrence · Relationship · ExternalDataSource | [BaseTableCatalog](BaseTableCatalog.md) · [TableOccurrenceCatalog](TableOccurrenceCatalog.md) · [RelationshipCatalog](RelationshipCatalog.md) · [ExternalDataSourceCatalog](ExternalDataSourceCatalog.md) |
| ValueList | [ValueListCatalog](ValueListCatalog.md) |
| Account · PrivilegeSet · ExtendedPrivilege | [AccountsCatalog](AccountsCatalog.md) · [PrivilegeSetsCatalog](PrivilegeSetsCatalog.md) · [ExtendedPrivilegesCatalog](ExtendedPrivilegesCatalog.md) |
| Authorization (no [ObjectCatalog](../object-catalog/ObjectCatalog.md) entry) | [FileAccessAuthorizations](FileAccessAuthorizations.md) |
| CustomMenu · CustomMenuSet | [CustomMenuCatalog](CustomMenuCatalog.md) · [CustomMenuSetCatalog](CustomMenuSetCatalog.md) |
| Theme · BaseDirectory | [ThemeCatalog](ThemeCatalog.md) · [BaseDirectoryCatalog](BaseDirectoryCatalog.md) |

Separator lines and folder end markers carry a stamp in the export but are no objects; they are not in the table. Every other object of these types has a row — the import check `v_check_change_meta` reports any object without one.

Script steps, layout objects, layout parts, calculations, script triggers and menu items have **no** stamp of their own. They change together with their container: follow the containment links in [ObjectLinks](../object-catalog/ObjectLinks.md) (`parent_script`, `parent_layout`, `parent_menu`, `trigger_owner`, `has_calculation` in reverse) and read the container's row — and present it as "container changed", not as a change of the object itself. Variables and the synthetic types (built-in and plug-in functions, script-step types) have no stamp at all.

## What the values mean

- **Only the last change.** Each save overwrites the stamp. An object changed fifty times appears once, at its latest date; distributions over time therefore show last changes, not activity. `Modifications` counts the saves since the object was created.
- **What renews a stamp.** Saving the object itself: a changed script step renews the script, moving or formatting a layout object renews the layout, moving or renaming a table occurrence renews the occurrence. Pasting or importing creates a *new* object — new UUID, counter 1, the time and user of the paste. A user who changes their password at runtime stamps their account. Saving a clone, running the Developer Utility without options and saving a compacted copy leave every stamp unchanged.
- **Mass actions.** Real solutions often carry the same timestamp on thousands of objects of one file — a migration, a find & replace, a paste of many scripts. Such a stamp says little about the individual object. The import groups these stamps into mass events (below).
- **Time.** `Modified_At` is the local time of the editing client, without time zone. `Modified_At_Raw` keeps the exported text.
- **Who.** `Modified_By` is the FileMaker user name (as `Get(UserName)` returns it), `Modified_Account` the signed-in account (empty → `NULL`). Both appear in several spellings: the account is stored as typed at login (`Admin` / `admin`), user names vary in case. `Author_Key = lower(trim(Modified_By))` merges the case variants.

## Bursts, mass events and technical authors

- **`Burst_ID`** groups the stamps of one file that follow each other with gaps of at most 10 seconds — usually one save action or one quick series of edits. Every stamp with a readable timestamp belongs to exactly one burst.
- **`Bulk_Event_ID`** links a stamp to its mass event in [ChangeBulkEvents](ChangeBulkEvents.md): a burst of 25 objects or more, or a burst written only by a tool. Mass events of different files that follow each other within 15 minutes form one event across files. `NULL` = an individual change. The thresholds are in [ChangeBulkConfig](ChangeBulkEvents.md#changebulkconfig).
- **`Author_Kind`** marks authors that are not developers, from the patterns in [ChangeTechnicalAuthors](ChangeBulkEvents.md#changetechnicalauthors): `tool` (the FileMaker Data Migration Tool) or `runtime` (a WebDirect session — an end user changing an account at runtime). `NULL` = a person. Bursts of `tool` authors are always a mass event; `runtime` stamps stay individual changes but are no developer activity.
- Both IDs are **renumbered on every import**. Never store them as keys elsewhere; a mass event is recognizable across imports by its scope and start time.
- The REST API adds the view `v_change_meta_authors` (one row per `Author_Key`) on top: it merges spelling variants of the same person through aliases curated in the solution's annotations database, which survive a rebuild. The view exists only inside the API connection, not in the catalog file.
- **In the web frontend** every detail view shows a line *Last modified* below the title: the object's own stamp, or — for script steps, layout objects, calculations and the other types without a stamp — *Container last modified* with a link to the script or layout. Badges mark technical authors and mass events. The author opens the [dashboard *Recent changes*](#recent-changes-dashboard) filtered to that person, the mass-event badge opens it on the event's time window. The search sorts by *Last modified* and filters on *Modified since* ([Search API](../../rest-api/endpoints/Search%20API.md#change-stamps)); the file view shows the last design change, the stamps per catalog and the individual changes per month as a [sparkline](#sparkline-in-the-file-view); the settings page curates the author aliases.

## Recent changes dashboard

The system dashboard `changes` (`/dashboard/changes`) lists who changed what and when — one row per stamp, newest first, 100 rows per page. The home page shows the ten newest individual changes as the card *Recently changed* with a link to it. In the dashboard overview it sits in the folder *Changelog*, together with [Hotspots & stale objects](#hotspots-and-stale-objects-dashboard), [Changed together](#changed-together-dashboard), [Module activity](#module-activity-dashboard), [Security changes](#security-changes-dashboard) and [Change metadata quality](#change-metadata-quality-dashboard). The skill [fm-changes](../../skills/Skill%20fm-changes.md) turns the same stamps into written release notes.

- **Filters:** object types and files (multiple choice), person (spelling variants merged through the aliases), period (7, 30, 90, 365 days or all), and a server-side search over object name, type, file and person. Every filter is a URL parameter, so a filtered view can be shared as a link.
- **Anchor:** the period counts back from the *data state* — the newest individual change of the solution — not from today, because an export is usually older than the day it is viewed. *From today* is the alternative. The filter card names the end of the period next to the period chips.
- **Hidden by default:** mass events, technical authors, and accounts and authorizations (runtime changes, no developer activity). On/off chips in the filter card switch mass events and technical authors on; accounts and authorizations appear when the type filter names them.
- **Mass events** have their own card with time window, scope, kind and the matching objects. Opening one shows its objects in the list (URL parameters `from`, `to` and `bulk=include`) — the event is addressed by its time window, not by the renumbered `Bulk_Event_ID`.
- **Work sessions:** the grouping *Work sessions* merges consecutive changes of one person with gaps of at most 30 minutes, across files. Opening a session shows its changes.
- **KPIs:** changes, actions (distinct bursts — a mass event or a paste counts once), active days, persons, files and the mass events in the period.
- The base is the **last** stamp per object; earlier changes of the same object are overwritten. The card *Data basis* at the end of the page says so. The dashboard needs a catalog of schema 1.36.0 or later; on a catalog without change stamps it shows only a hint to import the solution again.

### Activity charts

The card *Activity* between the KPIs and the list draws the same filtered changes as two charts. The on/off chip *Activity* hides it (URL parameter `charts`).

- **Activity map** in the GitHub style. The grid follows the period: at 7 days one row per day and one column per hour; at 30, 90 and 365 days a calendar of weeks × weekdays; at *All* one block per year, from the month of the first change on, with the twelve months as columns and five sections of each month as rows (days 1–7, 8–14, 15–21, 22–28, 29 to the end of the month). A year block names the year and its total.
- **Colour levels:** level 0 is an empty cell; levels 1–4 are the quartiles of the non-empty cells in view, and the busiest cell always gets level 4. Fixed thresholds would not work across solutions. Mass events never count into the intensity: a ring marks their cells, the colour stays that of the individual changes. The tooltip names the count and the top three types and persons.
- **Changes over time:** stacked columns per day (7 and 30 days), per ISO week (90 and 365 days) or per month (*All*); a bucket without changes stays visible as an empty column. The chips *By type*, *By file*, *By person* and *By module* choose the series, at most seven plus *Other*. Object types keep fixed colours (Script, Layout, Field, Relationship, ValueList, CustomFunction, TableOccurrence; every other type is *Other*). Files, persons and modules take theirs from their rank by individual changes across the whole solution, so a series keeps its colour and its place in the stack whatever the period or filter. Modules are the communities of the cluster partition (objects outside it count as *Other*); without a partition every file is a module. A flag marks columns with mass events; with mass events switched on they form a hatched series of their own.
- **Legend:** a click hides or shows one series; Shift- or Alt/Option-click shows only that series (once more on the only visible one: all series). *All series* appears as soon as something is hidden.
- **Count mode:** *Count objects* counts changed objects, *Count actions* counts bursts — a paste or a mass event counts once.
- **Drill-down:** a click on a cell or a column opens its changes in the list below (URL parameters `from` and `to`); the other filters stay. The charts keep the whole period and highlight the chosen cell or column. Keyboard: one tab stop per chart, arrow keys move, Enter opens.

### Sparkline in the file view

The card *Changes per catalog* of the file view (`/file/<name>`) shows the individual changes of the file per month over the twelve months up to the data state, with the same defaults as the dashboard (no mass events, no technical authors, no accounts and authorizations). A click on a month opens exactly these changes in the dashboard.

## Hotspots and stale objects dashboard

The system dashboard `hotspots` (`/dashboard/hotspots`) shows where maintenance pays off. It places every object on two axes: how often it was saved (the lifetime counter `Modifications`) and how widely it is used (its fan-in). Objects changed often and used widely are *hotspots*; objects nobody references are *stale objects*, sorted by how long they have been left untouched.

- **Objects:** scripts, fields, layouts, table occurrences, base tables, value lists, custom functions, external data sources and themes — the types whose usage the where-used analysis captures. Left out are relationships, folders and base directories (never the target of a usage link), custom menus and menu sets (partly used without a link: the default menu set of a file, the standard menus), privilege sets and extended privileges (security model) and accounts and authorizations (runtime changes). Every stamp counts, whatever its author — the counter covers the whole lifetime of the object.
- **Fan-in:** the distinct objects that reference the object through a link role with `Counts_For_Where_Used` in [LinkRoleRegistry](../object-catalog/LinkRoleRegistry.md) — the same roles as the line *Not referenced* in the references tab. Self-references (a recursive script or custom function) and privilege restrictions do not count. Objects are keyed by UUID and file.
- **Quadrants:** *high* means the top decile of the object type on that axis, measured over the whole solution, so a filter never moves the thresholds. *Hotspot* is high on both axes, *Changed often* only on the counter, *Stable core* only on the fan-in. The ranking sorts by the product of both percentile ranks.
- **Stale objects** are objects without fan-in, by the age of their last stamp counted from the data state (as in [*Recent changes*](#recent-changes-dashboard)):
  - *Cold* — the last stamp, a mass event included, is older than the threshold of 1, 2 (default) or 5 years.
  - *Age unknown* — the last stamp is a younger mass event; the last real change is overwritten. The dashboard counts these openly instead of treating them as young.
  - *Recently changed* — a younger individual change.
  - *In a menu* — layouts in the layout menu and scripts in the Scripts menu without a reference. Users reach them directly, so they are listed apart and not counted as unused.
- **Limits:** *unused* means *without a static reference*. Names built by a formula, `ExecuteSQL` texts and calls from outside (server schedules, `fmp://` URLs, Data API) stay invisible. Pasting or importing creates a new object with counter 1, so a pasted object looks young and calm.
- **Use:** the KPI tiles open the matching list; both lists page on the server (100 rows per page) and search over object name, type and file; type and file filters take several values. A row opens the object, whose references tab explains the fan-in.

## Changed together dashboard

The system dashboard `cochange` (`/dashboard/cochange`) compares the work sessions with the modules of the object graph: which modules are changed together, and do the modules of the cluster partition match the way the solution is worked on?

- **Work sessions** as in [*Recent changes*](#recent-changes-dashboard): consecutive individual changes of one person with gaps of at most 30 minutes, without mass events, technical authors, accounts and authorizations. Filters: files, person and period — *all* by default, because the view needs many sessions.
- **Modules** are the communities of the partition that [fm-graph-cluster](../../skills/Skill%20fm-graph-cluster.md) writes, named by their semantic name, else by their heuristic name. Objects without a community — isolated nodes of the graph — count in the session size, but their pairs stay out of the coupling; the card *Data basis* names their share. Without a partition every file counts as one module, and a hint says so.
- **Weighting:** a pair of objects from a session with n objects weighs 1/(n−1). Each object spreads the weight 1 over its partners, so one session of 200 objects does not outweigh hundreds of small ones. Sessions of more than 50 objects are marked as large.
- **KPIs:** sessions with at least two objects, object pairs, the weighted share of pairs within one module (*Same module*) and the share a random pair of objects would reach (*By chance*, Σ p² over the module sizes). A share far above chance means the modules follow the way the solution is changed.
- **Module coupling:** module pairs by summed weight, with their object pairs and sessions; the chip *Within a module* lists the single modules instead. Searchable by module name.
- **Sessions across modules:** the sessions that touched two or more modules, with their largest modules. Opening one lists exactly its changes in *Recent changes* (time window, person and the file filter).
- **Bias:** each object keeps only its last stamp and therefore counts only in its last work session — the view shows what was *last* changed together, not how often.

## Module activity dashboard

The system dashboard `module_activity` (`/dashboard/module_activity`) shows which modules of the solution are alive and which rest: every community of the cluster partition — or every file, when the solution is not clustered yet — classed by the age of its newest individual change.

### Activity classes

The same classes appear in this dashboard, in the colour mode *Activity* of the Graph Atlas and the Graph Explorer, and in the section *Development activity* of [fm-deep-research](../../skills/Skill%20fm-deep-research.md).

- **Per object:** the age of its last stamp, counted back from the data state — ≤ 30 days · ≤ 90 days · ≤ 1 year · ≤ 2 years · > 2 years.
- **Mass events and technical authors** overwrite the last real stamp. Such a stamp only bounds the last real change from above: when it is older than two years, the class *> 2 years* still holds; a younger one leaves the age **unknown** — never young. Objects without a stamp of their own (variables, plug-in functions, layout objects and menu items, which carry the stamp of their container) are *no stamp*.
- **Per module or tile:** the youngest class among the members; *unknown* only when all stamped members are unknown, *no stamp* when no member has one.
- **Mass events included:** the switch *Mass events* lets every stamp date the last change, as the last stamp of the object.
- **Saves:** the second scale ranks the lifetime save counter `Modifications` within each object type across the solution (ties share the middle of their range). A module takes the mean rank of its members, in five levels with fixed limits (0.3 · 0.4 · 0.5 · 0.6). The counter is robust against mass events, so it still separates the modules when the classes are mostly *unknown*.

### The dashboard

- **Filters:** files, person, period (30, 90, 365 days — the default — or all) and the switches for mass events and technical authors. The class of a module never depends on the filters; the period and the filters only change the counts *Changes* and *Persons*. Files, person or the search narrow the table to the modules those changes touch.
- **KPIs:** modules, active ≤ 90 days, resting > 2 years, unknown, and the objects that belong to no module. A click filters the table by state.
- **Module table:** module, members, activity (badge), newest change, changes and persons in the period, members changed within 90 days (%), median saves, share of mass stamps — 100 rows per page, searchable by module name. The chips sort by activity (youngest first), by saves or by changes.
- **Selected module:** a click on a row selects the module (URL parameter `module`) and shows its figures. *Members* opens the module in the Graph Atlas, coloured by activity; *Changes* opens [*Recent changes*](#recent-changes-dashboard) filtered to the files of the module with the current period and switches. The Graph Atlas links to the same selection (*Changes of this module*).
- **Changes by module:** the stacked timeline of *Recent changes* with the series *By module*.
- **Mass dominance:** when more than 80 % of the module members are of unknown age, a hint says so and points to sorting by saves.
- The base is the **last** stamp per object, as everywhere in this table — the classes describe the last state, not a history.

### In the Graph Atlas and the Graph Explorer

- **Graph Atlas:** the colour switch *Type · Activity · Saves* in the toolbar (URL parameters `color=recency|saves`, `bulk=include` for the switch *Mass events*). Activity uses a blue ramp, saves an orange one; unknown tiles are hatched gray, tiles without a stamp keep the base colour. The legend lists the steps with the share of the visible nodes and the data state, and points to the saves mode when more than 80 % are unknown. The tile tooltip and the *(…)* panel show the newest change, the members changed within 90 days, the medians and the share of mass stamps. The fold tile carries the activity of the folded tiles.
- **Graph Explorer:** the colour lens *Activity* next to *Type* and *Community* fills each node with the class of the object; the trace roles stay on the borders. The node tooltip names the class and the newest change.
- Both colour modes are off on a catalog without change stamps. The REST side is described in [Graph API](../../rest-api/endpoints/Graph%20API.md#get-apigraphoverview).

## Security changes dashboard

The system dashboard `security_changes` (`/dashboard/security_changes`) keeps the changes of the security model apart from the development activity: accounts, privilege sets, extended privileges and file access authorizations.

- **Filters:** security types and files (multiple choice), person, period (*all* by default — security objects change rarely) and a search. The chips *All authors*, *Developers*, *Runtime (end users)* and *Tools* split the stamps by their author, with counts: a **runtime** change comes from an end user while the solution runs, for example a password change in a WebDirect session; **tools** are the FileMaker Data Migration Tool and authors marked technical in the author aliases.
- **List:** one row per stamp with the assignment of the object — the privilege set of an account, the privilege sets holding an extended privilege, the description of a privilege set, the authorized file of an authorization — whether an account is active, the counter and a badge for mass events, runtime changes and technical authors.
- **Mass events:** migrations, pastes and tool runs that also wrote security objects; opening one lists its security objects (mass events are hidden in the list by default, like in *Recent changes*).
- **Security catalogs:** the stamps of the catalogs themselves per file. A catalog stamp newer than every object of its catalog points to a structural change after the last edit — for the accounts catalog a deleted account ([CatalogChangeMeta](CatalogChangeMeta.md)). A changed password raises only the counter of the accounts catalog, not its timestamp.

## Change metadata quality dashboard

The system dashboard `change_quality` (`/dashboard/change_quality`) shows how far the change stamps of a solution can be trusted — before reading the other Changelog views, and per file.

- **Integrity** — checks of the import; after a healthy import every value is 0: objects of stamped types without a stamp, timestamps the import could not read, two stamps for one object, stamps newer than the file's import plus one day (usually a wrong clock on an editing client), readable stamps outside every burst. They follow the import check `v_check_change_meta`.
- **Signals** — no errors, but limits of what the stamps say: stamps in mass events (count and share), technical authors, stamps without a signed-in account, counter 0 (no save reported since creation) and persons who appear under several user names or author keys.
- A click on a value lists the affected objects (paged, oldest stamp first); *Persons with several names* lists the user names per person instead — merge them in the author aliases on the settings page.
- **Per file:** stamps, the share in mass events, technical authors, stamps without account, counter 0, the integrity issues, and the file's data state against its import date. The page header names how much older the export is than the import.
- A history across imports — and with it a check for stamps that change without a counter — is not part of the catalog.

## Notes

- Join to the catalog on `Object_UUID` **and** `File_Name` — clone files can share UUIDs.
- The catalogs themselves carry stamps too; they are in [CatalogChangeMeta](CatalogChangeMeta.md).
- The table is rebuilt completely on every import.

```sql
-- The 20 most recent individual changes by developers (mass events and technical authors excluded)
SELECT Modified_At, Object_Type, Object_Name, File_Name, Modified_By, Modifications
FROM ObjectChangeMeta
WHERE Bulk_Event_ID IS NULL
  AND Author_Kind IS NULL
ORDER BY Modified_At DESC
LIMIT 20;
```

**See also:** [ChangeBulkEvents](ChangeBulkEvents.md) · [CatalogChangeMeta](CatalogChangeMeta.md) · [ObjectCatalog](../object-catalog/ObjectCatalog.md) · [ObjectLinks](../object-catalog/ObjectLinks.md) · [LinkRoleRegistry](../object-catalog/LinkRoleRegistry.md)
