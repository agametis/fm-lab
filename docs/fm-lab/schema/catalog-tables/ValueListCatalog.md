# ValueListCatalog

Part of the [FM-Lab schema](../Schema.md) · Value lists · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** [XML ValueListCatalog](../../xml/catalogs/XML%20ValueListCatalog.md)

All value lists with their source type (custom values, field-based, or a wrapper for a value list in another file). The per-source details live in [OptionsForValueLists](OptionsForValueLists.md).

## Columns

| Column | Type |
|---|---|
| `VL_ID` | `BIGINT` |
| `VL_Name` | `VARCHAR` |
| `Source_Type` | `VARCHAR` |
| `VL_UUID` | `VARCHAR` |
| `Modified_At` | `VARCHAR` |
| `Modified_By` | `VARCHAR` |
| `Modified_Account` | `VARCHAR` |
| `Modifications` | `BIGINT` |
| `File_Name` | `VARCHAR` |

## Notes

- `Modified_At` / `Modified_By` / `Modified_Account` / `Modifications` are the raw change metadata of the object's `<UUID>` element: timestamp as text (local time of the editing client, no time zone), user name, account (empty → `NULL`) and change counter. [ObjectChangeMeta](ObjectChangeMeta.md) collects them across all object types with a typed timestamp.

**See also:** [OptionsForValueLists](OptionsForValueLists.md)
