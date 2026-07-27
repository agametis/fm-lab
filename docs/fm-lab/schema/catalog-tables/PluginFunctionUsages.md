# PluginFunctionUsages

Part of the [FM-Lab schema](../Schema.md) · Calculations & variables · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** derived from [XML DDR_INFO](../../xml/catalogs/XML%20DDR_INFO.md) calculation chunks

Every call of an external plugin function (e.g. the MBS Plugin) found in a calculation, one row per usage with the owning source object and the calculation hash. Plugin functions are registered as synthetic `PluginFunction` objects in [ObjectCatalog](../object-catalog/ObjectCatalog.md) and the usages become `calls_pluginfunction` links.

## Columns

| Column | Type |
|---|---|
| `Source_UUID` | `VARCHAR` |
| `Source_Type` | `VARCHAR` |
| `Source_Subkey` | `VARCHAR` |
| `Subrole` | `VARCHAR` |
| `Plugin_Function_Name` | `VARCHAR` |
| `Calc_Hash` | `VARCHAR` |
| `File_Name` | `VARCHAR` |
| `Calc_UUID` | `VARCHAR` |
| `Plugin_Chunk_Index` | `BIGINT` |

## Notes

- MBS function names are qualified as `MBS:<Component.Function>`; components aggregate into `PluginComponent` objects.

**See also:** [ObjectCatalog](../object-catalog/ObjectCatalog.md) · [DDR_Calculations](DDR_Calculations.md)
