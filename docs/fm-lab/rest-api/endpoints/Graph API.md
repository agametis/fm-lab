# Graph API

Endpoints under `/api/graph/*` expose the object graph (`ObjectCatalog` + `ObjectLinks`) for interactive exploration: focus-centered subgraphs, lazy expansion, the top-down atlas, community/cluster information, and search. `/api/relationship-graph/:fileName` additionally renders the classic FileMaker relationship diagram data for one file.

Common behavior:

- All GET routes accept the standard `format` / `meta` / `debug` parameters ([REST API Conventions](../REST%20API%20Conventions.md)).
- Focus-based routes resolve the focus node clone-aware: optional `focus_file` disambiguates shared UUIDs, otherwise `409 AMBIGUOUS_UUID` (response details list the matching files).
- Node identifiers in responses are composite `uuid::file` (`id`) plus the raw `uuid` — the composite key stays unique across cloned files.
- Subgraph/overview responses are LRU-cached for 5 minutes per parameter set.

---

## GET /api/graph/subgraph

Focus-centered k-hop subgraph.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `focus` | string | — | **Required.** Focus node UUID |
| `focus_file` | string | — | Clone disambiguation of the focus node |
| `depth` | integer | `1` | Traversal depth (server-capped) |
| `direction` | enum | `both` | `out` · `in` · `both` |
| `mode` | enum | `logical` | `logical` (condensed) · `raw` (all edges) |
| `types` | string (CSV) | — | Object types to include |
| `roles` | string (CSV) | — | Edge roles to include |
| `include_builtins` | boolean | `false` | Include builtin-function nodes |
| `node_limit` | integer | `1000` | Node cap; `truncated: true` signals clipping |
| `hub_degree` | integer | `100` | Degree threshold for the `isHub` flag |

**Response `data`**

```json
{
  "focus": "…",
  "params": { "depth": 2, "direction": "both", "…": "…" },
  "truncated": false,
  "stats": { "nodeCount": 57, "edgeCount": 84, "totalReachable": 57, "maxDepthReached": 2 },
  "nodes": [ { "id": "uuid::File", "uuid": "…", "label": "…", "type": "Script", "file": "…",
               "depth": 1, "degree": 4, "isHub": false, "isFocus": false,
               "community": 3, "communityName": "Invoicing", "hidden": false } ],
  "edges": [ { "id": "…", "source": "…", "target": "…", "role": "calls_script",
               "subrole": null, "linkType": "operational", "crossFile": false } ]
}
```

`community`/`communityName` are `null` when the solution has not been clustered yet. Errors: `404 OBJECT_NOT_FOUND`, `409 AMBIGUOUS_UUID`.

## GET /api/graph/neighbors

1-hop expansion around an existing node (lazy expand). Identical parameters and response shape as `/graph/subgraph`, but without `depth` (fixed to 1).

## GET /api/graph/depth-profile

Maximum reachable depth (eccentricity) from a focus plus per-depth node counts — lightweight companion to the subgraph depth slider.

Parameters: `focus` (required), `focus_file`, `direction`, `mode`, `types`, `include_builtins` — same semantics as `/graph/subgraph`.

Response `data`: `focus`, `direction`, `mode`, `maxDepth`, `hitCap` (true when the walk hit the server's depth cap — real eccentricity may be larger), `hardCap`, and `perDepth[]` of `{ depth, nodes, cumulative }`.

## GET /api/graph/overview

Top-down atlas entry point: treemap (composition) or meta-graph (topology) over the whole solution.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `view` | enum | `composition` | `composition` (treemap) · `topology` (meta-graph) |
| `level` | enum | `root` | Treemap funnel: `root` · `segment` · `leaf` |
| `segment_by` | enum | `community` | `community` · `file` · `type` · `hubs` |
| `parent_community` / `parent_file` / `parent_type` | — | — | Drill-down context for levels `segment`/`leaf` |
| `weight` | enum | `domain` | Segment weighting: `domain` · `logical` |
| `include_builtins` | boolean | `false` | |
| `exclude_types` | string (CSV) | — | Object types to hide (applied before aggregation) |
| `fold` | boolean | `true` | Top-K folding with a "rest" tile; `false` = all segments |
| `limit` | integer | `50` | Top-N cutoff |

Composition responses return `tiles[]` (aggregate tiles with `key`, `label`, `node_count`, `weight`; leaf tiles with `uuid`, `file`, `type`; a folded tail becomes a `kind: "rest"` tile). Topology responses return super-`nodes[]` and undirected, de-duplicated `edges[]` with weights.

## GET /api/graph/communities

Full community list of the active cluster partition, sorted by member count. Returns per community: `community` (id), `display_name` (user name > semantic name > heuristic name > "Community N"), `description`, `member_count`, `dominant_type`, `dominant_file`, and a representative top member. Without clustering: `{ "engine": "", "communities": [] }` (HTTP 200).

## GET /api/graph/community-stats

Cluster availability and naming status for the atlas status bar: `engine`, `clusters_available` (whether the active engine has cluster data at all), `total_communities`, `named_communities`, `coverage_pct` (member-weighted semantic-name coverage, `null` when unnamed), and the persisted metrics of the last cluster run (`modularity_q`, `resolution`, `seed`, …). Degrades gracefully to zeros/false when no clustering exists.

## GET /api/graph/search

Focus autocomplete over `ObjectCatalog`.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `q` | string | — | **Required.** Search text |
| `type` | string | — | Optional type filter |
| `file` | string | — | Optional file filter |
| `limit` | integer | `20` | Max 100 |

Response: `results[]` of `{ id, label, type, file }`.

## POST /api/graph/recluster

Re-runs the graph clustering for the request's context solution and streams progress as **Server-Sent Events** (`text/event-stream`):

- `{ "event": "start", "ts": … }`
- `{ "event": "log", "level": "info", "msg": "…" }` — one per pipeline log line
- `{ "event": "done", "ok": true, "exit_code": 0 }` — terminal
- `{ "event": "error", "message": "…" }` followed by a failing `done` on errors

Engine, resolution and seed come from the solution's stored cluster configuration; no request body is required. Returns `409 ALREADY_RUNNING` when a recluster or an XML conversion is already active — the run shares the per-solution conversion lock, so parallel imports are rejected as well. A client disconnect does not abort the run.

## GET /api/relationship-graph/:fileName

Complete relationship-diagram model for one FileMaker file (`:fileName` = `File_Name`): table occurrences with geometry and color, relation-participating fields per TO, and relationships grouped by join predicate.

**Response `data`**

- `viewport` — bounding box over all TO boxes
- `tableOccurrences[]` — `uuid`, `id`, `name`, `baseTable`, `dataSource`, `view` (`Full`/`Related`/`Collapse`), `bounds`, `color`, `fields[]` (`{ uuid, id, name, dataType, isUsedInRelation }`)
- `relationships[]` — `id`, `left`/`right` (`{ toUuid, toName, cascadeCreate, cascadeDelete }`), `predicates[]` with operator symbols (`=`, `≠`, `<`, `≤`, `>`, `≥`, `×`)

Errors: `404 OBJECT_NOT_FOUND` when the file is not in the catalog.

---

See also: [References API](References%20API.md) (tabular reference lookups), [Solutions API](Solutions%20API.md) (cluster state lives per solution).
