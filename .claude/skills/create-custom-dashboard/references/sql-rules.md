# SQL rules for dashboard datasets

Source of truth for every `.sql` file generated into a dashboard bundle. Read this
before drafting the first query (workflow step 2).

## 1. Identity rule: UUID **plus** file (critical)

The database holds **many FileMaker files** per solution, and two independent
uniqueness failures exist:

1. **Numeric FileMaker IDs** (`L_ID`, `Script_ID`, `BT_ID`, `Layout_ID`, `Field_ID`, …)
   are only unique **within one file**. Joining on a bare ID fans out across every
   file that reuses the same number and silently inflates counts.
2. **UUIDs are not guaranteed globally unique either**: cloned FileMaker files carry
   the clone's UUIDs. Production corpora have shipped duplicate UUIDs across files
   (import quality tests treat them as a known, real-world case). A bare-UUID join
   is therefore *usually* right and *occasionally* silently wrong — the worst kind.

**Canonical rule: an object's identity is the pair (UUID, File_Name). Join on both
whenever both sides carry a file column.**

### Join matrix

| Situation | Pattern |
|---|---|
| Catalog ↔ satellite table (e.g. `ScriptCatalog` ↔ `StepsForScripts`) | `ON st.Script_UUID = s.Script_UUID AND st.File_Name = s.File_Name` |
| `ObjectLinks` → source object | `JOIN ObjectCatalog src ON src.Object_UUID = ol.Source_UUID AND src.File_Name = ol.Source_File` |
| `ObjectLinks` → target object | `JOIN ObjectCatalog tgt ON tgt.Object_UUID = ol.Target_UUID AND tgt.File_Name = ol.Target_File` |
| Numeric-ID join (no shared UUID column) | `ON lo.Layout_ID = l.L_ID AND lo.File_Name = l.File_Name` |
| Aggregation | `GROUP BY s.Script_UUID, s.File_Name` — never UUID alone, never ID alone |
| `IN` / `NOT IN` subquery | rewrite as correlated `EXISTS` / `NOT EXISTS` over **both** columns (a bare `UUID NOT IN (…)` ignores the file) |

Notes:
- `ObjectLinks` carries `Source_File`, `Target_File` and `Is_Cross_File` exactly for
  this purpose — cross-file links stay correct because `Target_File` is the file of
  the *target* object.
- The `EXISTS` form of the subquery rule:

  ```sql
  AND NOT EXISTS (
      SELECT 1 FROM StepsForScripts st
      WHERE st.Script_UUID = s.Script_UUID
        AND st.File_Name  = s.File_Name
        AND st.Step_ID = 89 AND st.Step_Index = 1
  )
  ```

### Fan-out plausibility check (run after the preview)

If top counts look identical, suspiciously round, or higher than the solution
plausibly allows, compare:

```sql
SELECT count(*) AS rows, count(DISTINCT uuid || '|' || file) AS identities FROM (<query>);
```

`rows > identities` (with non-NULL file) means the query fans out — fix the joins
before showing the preview to the user.

## 2. Result contract for navigable datasets

Every dataset whose rows represent catalog objects (scripts, layouts, fields,
variables, custom functions, …) MUST return:

| Column | Purpose |
|---|---|
| `uuid` | `openObject` navigation target |
| `file` | disambiguates duplicate UUIDs in `openObject`, feeds the full-text search, satisfies the identity rule |
| `type` | only when the dataset mixes object types (`openObject` needs it via `{{type}}`) |
| `name` | display |

`file` is **mandatory, not optional** — the frontend passes it to `openObject` and
it is the cheapest join-audit column a reviewer has.

Where the query knows a *find site* inside the object, also return it so the click
can land precisely: `step_uuid` (script step anchor), a `search_term` for the
detail view's search (`sq` param), etc. See `references/primitives.md` §Actions.

## 3. Parameters

- Read parameters with `getvariable('param_name')`. The REST API **textually
  replaces** each `getvariable('x')` with the escaped request value, or `NULL`
  when absent — the SQL never sees an unreplaced call at runtime. The DuckDB CLI
  behaves compatibly for probing: unset variables yield `NULL`, and
  `SET VARIABLE x = '…';` sets them (see `references/validation.md`).
- Every `getvariable('p')` the SQL reads MUST be declared in `manifest.params`
  (type `string` / `number` / `boolean` — never `integer`/`int`/`float`/`bool`).
- Per-dataset default values can additionally be set in
  `manifest.datasets[].params` (e.g. `{ "limit": 200 }`); URL params override them.
- **A param value arrives in three shapes — handle all three:**
  1. absent → `NULL`,
  2. URL param → escaped **string** (KPI reset tiles send the **empty string** `''`),
  3. `datasets[].params` default → its **JSON type** (numbers are injected
     *unquoted*: `getvariable('limit')` becomes the bare `100`).

  Naive idioms break on one of these (`NULLIF(getvariable('limit'), '')` →
  conversion error when the unquoted number arrives; a plain `IS NULL` check
  misses the `''` reset). Use the normalising idioms:

  ```sql
  -- optional text filter ('' and NULL both mean "no filter"):
  (NULLIF(CAST(getvariable('lens') AS VARCHAR), '') IS NULL OR <predicate>)

  -- numeric param with default:
  LIMIT CAST(COALESCE(NULLIF(CAST(getvariable('limit') AS VARCHAR), ''), '100') AS INTEGER)
  ```
