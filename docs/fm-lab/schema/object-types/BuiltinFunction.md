# BuiltinFunction

Part of the [FileMaker object types](FileMaker%20Object%20Types.md) · semantic object-type reference

A **built-in function** is a function of the FileMaker calculation language itself — `Case`, `Substitute`, `Get ( LayoutName )`, … FileMaker's export has no catalog of built-in functions; they only appear as tokens inside calculation texts. BuiltinFunction is therefore a **synthetic** type: the import pipeline derives one object per distinct function token found in the DDR calculation chunks (`FunctionRef` chunks in [XML DDR_INFO](../../xml/catalogs/XML%20DDR_INFO.md)), which is what makes questions like *"where is `ExecuteSQL` used?"* answerable as a plain graph walk over [ObjectLinks](../object-catalog/ObjectLinks.md).

Built-in functions are solution-independent: their catalog rows carry `File_Name = NULL` and a deterministic `Object_UUID` hashed from the function name, so the same function is one shared node across all files of the catalog. Two derivation details matter in practice: `Get` sub-parameters produce their *own* objects (`Get(LayoutName)`, `Get(SystemPlatform)`, …) in addition to the bare `Get` entry — usage links point at the sub-parameter entry when one is present. And the object name is the **literal token spelling from the export**: SaXML writes calculations in the UI language of the exporting client, so a German export yields entries like `Get(DateiName)` *(corpus)*. Localized spellings of the same function become separate catalog entries; the [fm-spec](../../Wiki/fm-spec.md) language layer ([function_name_lookup](../fm-spec-tables/function_name_lookup.md)) maps any localized name back to the canonical function ID (and its canonical English name) at query time. Because derivation runs over DDR chunks, the type is only populated for files exported with DDR-Info.

## Properties

A synthetic type has no XML property surface of its own — its properties are derived at import:

| Property | Derivation | Notes |
|---|---|---|
| `Object_Name` | Literal function token from the calc chunk | `Get(<SubParameter>)` form for Get sub-parameters; spelling follows the export locale |
| `Object_UUID` | Deterministic hash of `'BuiltinFunction::' + name` | Stable across imports; localized spellings hash to different UUIDs |
| `File_Name` | always `NULL` | Built-ins are solution-independent, shared across files |
| `Object_ID` | always `NULL` | No FileMaker-internal ID exists |
| `Source_Table` | `'DDR_Calculations'` | Provenance marker in [ObjectCatalog](../object-catalog/ObjectCatalog.md) |

There is no type-specific detail table; everything about a built-in function beyond its usages lives in the [fm-spec](../../Wiki/fm-spec.md) reference ([functions](../fm-spec-tables/functions.md) — 367 functions with stable IDs, categories, parameters, localized names and documentation links).

## References

A built-in function is a pure *target*: it has no outgoing edges. Full role definitions: [Link Roles and Subroles](../object-catalog/Link%20Roles%20and%20Subroles.md).

### Outgoing links (BuiltinFunction as source)

*None.*

### Incoming links (BuiltinFunction as target)

| Link_Role | Source | Kind | Description |
|---|---|---|---|
| `calls_function` | [Script](Script.md) / [Field](Field.md) / [LayoutObject](LayoutObject.md) / [CustomFunction](CustomFunction.md) / [CustomMenuItem](CustomMenuItem.md) / … | usage | A calculation of the source calls the function |

The link subrole names the owner's calc-anchor slot that contains the call (step index, `Tooltip`, `Hide`, `Install`, …) — see the subrole table in [Link Roles and Subroles](../object-catalog/Link%20Roles%20and%20Subroles.md).

## Schema & tooling

- **XML schema:** no catalog of its own — derived from the `FunctionRef` chunks in [XML DDR_INFO](../../xml/catalogs/XML%20DDR_INFO.md) (requires the "Include details for analysis tools" export option)
- **DB schema:** rows in [ObjectCatalog](../object-catalog/ObjectCatalog.md) only; usages resolve via [ObjectLinks](../object-catalog/ObjectLinks.md) and the chunk table [DDR_Calculations](../catalog-tables/DDR_Calculations.md) · language vocabulary in the fm-spec tables [functions](../fm-spec-tables/functions.md) and [function_name_lookup](../fm-spec-tables/function_name_lookup.md) (see [Schema](../Schema.md) §3, [fm-spec](../../Wiki/fm-spec.md))
- **Detail view template:** `rest-api/templates/sql/object_details_builtinfunction.sql` (caller aggregation), served via the [/api/get-details endpoint](../../rest-api/endpoints/Objects%20API.md)
- **Frontend:** object list at `http://localhost:5173/?type=BuiltinFunction`

**See also:** [Object Types](../object-catalog/Object%20Types.md) · [CustomFunction](CustomFunction.md) · [PluginFunction](PluginFunction.md) · [DDR_Calculations](../catalog-tables/DDR_Calculations.md) · [fm-spec](../../Wiki/fm-spec.md)
