# CustomMenuSetCatalog

Part of the [FM-Lab schema](../Schema.md) · Custom menus · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** [XML CustomMenuSetCatalog](../../xml/catalogs/XML%20CustomMenuSetCatalog.md)

The custom menu sets of each file with their member menus as ID and name arrays. Layouts bind a menu set via `uses_menuset` links; scripts install one via `installs_menuset`.

## Columns

| Column | Type |
|---|---|
| `MenuSet_ID` | `BIGINT` |
| `MenuSet_Name` | `VARCHAR` |
| `Comment` | `VARCHAR` |
| `MenuSet_UUID` | `VARCHAR` |
| `Member_Menu_IDs` | `BIGINT[]` |
| `Member_Menu_Names` | `VARCHAR[]` |
| `File_Name` | `VARCHAR` |

**See also:** [CustomMenuCatalog](CustomMenuCatalog.md) · [Layouts](Layouts.md)
