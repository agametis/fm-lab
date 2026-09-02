# LayoutObjectConditions

Part of the [FM-Lab schema](../Schema.md) · Layouts · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** [XML LayoutCatalog](../../xml/catalogs/XML%20LayoutCatalog.md) — the `<Conditions><Formatting>` block of the layout-object payload

One row per **conditional-formatting rule** of a layout object. The rules are extracted depth-anchored from the object's own payload (`/LayoutObject/Conditions/Formatting/Condition`), so rules of nested container objects can never be double-counted on their parents. Every rule carries its condition (a formula, or a value operator with operands), its enable state, the applied format as raw CSS, and a foreign key to the rule's calculation instance in [CalculationsCatalog](CalculationsCatalog.md).

## Columns

| Column | Type |
|---|---|
| `Rule_UUID` | `VARCHAR` |
| `Object_UUID` | `VARCHAR` |
| `Layout_ID` | `BIGINT` |
| `Rule_Index` | `BIGINT` |
| `Condition_Type` | `BIGINT` |
| `Condition_Kind` | `VARCHAR` |
| `Options_Raw` | `BIGINT` |
| `Calc_Text` | `VARCHAR` |
| `Calc_Hash` | `VARCHAR` |
| `Calculation_UUID` | `VARCHAR` |
| `Range_Start` | `VARCHAR` |
| `Range_End` | `VARCHAR` |
| `Formatting_Membercount` | `BIGINT` |
| `Local_CSS` | `VARCHAR` |
| `File_Name` | `VARCHAR` |

## Notes

- `Rule_Index` is 1-based per object in rule order and equals the DDR anchor suffix (`Condition_<N>`).
- `Condition_Type` is the raw `@type` of the rule: `0` = formula condition, `1`–`13` = value-based operator ("is equal to", "is between", …); `Condition_Kind` normalizes this to `formula` / `value`.
- `Calc_Text` holds the condition formula. For value-based rules FileMaker serializes an equivalent *self formula* alongside the operands — that formula lands here, the operands in `Range_Start` / `Range_End` (as expression text, decoded).
- `Options_Raw` is the raw format bitmask; **bit 0 is the rule's enable flag**.
- `Calculation_UUID` links the rule to its [Calculation](../object-types/Calculation.md) instance (role `conditional_format`); `NULL` when the export carries no anchor for the rule. `Calc_Hash` joins to [DDR_Calculations](DDR_Calculations.md).
- `Local_CSS` is the applied formatting as raw CSS; `Formatting_Membercount` mirrors the declared rule count of the object and is the basis of the P6 guard view `v_check_cf_rules`.
- The rules are served rule-exact through `GET /api/conditional-formatting` ([Objects API](../../rest-api/endpoints/Objects%20API.md)) — never regex `Object_XML` for conditional formatting.

**See also:** [LayoutObjects](LayoutObjects.md) · [CalculationsCatalog](CalculationsCatalog.md) · [Calculation](../object-types/Calculation.md) · [XML LayoutCatalog](../../xml/catalogs/XML%20LayoutCatalog.md)
