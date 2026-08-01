# Schema Reference — DuckDB Tables & Link Roles

> Referenced from CLAUDE.md §4. Read this when you need column-level detail,
> link-role semantics, or the complete table list. For the pipeline that builds
> these tables see `pipeline-reference.md`; for the underlying XML structure see
> `docs/agents/xml-schema.md`.

## All tables

The table names mirror the XML branches of the corresponding object types:

- **XMLMetadata** — Root attributes of the XML file (version, DDR-Info status)
- **ExternalDataSourceCatalog** — External data sources
- **BaseTableCatalog** — Base tables of the FileMaker solution
- **TableOccurrenceCatalog** — Table occurrences in the relationship graph
- **RelationshipCatalog** — Relationships between table occurrences (per predicate, column `Predicate_Index`)
- **FieldsForTables** — Fields of all tables with type, properties and AutoEnter details (Lookup, Calculated, ConstantData)
- **CustomFunctionsCatalog** — Custom functions
- **CalcsForCustomFunctions** — Formulas of the custom functions
- **ScriptCatalog** — All scripts, folders and separators
- **StepsForScripts** — Script steps with parameters. Note `Calculation_Text` = the step's **first** calculation in document order, excluding repetition/window-geometry (`Bounds`) slots — NULL when the step carries only such slots (e.g. a `New Window` without a name). For every calculation of a multi-calc step use **StepCalculations**. `Opens_Window` (derived, P3): TRUE/FALSE for the two window-capable steps only (`New Window` = always TRUE, `Go to Related Record` = TRUE iff its "New window" option is set), NULL for all other steps
- **StepCalculations** — One row per positioned calculation of a step (derived in P3 from `Step_XML`): `Slot` (parent element of the calculation — `Name`, `height`, `URL`, `Title`, `value`, `repetition`, … or `Parameter:<type>` when directly under a `<Parameter>`), `Calc_Position` (the `@position` attribute — NOT step-unique, FileMaker restarts numbering in some parameter containers), `Slot_Seq` (1-based ordinal within one slot parent, e.g. JavaScript argument lists), `Calc_Text`. Covers what `Calculation_Text` cannot: window names vs. geometry, dialog title vs. message, URL vs. cURL options
- **Layouts** — Layouts of the solution
- **LayoutObjects** — All layout objects across all layouts (22 types, real container hierarchy via direct child axes; corpus reaches nesting depth 5)
- **LayoutParts** — Layout sections (Header, Body, Footer, Sub-summaries; one row per part via `Part_Seq` — multiple sub-summaries of the same kind stay distinct; `Break_Field_*`/`Break_TO_*` = sub-summary break field)
- **ValueListCatalog** — Value lists
- **OptionsForValueLists** — Details of value lists (CustomValues, field references, External source: `External_DS_*`/`External_VL_*` columns for value lists sourced from another file)
- **AccountsCatalog** — User accounts
- **PrivilegeSetsCatalog** — Privilege sets
- **PrivilegeSetRecordAccess** — Custom Record Privileges, table level (per Privilege Set × table × operation View/Edit/Create/Delete; access mode, calc text/hash, evaluation context)
- **PrivilegeSetFieldAccess** — Custom Record Privileges, field level (per Privilege Set × table × field; per-field access mode, only for tables with `Fields access="Custom"`)
- **PrivilegeSetObjectAccess** — Custom Privileges for Layouts/ValueLists/Scripts (per Privilege Set × object; per-object access mode, Layout records-access, class create flag)
- **DDR_ScriptSteps** — Human-readable script steps (optional, only when DDR-Info is available)
- **DDR_Calculations** — Formula chunks for dependency analysis (optional, only when DDR-Info is available)
- **PasteIndexList** — List of object IDs for copy/paste operations
- **BaseDirectoryCatalog** — Base directory of the FileMaker file
- **ScriptTriggers** — Script triggers (OnFirstWindowOpen, OnLastWindowClose, etc.)
- **ExtendedPrivilegesCatalog** — Extended privileges (fmwebdirect, fmxdbc, fmapp, etc.)
- **CustomMenuCatalog** — Custom menus with nested hierarchy
- **CustomMenuItemCatalog** — Individual menu items (from Menu_XML: commands, submenu/separator flags)
- **CustomMenuSetCatalog** — Menu sets with member-menu ID lists
- **ThemeCatalog** — CSS rule sets for layouts
- **FileOptionsCatalog** — File options from the Metadata branch: encryption status, minimum version, **auto-login account (security-relevant)**, sharing visibility, default/start layout (→ `default_layout` link)
- **FileAccessAuthorizations** — Inter-file access authorizations
- **LibraryReferences** — Library references (metadata only, blobs discarded)
- **LinkRoleRegistry** — Link-role classification per role: columns `Link_Role`, `Link_Kind` (`usage`/`containment`/`restriction`), `Counts_For_Where_Used` (boolean). No prose/`Description` column — the meaning of each role is the "Link roles" list below. P6 warns when an ObjectLinks role lacks a registry entry
- **ScriptStepRoleMap** — Curated Step_ID → Link_Role mapping for Script→Field links (locale-independent; `Step/@name` is localized in SaXML exports). Canonical_Name documents the English reference name; IDs verified against the reference index `reference/fm_spec.duckdb` (`script_steps.step_id` ≙ SaXML `Step/@id`), which is deliberately NOT a runtime dependency of the converter
- **FilesCatalog** — Metadata of all imported FileMaker files (multi-file support)
- **ObjectCatalog** — Central object registry covering all 25+ object types across all files
- **ObjectLinks** — Links between objects (operational & structural, including cross-file links)
- **VariableUsages** — Every individual variable usage with its context (script, field, layout)
- **VariablesCatalog** — Aggregated overview per variable (set/read counts, scope, files)
- **DuplicateAbsorptions** — Dup-absorption census (monitoring): parsed source-record counts per catalog × file × chunk, written in P1. The P6 view `v_check_absorbed_dups` compares against live row counts — a positive difference means the per-file upsert silently collapsed duplicate-UUID source objects (export defect class B-K3); reported as a warn finding in the import report
- **v_script_block_tree** — MATERIALIZED per-step control-flow nesting (built with the analysis views): for every script step its Loop and If depth (`loop_depth_before/after`, `if_depth_before/after`, `block_depth_before`, raw `if_running_depth` for unbalanced-If detection). **Use this whenever branch scope matters** (is step X inside a Loop / which If level — e.g. dead-code or window-lifecycle reasoning); never reconstruct nesting by hand from sequential `Step_Index` reads. Partition key is `(File_Name, Script_ID)` — not `Script_UUID`, which is non-unique in merge-artifact cases

