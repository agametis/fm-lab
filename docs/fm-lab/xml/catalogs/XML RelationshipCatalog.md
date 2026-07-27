# XML RelationshipCatalog

Part of the [FileMaker XML reference](../XML.md) · SaXML v2.2 (FileMaker 22) · `Structure/AddAction` branch

The relationships of the graph. Each `<Relationship>` names its two sides (`LeftTable`/`RightTable` with cascade options and optional sort specification) and a `<JoinPredicateList>` with one `<JoinPredicate>` per compared field pair — multi-field joins therefore have several predicates.

## Structure

```xml
<RelationshipCatalog membercount="…">
    <Relationship id="1">
        <UUID …>…</UUID>
        <LeftTable type="…" cascadeCreate="False" cascadeDelete="False">
            <TableOccurrenceReference id="…" name="Contacts" UUID="…"/>
            <SortSpecification value="…" maintain="…">…</SortSpecification>  <!-- optional -->
        </LeftTable>
        <RightTable type="…" cascadeCreate="True" cascadeDelete="False">
            <TableOccurrenceReference id="…" name="Orders" UUID="…"/>
        </RightTable>
        <JoinPredicateList membercount="…">
            <JoinPredicate type="Equal">
                <LeftField><FieldReference id="…" name="…" UUID="…"/></LeftField>
                <RightField><FieldReference id="…" name="…" UUID="…"/></RightField>
            </JoinPredicate>
        </JoinPredicateList>
    </Relationship>
</RelationshipCatalog>
```

## Notes

- `JoinPredicate/@type` is the comparison operator (Equal, less/greater variants, Cartesian).
- A `<Sort type="Custom">` inside a side's sort specification carries a `<ValueListReference>` — the *custom sort by value list* case.
- The importer stores one row **per predicate** (`Predicate_Index`), not per relationship.

**Extracted into:** [RelationshipCatalog](../../schema/catalog-tables/RelationshipCatalog.md) — column details in the [schema reference](../../schema/Schema.md).
