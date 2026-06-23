# Community Detection

Standalone batch that computes **community / module clusters** over the FileMaker
object graph and writes them into the master DuckDB, so the Graph Explorer can
color nodes by module.

This is **not** part of the `convert-xml` pipeline — run it manually after a
(re-)import. See _"Why standalone"_ below.

## Run

```bash
bash tools/graph-export/cluster.sh
```

Knobs (env):

| Var                        | Default | Meaning                                                        |
| -------------------------- | ------- | -------------------------------------------------------------- |
| `FMLAB_CLUSTER_ENGINE`     | `auto`  | `auto` \| `louvain` \| `leiden`                                |
| `FMLAB_CLUSTER_RESOLUTION` | `1.0`   | Louvain/Leiden resolution (higher → more, smaller communities) |
| `FMLAB_CLUSTER_SEED`       | `42`    | PRNG seed — fixed so colors are reproducible between runs      |
| `FMLAB_CLUSTER_NO_SYNC`    | –       | set `1` to skip the rest-api copy + `/api/admin/reload`        |

Engine selection (`auto`): **Leiden** when `python3` + `igraph` are importable,
otherwise the guaranteed Node/**Louvain** baseline (no hard Python dependency).
The chosen engine is persisted in `ObjectClusters.Engine` (provenance).

## Pipeline

```
graph_export_logical.sql  →  edges.csv         (SELECT FROM ClusterEdges; ORDER BY → stable)
cluster_louvain.mjs       →  communities.csv   (node → community; graphology; Q on stderr)
  └ or cluster_leiden.py                        (igraph, optional drop-in; Q on stderr)
cluster_load.sql          →  ObjectClusters + CommunityNames (heuristic names)
sync_db.sh                →  rest-api/db copy + reload
```

The edge export is **sorted** (`ORDER BY source, target`), so `edges.csv` is
bit-identical across runs and the (order-sensitive) engines produce the same
partition for a fixed seed+resolution — reproducible cluster colors.

The clustering input is the **same cleaned logical graph the Explorer renders**
in `mode=logical` (operational links, sub-objects hoisted to their container,
builtins + orphans removed) — so cluster colors match the shown topology.

### Logical edge source — the `ClusterEdges` view (`graph_export_logical.sql` ≥ 2.0.0)

The cleaned edge set is a **DuckDB view**, not inline SQL. `convert-xml` Phase 5
([sql/convert-xml/convert_xml_05_homes.sql](../../sql/convert-xml/convert_xml_05_homes.sql))
creates two views as a single source of truth:

- **`LogicalLinks`** — operational links, sub-objects hoisted to their container,
  containment scaffold + orphans removed, `(source,target)`-deduped. **With** builtins.
  Canonical definition: [rest-api/templates/sql/graph_logical_links.sql](../../rest-api/templates/sql/graph_logical_links.sql).
- **`ClusterEdges`** — `LogicalLinks` minus `BuiltinFunction` endpoints. This is
  the exact engine input and the canonical **logical degree** definition the
  `fm-graph-cluster` skill uses for its hub analysis.

`graph_export_logical.sql` just does `SELECT … FROM ClusterEdges ORDER BY source, target`.
The 2.0.0 switch from inline-CTE to view-read is **bit-identical**.
Because `cluster.sh` runs the export `-readonly`, the views must already exist —
a fresh `convert-xml --batch` creates them in P5.

## Output tables

```
ObjectClusters(Object_UUID PK, Community INT, Engine)
CommunityNames(Community, Engine, Member_Count, Dominant_Type, Dominant_File,
               Top_Member_UUID, Top_Member_Label, Sample_Labels[],
               Heuristic_Name,        -- always (deterministic, no LLM)
               Semantic_Name,         -- optional naming step, nullable
               Semantic_Description)  -- optional, nullable (deep-research only)
```

Heuristic name = `Dominant_File · Top_Member_Label (+N)`. Display in the Explorer
is `COALESCE(Semantic_Name, Heuristic_Name)`. The optional semantic-naming step
(reads the hint columns, fills `Semantic_Name` — and `Semantic_Description` in
deep-research mode) is not required — the explorer works fully on heuristic names.

## Semantic naming via `fm-graph-cluster`

The `Semantic_Name` / `Semantic_Description` columns are filled by the
**`fm-graph-cluster`** skill (`.claude/skills/fm-graph-cluster/`). Beyond just
naming, the skill **picks the resolution itself**: it sweeps candidate
resolutions (export edges once, run the engine N×), scores each by **modularity
`Q`** (now emitted on the engine's stderr — `modularity=…`) plus distribution
guardrails relative to the solution size, runs the winner through `cluster.sh`
once, then fills the names via bundled `UPDATE`s and writes an analysis report to
`output/graph_cluster_report_<ts>.md`.

Because `cluster_load.sql` rebuilds `CommunityNames` via `CREATE OR REPLACE`,
**every cluster run wipes the semantic names** — so naming is always the skill's
_last_ write step, and the rest-api sync runs once at the very end (after naming)
so the Explorer sees the named partition in a single reload. The sync itself lives
in the reusable `sync_db.sh` (cluster.sh step 5 and the skill both call it).

**Partition, not overlap:** Louvain/Leiden produce a _partition_ — every node belongs to
**exactly one** community (`ObjectClusters.Object_UUID` is unique). Overlapping membership
would require a different algorithm (link communities / clique percolation) and is out of scope.

## How the Explorer consumes it

`graph.service.js` enriches subgraph nodes with `community` (int color key) +
`communityName` (display) via a **guarded** lookup — only if `ObjectClusters`
exists (`information_schema` check). The subgraph SQL itself never joins the
cluster tables, so the Explorer keeps working _before_ the first cluster run and
on databases that never clustered (community stays `null`). The standalone
`/graph` view exposes a Type↔Community color toggle + legend; the embedded
object-view panel does not.

## Why standalone, not part of the import pipeline

> **Disclaimer — illustrative numbers only.** The figures below come from a single
> run against one example FileMaker solution. That solution is **not necessarily
> representative**; the numbers are for illustration and **cannot be transferred 1:1**
> to your own solutions (graph size, density and hardware all change them). The
> _conclusion_ that follows holds regardless — it is about keeping the pure-SQL
> import separate from extra (Node) code, not about any particular runtime.

Example run (one sample solution):

- input: **178 478** logical edges / **56 794** nodes (builtins/orphans removed)
- Louvain: parse **535 ms**, cluster **129 ms**, peak RSS **243 MB**
- result: **453** communities, largest 4 879, avg 125 members
- total wall-clock incl. export + load: **~1–2 s**

The compute itself is cheap, **but** it needs Node + `graphology` and the fully
built `ObjectCatalog`/`ObjectLinks`. The import pipeline is otherwise pure DuckDB
SQL; folding a Node step into it would add a runtime dependency to **every** import
for a one-off gain. **Recommendation: keep it a standalone tail step** (run after the
import), and revisit only if module coloring becomes a default expectation of every
import.

## Dependencies

- `graphology` + `graphology-communities-louvain` — root `devDependencies`
  (build-time only; no new REST-API runtime dependency).
- optional: `python3` + `python-igraph` for the Leiden enhancement.
