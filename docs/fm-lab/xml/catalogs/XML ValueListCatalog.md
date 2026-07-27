# XML ValueListCatalog

Part of the [FileMaker XML reference](../XML.md) · SaXML v2.2 (FileMaker 22) · `Structure/AddAction` branch

The value lists of the file — identity plus the source kind only. The actual definition (custom values, source fields, external source) follows in the separate [XML OptionsForValueLists](XML%20OptionsForValueLists.md) branch.

## Structure

```xml
<ValueListCatalog membercount="…">
    <ValueList id="1" name="Status">
        <UUID …>44639478-…</UUID>
        <Source value="Custom|Field|External"/>
        <TagList/>
    </ValueList>
</ValueListCatalog>
```

**Extracted into:** [ValueListCatalog](../../schema/catalog-tables/ValueListCatalog.md) — column details in the [schema reference](../../schema/Schema.md).
