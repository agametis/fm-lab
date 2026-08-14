# DDR_ScriptSteps

Part of the [FM-Lab schema](../Schema.md) · Scripts & script steps · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** [XML DDR_INFO](../../xml/catalogs/XML%20DDR_INFO.md)

Human-readable renderings of script steps — the same text FileMaker's Database Design Report would print, e.g. `Set Variable [ $count ; Value: 0 ]`. Only populated for files exported with DDR-Info (FileMaker 21+, *Include details for analysis tools*).

## Columns

| Column | Type |
|---|---|
| `Step_UUID` | `VARCHAR` |
| `Step_Hash` | `VARCHAR` |
| `Step_Text` | `VARCHAR` |
| `File_Name` | `VARCHAR` |

## Notes

- Join via `StepsForScripts.DDR_UUID = DDR_ScriptSteps.Step_UUID`.
- Check availability per file with `FilesCatalog.Has_DDR_INFO`.
- The DDR block keys step text by step UUID only. For healed duplicate steps ([UUID healing](../UUID%20Healing%20and%20Duplicate%20Census.md)) the text resolves through the content hash instead (`StepsForScripts.DDR_Hash` = `Step_Hash`); twins with *different* content share one DDR row in the source — a source-format limit, the other twin stays without text.

**See also:** [StepsForScripts](StepsForScripts.md) · [FilesCatalog](../object-catalog/FilesCatalog.md)
