# TableOccurrenceCatalog

Part of the [FM-Lab schema](../Schema.md) · Data model · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** [XML TableOccurrenceCatalog](../../xml/catalogs/XML%20TableOccurrenceCatalog.md)

Every table occurrence on the relationship graph, with its base table reference, its data source (for occurrences pointing into another file) and the visual state on the graph canvas (position, size, color, collapsed/expanded view state).

## Columns

| Column | Type |
|---|---|
| `TO_ID` | `BIGINT` |
| `TO_Name` | `VARCHAR` |
| `TO_Type` | `VARCHAR` |
| `TO_UUID` | `VARCHAR` |
| `DS_ID` | `BIGINT` |
| `DS_Name` | `VARCHAR` |
| `DS_UUID` | `VARCHAR` |
| `BT_ID` | `BIGINT` |
| `BT_Name` | `VARCHAR` |
| `BT_UUID` | `VARCHAR` |
| `View_State` | `VARCHAR` |
| `Box_Height` | `BIGINT` |
| `Coord_Top` | `BIGINT` |
| `Coord_Left` | `BIGINT` |
| `Coord_Bottom` | `BIGINT` |
| `Coord_Right` | `BIGINT` |
| `Color_R` | `BIGINT` |
| `Color_G` | `BIGINT` |
| `Color_B` | `BIGINT` |
| `Color_Alpha` | `DOUBLE` |
| `Modified_At` | `VARCHAR` |
| `Modified_By` | `VARCHAR` |
| `Modified_Account` | `VARCHAR` |
| `Modifications` | `BIGINT` |
| `File_Name` | `VARCHAR` |

## Notes

- `BT_*` columns point to the local base table; `DS_*` columns to the external data source when the occurrence references a table in another file.
- Graph-canvas geometry (`Coord_*`, `Color_*`, `View_State`) is preserved so the developer's spatial organization of the graph is analyzable.
- `Modified_At` / `Modified_By` / `Modified_Account` / `Modifications` are the raw change metadata of the object's `<UUID>` element: timestamp as text (local time of the editing client, no time zone), user name, account (empty → `NULL`) and change counter. [ObjectChangeMeta](ObjectChangeMeta.md) collects them across all object types with a typed timestamp.

**See also:** [BaseTableCatalog](BaseTableCatalog.md) · [RelationshipCatalog](RelationshipCatalog.md) · [ExternalDataSourceCatalog](ExternalDataSourceCatalog.md)
