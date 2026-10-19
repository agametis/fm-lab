# LayoutObjectSymbols

Part of the [FM-Lab schema](../Schema.md) · Layouts · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** [XML LayoutCatalog](../../xml/catalogs/XML%20LayoutCatalog.md) — `{{…}}` placeholders inside the `Text_Content` of a text object or button label

The **symbol inventory** of the layout texts: one row per distinct `{{…}}` placeholder per layout object with text — `{{CurrentDate}}`, `{{PageNumber}}`, `{{RecordNumber}}` and the rest of FileMaker's text symbols. It answers "which layouts render which symbols?" as a plain table query.

## Columns

| Column | Type |
|---|---|
| `Object_UUID` | `VARCHAR` |
| `Layout_ID` | `BIGINT` |
| `File_Name` | `VARCHAR` |
| `Symbol_Text` | `VARCHAR` |
| `Symbol_Norm` | `VARCHAR` |
| `Occurrence_Count` | `BIGINT` |
| `Is_Evaluated` | `BOOLEAN` |

## Notes

- `Symbol_Text` is the placeholder as written; `Symbol_Norm` is the lowercased form — the case-robust match key, since FileMaker accepts symbol names case-insensitively.
- `Occurrence_Count` counts how often the symbol appears in the object's text.
- A symbol is the value of `Get(<Symbol>)` at display time. A **valid** symbol of a text object carries a `displays_symbol` edge in [ObjectLinks](../object-catalog/ObjectLinks.md) to that Get parameter's [BuiltinFunction](../object-types/BuiltinFunction.md) node, so "which layouts show `{{PageNumber}}`?" is an ordinary where-used query. An unknown symbol renders literally and stays edgeless; the analysis test `layout-merge-anchors` reports it.
- `Is_Evaluated` is TRUE for a text object and FALSE for the label of a button or popover button: FileMaker never evaluates a symbol there, not even a valid Get parameter. Such a symbol gets no edge and creates no catalog object; the rule *Symbol in button label* reports it. Filter on `Is_Evaluated` for symbols that actually display a value.
- Query this table directly; never regex `Text_Content` for symbols.
- Merge *fields* and merge *variables* (`<<…>>`) are a different mechanism: they resolve into `displays_field` / `displays_variable` edges, layout calculations `<<ƒ:…>>` into [Calculation](../object-types/Calculation.md) instances.

**See also:** [LayoutObjects](LayoutObjects.md) · [Layouts](Layouts.md) · [XML LayoutCatalog](../../xml/catalogs/XML%20LayoutCatalog.md)
