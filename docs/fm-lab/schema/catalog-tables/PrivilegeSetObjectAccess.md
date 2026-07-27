# PrivilegeSetObjectAccess

Part of the [FM-Lab schema](../Schema.md) · Security · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** [XML PrivilegeSetsCatalog](../../xml/catalogs/XML%20PrivilegeSetsCatalog.md)

Custom privileges for the other object classes — layouts, value lists and scripts — in one unified table with an `Object_Class` discriminator: one row per privilege set × object with the access mode, the layout-specific records-access column and the class-level create flag.

## Columns

| Column | Type |
|---|---|
| `PrivilegeSet_ID` | `BIGINT` |
| `PrivilegeSet_Name` | `VARCHAR` |
| `PrivilegeSet_UUID` | `VARCHAR` |
| `Object_Class` | `VARCHAR` |
| `Object_ID` | `BIGINT` |
| `Object_Name` | `VARCHAR` |
| `Object_UUID` | `VARCHAR` |
| `Item_Type` | `VARCHAR` |
| `Access_Mode` | `VARCHAR` |
| `Records_Access` | `VARCHAR` |
| `Class_Allow_Create` | `BOOLEAN` |
| `File_Name` | `VARCHAR` |

## Notes

- Classes left in the simple attribute form (no custom detail tree) produce no rows here.
- Actual restrictions become `restricts_object` links (restriction, not usage); folders and separators are excluded.

**See also:** [PrivilegeSetsCatalog](PrivilegeSetsCatalog.md) · [PrivilegeSetRecordAccess](PrivilegeSetRecordAccess.md)
