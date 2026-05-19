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
