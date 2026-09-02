# PrivilegeSetsCatalog

Part of the [FM-Lab schema](../Schema.md) · Security · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** [XML PrivilegeSetsCatalog](../../xml/catalogs/XML%20PrivilegeSetsCatalog.md)

The privilege sets of each file with all class-level switches: record, layout, value-list and script permissions, the extended toggles (printing, exporting, managing accounts, …) and the idle-disconnect and password policies.

## Columns

| Column | Type |
|---|---|
| `PrivilegeSet_ID` | `BIGINT` |
| `PrivilegeSet_Name` | `VARCHAR` |
| `PrivilegeSet_UUID` | `VARCHAR` |
| `Description` | `VARCHAR` |
| `Is_Default_Access` | `BOOLEAN` |
| `Records_Create` | `BOOLEAN` |
| `Records_Edit` | `BOOLEAN` |
| `Records_Delete` | `BOOLEAN` |
| `Records_View` | `VARCHAR` |
| `Layouts_Create` | `BOOLEAN` |
| `Layouts_Edit` | `BOOLEAN` |
| `Layouts_Delete` | `BOOLEAN` |
| `Layouts_View` | `VARCHAR` |
| `Layouts_Custom` | `BOOLEAN` |
| `ValueLists_Create` | `BOOLEAN` |
| `ValueLists_Edit` | `BOOLEAN` |
| `ValueLists_Delete` | `BOOLEAN` |
| `ValueLists_View` | `VARCHAR` |
| `Scripts_Create` | `BOOLEAN` |
| `Scripts_Edit` | `BOOLEAN` |
| `Scripts_Delete` | `BOOLEAN` |
| `Scripts_View` | `VARCHAR` |
| `Other_Value` | `BIGINT` |
| `Allow_Print` | `BOOLEAN` |
| `Allow_Export` | `BOOLEAN` |
| `Manage_Database` | `BOOLEAN` |
| `Manage_Custom_Menus` | `BOOLEAN` |
| `Manage_Accounts` | `BOOLEAN` |
| `Manage_Ext_Privs` | `BOOLEAN` |
| `Allow_Override` | `BOOLEAN` |
| `Allow_Open_Quickly` | `BOOLEAN` |
| `Disconnect_Idle` | `BOOLEAN` |
| `Commands` | `VARCHAR` |
| `Password_Prohibit_Modification` | `BOOLEAN` |
| `File_Name` | `VARCHAR` |

## Notes

- When a class uses **Custom privileges**, the class-level columns no longer reflect real access — the per-object detail then lives in [PrivilegeSetRecordAccess](PrivilegeSetRecordAccess.md), [PrivilegeSetFieldAccess](PrivilegeSetFieldAccess.md) and [PrivilegeSetObjectAccess](PrivilegeSetObjectAccess.md).

**See also:** [PrivilegeSetRecordAccess](PrivilegeSetRecordAccess.md) · [PrivilegeSetFieldAccess](PrivilegeSetFieldAccess.md) · [PrivilegeSetObjectAccess](PrivilegeSetObjectAccess.md) · [ExtendedPrivilegesCatalog](ExtendedPrivilegesCatalog.md) · [AccountsCatalog](AccountsCatalog.md)
