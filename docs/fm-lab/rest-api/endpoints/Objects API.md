# Objects API

Retrieve single catalog objects: the basic catalog row (`/get`), the type-specific detail view (`/get-details`), and standalone calculations by hash (`/get-calc`).

All three are UUID/hash-addressed and clone-aware: if a bare UUID exists in more than one file (cloned/modular FileMaker files share internal UUIDs), the response is `409 AMBIGUOUS_UUID` with the list of matching files — retry with `file=<File_Name>`. Unknown identifiers yield `404 OBJECT_NOT_FOUND`. See [Clone disambiguation](../REST%20API%20Conventions.md#clone-disambiguation-file-ambiguous_uuid).

---

## GET /api/get

The `ObjectCatalog` row of a single object.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `uuid` | string | — | **Required.** Object UUID |
| `file` | string | — | Clone disambiguation |
| `format` | enum | `json` | See [REST API Output Formats](../REST%20API%20Output%20Formats.md) |
| `meta` / `debug` | boolean | `false` | Envelope extras |

```bash
curl "http://localhost:3003/api/get?uuid=1EC24DF4-…-9AA1"
```

```json
{
  "success": true,
  "data": {
    "Object_UUID": "1EC24DF4-…-9AA1",
    "Object_Type": "Script",
    "Object_Name": "Import Data",
    "File_Name": "Contacts",
    "Object_ID": 42,
    "Source_Table": "ScriptCatalog"
  }
}
```

## GET /api/get-details

Type-specific rich detail view. The server resolves the object's type and dispatches to a dedicated detail template per type (scripts with steps, fields with options, layouts with objects, …); types without a dedicated template fall back to a generic view.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `uuid` | string | — | **Required.** Object UUID |
| `file` | string | — | Clone disambiguation |
| `format` | enum | `json` | Full format enum; `tokens` has special semantics (below) |
| `enrich` | string | — | Language code — only with `format=tokens`: augments tokens with reference-database display names, signatures and help URLs |
| `meta` / `debug` | boolean | `false` | `meta` reports `template_used`, `object_type`, … |

**`format=tokens`** returns the structured token payload for editor-style rendering (see [tokens](../REST%20API%20Output%20Formats.md#tokens)). Supported object types: `Script`, `ScriptStep`, `LayoutObject` (button-embedded steps), `CustomFunction`, `Field`, `CustomMenu`, `CustomMenuItem` — other types yield `400 VALIDATION_ERROR` listing the supported set. Reference enrichment soft-fails when the reference database is not installed (`enrich: null`, `enrich_error: "REF_NOT_ATTACHED"`).

Detail templates whose output is a prose block automatically render as plain text for any non-JSON format.

**Layout special case:** the detail template for `Layout` objects generates a complete **SVG wireframe** of the layout (parts as bands, objects as color-coded rectangles with labels and tooltips, nested objects resolved to absolute coordinates). `format=content` returns the ready-to-use SVG document; the default `format=json` delivers the same markup line-wise as rows with a `content` column. Interactive clients that need hover/navigation on individual layout objects should use the structured layout data templates via [/query](Query%20and%20Report%20API.md) instead — see [SVG and visual output](../REST%20API%20Output%20Formats.md#a-note-on-svg-and-visual-output).

## GET /api/get-calc

A standalone (deduplicated) calculation addressed by its hash — the token view for calculations that are shared across objects rather than tied to a single one.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `hash` | string | — | **Required.** Calculation hash |
| `format` | enum | `tokens` | Only `tokens` or `json` |
| `enrich` | string | — | Language code for reference enrichment |
| `meta` / `debug` | boolean | `false` | |

**Response `data`:** `{ "kind": "calculation", "object": { "hash": "…" }, "tokens": [ … ], "plainText": "…" }`. Unknown hash: `404 OBJECT_NOT_FOUND`.

---

See also: [Search API](Search%20API.md) (finding UUIDs), [References API](References%20API.md) (dependencies of an object), [REST API Output Formats](../REST%20API%20Output%20Formats.md).
