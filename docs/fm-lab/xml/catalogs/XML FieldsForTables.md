# XML FieldsForTables

Part of the [FileMaker XML reference](../XML.md) · SaXML v2.2 (FileMaker 22) · `Structure/AddAction` branch

The complete field definitions, grouped per base table: one `<FieldCatalog>` per table with its `<BaseTableReference>`, containing one `<Field>` per field. The field element is the richest structure of the whole export — auto-enter, storage, validation, calculation, summary and display options are all child elements.

## Structure

```xml
<FieldsForTables membercount="…">
    <FieldCatalog>
        <BaseTableReference id="1" name="Contacts" UUID="D4A0…"/>
        <ObjectList membercount="…">
            <Field id="1" name="Name" fieldtype="Normal" datatype="Text" comment="…">
                <UUID …>3082C86A-…</UUID>
                <AutoEnter type="…" prohibitModification="False">   <!-- optional -->
                    <SerialNumber increment="1" nextvalue="…" generate="OnCreation"/>
                    <Looked_up dontCopyIfEmpty="…" noMatchCopyOption="…">…</Looked_up>
                    <Calculated><Calculation>…</Calculation></Calculated>
                    <ConstantData>…</ConstantData>
                </AutoEnter>
                <Storage autoIndex="True" index="None|All|Minimal" global="False"
                         maxRepetitions="1" storeCalculationResults="True">
                    <LanguageReference id="…" name="German"/>       <!-- index language -->
                    <Remote type="…">…</Remote>                     <!-- ext. container storage -->
                </Storage>
                <Validation type="…" allowOverride="…" notEmpty="…" unique="…"
                            existing="…" alwaysValidate="…">        <!-- optional children: -->
                    <Strict/> <MaximumSize/> <Range from="…" to="…"/>
                    <ValueListReference …/> <Calculated>…</Calculated>
                    <Message/> <MessageCalc>…</MessageCalc>
                </Validation>
                <Calculation>                                       <!-- fieldtype="Calculated" -->
                    <TableOccurrenceReference id="…" name="…" UUID="…"/>
                    <DDRREF kind="ChunkList" hash="5754CB6D…">_3082C86A-…_0</DDRREF>
                    <Text><![CDATA[Shelves::Index]]></Text>
                </Calculation>
                <SummaryInfo operation="…" restartEachGroup="…" summarizeRepetition="…">
                    <SummaryField><FieldReference …/></SummaryField>
                </SummaryInfo>
            </Field>
        </ObjectList>
    </FieldCatalog>
</FieldsForTables>
```

## Notes

- `fieldtype` (Normal/Calculated/Summary) and `datatype` (Text/Number/Date/…) are separate attributes.
- A true calculated field carries `<Calculation>` directly under `<Field>`; a normal field with an auto-enter calc nests it under `<AutoEnter><Calculated>` — the catalog keeps the two apart (`Calculation_Text` vs. `AE_Calc_Text`).
- `DDRREF/@hash` joins the formula to its chunk list in [XML DDR_INFO](XML%20DDR_INFO.md).

**Extracted into:** [FieldsForTables](../../schema/catalog-tables/FieldsForTables.md) — column details in the [schema reference](../../schema/Schema.md).
