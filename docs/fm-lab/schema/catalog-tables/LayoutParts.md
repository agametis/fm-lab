# LayoutParts

Part of the [FM-Lab schema](../Schema.md) · Layouts · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** [XML LayoutCatalog](../../xml/catalogs/XML%20LayoutCatalog.md)

The parts (sections) of every layout — header, body, footer, sub-summaries and so on — one row per part, ordered by `Part_Seq`. Because parts are sequenced rather than keyed by type, multiple sub-summary parts of the same kind stay distinct.

## Columns

| Column | Type |
|---|---|
| `Layout_ID` | `BIGINT` |
| `Layout_Name` | `VARCHAR` |
| `Part_Seq` | `INTEGER` |
| `Part_Type` | `VARCHAR` |
| `Part_Kind` | `INTEGER` |
| `Definition_Type` | `VARCHAR` |
| `Definition_Kind` | `INTEGER` |
| `Part_Size` | `INTEGER` |
| `Part_Absolute` | `INTEGER` |
| `Part_Options` | `INTEGER` |
| `Object_Count` | `BIGINT` |
| `Break_Field_ID` | `BIGINT` |
| `Break_Field_Name` | `VARCHAR` |
| `Break_Field_UUID` | `VARCHAR` |
| `Break_TO_Name` | `VARCHAR` |
| `Break_TO_UUID` | `VARCHAR` |
| `File_Name` | `VARCHAR` |

## Notes

- Sub-summary parts name their break field in the `Break_Field_*`/`Break_TO_*` columns (→ `breaks_on_field` link — a real field usage).
- `Object_Count` gives a quick size measure per part without touching [LayoutObjects](LayoutObjects.md).

**See also:** [Layouts](Layouts.md) · [LayoutObjects](LayoutObjects.md) · [FieldsForTables](FieldsForTables.md)
