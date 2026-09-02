# XML

**Save a Copy as XML** (SaXML) is FileMaker's structural export: the complete definition of a FileMaker file — tables, fields, relationships, scripts, layouts, value lists, custom functions, menus, security — as one XML document, *without any record data*. This export is FM-Lab's single input format: everything the [object catalog](../schema/Schema.md) knows about a solution originates here.

This reference describes **SaXML v2.2.x as written by FileMaker 22** (root attribute `version="2.2.x.x"`), the format FM-Lab currently targets. FileMaker 26 introduces SaXML v2.3.0.0 with structural changes (see [version notes](#version-notes-v22-and-the-upcoming-v26)); a dedicated section for v26 will follow shortly.

## Document structure

The document has one root element, `<FMSaveAsXML>`, whose attributes identify the exported file — and three top-level branches:

```xml
<?xml version="1.0" encoding="UTF-16"?>
<FMSaveAsXML version="2.2.3.0" Source="22.0.4" File="Mysolution.fmp12"
             UUID="3577981F-…" locale="German" Has_DDR_INFO="True">

    <Structure membercount="1">
        <AddAction membercount="…">
            <!-- one catalog element per object type, see the table below -->
            <BaseDirectoryCatalog>…</BaseDirectoryCatalog>
            <ExternalDataSourceCatalog>…</ExternalDataSourceCatalog>
            <BaseTableCatalog>…</BaseTableCatalog>
            <TableOccurrenceCatalog>…</TableOccurrenceCatalog>
            <CustomFunctionsCatalog>…</CustomFunctionsCatalog>
            <FieldsForTables>…</FieldsForTables>
            <ValueListCatalog>…</ValueListCatalog>
            <OptionsForValueLists>…</OptionsForValueLists>
            <RelationshipCatalog>…</RelationshipCatalog>
            <CalcsForCustomFunctions>…</CalcsForCustomFunctions>
            <ScriptCatalog>…</ScriptCatalog>
            <ThemeCatalog>…</ThemeCatalog>
            <LayoutCatalog>…</LayoutCatalog>
            <PrivilegeSetsCatalog>…</PrivilegeSetsCatalog>
            <ExtendedPrivilegesCatalog>…</ExtendedPrivilegesCatalog>
            <AccountsCatalog>…</AccountsCatalog>
            <StepsForScripts>…</StepsForScripts>
            <CustomMenuCatalog>…</CustomMenuCatalog>
            <CustomMenuSetCatalog>…</CustomMenuSetCatalog>
            <FileAccessCatalog>…</FileAccessCatalog>
            <LibraryCatalog>…</LibraryCatalog>
            <PasteIndexList>…</PasteIndexList>
        </AddAction>
    </Structure>

    <Metadata membercount="1">
        <AddAction>…file options, start layout, file-level triggers…</AddAction>
    </Metadata>

    <DDR_INFO>…tokenized calculations & readable script texts…</DDR_INFO>
</FMSaveAsXML>
```

- **`Structure/AddAction`** holds the object catalogs — one XML dictionary per object type. This is where nearly all schema information lives.
- **`Metadata/AddAction`** holds the file options (→ [XML Metadata](catalogs/XML%20Metadata.md)).
- **`DDR_INFO`** exists only when the export was created with *“Include details for analysis tools”* (FileMaker 21+) and carries the tokenized calculations that power FM-Lab's dependency analysis (→ [XML DDR_INFO](catalogs/XML%20DDR_INFO.md)).

The root attributes themselves (format version, source version, file name/UUID, export locale, DDR flag) are imported into [XMLMetadata](../schema/catalog-tables/XMLMetadata.md) and [FilesCatalog](../schema/object-catalog/FilesCatalog.md).

## Recurring patterns

The same encoding conventions repeat throughout all catalogs — knowing them once makes every branch readable:

- **`membercount`** — nearly every container element declares how many members it holds.
- **Identity triple `id` / `name` / UUID.** Objects carry a numeric `id` and a `name` as attributes, plus a `<UUID>` child element. Numeric IDs are only unique *per file and type*; the UUID is the global identity. The `<UUID>` element doubles as modification metadata: its attributes record `modifications`, `accountName`, `userName` and `timestamp`.
- **`*Reference` elements.** A reference to another object is an element like `<FieldReference id="…" name="…" UUID="…"/>`, often nested (a `FieldReference` carrying its `TableOccurrenceReference` context). These references are what the import resolves into the [ObjectLinks](../schema/object-catalog/ObjectLinks.md) graph. Some references have no UUID (submenu targets, external value-list targets) and are resolved by file-local ID.
- **Localized names.** All display names — including script-step names (`Step/@name`) — are written in the UI language of the exporting client (root attribute `locale`). Stable identity always comes from numeric IDs and UUIDs, never from name strings.
- **Calculations = CDATA + chunk hash.** A formula appears as `<Calculation>` with the plain text in `<Text><![CDATA[…]]></Text>` and a `<DDRREF kind="ChunkList" hash="…">` pointing into [XML DDR_INFO](catalogs/XML%20DDR_INFO.md), where the same formula exists as a tokenized chunk list.
- **Unsigned 32-bit sentinels.** Some numeric attributes are serialized as unsigned 32-bit values: `4294967295` (UINT32_MAX) is FileMaker's encoding of an internal `-1` — "unlimited" / "no limit" — not a real number. Consumers must read these slots as 64-bit integers; the importer stores the sentinel of `<MaximumSize>` as NULL (see [XML FieldsForTables](catalogs/XML%20FieldsForTables.md)).
- **`TagList`, `SourceUUID`, `OwnerID`** — bookkeeping elements that appear on most objects (tags, copy provenance, folder/owner membership).

## From XML to DuckDB — the Katana engine

FM-Lab never analyzes the XML directly. The [Katana XML engine](../Wiki/katana-engine.md) converts each export into the DuckDB solution catalog described in the [schema reference](../schema/Schema.md):

1. **Normalize & partition.** The UTF-16 export is decoded to UTF-8, oversized binary payloads (icons, library blobs) are stripped, and the document is split at catalog boundaries into self-contained chunks — so multi-gigabyte exports convert in parallel with bounded memory.
2. **P1 – Extract.** The only phase that reads XML at all: every catalog branch lands as a raw DuckDB table whose name mirrors the XML branch (`ScriptCatalog` → `ScriptCatalog`, `LayoutCatalog` → `Layouts`/`LayoutParts`/`LayoutObjects`, …), including raw-XML columns for the deep structures.
3. **P2–P5 – Resolve, details, catalog, homes.** All `*Reference` elements and `DDRREF` hashes are resolved into concrete edges: the result is the central [ObjectCatalog](../schema/object-catalog/ObjectCatalog.md) / [ObjectLinks](../schema/object-catalog/ObjectLinks.md) pair, variable and plugin usage tables, and cross-file resolution.
4. **P6–P7 – Validate & cluster.** Consistency checks over the finished catalog, then graph clustering into modules.

The practical consequence for every consumer: **after import, the XML is done.** Analyses query the DuckDB tables; the per-catalog pages below document where each piece of information comes from, and each [schema](../schema/Schema.md) table page links back to its XML source.

## The catalogs

| XML branch | Content | Imported into |
|---|---|---|
| [XML BaseDirectoryCatalog](catalogs/XML%20BaseDirectoryCatalog.md) | Named base directories for external paths | `BaseDirectoryCatalog` |
| [XML ExternalDataSourceCatalog](catalogs/XML%20ExternalDataSourceCatalog.md) | External data sources with path lists | `ExternalDataSourceCatalog` |
| [XML BaseTableCatalog](catalogs/XML%20BaseTableCatalog.md) | Base tables (identity + comment) | `BaseTableCatalog` |
| [XML TableOccurrenceCatalog](catalogs/XML%20TableOccurrenceCatalog.md) | Table occurrences incl. graph-canvas state | `TableOccurrenceCatalog` |
| [XML CustomFunctionsCatalog](catalogs/XML%20CustomFunctionsCatalog.md) | Custom-function signatures & folders | `CustomFunctionsCatalog` |
| [XML FieldsForTables](catalogs/XML%20FieldsForTables.md) | Full field definitions per table | `FieldsForTables` |
| [XML ValueListCatalog](catalogs/XML%20ValueListCatalog.md) | Value-list identities | `ValueListCatalog` |
| [XML OptionsForValueLists](catalogs/XML%20OptionsForValueLists.md) | Value-list definitions incl. external wrappers | `OptionsForValueLists` |
| [XML RelationshipCatalog](catalogs/XML%20RelationshipCatalog.md) | Relationships with join predicates | `RelationshipCatalog` |
| [XML CalcsForCustomFunctions](catalogs/XML%20CalcsForCustomFunctions.md) | Custom-function formulas (v2.2 only) | `CalcsForCustomFunctions` |
| [XML ScriptCatalog](catalogs/XML%20ScriptCatalog.md) | Scripts, folders, separators, options | `ScriptCatalog` |
| [XML StepsForScripts](catalogs/XML%20StepsForScripts.md) | Script steps with typed parameters | `StepsForScripts`, `StepCalculations` (+ the step slots of `CalculationsCatalog`) |
| [XML ThemeCatalog](catalogs/XML%20ThemeCatalog.md) | Themes incl. CSS rule sets | `ThemeCatalog` |
| [XML LayoutCatalog](catalogs/XML%20LayoutCatalog.md) | Layouts, parts and all layout objects | `Layouts`, `LayoutParts`, `LayoutObjects`, `LayoutObjectConditions`, `LayoutObjectSymbols`, `ScriptTriggers`, `LayoutObjectSteps` |
| [XML PrivilegeSetsCatalog](catalogs/XML%20PrivilegeSetsCatalog.md) | Privilege sets incl. custom access trees | `PrivilegeSetsCatalog`, `PrivilegeSet*Access` |
| [XML ExtendedPrivilegesCatalog](catalogs/XML%20ExtendedPrivilegesCatalog.md) | Extended privileges with granting sets | `ExtendedPrivilegesCatalog` |
| [XML AccountsCatalog](catalogs/XML%20AccountsCatalog.md) | Accounts with authentication block | `AccountsCatalog` |
| [XML CustomMenuCatalog](catalogs/XML%20CustomMenuCatalog.md) | Custom menus with inline items | `CustomMenuCatalog`, `CustomMenuItemCatalog` |
| [XML CustomMenuSetCatalog](catalogs/XML%20CustomMenuSetCatalog.md) | Menu sets with member lists | `CustomMenuSetCatalog` |
| [XML FileAccessCatalog](catalogs/XML%20FileAccessCatalog.md) | Inter-file access authorizations | `FileAccessAuthorizations` |
| [XML LibraryCatalog](catalogs/XML%20LibraryCatalog.md) | Embedded libraries (metadata kept, blobs stripped) | `LibraryReferences` |
| [XML PasteIndexList](catalogs/XML%20PasteIndexList.md) | Copy/paste index bookkeeping | internal |
| [XML Metadata](catalogs/XML%20Metadata.md) | File options, start layout, file-level triggers | `FileOptionsCatalog`, `ScriptTriggers` |
| [XML DDR_INFO](catalogs/XML%20DDR_INFO.md) | Tokenized calculations & readable script texts | `DDR_Calculations`, `DDR_ChunkListContexts`, `DDR_ScriptSteps` (+ the DDR side of `CalculationsCatalog`) |

## Version notes: v22 and the upcoming v26

FM-Lab imports SaXML **v2.1.0.0 and newer** (FileMaker 19+, root element `FMSaveAsXML`); the old v2.0.0.0 format (`FMDynamicTemplate`) is skipped with a warning. All structure pages here describe the v2.2.x form produced by FileMaker 22.

FileMaker 26 writes **SaXML v2.3.0.0**. The known structural change so far: the separate [CalcsForCustomFunctions](catalogs/XML%20CalcsForCustomFunctions.md) branch is gone — each custom function embeds its `<Calculation>` directly (with the chunk list reachable only via the `DDRREF` hash). The importer already handles both forms through structure-tolerant extraction. A dedicated **v26 section** of this reference, documenting the v2.3 differences per catalog, will be added alongside FileMaker 26 coverage.
