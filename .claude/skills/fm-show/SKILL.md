---
name: fm-show
version: 0.8.9
description: >
  Opens a FileMaker object in the FM-Lab web frontend (browser deep link) —
  detail view by default, references or graph view via flags; works from inside
  the dev container by opening the browser on the host. Use fm-open instead to
  jump to the object in FileMaker Pro itself. Triggers (English): "/fm-show",
  "show this in FM-Lab", "open in the web frontend", "show the references in
  the browser", "show the callers in FM-Lab", "show this in the graph".
  Triggers (German): "zeig das in FM-Lab", "im Web-Frontend öffnen", "zeig die
  Referenzen im Browser", "zeig die Aufrufer in FM-Lab", "zeig das im Graph".
  Triggers (Spanish): "muestra esto en FM-Lab", "muestra las referencias en el
  navegador". Triggers (French): "montre ça dans FM-Lab", "montre les
  références dans le navigateur". Triggers (Italian): "mostra questo in
  FM-Lab", "mostra i riferimenti nel browser". Triggers (Dutch): "toon dit in
  FM-Lab", "toon de referenties in de browser". Triggers (Portuguese): "mostre
  isto no FM-Lab", "mostre as referências no navegador". Triggers (Swedish):
  "visa detta i FM-Lab", "visa referenserna i webbläsaren". Triggers
  (Japanese): "これをFM-Labで表示して", "参照をブラウザで表示して". Triggers
  (Korean): "이것을 FM-Lab에서 보여 줘", "참조를 브라우저에서 보여 줘".
  Triggers (Chinese): "在 FM-Lab 中显示这个", "在浏览器中显示引用".
---

# fm-show — Show a FileMaker object in the FM-Lab web frontend

## Purpose

Opens the discussed object as a deep link in the FM-Lab web UI: detail view
(default), where-used references, or the focused graph explorer. Every
ObjectCatalog UUID is addressable — unlike fmIDE there is **no type restriction**
(variables, layout objects etc. all work). Neighbour skill: **fm-open** jumps to
the object in FileMaker Pro itself. Answer the user in the user's language; this
document is English by convention.

## Prerequisites

- Master DB `db/fm_catalog.duckdb` (object resolution). Missing → abort with a
  pointer to the `convert-xml` skill. No REST-API requirement — the frontend dev
  server alone is enough.
- A reachable FM-Lab web frontend (dev server on :5173, or any base URL the user
  provides). Not reachable → see error table.

## Arguments & modes

| Argument / flag | Effect | Default |
|---|---|---|
| _(none)_ / `<name>` / `<uuid>` / `--file <File>` / `--list` / `--dry-run` | identical to fm-open (shared resolution) | — |
| _(no view flag)_ | **Detail view** | ✓ |
| `--refs` | References view (where-used tree) | — |
| `--graph` | Graph view (full-screen explorer, focused on the object) | — |
| `--type <T[,T…]>` | Only with `--refs`: restrict the view to these object types (comma-separated, e.g. `Script` or `Script,Layout`) | all types |
| `--dir <in\|out>` | Link direction: `in` = incoming (who references/calls this object), `out` = outgoing (what this object references). Works with `--refs` and `--graph` | both |
| `--depth <1-16>` | Only with `--graph`: subgraph depth (clamp out-of-range values to the nearest bound, like the frontend does) | 2 |
| `--ref <name\|uuid>` | Highlight object: the target opens with `ref=<uuid>` and the frontend marks where that object appears (canvas highlight on layouts, token hits in formulas, origin pill) | auto-derived, see step 1a |
| `--base-url <url>` | Frontend base URL override | probed (see step 2) |

Natural-language routing: "show the references / zeig die Referenzen" → `--refs`;
"show it in the graph / zeig das im Graph" → `--graph`; "show who calls this
script (in FM-Lab) / zeig die Aufrufer" → `--refs --type Script --dir in`;
"show what it uses / zeig was es verwendet" → `--refs --dir out`.

