# CustomMenuItemCatalog

Part of the [FM-Lab schema](../Schema.md) · Custom menus · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** [XML CustomMenuCatalog](../../xml/catalogs/XML%20CustomMenuCatalog.md)

The individual items of every custom menu, parsed from the menu XML: command items with their command name/ID, separators and submenu items, in menu order (`Item_Index`).

## Columns

| Column | Type |
|---|---|
| `Item_UUID` | `VARCHAR` |
| `Item_Hash` | `VARCHAR` |
| `Item_Index` | `INTEGER` |
| `Is_SubMenuItem` | `BOOLEAN` |
| `Is_SeparatorItem` | `BOOLEAN` |
| `Command_Name` | `VARCHAR` |
| `Command_ID` | `VARCHAR` |
| `Menu_ID` | `BIGINT` |
| `Menu_UUID` | `VARCHAR` |
| `Menu_Name` | `VARCHAR` |
| `Item_XML` | `VARCHAR` |
| `File_Name` | `VARCHAR` |

## Notes

- Submenu items (`Is_SubMenuItem`) produce an `opens_menu` link to the menu they open — a real usage that keeps submenu-only menus out of dead-code results.

**See also:** [CustomMenuCatalog](CustomMenuCatalog.md)