### Common columns

Every table contains:
- An `ID` column (e.g. `BT_ID`, `Script_ID`, `Field_ID`)
- A `Name` column (e.g. `BT_Name`, `Script_Name`, `Field_Name`)
- A `UUID` column for unique referencing

Use UUIDs for JOINs; the row order matches the FileMaker solution; script steps additionally carry `Step_Index`.

**`Step_Index` is 0-based and gapless** (per script: `min = 0`, `max = n-1`). FileMaker's
Script Workspace and every fm-lab user-facing surface count 1-based — **always render
`Step_Index + 1` when quoting a step number to a user**, and subtract 1 when translating a
user-quoted step number back into a `Step_Index` filter. Sort/join on the raw `Step_Index`.

## FieldsForTables — column details

Base columns: Table_ID/Name/UUID, Field_ID/Name/Type, Data_Type, Field_Comment, Field_UUID, Is_Global, Max_Repetitions, DDR_Hash, Calculation_Text. Plus 13 AutoEnter columns:

**AutoEnter base attributes (all types):**
- `AutoEnter_Type` — Type: `Looked_up`, `SerialNumber`, `Calculated`, `ConstantData`, `CreationDate`, etc. (NULL for fields without AutoEnter)
- `AutoEnter_ProhibitMod` — May the user overwrite the value?