Relational requests ("show the layout where a button calls this script") are a
target form, not a flag — see step 1a.

Examples: `/fm-show` · `/fm-show Status Umsatzsteuer Nr --refs` ·
`/fm-show Umsatzsteuer Nr prüfen --refs --type Script --dir in` (callers) ·
`/fm-show --graph --depth 3 --dir out` · `/fm-show 8075DF6B-… --file Kunden`

## Workflow

### 1 — Resolve the object

Follow `.claude/skills/_shared/resolve-object.md` (read it now if not loaded).
Result: `Object_UUID`, `Object_Type`, `Object_Name`, `File_Name`. The existence
check against the master DB is part of the resolution — no API round-trip.
`--list` mode: shared selection-list table, then stop.

### 1a — Relational targets and the `ref` highlight

When the request names the target **through a relationship** ("the layout where
a button calls this script", "the layout that displays this field"), resolve it
in two hops via ObjectLinks: first the connecting object, then its container —
the container becomes the target, the connecting object becomes `ref`. Example
(buttons calling script `<S_UUID>`; other cases swap the first `Link_Role`,
e.g. `displays_field`):

```sql
SELECT btn.Object_UUID AS Ref_UUID, btn.Object_Type AS Ref_Type,
       lay.Object_UUID AS Target_UUID, lay.Object_Name AS Layout_Name, lay.File_Name
FROM ObjectLinks trig
JOIN ObjectCatalog btn ON trig.Source_UUID = btn.Object_UUID AND btn.Object_Type = 'LayoutObject'
JOIN ObjectLinks pl ON pl.Source_UUID = btn.Object_UUID AND pl.Link_Role = 'parent_layout'
JOIN ObjectCatalog lay ON pl.Target_UUID = lay.Object_UUID
WHERE trig.Target_UUID = '<S_UUID>' AND trig.Link_Role = 'triggers_script';
```

Several hits (script wired to buttons on multiple layouts) → selection list
showing layout + connecting object + file.

Set `ref` automatically in two more cases:
- **Target is itself a sub-object** (LayoutObject, ScriptStep): it has no useful
  standalone detail view — open its container instead (`parent_layout` /
  `parent_script` link) with `ref=<sub-object UUID>`.
- **`--ref`** names an object explicitly → resolve it like any object argument.

Do NOT attach `ref` to unrelated lookups (plain `/fm-show <name>` with no
relationship in the request) — the frontend degrades gracefully on a no-match
ref (highlight pill hides), but a meaningless ref is still noise in the URL.

### 2 — Determine the frontend base URL

```bash
.claude/skills/fm-show/scripts/resolve_base_url.sh [<--base-url value>]
```

Priority chain inside the script: explicit argument → `FMLAB_WEB_URL` env →
probe candidates. The script separates the PROBE address from the PUBLIC
(browser) address: in the Docker Compose stack the web dev server lives in a
sibling container, reachable in-container only via `http://web:5173` (compose
DNS, answers 403 to the foreign Host header — still proof of life), while the
returned URL stays `http://localhost:5173` (host port mapping). It also probes
`localhost:3003`/`api:3003` for an SPA-serving REST API (activates
automatically once the API serves HTML; skipped while it answers JSON). Exit 4 = nothing reachable → offer to
start the frontend (via the `rest-frontend-start` command if available,
otherwise the setup's usual start); on request build the URL against
`http://localhost:5173` anyway and display it (`--dry-run`-style).

`localhost` is correct even inside the dev container: VS Code auto-forwards the
port and the `$BROWSER` helper opens the URL on the host. For remote hosts the
user supplies `--base-url` / `FMLAB_WEB_URL`.

### 3 — Build the deep link

URL-encode every parameter value (in a script-safe way, e.g.
`jq -rn --arg v "$VALUE" '$v|@uri'`).

| Case | URL pattern |
|---|---|
| Detail (default) | `<base>/object/<uuid>?file=<File_Name>[&ref=<uuid>]` |
| References (`--refs`) | `<base>/object/<uuid>?file=<File_Name>&tab=references[&types=<T,…>][&rdir=<in\|out>]` |
| Graph (`--graph`) | `<base>/graph?focus=<uuid>&focus_file=<File_Name>&depth=<n>&dir=<both\|in\|out>` |
| Object_Type = File | `<base>/file/<File_Name>` (file dashboard instead of object detail) |
| Object_Type = Layout, detail case | normal detail URL; mention the full-screen canvas link `<base>/layout/<uuid>?file=<File_Name>[&ref=<uuid>]` in the success message |

`ref` (from step 1a) attaches to `/object/` and `/layout/` URLs — including the
references tab, where it marks the origin's hits; on the layout canvas it
highlights and pre-selects the ref'd object. Not applicable to `/graph` (the
focus node is the anchor) or `/file/`.

Filter-flag mapping: `--type` → `types` (comma-CSV), `--dir` → `rdir` (refs) /
`dir` (graph). Both are omitted at their defaults (all types / both) — the
frontend treats a missing param exactly like the default.

`--type` values are matched against the catalog before building the URL
(`SELECT DISTINCT Object_Type FROM ObjectCatalog` — the references filter is
case-sensitive): case-correct silently, warn on values with no match and name
close candidates. `--type` with `--graph` is not URL-addressable (the explorer's
type filter is in-UI only) — say so briefly and build the graph URL without it.

### 4 — Open

```bash
.claude/skills/_shared/scripts/open_url.sh "<url>"
```

In plain Docker (no VS Code `$BROWSER`) the script hands the URL to the host
open-bridge (`fmlab.sh up --claude` / `agent` auto-start it; standalone:
`bash tools/fmlab.sh open-bridge` on the host). Exit 3 (no mechanism, bridge
not running) → present the URL as a clickable Markdown link — with Compose port
mapping it works on the host as-is — and mention the open-bridge command.
`--dry-run`: display the URL, do not open.

## Output

Success is a single line:

```
FM-Lab → Field "Status Umsatzsteuer Nr" (references) opened at http://localhost:5173/object/…&tab=references (via $BROWSER).
```

## Error cases

| Symptom | Cause | Reaction |
|---|---|---|
| DB missing / ObjectCatalog empty | no import yet | Abort → `convert-xml` |
| No object in context, no argument | nothing discussed yet | Usage hint (see resolve-object.md) |
| Name/UUID ambiguous | duplicates / clone files | Selection list, wait |
| `resolve_base_url.sh` exit 4 | no frontend running | Offer a frontend start (`rest-frontend-start` if available); on request show the :5173 URL anyway |
| `open_url.sh` exit 3 | headless / plain Docker without a running open-bridge | Show the URL as a clickable link + hint: `bash tools/fmlab.sh open-bridge` (host) enables auto-opening |
| `--depth` outside 1–16 | user input | Clamp to the bound, note it briefly |
| `--type` with no catalog match | typo / wrong case | Case-correct silently; otherwise warn + name close candidates, build without the bogus value |
| `--dir` not `in`/`out` | user input | Fall back to both (mirrors the frontend codec), note it briefly |
| Relational target yields no hits | no such link in ObjectLinks | Say so ("no button on any layout calls this script"), offer the plain detail/refs view of the context object instead |

## Do not do

- No file changes — read-only plus one open invocation.
- Never start the dev server silently; starting it is the user's call.
- No type gating — every catalog object has a detail route.

## References

- `.claude/skills/_shared/resolve-object.md` — read before resolving (step 1).
- `scripts/resolve_base_url.sh` — base-URL probe chain (step 2).
- `.claude/skills/_shared/scripts/open_url.sh` — the only open mechanism (step 4).
