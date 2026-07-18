---
name: create-custom-dashboard
version: 0.9.0
description: Interactively creates a new custom dashboard bundle for the fm-lab dashboard system. Clarifies the goal, drafts SQL, confirms sample results with the user, recommends an interactive dashboard pattern (navigation, KPI filters, search), asks for a name, and generates the full bundle directory under `rest-api/templates/dashboards-custom/<id>/`. Triggers (English): "/create-custom-dashboard", "create a new dashboard for X", "new dashboard", "build a dashboard that shows X". Triggers (German): "erstelle ein neues Dashboard für X", "neues Dashboard", "baue ein Dashboard das X zeigt".
---

# Create a custom dashboard

Guide the user interactively through the creation of a new dashboard bundle. The
result is a complete bundle directory under
`rest-api/templates/dashboards-custom/<id>/` containing `manifest.json`,
`layout.json`, at least one SQL file under `data/`, and 10 locale files.

## Reference files (read at the step that needs them)

| File | Content | Read before |
|---|---|---|
| `references/sql-rules.md` | join matrix (UUID+file), params, `:word` trap, locale independence, count consistency | step 2 (first SQL draft) |
| `references/patterns.md` | patterns P1–P6, intent matrix, interactivity duties in full | step 3 (recommendation) |
| `references/primitives.md` | all primitives/props, actions, tokens, formats, manifest schema | step 5 (writing files) |
| `references/localization.md` | locale files, ID-form overrides | step 5.5 |
| `references/validation.md` | verification gate V1–V6, auto-heal, closing message | step 5.6 |

## Directory split

| Directory | Content | Who writes? |
|---|---|---|
| `rest-api/templates/dashboards/` | system bundles (`home`, `_generic`, `custom_queries`, `dashboards`) | core team only |
| `rest-api/templates/dashboards-custom/` | custom/plugin bundles | this skill, user plugins |

The resolver searches both; on ID collision the custom directory wins. This skill
writes **exclusively** to `dashboards-custom/`.

## Ground rules

- **Language**: dialogue in the user's input language. SQL files, `manifest.json`,
  `layout.json`: English only (filenames, params, aliases, labels, comments).
  Translations go to `locales/<lang>.json` (step 5.5).
- **Database**: `db/fm_catalog.duckdb` (master — NOT `rest-api/db/`); with an
  active session pin (`FMLAB_SOLUTION`/`FMLAB_CONTEXT`, CLAUDE.md §2) run
  draft/sample queries against the literal bundle path
  `solutions/<id>/db/fm_catalog.duckdb`.
- **DuckDB invocation**: bare `duckdb db/fm_catalog.duckdb -c "…"` per
  CLAUDE.md §2; never install DuckDB yourself.
- **Read-only**: never UPDATE/INSERT/DELETE on the database.
- **Identity rule (memorise):** an object's identity is **(UUID, File_Name)** —
  numeric FileMaker IDs are file-scoped, and UUIDs can be duplicated by cloned
  files. Join and GROUP BY on the pair. Details: `references/sql-rules.md`.
- **Interactivity duties (memorise):**
  - **I1** object rows are always navigable (`openObject` with `uuid`+`type`+`file`);
  - **I2** meaningful partitions become clickable filters (KPI hero tiles /
    FilterChips — server-side via URL param → `getvariable`);
  - **I3** every List/Table/TileGrid that typically exceeds 3 rows gets
    `"searchable": "auto", "searchAutoThreshold": 3`.

## The three gates (non-negotiable)

Files are written **only after all three gates have an explicit user answer**:

| Gate | After | Confirms |
|---|---|---|
| **G1** | step 2 preview | the data is what the user needs |
| **G2** | step 3 | pattern & presentation |
| **G3** | step 4 | ID & title |

**Every gate is an AskUserQuestion tool call** — never a question typed as prose
at the end of a working turn, and never answered by yourself because the choice
"seems obvious". If the AskUserQuestion tool is unavailable in this session
(headless run), ask the question as the **last line of your reply and end the
turn** — do not continue working past an unanswered gate.

A topic passed with the invocation (e.g. `/create-custom-dashboard variable
analysis`) skips only the step-1 topic question — never G1–G3.

---

## Workflow

### Step 1 — Clarify the goal

If no topic was provided, ask one short question (AskUserQuestion, free-form via
"Other" is fine): *"What should the dashboard show?"* with 2–3 example options
drawn from the catalog domain (e.g. variable overview, scripts without comments,
lookup fields).

With the topic in hand, silently classify the **intent** using the matrix in
`references/patterns.md` (worklist? counts-per-trait? two-level drilldown?
lenses/thresholds? multi-facet? static?). The intent drives steps 2–3: a P2/P3
intent needs a summary dataset and a filter param from the start.

### Step 2 — Draft the SQL, execute, preview

**Read `references/sql-rules.md` now.** Draft the dataset SQL accordingly
(identity rule, result contract with `uuid`/`file`/`name`, `getvariable` params,
no `:word` sequences, `Step_ID` instead of step-name literals).

Execute with a preview limit:

```bash
duckdb db/fm_catalog.duckdb -c "<SQL with LIMIT 10>"
```

On error: correct once and re-run. After two failures, take the error to the user
via AskUserQuestion (options: alternative interpretation / different data source /
abort).

Run the **fan-out plausibility check** from sql-rules.md §1 when top counts look
identical, round, or too high.

Present the result: ≤10 rows fully; >10 rows as "first 10 of N"; >8 columns the
most important ones; 0 rows → say so and propose an alternative query.

### Gate G1 — Confirm the data (AskUserQuestion)

