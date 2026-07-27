# XML CustomFunctionsCatalog

Part of the [FileMaker XML reference](../XML.md) · SaXML v2.2 (FileMaker 22) · `Structure/AddAction` branch

The custom functions of the file — in SaXML v2.2 only their *signatures*: ID, name, availability, display form and folder structure. The formula bodies live in the separate [XML CalcsForCustomFunctions](XML%20CalcsForCustomFunctions.md) branch.

## Structure

```xml
<CustomFunctionsCatalog membercount="…">
    <ObjectList membercount="…">
        <CustomFunction id="2" name="OrderOfOperations" access="All" isFolder="False">
            <UUID …>D87A5E62-…</UUID>
            <Display>OrderOfOperations ( which )</Display>
            <TagList/>
            <!-- folders repeat the element with isFolder="True" and nest their
                 children in an inner <ObjectList> -->
        </CustomFunction>
    </ObjectList>
</CustomFunctionsCatalog>
```

## Notes

- **Version difference:** from SaXML v2.3.0.0 (FileMaker 26) the `<Calculation>` is embedded directly inside each `<CustomFunction>` and the separate `CalcsForCustomFunctions` branch disappears. The importer handles both forms.

**Extracted into:** [CustomFunctionsCatalog](../../schema/catalog-tables/CustomFunctionsCatalog.md) — column details in the [schema reference](../../schema/Schema.md).
