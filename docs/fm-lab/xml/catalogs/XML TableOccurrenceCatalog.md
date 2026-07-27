# XML TableOccurrenceCatalog

Part of the [FileMaker XML reference](../XML.md) · SaXML v2.2 (FileMaker 22) · `Structure/AddAction` branch

The table occurrences of the relationship graph. Each occurrence names its source base table — local or in another file — and carries the visual state of its node on the graph canvas (position rectangle, color, collapsed/expanded view).

## Structure

```xml
<TableOccurrenceCatalog membercount="…">
    <TableOccurrence id="1065089" name="Contacts" type="…" View="…" height="…">
        <UUID …>73ECAA67-…</UUID>
        <BaseTableSourceReference type="Internal|External">
            <BaseTableReference id="1" name="Contacts" UUID="D4A0…"/>
            <!-- external occurrences instead reference the data source + remote table -->
        </BaseTableSourceReference>
        <CoordRect top="…" left="…" bottom="…" right="…"/>
        <Color red="…" green="…" blue="…" alpha="…"/>
        <TagList/>
    </TableOccurrence>
    <TableOccurrenceNotes>
        <ObjectList membercount="…">
            <LayoutObject id="…" type="Text" …>…</LayoutObject>  <!-- canvas annotations -->
        </ObjectList>
    </TableOccurrenceNotes>
</TableOccurrenceCatalog>
```

## Notes

- Numeric occurrence IDs (`@id`) are file-local; identity across files is only guaranteed by the UUID.
- `TableOccurrenceNotes` holds free-floating text annotations placed on the graph canvas, encoded as layout objects.

**Extracted into:** [TableOccurrenceCatalog](../../schema/catalog-tables/TableOccurrenceCatalog.md) — column details in the [schema reference](../../schema/Schema.md).