Question: *"Does this preview show what you need?"*
Options (adapt): **"Yes, continue" (Recommended)** · "Adjust columns/filters" ·
"Different data entirely". On 0 rows or implausible counts, replace the first
option with your best alternative hypothesis. Iterate step 2 until G1 passes.

### Step 3 — Recommend pattern & presentation

**Read `references/patterns.md` now.** Two stages:

1. **Pattern** from the intent matrix (P1 navigator, P2 segmented overview,
   P3 aggregate+drilldown, P4 lens, P5 multi-facet, P6 static; combinations
   allowed — P2+P3 is the normal case for real analyses).
2. **Primitives** from the shape table (List vs Table vs AutoTable vs TileGrid …).

The recommendation **already includes** the interactivity duties — G2 asks *how*
to present, never *whether* rows are clickable or searchable. If the data has a
partition dimension (I2), name the concrete KPI tiles the user will get (e.g.
"Total / with trait / without trait — each tile filters the list") and, when the
partition dimension is ambiguous, ask for it **in the same** AskUserQuestion
(second question in the call, multiSelect where traits combine).

### Gate G2 — Confirm presentation (AskUserQuestion)

Question: *"Which presentation should I build?"*
Options: **recommended pattern (Recommended)** with a one-line description of its
interactivity · at most 2 alternatives · (optional second question: partition
dimension). Keep option labels short; put the tile/filter/search summary in the
description.

### Step 4 — Propose ID and title

- **ID** (= directory basename): lowercase ASCII `a-z0-9_`, max 30 chars; avoid
  reserved system IDs `home`, `_generic`, `custom_queries`, `dashboards`.
  Transliterate user-language names (ä→ae, ö→oe, ü→ue, ß→ss, é→e, …).
- **Title** (manifest default): English, max 50 chars, human-readable. If the
  user's language ≠ English, also show the localized title that will land in
  `locales/<lang>.json`.

### Gate G3 — Confirm the name (AskUserQuestion)

Question: *"Use this name?"* Options: **"`<id>` / \"<title>\"" (Recommended)** ·
1 alternative naming · ("Other" catches free-form names — derive ID and English
title from whatever the user supplies).

### Write-gate (self-check — not a user question)

Immediately before writing: **do G1, G2 and G3 each have an explicit user answer
in this conversation?** If any is missing (e.g. after a compaction or a detour),
ask that gate **now**. Never write files on inferred consent.

Then check for collisions:

```bash
ls rest-api/templates/dashboards-custom/ rest-api/templates/dashboards/
```

If the ID already exists in `dashboards-custom/`: ask (AskUserQuestion) whether to
overwrite or rename.

### Step 5 — Generate the bundle

**Read `references/primitives.md` now** (node shape, `id` convention, props,
actions, manifest schema constraints) and keep `references/patterns.md`'s skeleton
for the chosen pattern at hand.

1. **`data/<dataset>.sql`** — final SQL per sql-rules.md (`@template_type` /
   `@description` / `@params` header; parameterised LIMIT instead of the preview
   LIMIT). Separate files for logically separate datasets (summary KPI + detail
   list). Shared base population = shared CTE text in both files (sql-rules §5).
2. **`manifest.json`** — schema constraints per primitives.md §Manifest.
   Declare every `getvariable` param under `params`; icon from the Lucide list;
   `"permissions": { "read_only": true, "allow_navigation": true }`.
3. **`layout.json`** — `Grid(columns:12)` root, every content unit in a `Card`,
   **every node with a stable `id`**. First card without `title` (the entry title
   comes from `manifest.title`); only genuine section labels on follow-up cards.
   Apply I1–I3 exactly as confirmed in G2.
4. **`locales/*.json`** — **read `references/localization.md`**, generate all 10
   languages with ID-form keys in one pass.

### Step 5.6 — Verification gate (BLOCKING — never skip)

**Read `references/validation.md` and run V1–V6**: cache reload, `GET
/api/dashboards/<id>`, log check (incl. `[dashboard-i18n]` warnings), one
auto-heal retry for the known manifest failures, dataset probes (default run
**and one run per filter param** via `SET VARIABLE`), KPI/detail count
consistency, interactivity self-check I1–I3.

Writing the bundle and announcing success without this gate has hit us
repeatedly — Joi rejects silently and the API only says "not found or invalid";
the real reason is always in `logs/rest-api.log` with prefix `[dashboard:<id>]`.

### Step 5.7 — Closing message

Use the template in `references/validation.md` (files tree, pattern, filter
params with an example URL, verification status, interactivity waivers).

---

## Example run (compressed)

**User**: `/create-custom-dashboard scripts without comments`

1. Topic given → intent: worklist with a trait partition (P1+P2).
2. Read sql-rules.md → draft (note `Step_ID = 89 -- "# (comment)"`, identity-pair
   joins, `pattern`/`file`/`limit` params) → preview 10 of 47 rows.
3. **G1** (AskUserQuestion): "47 scripts, columns name/file/steps — is this the
   data you need?" → *Yes.*
4. Read patterns.md → recommend P2: KPI heroes "Total / without comment / with
   comment" filtering a searchable, clickable script list; alternative plain P1.
   **G2** → *P2.*
5. **G3**: `scripts_without_comment` / "Scripts without comment" → *Yes.*
6. Write-gate: G1 ✓ G2 ✓ G3 ✓ → collision check → write data/ (summary.sql +
   scripts.sql sharing the base CTE), manifest, layout (ids everywhere,
   `searchAutoThreshold: 3`, `openObject` with uuid+file), 10 locales.
7. Validation gate V1–V6 → closing message with `/dashboard/scripts_without_comment?pattern=without`.
