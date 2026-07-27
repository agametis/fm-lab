# Layouts

Part of the [FM-Lab schema](../Schema.md) · Layouts · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** [XML LayoutCatalog](../../xml/catalogs/XML%20LayoutCatalog.md)

All layouts including the layout folder tree (folders and separators appear as rows, marked by `Folder_Type`/`Is_Separator`). Each layout row carries its context table occurrence, theme and menu set references, decoded view options (which of form/list/table view are available and which is the default) and modification metadata.

## Columns

| Column | Type |
|---|---|
| `L_ID` | `BIGINT` |
| `L_Name` | `VARCHAR` |
| `L_UUID` | `VARCHAR` |
| `L_TO_Name` | `VARCHAR` |
| `L_TO_UUID` | `VARCHAR` |
| `L_Width` | `INTEGER` |
| `L_Theme_ID` | `BIGINT` |
| `L_Theme_Name` | `VARCHAR` |
| `L_Theme_UUID` | `VARCHAR` |
| `L_MenuSet_ID` | `BIGINT` |
| `L_MenuSet_Name` | `VARCHAR` |
| `L_MenuSet_UUID` | `VARCHAR` |
| `Options_Raw` | `BIGINT` |
| `View_Form_Available` | `BOOLEAN` |
| `View_List_Available` | `BOOLEAN` |
| `View_Table_Available` | `BOOLEAN` |
| `Default_View` | `VARCHAR` |
| `Auto_Save_Changes` | `BOOLEAN` |
| `Show_Field_Frames` | `BOOLEAN` |
| `Frame_Current_Record_Only` | `BOOLEAN` |
| `Show_Current_Record_List` | `BOOLEAN` |
| `Quick_Find_Enabled` | `BOOLEAN` |
| `Is_Hidden` | `BOOLEAN` |
| `L_Theme_Base` | `VARCHAR` |
| `Modified_By` | `VARCHAR` |
| `Modified_At` | `VARCHAR` |
| `Modifications` | `INTEGER` |
| `Folder_Type` | `VARCHAR` |
| `Is_Separator` | `BOOLEAN` |
| `Sequence_ID` | `BIGINT` |
| `File_Name` | `VARCHAR` |

## Notes

- The view flags and `Default_View` are decoded from the packed `Options_Raw` bitmask at import.
- `L_ID` is only unique per file — join with `File_Name`, or use `L_UUID`.
- Theme and menu-set references also exist as graph links (`uses_theme`, `uses_menuset`).

**See also:** [LayoutParts](LayoutParts.md) · [LayoutObjects](LayoutObjects.md) · [ThemeCatalog](ThemeCatalog.md) · [CustomMenuSetCatalog](CustomMenuSetCatalog.md)