**Lookup details (only AutoEnter_Type = 'Looked_up'):**
- `Lookup_Field_Name` / `Lookup_Field_UUID` — Source field (name and UUID)
- `Lookup_TO_Name` / `Lookup_TO_UUID` — Relationship TO (name and UUID)
- `Lookup_DontCopyIfEmpty` — Do not copy empty values?
- `Lookup_NoMatchOption` — `DoNotCopy` or `ConstantData`

**AutoEnter Calculated details (only AutoEnter_Type = 'Calculated'):**
- `AE_Calc_Text` — Plain-text formula (complementary to `Calculation_Text` for true Calculated Fields)
- `AE_Calc_Hash` — DDR hash (complementary to `DDR_Hash`; JOIN with DDR_Calculations possible)
- `AE_Calc_OverwriteExisting` — Overwrite existing values?
- `AE_Calc_AlwaysEvaluate` — Re-evaluate on every change?

**ConstantData (only AutoEnter_Type = 'ConstantData'):**
- `AE_ConstantData` — Fixed default value

**Note:** `Calculation_Text`/`DDR_Hash` apply to `fieldtype="Calculated"` (true Calculated Fields), while `AE_Calc_Text`/`AE_Calc_Hash` apply to `fieldtype="Normal"` with an AutoEnter calculation. A field never has both populated at the same time.

**Validation / storage / serial / summary columns (schema 1.5.0):**
- `Validation_Type/_AllowOverride/_NotEmpty/_Unique/_Existing` — field validation options; `Validation_VL_ID/_Name/_UUID` — validation by value list (→ `uses_valuelist` link, Subrole `validation`)
- `Storage_AutoIndex`, `Storage_Index` (`None`/`All`/`Minimal`), `Storage_StoreCalcResults` — indexing/storage options
- `Serial_Increment/_NextValue/_Generate` — serial-number details (only `AutoEnter_Type='SerialNumber'`)
- `Summary_Operation`, `Summary_Field_Name/_UUID` — summary definition (only `fieldtype='Summary'`; → `summarizes_field` link)

**Field-option coverage (schema 1.10.0):**
- `Validation_AlwaysValidate` — `<Validation @alwaysValidate>`
- `Validation_StrictType` — strict data type from `<Strict>` (`FourDigitYear`, numeric-only, time-of-day; raw token, no enum constraint)
- `Validation_MaxChars` — `<MaximumSize>` (max characters)
- `Validation_Range_From/_To` — `<Range @from/@to>`
- `Validation_Calc_Text/_Calc_Hash` — validate-by-calculation (`<Validation><Calculated>`; hash → `DDR_Calculations`, feeds the `validates_by_calc` link)
- `Validation_Message` — static custom error message (`<Message>`); `Validation_Message_Calc_Hash` — `<MessageCalc>` (message-by-calc)
- `Storage_IndexLanguage/_IndexLanguage_ID` — default index language (`<Storage><LanguageReference @name/@id>`; a **child element**, not an attribute)
- `Summary_RestartEachGroup`, `Summary_RepetitionMode` (`Together`/`Individually`) — `<SummaryInfo @restartEachGroup/@summarizeRepetition>`

**Layouts metadata columns (schema 1.5.0):** `L_TO_UUID` (context TO by UUID), `L_Width`, `L_Theme_ID/_Name/_UUID` (→ `uses_theme` link).

## LayoutObjects — structure

**Base attributes:**
- `Layout_ID` — Link to the layout (JOIN with Layouts.L_ID)
- `Part_Type` — Layout section (Header, Body, Footer)
- `Object_ID` — Object ID (unique only within a layout)
- `Object_UUID` — Unique UUID of the object
- `Object_Type` — Type of the object (Text, Edit Box, Button, Portal, Rectangle, etc.)
- `Object_Name` — User-defined name (often empty)

