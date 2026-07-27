# XML DDR_INFO

Part of the [FileMaker XML reference](../XML.md) · SaXML v2.2 (FileMaker 22) · top-level `DDR_INFO` branch

The analysis block written by the FileMaker 21+ export option **“Include details for analysis tools”** — a top-level `<DDR_INFO>` branch with two sub-branches. `<Calculation>` holds every formula of the file as a tokenized chunk list under a synthetic anchor element named `_<OwnerUUID>_<kind>`; `<Script>` holds the human-readable text of every script under `_<ScriptUUID>` anchors. The `hash` attributes are the join keys the `DDRREF` elements all over the export point to.

## Structure

```xml
<DDR_INFO>
    <Calculation>
        <ObjectList>
            <_3082C86A-…_0 datatype="…" hash="5754CB6D…">
                <ChunkList>
                    <Chunk type="NoRef">If ( </Chunk>
                    <Chunk type="FieldRef"><FieldReference id="…" name="…" UUID="…"/></Chunk>
                    <Chunk type="VariableReference">$$MODE</Chunk>
                    <Chunk type="FunctionRef">Get ( SystemPlatform )</Chunk>
                    <Chunk type="CustomFunctionRef">MyFunction</Chunk>
                    <Chunk type="Comment">/* … */</Chunk>
                </ChunkList>
            </_3082C86A-…_0>
        </ObjectList>
    </Calculation>
    <Script>
        <ObjectList>
            <_0164… datatype="…" hash="…">…human-readable step text…</_0164…>
        </ObjectList>
    </Script>
</DDR_INFO>
```

## Notes

- The anchor suffix (`_0`, `_10`, `_Filter_0`, `_Tooltip`, `_ScriptTrigger_103`, `_Install`, `_XML`, …) encodes which calculation of the owner the chunk list belongs to (step index, filter, tooltip, trigger parameter, …).
- Chunk types observed in v22 exports: `NoRef` (plain text), `VariableReference`, `FunctionRef`, `CustomFunctionRef`, `FieldRef` (with a nested `FieldReference`), `Comment`.
- Without DDR-Info the branch is absent; the catalog tables [DDR_Calculations](../../schema/catalog-tables/DDR_Calculations.md) and [DDR_ScriptSteps](../../schema/catalog-tables/DDR_ScriptSteps.md) then stay empty and dependency analysis falls back to coarser sources.

**Extracted into:** [DDR_Calculations](../../schema/catalog-tables/DDR_Calculations.md) · [DDR_ScriptSteps](../../schema/catalog-tables/DDR_ScriptSteps.md) — column details in the [schema reference](../../schema/Schema.md).
