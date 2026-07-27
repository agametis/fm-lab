# REST API Output Formats

Most read endpoints accept a `format` query parameter that controls how results are rendered. Eleven formats are supported; names are case-insensitive. The default is `json` everywhere except `/report` (default `html`) and `/get-calc` (default `tokens`).

**Envelope rule:** `json` and `tokens` are structured formats — they are wrapped in the standard `{ success, data, meta }` envelope and served as `application/json`. Every other format returns the rendered payload **directly** (no envelope) with its own content type; when `meta=true` or `debug=true` is set, the metadata is appended as a trailing comment (`<!-- … -->` in HTML/Markdown, `# …` in text formats).

**Validation:** a format outside the enum is rejected with `400 VALIDATION_ERROR` before the endpoint runs. A *valid* format applied to data it cannot render either degrades gracefully (the text formats) or fails (`mermaid` on non-graph data, `tokens` outside its two endpoints).

| Format        | Content type       | Best for                                                        |
| ------------- | ------------------ | --------------------------------------------------------------- |
| `json`        | `application/json` | Programmatic access (default)                                   |
| `raw`         | `text/csv`         | Spreadsheet import, piping                                      |
| `text`        | `text/plain`       | Quick `UUID \| Name` lists                                      |
| `short`       | `text/plain`       | Names only                                                      |
| `detailed`    | `text/plain`       | One-line summaries with file/type/refcount                      |
| `html`        | `text/html`        | Browsable result table                                          |
| `markdown`    | `text/markdown`    | Pasting into docs/issues                                        |
| `content`     | `text/plain`       | Prose output of content templates                               |
| `mermaid`     | `text/html`        | Rendered dependency diagram                                     |
| `mermaid-raw` | `text/plain`       | Mermaid source for further processing                           |
| `tokens`      | `application/json` | Editor-style token rendering (`/get-details`, `/get-calc` only) |

---

## json (default)

The result rows unchanged, inside the standard envelope. Single-object endpoints (`/get`) return an object, list endpoints an array.

```json
{ "success": true, "data": [ { "Object_UUID": "ABC-123", "Object_Type": "Script", "Object_Name": "Import Data", "File_Name": "Contacts" } ] }
```

## raw

CSV: header row from the union of all row keys, one line per row. Values containing commas, quotes or newlines are quoted with `"` doubling. Suited to any tabular result.

```
Object_UUID,Object_Type,Object_Name,File_Name
ABC-123,Script,Import Data,Contacts
DEF-456,Field,"Name, full",Contacts
```

## text

One line per row: `UUID | Name`. The formatter resolves UUID/name across common column variants (`Object_UUID`, `Source_UUID`, `Target_UUID`, …) and falls back to `N/A` / `Unnamed`.

```
ABC-123-DEF | Import Data
DEF-456-GHI | Validate Order
```

## short

Object names only, one per line — the piping-friendly minimal form.

```
Import Data
Validate Order
```

## detailed

One line per row: `UUID | File | Type | Name | RefCount`. The last column is populated when the result carries a count/depth field (e.g. `/references`, grouped `/count`), otherwise `-`.

```
ABC-123-DEF | Contacts | Script | Import Data | 3
DEF-456-GHI | Contacts | Field  | Order_Total | -
```

## html

A standalone HTML document with a styled table (header row from the union of all keys, escaped cells, row-count footer). Renders any tabular result browsable; empty results produce a "No data available" page.

## markdown

A Markdown table with heading and `_Total rows: N_` footer; pipes and backslashes escaped, newlines collapsed. Ready to paste into issues or documentation.

```markdown
| Object_UUID | Object_Name |
| --- | --- |
| ABC-123 | Import Data |
```

## content

Emits only the `content` column of each row, joined by newlines — everything else is dropped. Designed for templates that pre-render their output *inside SQL*: the rows form a text artifact line by line, and `format=content` concatenates them. On results without a `content` column the output is empty. Detail templates marked as content templates render as `content` automatically for any non-JSON format.

The artifact does not have to be prose. Content templates are the generic escape hatch for any text-based output format the SQL can assemble — narrative summaries, Mermaid source (see below), or complete **SVG markup** such as a layout wireframe whose `<svg>`/`<rect>`/`<text>` elements are built row-wise from `LayoutObjects` geometry:

```
Script: Import Data (Contacts)
Steps: 12 · References: 3
This routine imports the daily customer feed …
```

## mermaid · mermaid-raw

Diagram rendering with two auto-detected input modes:

