# DDR_ChunkListContexts

Part of the [FM-Lab schema](../Schema.md) · Calculations & variables · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** [XML DDR_INFO](../../xml/catalogs/XML%20DDR_INFO.md) — the `<TableOccurrenceReference>` child and chunk count of every ChunkList anchor

One row per **ChunkList anchor** of the DDR-Info block: the anchor's evaluation-context table occurrence and its chunk count. Its distinctive value: it also records **empty** ChunkLists (`Chunk_Count = 0`), which produce no [DDR_Calculations](DDR_Calculations.md) rows and therefore appear nowhere else — exactly the anchors of layout display formulas whose token stream FileMaker omits. Those rows are the anchor source for the display-calculation fallback that recovers such formulas from the layout text instead.

## Columns

| Column | Type |
|---|---|
| `Calc_UUID` | `VARCHAR` |
| `Calc_Hash` | `VARCHAR` |
| `Chunk_Count` | `BIGINT` |
| `Context_TO_ID` | `BIGINT` |
| `Context_TO_Name` | `VARCHAR` |
| `Context_TO_UUID` | `VARCHAR` |
| `File_Name` | `VARCHAR` |

## Notes

- Primary key `(Calc_UUID, File_Name)`; `Calc_UUID` is the anchor (`_<OwnerUUID>_<Suffix>`) and joins to `CalculationsCatalog.DDR_Calc_UUID`.
- The context TO is read from the anchor's **direct** `<TableOccurrenceReference>` child only — nested references inside the chunk stream stay untouched.
- Empty ChunkLists share a file-wide hash (`md5('')`), so `Calc_Hash` is only meaningful together with `Calc_UUID`.
- The context TO fills `Context_TO_UUID`/`_Name` of the matching [CalculationsCatalog](CalculationsCatalog.md) instances and anchors the field-reference rescue for mis-chunked display formulas.

**See also:** [DDR_Calculations](DDR_Calculations.md) · [CalculationsCatalog](CalculationsCatalog.md) · [XML DDR_INFO](../../xml/catalogs/XML%20DDR_INFO.md)
