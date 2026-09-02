# ScriptStep

Part of the [FileMaker object types](FileMaker%20Object%20Types.md) · semantic object-type reference

A **script step** is a single executable statement of a [script](Script.md) — one line of the Script Workspace, from `Set Variable` to `Perform Script` to control-flow markers like `If`/`End If`. FileMaker identifies the step *type* by a numeric, locale-independent ID; the step *name* is only a localized display label written in the UI language of the exporting client. Every robust analysis keys on `Step_ID` — the same stable ID that [fm-spec](../../Wiki/fm-spec.md) documents in [script_steps](../fm-spec-tables/script_steps.md), together with the step's option grammar and XML emission rules.

ScriptStep is an **exported** type: each `<Step>` element of the [XML StepsForScripts](../../xml/catalogs/XML%20StepsForScripts.md) branch becomes one row in [StepsForScripts](../catalog-tables/StepsForScripts.md) and one [ObjectCatalog](../object-catalog/ObjectCatalog.md) entry. In the frontend, steps are **hoisted**: they render inside the parent script's detail view (the ordered step list), not as standalone pages.

## Properties

The tables below list the property surface of the `<Step>` element and where each property lands in the catalog. Properties marked **not extracted** are visible in the raw XML only.

### Identity & state

| Property (XML) | In catalog | Notes |
|---|---|---|
| `@id` | `Step_ID` | Numeric, locale-independent step type — identical to `script_steps.step_id` in [fm-spec](../../Wiki/fm-spec.md) |
| `@name` | `Step_Name` | Localized display name of the exporting client — never filter on it |
| `@index` | `Step_Index` | Execution order within the script |
| `@enable` | `Is_Enabled` | Disabled steps are exported too |
| `@breakpoint` | — | Script Debugger breakpoint flag — **not extracted** |
| `@hash` | — | Step content hash — **not extracted** (the DDR hash below is a different value) |
| `<UUID>` (text) | `Step_UUID` | Stable identity |
| `<OwnerID>` | — | Empty in all observed exports; undocumented — **not extracted** |
| `<Options>` (text content) | — | Numeric step option value — **not extracted** |
| `<DDRREF kind="StepText">` | `DDR_Hash`, `DDR_UUID` | Joins to the human-readable step text in [DDR_ScriptSteps](../catalog-tables/DDR_ScriptSteps.md) (requires DDR-Info) |

### Parameters (`<ParameterValues>`)

Step parameters are typed `<Parameter>` children; the parameter vocabulary is an open set defined per step type (over 100 distinct `@type` values occur in the test corpus, from `Calculation` and `Variable` to `SortSpecification` and `LLMAction`). Object references appear as `*Reference` elements inside the parameters (`FieldReference`, `LayoutReference`, `ScriptReference`, `TableOccurrenceReference`, `ValueListReference`, `WindowReference`, …).

| Property (XML) | In catalog | Notes |
|---|---|---|
| `<ParameterValues>` (full fragment) | `Parameters_XML` | Raw parameter XML, last resort |
| whole `<Step>` fragment | `Step_XML` | Raw step XML, last resort |
| first `<Parameter>/@type` | `Parameter_Type` | |
| `Variable` parameter | `Variable_Name` | Set Variable target |
| main `Calculation` parameter | `Calculation_Text` | The step's principal calc expression |
| `Text` parameter | `Inserted_Text` | Insert-Text-class payload |
| `Comment` parameter | `Comment_Text` | |
| `Boolean` parameter | `Boolean_Type`, `Boolean_Value` | On/off style options |
| other parameter types | — | Only in `Parameters_XML`; object references are resolved into [ObjectLinks](../object-catalog/ObjectLinks.md) at import — query the edge, not the XML |

**Important:** [ObjectLinks](../object-catalog/ObjectLinks.md) edges carried by calculations and references *inside* steps attach to the parent **Script** with the step index as `Link_Subrole` — not to the ScriptStep object. The ScriptStep object itself carries only structural edges: `parent_script`, plus `has_calculation` to each of its parameter-calculation instances (schema 1.22.0).

## Object hierarchy

Every step belongs to exactly one [Script](Script.md) via `parent_script`, ordered by `Step_Index`; control-flow nesting (`If`/`Loop` blocks) is a property of the sequence, not of the containment tree. A second habitat exists outside scripts: a layout **button can embed a single script step** (`Button/action/Step` in the [LayoutCatalog branch](../../xml/catalogs/XML%20LayoutCatalog.md)). Button-embedded steps do **not** become ScriptStep objects — their references attach to the owning [LayoutObject](LayoutObject.md), and they count toward the per-type aggregate [ScriptStepType](ScriptStepType.md).

## References

ScriptStep is deliberately link-poor: usage edges live on the parent script (see above). Full role definitions: [Link Roles and Subroles](../object-catalog/Link%20Roles%20and%20Subroles.md).

### Outgoing links (ScriptStep as source)

| Link_Role | Target | Kind | Description |
|---|---|---|---|
| `parent_script` | [Script](Script.md) | containment | The step belongs to the script |
| `has_calculation` | [Calculation](Calculation.md) | containment | Each parameter-calculation slot of the step as an addressable instance (subrole `step_parameter`, indexed for multi-calc steps) — never counts as usage |

### Incoming links (ScriptStep as target)

No link role targets ScriptStep — the type appears only as a source of `parent_script` and `has_calculation`.

## Schema & tooling

- **XML schema:** [XML StepsForScripts](../../xml/catalogs/XML%20StepsForScripts.md) — `Structure/AddAction` branch, grouped per script under a `<ScriptReference>` wrapper
- **DB schema:** [StepsForScripts](../catalog-tables/StepsForScripts.md) · human-readable step text in [DDR_ScriptSteps](../catalog-tables/DDR_ScriptSteps.md) · step vocabulary in [fm-spec](../../Wiki/fm-spec.md) ([script_steps](../fm-spec-tables/script_steps.md), [step_xml_map](../fm-spec-tables/step_xml_map.md))
- **Detail view:** hoisted — steps render inside the script detail view (`object_details_script.sql`); for a standalone ScriptStep object `/api/get-details` falls back to the generic template (`object_details_generic.sql`). The calculation-token view of a single step is served by `object_details_scriptstep_tokens.sql` (all via the [/api/get-details endpoint](../../rest-api/endpoints/Objects%20API.md))
- **Frontend:** object list at `http://localhost:5173/?type=ScriptStep`

**See also:** [Object Types](../object-catalog/Object%20Types.md) · [Script](Script.md) · [ScriptStepType](ScriptStepType.md) · [fm-spec](../../Wiki/fm-spec.md) · [Link Roles and Subroles](../object-catalog/Link%20Roles%20and%20Subroles.md)
