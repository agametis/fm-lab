## FileMaker SaveAsXML

**Save a Copy as XML** (often shortened to _SaveAsXML_) is a function in Claris FileMaker for exporting an open FileMaker file as an XML document. The XML contains all schema and structural details of the FileMaker solution — tables, field definitions, layouts, scripts, value lists, security privileges, etc. — but does not include any record data from the tables. The XML file therefore serves as documentation of the application and lets developers track changes to the structure of the FileMaker file.


## XML structure

This is the high-level structure of the XML export produced from a FileMaker file.

```XML
<?xml version="1.0" encoding="utf-8"?>
<FMSaveAsXML version="2.2.0.0" Source="19.6.3" File="Filename.fmp12" UUID="3577981F-2DDF-45FC-9720-9570570760DB" locale="German">
    <Structure membercount="1">
        <AddAction membercount="18">
            <BaseDirectoryCatalog membercount="1" generate="True" temporary="True">...</BaseDirectoryCatalog>
            <ExternalDataSourceCatalog membercount="4">...</ExternalDataSourceCatalog>
            <BaseTableCatalog membercount="5">...</BaseTableCatalog>
            <TableOccurrenceCatalog membercount="7">...</TableOccurrenceCatalog>
            <CustomFunctionsCatalog membercount="28">...</CustomFunctionsCatalog>
            <FieldsForTables membercount="5">...</FieldsForTables>
            <ValueListCatalog membercount="1">...</ValueListCatalog>
            <RelationshipCatalog membercount="3">...</RelationshipCatalog>
            <CalcsForCustomFunctions membercount="28">...</CalcsForCustomFunctions>
            <ScriptCatalog membercount="106">...</ScriptCatalog>
            <ThemeCatalog membercount="1">...</ThemeCatalog>
            <LayoutCatalog membercount="7">...</LayoutCatalog>
            <PrivilegeSetsCatalog membercount="6">...</PrivilegeSetsCatalog>
            <ExtendedPrivilegesCatalog membercount="9">...</ExtendedPrivilegesCatalog>
            <AccountsCatalog membercount="6">...</AccountsCatalog>
            <StepsForScripts membercount="82">...</StepsForScripts>
            <CustomMenuCatalog membercount="24">...</CustomMenuCatalog>
            <PasteIndexList membercount="0"></PasteIndexList>
        </AddAction>
    </Structure>
```

## CustomFunction calculations — format differs by SaXML version

The location of a custom function's calculation body changed between SaXML versions:

- **SaXML ≤ v2.2.x (FileMaker ≤ 22):** `<CustomFunctionsCatalog>` carries only the
  signature (`id`/`name`/`UUID`/`Display`/parameters). The formula bodies live in a
  **separate top-level `<CalcsForCustomFunctions>`** section, one `<CustomFunctionCalc>`
  per function (with `<CustomFunctionReference>` + `<Calculation>` incl. an inline
  `<ChunkList>`). *Verified at `xml-test/…_v2_2_3_0__fm_v22_0_4…`.*
- **SaXML v2.3.0.0 (FileMaker 26+):** the `<CalcsForCustomFunctions>` section is gone;
  `<Calculation>` is **embedded directly inside each `<CustomFunction>`** within
  `<CustomFunctionsCatalog>`. The embedded `<Calculation>` has **no `<ChunkList>`** —
  only `<DDRREF kind="ChunkList" hash="…">` (the chunks remain reachable via the hash in
  `<DDR_INFO>`) and `<Text>`. *Verified at `xml-test/v26/Ooe.xml` (v2.3.0.0 / FM 26.0.1).*

```xml
<!-- v2.3.0.0 (FM 26): Calculation embedded in CustomFunctionsCatalog -->
<CustomFunction id="2" name="OrderOfOperations" access="All">
    <UUID …>D87A5E62-…</UUID>
    <Calculation>
        <DDRREF kind="ChunkList" hash="804DF992…">_D87A5E62-…</DDRREF>
        <Text><![CDATA[Contacts::OrderOfOperationsTest_u & If ( … )]]></Text>
    </Calculation>
    <Display>OrderOfOperations</Display>
</CustomFunction>
```

The exact FM version that introduced the embedded format is unknown (between v2.2.3.0 / FM 22
and v2.3.0.0 / FM 26). The extractor handles **both** forms via a structure-tolerant double
extraction (no version switch) — see
`project/bugreports/2026-06-23_Philipp-Puls_CustomFunctions_v26.md`.

> The high-level structure block above (`version="2.2.0.0"`, with a top-level
> `<CalcsForCustomFunctions>`) reflects the FM 19 export; under v2.3.0.0 that section
> is absent and the calculation moves into `<CustomFunction>` as shown here.

## AutoEnter node (inside Field elements)

Each `<Field>` element in `FieldsForTables` may contain an `<AutoEnter>` child:

```xml
<AutoEnter type="<TYPE>" prohibitModification="True|False">
    <!-- type-specific children -->
</AutoEnter>
```

### AutoEnter types

| Type | Children |
|-----|--------|
| `SerialNumber` | `<SerialNumber increment="1" nextvalue="207782" generate="OnCreation"/>` |
| `Looked_up` | `<Looked_up>` with FieldReference (see below) |
| `Calculated` | `<Calculated>` with Calculation/Text (formula) and DDRREF (hash) |
| `ConstantData` | `<ConstantData>Value</ConstantData>` |
| `CreationDate`, `CreationTime`, `CreationTimestamp`, `CreationName`, `CreationAccountName` | none |
| `ModificationDate`, `ModificationTime`, `ModificationTimestamp`, `ModificationName`, `ModificationAccountName` | none |

### Lookup structure (Looked_up)

```xml
<AutoEnter type="Looked_up" prohibitModification="False">
    <Looked_up dontCopyIfEmpty="False" noMatchCopyOption="DoNotCopy">
        <FieldReference id="12" name="Default 9" UUID="3082C86A-...">
            <TableOccurrenceReference id="1065097" name="Article Range" UUID="11A6B529-..."/>
        </FieldReference>
        <Context>
            <TableOccurrenceReference id="1065089" name="Article" UUID="73ECAA67-..."/>
        </Context>
    </Looked_up>
</AutoEnter>
```

### AutoEnter Calculated structure

```xml
<AutoEnter type="Calculated" prohibitModification="False" overwriteExisting="True" alwaysEvaluate="False">
    <Calculated>
        <Calculation>
            <TableOccurrenceReference id="1065089" name="Stocks" UUID="0DD01566-..."/>
            <DDRREF kind="ChunkList" hash="5754CB6D...">...</DDRREF>
            <Text><![CDATA[Shelves::Index]]></Text>
        </Calculation>
    </Calculated>
</AutoEnter>
```

### ConstantData structure

```xml
<AutoEnter type="ConstantData" prohibitModification="False">
    <ConstantData>1</ConstantData>
</AutoEnter>


```xml
    <Metadata membercount="1">
        <AddAction membercount="6">
            <Encryption type="0"></Encryption>
            <Minimum version="16.0" value="1600"></Minimum>
            <Login type="1">...</Login>
            <Defaults>...</Defaults>
            <Spelling underline="False"></Spelling>
            <ScriptTriggers membercount="1">...</ScriptTriggers>
        </AddAction>
    </Metadata>
</FMSaveAsXML>
```
