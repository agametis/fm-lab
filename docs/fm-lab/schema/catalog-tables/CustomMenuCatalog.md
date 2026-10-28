# CustomMenuCatalog

Part of the [FM-Lab schema](../Schema.md) · Custom menus · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** [XML CustomMenuCatalog](../../xml/catalogs/XML%20CustomMenuCatalog.md)

The custom menus of each file. The menu definition is kept as a raw XML fragment (`Menu_XML`); its individual items are parsed into [CustomMenuItemCatalog](CustomMenuItemCatalog.md).

## Columns

| Column | Type |
|---|---|
| `Menu_ID` | `BIGINT` |
| `Menu_Name` | `VARCHAR` |
| `Menu_UUID` | `VARCHAR` |
| `Menu_XML` | `VARCHAR` |
| `Modified_At` | `VARCHAR` |
| `Modified_By` | `VARCHAR` |
| `Modified_Account` | `VARCHAR` |
| `Modifications` | `BIGINT` |
| `File_Name` | `VARCHAR` |

## Notes

- `Menu_ID` is file-local — join with `File_Name`, or use `Menu_UUID`.
- `Modified_At` / `Modified_By` / `Modified_Account` / `Modifications` are the raw change metadata of the object's `<UUID>` element: timestamp as text (local time of the editing client, no time zone), user name, account (empty → `NULL`) and change counter. [ObjectChangeMeta](ObjectChangeMeta.md) collects them across all object types with a typed timestamp.

**See also:** [CustomMenuItemCatalog](CustomMenuItemCatalog.md) · [CustomMenuSetCatalog](CustomMenuSetCatalog.md)
