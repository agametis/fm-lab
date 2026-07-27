# XML CalcsForCustomFunctions

Part of the [FileMaker XML reference](../XML.md) · SaXML v2.2 (FileMaker 22) · `Structure/AddAction` branch

The formula bodies of the custom functions (SaXML v2.2): one `<CustomFunctionCalc>` per function, pairing a `<CustomFunctionReference>` with the `<Calculation>` — plain text as CDATA plus the `DDRREF` chunk hash.

## Structure

```xml
<CalcsForCustomFunctions membercount="…">
    <ObjectList membercount="…">
        <CustomFunctionCalc>
            <CustomFunctionReference id="2" name="OrderOfOperations" UUID="D87A5E62-…"/>
            <Calculation>
                <DDRREF kind="ChunkList" hash="804DF992…">_D87A5E62-…_Install</DDRREF>
                <Text><![CDATA[Contacts::OrderOfOperationsTest_u & If ( … )]]></Text>
            </Calculation>
        </CustomFunctionCalc>
    </ObjectList>
</CalcsForCustomFunctions>
```

## Notes

- Folder entries produce a `<CustomFunctionCalc>` without a `<Calculation>` child.
- **Version difference:** this branch exists only up to SaXML v2.2.x (FileMaker ≤ 22). From v2.3.0.0 (FileMaker 26) the calculation is embedded in [XML CustomFunctionsCatalog](XML%20CustomFunctionsCatalog.md) and this branch is absent.

**Extracted into:** [CalcsForCustomFunctions](../../schema/catalog-tables/CalcsForCustomFunctions.md) — column details in the [schema reference](../../schema/Schema.md).