1. **Graph mode** — result rows carry `source_uuid` and `target_uuid` (plus optional name/label columns): rendered as a `graph TD` flowchart with one node per unique object and labeled edges. `direction=TD|LR|BT|RL` overrides the layout, `theme=default|dark|forest|neutral` the color scheme, `title` the heading.
2. **Content mode** — rows carry a `content` column with ready-made Mermaid source: concatenated as-is.

`mermaid` wraps the diagram in a self-contained themed HTML page (Mermaid.js loaded from CDN); `mermaid-raw` returns only the diagram source:

```
graph TD
  ABC_123["Import Data"]
  DEF_456["Validate Order"]
  ABC_123 -->|calls| DEF_456
```

Only meaningful for edge-shaped results (`/references`, graph-shaped `/query` templates) or content templates — other data fails with an error.

## tokens

A structured JSON payload that tokenizes FileMaker script and calculation content into typed spans for editor-style rendering — the format behind the FM-Lab detail views and the VS Code extension.

Available **only** on `/api/get-details` (object types `Script`, `ScriptStep`, `LayoutObject`, `CustomFunction`, `Field`, `CustomMenu`, `CustomMenuItem`) and `/api/get-calc`; other endpoints and types reject it. Token types: `text`, `function`, `customFunction`, `pluginFunction`, `variable` (with `scope: local|global`), `field` (with resolved `TO::Field` and UUID), `comment`. Field references, find requests and sort orders are parsed out of the step definitions; function tokens carry stable synthetic UUIDs for cross-navigation.

With `enrich=<lang>`, step and function tokens are augmented with localized display names, signatures and help links from the [reference database](endpoints/Reference%20Database%20API.md) (soft-fails with `enrich_error` when it is not installed).

Abbreviated example (`kind: "script"`):

```json
{
  "kind": "script",
  "object": { "uuid": "ABC-123", "name": "Import Data", "file": "Contacts" },
  "lines": [
    { "kind": "step", "indent": 0, "stepId": 141, "stepName": "Set Variable",
      "text": "Set Variable [ $count ; Value: Count ( Orders::ID ) ]",
      "refs": [ { "type": "function", "name": "Count" }, { "type": "field", "name": "Orders::ID" } ] },
    { "kind": "comment", "indent": 0, "text": "loop over rows" }
  ],
  "plainText": "Set Variable [ … ]\n# loop over rows"
}
```

Other kinds follow the same pattern: `customfunction` (parameters + token stream), `field` (storage/auto-enter context + calc tokens), `calculation` (hash-addressed, see [GET /api/get-calc](endpoints/Objects%20API.md#get-apiget-calc)), `custommenu` (one token stream per attached calculation).

---

## A note on SVG and visual output

There is no dedicated `svg` format. Visual output takes three distinct routes, and the distinction matters when choosing an endpoint:

1. **Tabular rendering** (`html`, `markdown`, `raw`) — generic formatters that render any result rows as a table. Data-shape-agnostic.
2. **Graph rendering** (`mermaid`, `mermaid-raw`) — for *edge-shaped* data (`source_uuid`/`target_uuid` rows from [References API](endpoints/References%20API.md) or graph-shaped `/query` templates). The API emits Mermaid source (or an HTML page that renders it); the actual vector image is produced by Mermaid.js on the client. The relationship diagram ([GET /api/relationship-graph/](endpoints/Graph%20API.md#get-apirelationship-graphfilename)) likewise ships structured JSON geometry for the client to draw.
3. **Layout rendering (wireframe)** — for *geometry-shaped* data (`LayoutObjects` bounds). Both variants are production paths, serving different client types:
   - **Structured data + client-side drawing** — for interactive clients: the layout data templates (via [/query](endpoints/Query%20and%20Report%20API.md)) return one JSON row per layout object with absolute coordinates, part assignment, nesting and colors; the client draws the wireframe itself and owns hover, tooltips, cross-navigation and filtering. This is how the FM-Lab web frontend renders its layout view.
   - **Server-generated SVG** — for lightweight clients: the Layout detail template of [GET /api/get-details](endpoints/Objects%20API.md#get-apiget-details) *is* a content template that assembles the complete `<svg>` document row-wise (parts as bands, objects as color-coded rectangles with tooltips and labels, nesting resolved recursively). `GET /api/get-details?uuid=<layout>&format=content` returns the ready-to-use SVG file (served as `text/plain`; save as `.svg`, embed in HTML, or inline as a `data:image/svg+xml` URI). With the default `format=json` the same markup arrives line-wise as `content` rows — join them with newlines to reconstruct the document.
