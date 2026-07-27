# PrivilegeSetFieldAccess

Part of the [FM-Lab schema](../Schema.md) · Security · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** [XML PrivilegeSetsCatalog](../../xml/catalogs/XML%20PrivilegeSetsCatalog.md)

Custom Record Privileges at field level: one row per privilege set × table × field with the per-field access mode (`NoAccess`/`ReadOnly`/`ReadWrite`). Rows exist only for tables whose field access is set to *Custom*.

## Columns

| Column | Type |
|---|---|
| `PrivilegeSet_ID` | `BIGINT` |
| `PrivilegeSet_Name` | `VARCHAR` |
| `PrivilegeSet_UUID` | `VARCHAR` |
| `BaseTable_ID` | `BIGINT` |
| `BaseTable_Name` | `VARCHAR` |
| `BaseTable_UUID` | `VARCHAR` |
| `Field_ID` | `BIGINT` |
| `Field_Name` | `VARCHAR` |
| `Field_UUID` | `VARCHAR` |
| `Field_Type` | `VARCHAR` |
| `Access_Mode` | `VARCHAR` |
| `File_Name` | `VARCHAR` |

## Notes

- Actual restrictions (`Access_Mode <> 'ReadWrite'`) become `restricts_field` graph links — classified as restrictions, never as usage.

**See also:** [PrivilegeSetRecordAccess](PrivilegeSetRecordAccess.md) · [PrivilegeSetsCatalog](PrivilegeSetsCatalog.md)
