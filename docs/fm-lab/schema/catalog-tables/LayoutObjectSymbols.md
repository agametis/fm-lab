# LayoutObjectSymbols

Part of the [FM-Lab schema](../Schema.md) · Layouts · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** [XML LayoutCatalog](../../xml/catalogs/XML%20LayoutCatalog.md) — `{{…}}` placeholders inside a text object's `Text_Content`

The **symbol inventory** of the layout texts: one row per distinct `{{…}}` placeholder per text layout object — `{{CurrentDate}}`, `{{PageNumber}}`, `{{RecordNumber}}` and the rest of FileMaker's text symbols. It answers "which layouts render which symbols?" as a plain table query.

## Columns

| Column | Type |
|---|---|
| `Object_UUID` | `VARCHAR` |
| `Layout_ID` | `BIGINT` |
| `File_Name` | `VARCHAR` |
| `Symbol_Text` | `VARCHAR` |
| `Symbol_Norm` | `VARCHAR` |
| `Occurrence_Count` | `BIGINT` |

## Notes

- `Symbol_Text` is the placeholder as written; `Symbol_Norm` is the lowercased form — the case-robust match key, since FileMaker accepts symbol names case-insensitively.
- `Occurrence_Count` counts how often the symbol appears in the object's text.
- The table is **deliberately edge-free**: symbols produce no where-used links in [ObjectLinks](../object-catalog/ObjectLinks.md) — they reference runtime state, not catalog objects. Query this table directly; never regex `Text_Content` for symbols.
- Merge *fields* and merge *variables* (`<<…>>`) are a different mechanism: those resolve into [Calculation](../object-types/Calculation.md) instances and `displays_field` / `displays_variable` edges.

**See also:** [LayoutObjects](LayoutObjects.md) · [Layouts](Layouts.md) · [XML LayoutCatalog](../../xml/catalogs/XML%20LayoutCatalog.md)