- Defaults live **in the SQL** (and optionally `datasets[].params`), never in the
  frontend.

### Scope block (file filter + S-Block) — mandatory pattern for analysis datasets

Datasets that report per-object findings (rules, checks, anything with a
`nav_uuid` column) MUST use the combined scope building block — one unit, both
lines, placed together:

```sql
AND (getvariable('file') IS NULL OR t.File_Name = getvariable('file'))
AND (getvariable('scope_uuids') IS NULL
     OR t.Script_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
```

- The second line is the **S-Block**: `scope_uuids` is a CSV of `Object_UUID`s
  supplied by the Analysis-Tests run boundary (object / object-list / cluster
  scope). Both predicates collapse to `TRUE` when the params are absent —
  solution scope stays bit-identical.
- **Anchor column** = the same column the dataset exposes as `nav_uuid`
  (`Script_UUID`, `Field_UUID`, generic `Object_UUID`, …). Use
  `IN (SELECT unnest(...))` — DuckDB plans a hash semi-join; never
  `list_contains` (O(n) per row).
- **Placement**: wherever the file filter sits (main WHERE for row rules,
  inside the aggregation CTE, consumer side of asymmetric rules). If a summary
  embeds the findings core textually, the S-Block goes into **both** copies.
- **Aggregating dataset?** Take the anchor column into the projection —
  as a grouping key or via `any_value()` — otherwise the dashboard is not
  scope-capable. After a GROUP BY the anchor must be functionally determined by
  the grouping key (one group = one object; never group by a value attribute
  like a window name and then filter on the anchor).
- Declare the capability in the manifest `analysis.scope` block
  (`supported`/`anchor`/`mode`), and check before delivery: the number of
  `getvariable('scope_uuids')` occurrences must equal the number of
  `getvariable('file')` occurrences per file (M5a), and the S-Block anchor must
  match `analysis.scope.anchor` (M5b).

### ⚠️ The `:word` preprocessor trap

Before the `getvariable` pass, the API replaces **every** `:word` token in the SQL
text — including inside string literals and comments — with the matching request
param or `NULL`. `'localhost:3000'` becomes `'localhostNULL'`; `'fn:1'` becomes
`'fnNULL'`. (`://` is safe — `/` is not a word character.)

Rules:
- Never rely on `:name`-style parameters in bundle SQL; use `getvariable` only.
- Never write a `:` directly followed by `[A-Za-z0-9_]` anywhere in the file. If a
  string literal needs one, split it: `'fn' || ':' || '1'`. Check comments too.

## 4. Locale independence

Catalogs may be imported from any FileMaker localisation. Never match display
names of built-ins:

- Script steps: filter on `Step_ID`, never on `Step_Name` literals. (Real corpus
  example: the comment step's `Step_Name` is `# (comment)`, not `Comment` —
  a `Step_Name = 'Comment'` filter silently matches nothing. Use `Step_ID = 89`.)
- Same principle for any other localised/display-form column; user-defined object
  names (`Object_Name`, `Script_Name`, …) are of course fine to match.
- Add a comment naming the step next to each `Step_ID` literal:
  `st.Step_ID = 89  -- "# (comment)"`.

## 5. Count consistency for KPI subsets

When a KPI hero strip filters a detail table (pattern P2/P3), the KPI counts and
the filtered list MUST agree:

- Define the shared base population **once** as a CTE and use the *same* CTE text
  in the summary SQL and the detail SQL (copy it; add a header comment
  `-- keep in sync with data/<other>.sql` in both files).
- The summary dataset returns one row: `total` plus one count per subset.
- Subsets from **one** partition dimension should be disjoint and sum to `total`;
  if they overlap by design, say so in the dashboard's Markdown notes block.
- Counting is server-side by definition here — never derive KPI numbers client-side
  from a LIMIT-capped detail dataset.

## 6. Style

- Column names: short, lowercase, no spaces (`name`, `uuid`, `file`, `step_count`).
- Prefer CTEs over nested subqueries; one statement per file.
- Header comments (all three lines):

  ```sql
  -- @template_type: report
  -- @description: <what the dataset returns>
  -- @params: <name> (optional, default <value>), ...
  ```

- Always plan an optional `file` filter param for multi-file solutions.
- Parameterised `LIMIT` on detail datasets (default 50–200); no LIMIT on
  single-row summary datasets.
- Reference style: `rest-api/templates/dashboards/home/data/*.sql` (system),
  `rest-api/templates/dashboards-custom/developer-workflow/script_todos/data/*.sql` and
  `rest-api/templates/dashboards-custom/modularization/external_apis/data/*.sql`
  (custom, incl. KPI-filter wiring).
- Read-only: never `UPDATE` / `INSERT` / `DELETE` / DDL.
- **Never regex a `*_XML` column for something `ObjectLinks` already resolves**
  (project rule; the link roles are resolved at import — query the edge).
