# Schema Version History

The solution catalog carries an internal schema version, independent of the fm-lab release version. It is declared in the Phase-1 template of the conversion pipeline (`sql/convert-xml/convert_xml_01_extract.sql`, marker `@SCHEMA_VERSION`) and stamped into every built database via the `SchemaInfo` table. On each import the pipeline compares the template version against the version persisted in the database — a mismatch triggers the auto-heal mechanism: a forced full rebuild, so a catalog can never silently mix schema generations. An MD5 hash over the core SQL templates serves as a secondary drift indicator (hash drift alone warns; only a version bump forces the rebuild). That is why even pure content-semantic corrections get a version bump: the bump is what guarantees existing catalogs are rebuilt.

Two scope notes: this history covers the **solution catalog** (`db/fm_catalog.duckdb`) only — the [fm-spec](../Wiki/fm-spec.md) reference database has its own, independent `schema_version` in [reference_meta](fm-spec-tables/reference_meta.md). And versions up to 1.4.1 predate the fm-lab version manifest (introduced with v0.8.6), so no fm-lab release can be assigned to them; entries older than 1.4.0 are reconstructed from the git history.

## Versions

| Schema version | fm-lab version | Date |
|---|---|---|
| [1.14.0](#1140) | 0.9.3 | 2026-07-16 |
| [1.13.0](#1130) | 0.9.0 | 2026-07-15 |
| [1.12.1](#1121) | 0.9.0 | 2026-07-15 |
| [1.12.0](#1120) | 0.9.0 | 2026-07-15 |
| [1.11.0](#1110) | 0.9.0 | 2026-07-15 |
| [1.10.0](#1100) | 0.9.0 | 2026-07-15 |
| [1.9.0](#190) | 0.9.0 | 2026-07-15 |
| [1.8.0](#180) | 0.9.0 | 2026-07-15 |
| [1.7.0](#170) | 0.8.9 | 2026-07-08 |
| [1.6.1](#161) | 0.8.6 | 2026-07-04 |
| [1.6.0](#160) | 0.8.6 | 2026-07-03 |
| [1.5.2](#152) | 0.8.6 | 2026-07-03 |
| [1.5.1](#151) | 0.8.6 | 2026-07-02 |
| [1.5.0](#150) | 0.8.6 | 2026-07-02 |
| [1.4.1](#141) | — | 2026-06-23 |
| [1.4.0](#140) | — | 2026-06-18 |
| [1.3.0](#130) | — | 2026-06-18 |
| [1.2.0](#120) | — | 2026-06-18 |
| [1.1.0](#110) | — | 2026-06-13 |
| [1.0.0](#100) | — | 2026-05-13 |

## Changes by version

### 1.14.0

`ScriptStepType` entries in [ObjectCatalog](object-catalog/ObjectCatalog.md) are now also derived from `LayoutObjectSteps`, not only from [StepsForScripts](catalog-tables/StepsForScripts.md). A step type used *exclusively* by a button-embedded step previously had no catalog entry, so the step-name link in the button detail view resolved to "not found". Rows only, no new columns — the bump exists because only a version bump forces the rebuild that backfills the missing rows.

### 1.13.0

Extraction fix for `StepsForScripts.Calculation_Text`: the previous XPath took the *first* `<Calculation>` in document order, which for steps with a **calculated repetition** on the target field returned the repetition expression instead of the actual calculation. The path now excludes calculations inside `<repetition>` (affected Set Field, Replace Field Contents, Insert Calculated Result, Insert from URL and others). Content correction of an existing column.

### 1.12.1

The [ObjectCatalog](object-catalog/ObjectCatalog.md) display name for themes now uses `Theme_Display` (falling back to the internal name) — detail views, references and the graph show "Apex Blue" instead of `com.filemaker.theme.apex_blue`. Display semantics only; links are UUID-based and unaffected.

### 1.12.0

[ThemeCatalog](catalog-tables/ThemeCatalog.md) gains the `Theme_Display` column from `<Theme @Display>` — the localized display name of the theme as the FileMaker UI shows it, alongside the internal `name`.

### 1.11.0

[Layouts](catalog-tables/Layouts.md) gains five boolean columns decoded from the bit-packed `<Options>` integer: `Auto_Save_Changes`, `Show_Field_Frames`, `Frame_Current_Record_Only`, `Show_Current_Record_List`, `Quick_Find_Enabled` (the layout's "General" options). The bit decoder was verified against calibration layouts with exactly one option toggled each. Derived from `Options_Raw`; NULL for folders/separators.

### 1.10.0

Field-option coverage: [FieldsForTables](catalog-tables/FieldsForTables.md) gains 14 columns. Validation: `Validation_AlwaysValidate`, `_StrictType`, `_MaxChars`, `_Range_From/_To`, `_Calc_Text`/`_Calc_Hash` (validate by calculation), `_Message`, `_Message_Calc_Hash`. Storage: `Storage_IndexLanguage(_ID)` (default index language from `<Storage><LanguageReference>`). Summary: `Summary_RestartEachGroup`, `Summary_RepetitionMode`. New link role `validates_by_calc` (Field → Field/CustomFunction via the validation-calc chunks) — closes the where-used gap for objects referenced only inside a field validation.

### 1.9.0

Layout metadata: [Layouts](catalog-tables/Layouts.md) gains five columns — `Is_Hidden` (from `<Options @hidden>`, the inverted "Include in layout menus" switch), `L_Theme_Base` and the author metadata `Modified_By`, `Modified_At`, `Modifications` from the `<UUID>` element attributes.

### 1.8.0

Layout view options: [Layouts](catalog-tables/Layouts.md) gains `Options_Raw`, `View_Form/List/Table_Available` and `Default_View`. The available views and the default view are encoded in the bit-packed `<Options>` integer of the layout tail (no explicit XML element); the decoder was calibrated against reference layouts. `Options_Raw` is kept so later bit derivations need no re-import.

### 1.7.0

Button-embedded script steps become readable like regular steps: (a) [DDR_ScriptSteps](catalog-tables/DDR_ScriptSteps.md) no longer collapses UUID-less step-text records (button-embedded steps) onto an empty key — they fall back to a hash-based key, so the plain text resolves via the `DDRREF` hash; (b) new Phase-2 table `LayoutObjectSteps` materializes each button's embedded `action/Step` (step ID/name/enabled/text hash) so the read-only API can render it as tokens without XML parsing.

### 1.6.1

[RelationshipCatalog](catalog-tables/RelationshipCatalog.md) now captures relationships whose predicate fields live on **external** table-occurrence sides. The previous UUID-required filter discarded the *entire* relationship when a predicate field belonged to another file (empty `FieldReference/@UUID`) — 17 % of the reference corpus was missing. Resolution now runs structurally via `(Field_TO_UUID, Field_ID)`; a new P6 check view reports residuals. Extraction semantics only, no schema change — bumped to force the data-gaining rebuild.

### 1.6.0

Value-list reference coverage and import monitoring (reconstructed from the commit, no header changelog entry): custom sorts by value list are extracted from all four carriers (Sort Records step, portal sort, button-embedded sort step, relationship sort) into the new `sorts_by_valuelist` link role; external value lists (`<Source value="External">`) are resolved across files into `source_valuelist` / `data_source` links via the `External_*` columns of [OptionsForValueLists](catalog-tables/OptionsForValueLists.md). New census tables `DuplicateAbsorptions`/`DuplicateAbsorptionDetails` plus P6 checks detect silently absorbed duplicate-UUID source objects.

### 1.5.2

[FileOptionsCatalog](catalog-tables/FileOptionsCatalog.md) gains six columns from the Metadata branch: `Save_Password_Keychain`/`_RequireMobile` (stored-credentials policy — security-relevant, independent of the auto-login) and `PageSetup_Orientation`/`_Scale`/`_Width`/`_Height` (print defaults, extracted but not surfaced in the GUI).

### 1.5.1

Layout menu sets and sub-summary break fields: [Layouts](catalog-tables/Layouts.md) gains `L_MenuSet_ID/_Name/_UUID` (built-in default normalized to NULL), [LayoutParts](catalog-tables/LayoutParts.md) gains `Part_Seq` plus the `Break_Field_*`/`Break_TO_*` columns, with `Part_Seq` added to the primary key — multiple parts of the same kind no longer collapse. New link roles `uses_menuset` (Layout → CustomMenuSet) and `breaks_on_field` (LayoutPart → Field).

### 1.5.0

The first big coverage push: [FieldsForTables](catalog-tables/FieldsForTables.md) gains 18 columns (`Validation_*`, `Storage_*`, `Serial_*`, `Summary_*`), [Layouts](catalog-tables/Layouts.md) gains `L_TO_UUID`, `L_Width` and the `L_Theme_*` columns, and the new table [FileOptionsCatalog](catalog-tables/FileOptionsCatalog.md) lands (encryption, minimum version, login/auto-login, start layout, sharing visibility). New link roles: `grants_privilege`, `uses_theme`, `installs_menuset`, `parent_layout` (LayoutPart), `uses_valuelist` (validation subrole), `summarizes_field`, `default_layout`, `auto_login_account`.

### 1.4.1

[CalcsForCustomFunctions](catalog-tables/CalcsForCustomFunctions.md) extraction also handles SaXML v2.3.0.0 (FileMaker 26), where the `<Calculation>` is embedded inside each `<CustomFunction>` instead of a separate branch — a structure-tolerant dual extraction from a single parse, with no version switch (see [XML CustomFunctionsCatalog](../xml/catalogs/XML%20CustomFunctionsCatalog.md)).

### 1.4.0

Three new tables: [FileAccessAuthorizations](catalog-tables/FileAccessAuthorizations.md), [CustomMenuSetCatalog](catalog-tables/CustomMenuSetCatalog.md) and [LibraryReferences](catalog-tables/LibraryReferences.md) (additive; the existing 41 tables unchanged). Menu sets are registered in [ObjectCatalog](object-catalog/ObjectCatalog.md) and linked to their member menus (`contains_menu`).

### 1.3.0

Relationship sort definitions (reconstructed from git): [RelationshipCatalog](catalog-tables/RelationshipCatalog.md) gains the per-side `*_Sort_Enabled`/`*_Sort_Fields`/`*_Sort_Field_*` columns and the `sort_field` link role — a relationship's sort fields now appear in the field's where-used. Includes a fix for the join-predicate field resolution.

### 1.2.0

Multi-predicate relationships (reconstructed from git): relationships are stored **per join predicate** with the new `Predicate_Index` column — multi-field joins previously lost all but one predicate. [RelationshipCatalog](catalog-tables/RelationshipCatalog.md) and the `left_field`/`right_field` links have carried one pair per predicate since.

### 1.1.0

The conversion pipeline is split into six SQL phases (P1 Extract … P6 Validate) with one template per phase, together with the `--split` option for large exports (reconstructed from git; formerly a single `convert_xml.sql`). The phase architecture is what the [Katana engine](../Wiki/katana-engine.md) later builds on.

### 1.0.0

Schema versioning itself (reconstructed from git): the `SchemaInfo` table, the `@SCHEMA_VERSION` marker in the Phase-1 template and the auto-heal mechanism — on version mismatch the pipeline discards and rebuilds the catalog (force-rebuild), so schema drift can never produce silently inconsistent databases.