**Positioning:** `Bounds_Top`, `Bounds_Left`, `Bounds_Bottom`, `Bounds_Right` — position and size in pixels

**Nesting:**
- `Parent_Object_ID` — Reference to the parent object (NULL = top-level)
- `Nesting_Level` — Nesting level (0 = top-level; nested containers reach depth 5 in practice — e.g. Tab Control → Panel → Group → Grouped Button → object)

**Polymorphic properties:** `Object_XML` — full object definition as a raw XML fragment, queryable via `xml_extract_text(Object_XML, '/xpath')[1]` (requires `LOAD webbed;`)

**Object types (22):**
- **Input**: Edit Box, Drop-down List, Pop-up Menu, Radio Button Set, Checkbox Set, Drop-down Calendar
- **Display**: Text, Graphic, Container, Web Viewer
- **Action**: Button, Grouped Button, Button Bar, Popover Button
- **Container**: Portal, Group, Tab Control, Panel, Slide Control, PopoverPanel
- **Graphic**: Rectangle, Line, Oval

## PrivilegeSetRecordAccess (Custom Record Privileges)

When a privilege set uses **Custom Record Privileges**, the `<Records>` element only carries `Custom="True"` and `PrivilegeSetsCatalog.Records_*` no longer reflect the real access. The detail tree (`Records/Custom/ObjectList/Table`) is parsed into **PrivilegeSetRecordAccess** — one row per privilege set × table × operation:

