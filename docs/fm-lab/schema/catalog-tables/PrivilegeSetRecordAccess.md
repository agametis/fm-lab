# PrivilegeSetRecordAccess

Part of the [FM-Lab schema](../Schema.md) · Security · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** [XML PrivilegeSetsCatalog](../../xml/catalogs/XML%20PrivilegeSetsCatalog.md)

Custom Record Privileges at table level: one row per privilege set × base table × operation (View/Edit/Create/Delete) with the access mode. When access is decided by a calculation, the row carries the formula text, its DDR hash and the evaluation context table occurrence.

## Columns

| Column | Type |
|---|---|
| `PrivilegeSet_ID` | `BIGINT` |
| `PrivilegeSet_Name` | `VARCHAR` |
| `PrivilegeSet_UUID` | `VARCHAR` |
| `BaseTable_ID` | `BIGINT` |
| `BaseTable_Name` | `VARCHAR` |
| `BaseTable_UUID` | `VARCHAR` |
| `Table_Type` | `VARCHAR` |
| `Operation` | `VARCHAR` |
| `Access_Mode` | `VARCHAR` |
| `Calculation_Text` | `VARCHAR` |
| `DDR_Hash` | `VARCHAR` |
| `Context_TO_Name` | `VARCHAR` |
| `Context_TO_UUID` | `VARCHAR` |
| `Fields_Access` | `VARCHAR` |
| `File_Name` | `VARCHAR` |

## Notes

- `Table_Type='New'` rows are the default rule for future, not-yet-existing tables.
- `Access_Mode` is kept as plain text (no enum) so unknown modes survive: `NoAccess`, `ReadOnly`, `ReadWrite`, `Calculation`, …
- References inside record-access calculations (fields, custom functions, plugin functions, variables) are resolved into graph links, closing the where-used gap for objects referenced only by such a calc.
- `Fields_Access='Custom'` opens the per-field detail in [PrivilegeSetFieldAccess](PrivilegeSetFieldAccess.md).

**See also:** [PrivilegeSetsCatalog](PrivilegeSetsCatalog.md) · [PrivilegeSetFieldAccess](PrivilegeSetFieldAccess.md) · [DDR_Calculations](DDR_Calculations.md)
