# XML BaseTableCatalog

Part of the [FileMaker XML reference](../XML.md) · SaXML v2.2 (FileMaker 22) · `Structure/AddAction` branch

The base tables of the file — the schema-level table definitions. Only identity and comment live here; the field definitions follow in the separate [XML FieldsForTables](XML%20FieldsForTables.md) branch.

## Structure

```xml
<BaseTableCatalog membercount="…">
    <BaseTable id="1" name="Contacts" comment="…">
        <UUID modifications="…" userName="…" accountName="…" timestamp="…">D4A0…</UUID>
        <TagList/>
    </BaseTable>
</BaseTableCatalog>
```

## Notes

- The `<UUID>` element carries modification metadata as attributes (`modifications`, `accountName`, `timestamp`) — a pattern repeated on almost every object element in the export.

**Extracted into:** [BaseTableCatalog](../../schema/catalog-tables/BaseTableCatalog.md) — column details in the [schema reference](../../schema/Schema.md).
