# XML StepsForScripts

Part of the [FileMaker XML reference](../XML.md) · SaXML v2.2 (FileMaker 22) · `Structure/AddAction` branch

The script steps, grouped per script: one `<Script>` wrapper with a `<ScriptReference>` back to the catalog entry, containing one `<Step>` per step in execution order. `Step/@id` is the numeric, locale-independent step type; `Step/@name` is the localized display name of the exporting client. Parameters are typed `<Parameter>` children; object references appear as `*Reference` elements inside them.

## Structure

```xml
<StepsForScripts membercount="…">
    <Script>
        <ScriptReference id="27" name="Startup" UUID="0164…"/>
        <ObjectList membercount="…">
            <Step id="141" index="1" name="Variable setzen" enable="True" breakpoint="False" hash="…">
                <UUID>…</UUID>
                <Options/>
                <ParameterValues membercount="…">
                    <Parameter type="Variable" value="…">…</Parameter>
                    <Parameter type="Calculation">
                        <Calculation>
                            <DDRREF kind="ChunkList" hash="…">_0164…_1</DDRREF>
                            <Text><![CDATA[Get ( SystemPlatform )]]></Text>
                        </Calculation>
                    </Parameter>
                    <!-- reference parameters: FieldReference, LayoutReference,
                         ScriptReference, TableOccurrenceReference, … -->
                </ParameterValues>
                <DDRREF kind="StepText" hash="…">_0164…</DDRREF>
            </Step>
        </ObjectList>
    </Script>
</StepsForScripts>
```

## Notes

- `Step/@name` is written in the UI language of the exporting client — every robust consumer keys on `Step/@id`.
- The step-level `DDRREF` hash joins to the human-readable step text in [XML DDR_INFO](XML%20DDR_INFO.md).
- The catalog keeps the raw fragment (`Step_XML`) but resolves all references into [ObjectLinks](../../schema/object-catalog/ObjectLinks.md) at import.

**Extracted into:** [StepsForScripts](../../schema/catalog-tables/StepsForScripts.md) · [DDR_ScriptSteps](../../schema/catalog-tables/DDR_ScriptSteps.md) — column details in the [schema reference](../../schema/Schema.md).