- `PrivilegeSet_ID` / `PrivilegeSet_Name` / `PrivilegeSet_UUID` — owning privilege set
- `BaseTable_ID` / `BaseTable_Name` / `BaseTable_UUID` — target base table (NULL when `Table_Type='New'`)
- `Table_Type` — `existing` or `New` (the default rule for future, not-yet-existing tables)
- `Operation` — `View` | `Edit` | `Create` | `Delete`
- `Access_Mode` — `NoAccess` | `ReadOnly` | `ReadWrite` | `Calculation` | `Custom` | … (kept as VARCHAR, no enum, so unknown modes survive)
- `Calculation_Text` — plain-text formula (CDATA) when `Access_Mode='Calculation'`, normalized
- `DDR_Hash` — `Calculation/DDRREF/@hash`; JOIN-able with `DDR_Calculations.Calc_Hash`
- `Context_TO_Name` / `Context_TO_UUID` — evaluation context (the calc's table occurrence)
- `Fields_Access` — the table's `<Fields>@access` (one value per table; `Custom` opens a per-field detail tree → PrivilegeSetFieldAccess)
- `File_Name`

**Graph integration:** all references inside record-access calcs (via `DDR_Hash` → `DDR_Calculations`) are emitted into `XMLCalcReferences` with `Source_Type='PrivilegeSet'` and resolved to graph links (Link_Subrole = `<Operation>:<Table>` where applicable): **FieldRef** → `PrivilegeSet → Field (reads_field)`, **CustomFunctionRef** → `PrivilegeSet → CustomFunction (calls_customfunction)`, **PluginFunctionRef** → `PrivilegeSet → PluginFunction (calls_pluginfunction)` (via `PluginFunctionUsages`). **VariableReference** is handled separately — it has no generic XMLCalcReferences→link pass, so its read-usage is registered in `VariableUsages` (`Context_Type='record_access_calc'`) and becomes a `PrivilegeSet → Variable (reads_variable)` link. Together these close the where-used gap for any field/variable/CF/plugin referenced **only** by a Custom Record Privilege calc. Requires DDR-Info; without it the table is still populated (calc text comes from the CDATA subtree), but no graph links are created.

**Field level — `PrivilegeSetFieldAccess`:** when a table's `Fields_Access='Custom'`, the per-field detail tree (`…/Table/Fields/Field`) is parsed into one row per privilege set × table × field: `BaseTable_*`, `Field_ID`/`Field_Name`/`Field_UUID`, `Field_Type` (`existing`/`New`), `Access_Mode` (`NoAccess`/`ReadOnly`/`ReadWrite`), `File_Name`. Tables without custom field access produce no rows here.

**Other object classes — `PrivilegeSetObjectAccess`:** the same `Custom="True"` mechanism applies to Layouts, ValueLists and Scripts. Unified table with an `Object_Class` discriminator (`Layout`/`ValueList`/`Script`), one row per privilege set × object: `Object_ID`/`Object_Name`/`Object_UUID`, `Item_Type` (`existing`/`New`), `Access_Mode`, `Records_Access` (Layouts only), `Class_Allow_Create`, `File_Name`. Classes left in the simple attribute form (e.g. `<ValueLists Create="True" …>`) produce no rows.

Both feed the graph via **scoped restriction links** (`restricts_field` / `restricts_object`), but only for actual restrictions (`Access_Mode <> 'ReadWrite'`). **A restriction is *not* a usage** — these roles never make an object appear "used" in where-used or dead-code analysis. Folders/separators in the access tree are excluded. Link_Subrole carries the access mode.

## VariableUsages / VariablesCatalog

**VariableUsages** — every individual usage of a variable:
- `Variable_Name` — Full name including the prefix (`$sort`, `$$Module`)
- `Variable_Scope` — `global`, `local`, `superglobal`, `let_local`
- `Usage_Type` — `set` (assignment) or `read` (read access)
- `Context_Type` — `script_step`, `calculation`, `auto_enter_calc`, `custom_function`, `layout_object`, `record_access_calc` (variable read inside a Custom Record Privilege calc; Context_Name = `<PrivilegeSet> › <Operation>:<Table>`)
- `Context_UUID`, `Context_Name` — UUID and name of the context
- `Script_Name`, `Script_UUID`, `Step_Index` — Script context
- `Table_Name`, `Field_Name` — Field context
- `Source` — `set_variable_step`, `ddr_chunk`, `mbs_variable_call`, `merge_variable`, `regex_fallback`
- `File_Name` — FileMaker file

**VariablesCatalog** — aggregated overview per variable:
- `Variable_Name`, `Variable_Scope`, `Display_Name`, `Normalized_Name`
- `Set_Count`, `Read_Count`, `Script_Count`, `File_Count`
- `Files` (VARCHAR[]) — list of file names
- `Has_Spaces` — spaces in the name?
- `Source_Reliability` — `ddr`, `mbs`, `merge`, `regex`

**Data sources:** DDR_Calculations VariableReference chunks (primary), Set Variable steps, MBS superglobals (Variable.Set/Get), merge variables from layouts, LayoutObject formula hashes (Conditional Formatting, Hide, Tooltip, etc.), regex fallback for files without DDR.

**Prefix convention for Display_Name:** `$` → local, `$$` → global, `$$$` → superglobal (synthetic, MBS Plugin)

**ObjectCatalog integration:** Variables are registered with `Object_Type = 'Variable'`. UUID = `md5(Variable_Scope || '::' || Scope_Anchor || '::' || Variable_Name)` — the scope anchor is the script for local variables, the file for global variables, `__global` for superglobals.

**ObjectLinks roles:** `sets_variable`, `reads_variable`, `displays_variable`

## DDR-Info support (optional)

Starting with FileMaker 21, the export option **"Include details for analysis tools"** adds detailed metadata.

**Check availability:**
```sql
SELECT Has_DDR_INFO, FileMaker_Version, Filename FROM XMLMetadata;
```

**DDR_ScriptSteps** and **DDR_Calculations** are always created, but only populated when `Has_DDR_INFO = 'True'`.

**Usage with conditional display:**
```sql
SELECT
    s.Script_Name,
    s.Step_Index,
    CASE WHEN (SELECT Has_DDR_INFO FROM XMLMetadata) = 'True'
         THEN ddr.Step_Text
         ELSE s.Step_Name END as Display_Text
FROM StepsForScripts s
LEFT JOIN DDR_ScriptSteps ddr ON s.DDR_UUID = ddr.Step_UUID;
```

### DDR_Hash for Calculated Fields & CustomFunctions

With FileMaker 21+ and DDR-Info enabled, **FieldsForTables** and **CustomFunctionsCatalog** carry a `DDR_Hash` column that joins to **DDR_Calculations** via `DDR_Hash = Calc_Hash`:

- `FieldsForTables.DDR_Hash` — hash for Calculated Fields (NULL for other field types)
- `CustomFunctionsCatalog.DDR_Hash` — copied from `CalcsForCustomFunctions.DDR_Hash`

```sql
-- Dependencies of a Calculated Field
SELECT f.Field_Name, f.Table_Name, COUNT(d.Chunk_Index) as Dependency_Count
FROM FieldsForTables f
JOIN DDR_Calculations d ON f.DDR_Hash = d.Calc_Hash
WHERE f.Field_Type = 'Calculated'
GROUP BY f.Field_Name, f.Table_Name;

-- Dependencies of a CustomFunction
SELECT cf.CF_Name, COUNT(d.Chunk_Index) as Chunk_Count
FROM CustomFunctionsCatalog cf
JOIN DDR_Calculations d ON cf.DDR_Hash = d.Calc_Hash
GROUP BY cf.CF_Name;
```

## Universal catalogs

**FilesCatalog** — metadata of all imported FileMaker files:
- `File_Name` — file name without the .fmp12 suffix (PRIMARY KEY)
- `File_FullName`, `File_UUID`, `FileMaker_Version` (e.g. "ProAdvanced 22.0.4"), `Has_DDR_INFO`, `Import_Timestamp`, `XML_Path`

**ObjectCatalog** — central object registry:
- `Object_UUID` (PRIMARY KEY), `Object_Type`, `Object_Name`, `File_Name`, `Source_Table`, `Object_ID`

**Supported object types:**
- BaseTable, TableOccurrence, Field, Relationship
- Script, ScriptStep, Layout, LayoutObject (22 subtypes)
- CustomFunction, ValueList, Account, PrivilegeSet
- Theme, CustomMenu, ExtendedPrivilege, ScriptTrigger
- ExternalDataSource, BaseDirectory, LayoutPart
- File (owner anchor for file-level triggers; UUID = `FMSaveAsXML/@UUID`)
- Variable (see above), PluginFunction / PluginComponent

**ObjectLinks** — links between objects:
- `Source_UUID` / `Target_UUID` — source and target object UUIDs
- `Source_Type` / `Target_Type` — object types
- `Link_Type` — `operational` (functional dependencies) or `structural` (container hierarchies)
- `Link_Role` — specific role (e.g. calls_script, displays_field, parent_layout)
- `Is_Cross_File`, `Source_File` / `Target_File` — multi-file analyses

## Link roles (59 registered: 49 usage, 8 containment, 2 restriction)

Authoritative list incl. semantics: **`LinkRoleRegistry` table** — query it when in doubt. Overview:

- Field → BaseTable (parent_table)
- Field → Field (lookup_source) — Lookup target field references the source field
- Field → TableOccurrence (lookup_relationship) — Lookup target field uses this relationship
- Field → Variable (reads_variable) — Calculated/AutoEnter formula references the variable
- Field → Field/CustomFunction (validates_by_calc) — a field-validation calc (`<Validation><Calculated>`) or its custom-message calc (`<MessageCalc>`) references the target; Link_Subrole `validation`. A real usage → counts for where-used. Closes the gap for objects referenced **only** by a field validation
- TableOccurrence → BaseTable (base_table)
- TableOccurrence → ExternalDataSource (data_source)
- Relationship → TableOccurrence (left_table, right_table)
- Relationship → Field (left_field, right_field) — join-predicate fields; multi-field joins produce one pair **per predicate** since schema 1.2.0 (`Predicate_Index`)
- Relationship → Field (sort_field) — field of a relationship side's sort order; Link_Subrole = `left`/`right`. A real sort dependency, appears in the field's where-used (schema 1.3.0)
- Layout → TableOccurrence (context_table)
- LayoutObject → Layout (parent_layout)
- LayoutObject → LayoutObject (parent_object, structural)
- LayoutObject → Field (displays_field)
- LayoutObject → Script (triggers_script)
- LayoutObject → ValueList (uses_valuelist) — field uses the value list
- LayoutObject → TableOccurrence (portal_context) — portal data source
- LayoutObject → Variable (displays_variable, reads_variable) — merge variable, trigger parameter, DDR formulas (Conditional, Hide, Tooltip, etc.)
- LayoutObject → Layout/TableOccurrence/Field (navigates_to_layout, navigates_to_to, navigates_to_field/sorts_by_field/… via `ScriptStepRoleMap`) — **button-embedded single step** (`GroupedButton/Button/action/Step`): a button can execute a single script step instead of calling a script. Its references produce the same **reused** roles as the script side (`Source_Type='LayoutObject'` distinguishes the carrier; no new registry roles). Extracted in P2 from `Object_XML` with paths anchored at the button (`Ref_Type='layout_step'`/`table_occurrence_step'`/`field_step'`; step `@id` in additive column `XMLLayoutReferences.Step_ID` carries the locale-independent field role). Semantic gating like the script side: `navigates_to_to` only for GTRR (`Step_ID=74`) — the context TO of a Go-to-Field/Sort step is not a navigation target. Closes the largest remaining where-used gap class (layouts reachable only via button appeared as false positives in `unused_layout`)
- ScriptStep → Script (parent_script, structural)
- Script → Script (calls_script)
- Script → Field (sets_field, navigates_to_field; plus reads_field/finds_in_field/sorts_by_field/imports_to_field/exports_from_field/inputs_to_field per step-type group, and references_field as the fallback for uncurated step types). Role assignment is locale-independent via the step ID (`ScriptStepRoleMap` table): SaXML writes `Step/@name` in the exporting client's UI language, so name matching broke for localized (German) exports. Uncurated step IDs land in references_field and are reported by the P6 check `v_check_step_roles`
- Script → Layout (navigates_to_layout) — Go to Layout steps (and the target layout of "Go to Related Record")
- Script → TableOccurrence (navigates_to_to) — target TO of "Go to Related Record" (`Ref_Type='tableOccurrence'`). Closes the where-used gap for TOs serving only as GTRR targets
- Script → ValueList (sorts_by_valuelist) — reference value list of a custom sort in "Sort Records" (`<Sort type="Custom">` with `<ValueListReference>`; `Ref_Type='valuelist'`). Closes the where-used gap for value lists used only as sort reference (the sort *field* is linked via `sorts_by_field`)
- LayoutObject → ValueList (sorts_by_valuelist, Subrole `portal`/`button`) — custom sort of a portal or a button-embedded sort step. P2 extraction over `Object_XML` with paths **anchored** at the owning object (`Ref_Type='valuelist_sort'`; a `//` XPath would double-match inherited portal sorts on ancestor containers, since `Object_XML` contains the full subtree)
- Relationship → ValueList (sorts_by_valuelist, Subrole `left`/`right`) — custom sort of a relationship side (`RelationshipCatalog.Left/Right_Sort_ValueList_UUIDs`, analogous to `sort_field`)
- ValueList → ValueList (source_valuelist) — external value list: local wrapper (`<Source value="External">`) → target VL of the source file. The target UUID is EMPTY in the XML → resolved via data source (target file) + VL ID (fallback name); unresolved targets reported by P6 `v_check_external_vl_unresolved`
- ValueList → ExternalDataSource (data_source) — data source of an external wrapper (same role as TableOccurrence → ExternalDataSource)
- Script → Variable (sets_variable, reads_variable)
- CustomFunction → Variable (reads_variable, sets_variable)
- ValueList → Field (source_field)
- ValueList → TableOccurrence (source_table)
- ScriptTrigger → Script (trigger_script)
- ScriptTrigger → Layout/LayoutObject/File (trigger_owner) — structural back-link from a trigger to its owner; Link_Subrole = trigger type (e.g. `OnObjectSave`). Lets "which triggers hang on layout/object/file X?" be a direct graph query
- Account → PrivilegeSet (privilege_set)
- PrivilegeSet → Field (reads_field) — field referenced by a Custom Record Privilege calc; Link_Subrole = `<Operation>:<Table>`
- PrivilegeSet → Variable (reads_variable) — variable read by a Custom Record Privilege calc; via `VariableUsages.Context_Type='record_access_calc'`. A *read*, not a restriction — counts for where-used/dead-code (unlike `restricts_*`)
- PrivilegeSet → CustomFunction (calls_customfunction) / PrivilegeSet → PluginFunction (calls_pluginfunction) — CF/plugin called by a Custom Record Privilege calc
- PrivilegeSet → Field (restricts_field) — field-level restriction; Link_Subrole = access mode. Scoped to restrictions only (`Access_Mode <> 'ReadWrite'`); **never counts as usage**
- PrivilegeSet → Layout/ValueList/Script (restricts_object) — object-level restriction; Link_Subrole = access mode. Scoped to restrictions only; folders/separators excluded
- PrivilegeSet → ExtendedPrivilege (grants_privilege) — which sets grant fmapp/fmxdbc/fmwebdirect etc. (access audit)
- Layout → Theme (uses_theme) — layouts carrying a `LayoutThemeReference` (theme cleanup: which themes are in use?)
- Layout → CustomMenuSet (uses_menuset) — layout-bound menu set (the built-in default id=0/"[File Default]" is normalized to NULL in P1 and produces no link)
- Script → CustomMenuSet (installs_menuset) — Install-Menu-Set steps (via `XMLStepReferences` Ref_Type='menuset')
- CustomMenuItem → CustomMenu (opens_menu) — submenu item (`isSubMenuItem="True"`) → the menu it opens (`CustomMenuReference/@id`, no UUID → P4 resolves via `(File_Name, Menu_ID)` against `CustomMenuCatalog`; menu IDs are file-local). A real usage, deliberately NOT `parent_menu` (the containment-style owner backlink): closes the where-used gap for menus that only serve as a submenu of another (those need not be menu-set members → `contains_menu` doesn't cover them) and makes the menu hierarchy navigable. Unresolvable target IDs (built-in menu / outside the corpus) reported by P6 `v_check_submenu_unresolved`
- LayoutPart → Layout (parent_layout, structural) — parts anchored to their layout; Link_Subrole = part type
- LayoutPart → Field (breaks_on_field) — sub-summary break field (`Part/Definition/FieldReference`); Link_Subrole = part type. Closes the where-used gap for fields used only as a sub-summary break
- Field → ValueList (uses_valuelist, Subrole `validation`) — field validation by value list (a VL used only for validation no longer appears unused)
- Field → Field (summarizes_field) — summary field → summarized field; Link_Subrole = operation (Total/Average/…)
- File → Layout (default_layout) — start layout from the file options
- File → Account (auto_login_account) — auto-login account from the file options (security-relevant; unresolved when the referenced account does not exist)
- PluginFunction naming: qualified as `MBS:<Sub>::<Sub>` (e.g. `MBS:List.Sort::List.Sort`); PluginComponents aggregate as `MBS::<Component>` via `groups_into`
