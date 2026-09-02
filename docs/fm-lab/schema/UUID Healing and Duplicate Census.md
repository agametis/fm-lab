# UUID Healing and Duplicate Census

Part of the [FM-Lab schema](Schema.md) · Import monitoring · `db/fm_catalog.duckdb` (solution catalog)

Real FileMaker exports occasionally carry the **same UUID on two different objects within one file** — usually a copy-paste artifact inside FileMaker. Since every catalog table keys its rows by `(UUID, File_Name)`, such a twin used to be silently absorbed by the import upsert: one of the two objects was simply missing from the catalog. Since schema 1.19.0 the pipeline **heals** these collisions instead — both objects survive, and a persistent census records what happened. This page documents both halves: the healing mechanics and the census tables that make them auditable.

## How healing works

- **Detection** rides on the duplicate census that runs on every import anyway: only UUIDs that actually collide enter the healing path, so duplicate-free files pay effectively nothing.
- **Replacement UUID.** Each duplicate twin beyond the survivor gets a deterministic synthetic UUID, computed as `md5('DupHeal::' || catalog || '::' || file name || '::' || original UUID || '::' || discriminator)`. The discriminator is the object's **internal FileMaker ID** (script ID, layout ID + object ID, table ID + field ID, …) — an ID FileMaker assigns file-internally and keeps stable across exports. The hash is a pure row function: no counters, no positions, no coordination between parallel [Katana](../Wiki/katana-engine.md) chunk workers, and the result is invariant under chunking.
- **Survivor rule.** The twin with the *smallest* internal ID — in FileMaker terms the oldest object, most likely the original — keeps the original UUID; every other twin is healed.
- **References follow.** SaXML reference elements are `id`+`name`+`UUID` triples. Phase 2 extracts the internal reference `@id` (`Ref_ID`, plus the table-occurrence context for field references), and phase 4 rewrites incoming references so each twin receives its *own* edges in [ObjectLinks](object-catalog/ObjectLinks.md) — healed twins are full graph citizens, not islands. This scope is intra-file; cross-file references resolve to the survivor.
- **Cascade.** When a script is healed, its dependent extracts (steps, triggers, local-variable scope anchors) follow the new UUID, so the twins' steps and `$local` variables no longer merge into one object — healing corrects analysis distortions that shared UUIDs used to cause.
- **Escape hatch.** `FM_UUID_HEAL=0` restores the old behavior (absorb + census only), for comparison imports and bug-report reproduction.

### Recognizing a synthetic UUID

Replacement UUIDs are md5 hex strings — **32 characters, no dashes** — and therefore never match the native `8-4-4-4-12` UUID shape. Any filter for native UUIDs excludes them automatically. The reverse direction is **not** specific anymore: since schema 1.22.0 several synthetic object types carry md5-shaped UUIDs by construction — most massively every [Calculation](object-types/Calculation.md) instance, but also `PasteIndexObject`, `LayoutPart`, the per-type aggregates and variables — so a bare shape filter returns far more than healed twins. The authoritative test is the census: `DuplicateAbsorptionDetails.Healed_UUID` lists exactly the replacement UUIDs, and the original UUID of a healed object is always recoverable from it (below).

### What is deliberately NOT healed

- **FileMaker's double serialization** — the same object exported twice (same UUID *and* same internal ID, e.g. layout-part roots). Identical identity fields yield identical replacement UUIDs, so these still collapse into one row — correctly.
- **Chunk-overlap duplicates** — a converter-side re-feed of the same source record; same mechanism, still collapses correctly.
- **Clone files with an identical internal file name** — the twins are clones down to their internal IDs, so no discriminator exists. These remain monitoring-only in `MergeAbsorptions`.
- **Script steps** are the one healed class with a positional discriminator: steps carry no per-instance ID in the export, so a healed step's replacement UUID is keyed by `(script identity, Step_Index)` — stable across re-imports only as long as the surrounding script is not restructured.
- **DDR plain text** for healed steps resolves via the content hash instead of the step UUID (see [DDR_ScriptSteps](catalog-tables/DDR_ScriptSteps.md)); twins with *different* content share one DDR row in the source — a source-format limit.

## The census tables

### DuplicateAbsorptions

Per-chunk counters: how many source records each catalog parsed and where UUID collisions occurred.

| Column | Type | |
|---|---|---|
| `File_Name` | `VARCHAR` | |
| `Catalog` | `VARCHAR` | affected table, e.g. `StepsForScripts` |
| `PK_Columns` | `VARCHAR` | provenance, e.g. `Step_UUID,File_Name` |
| `Chunk_Seq` | `BIGINT` | source chunk; `-1` = recorded at the merge point |
| `Source_Records` | `BIGINT` | parsed source records of this chunk |

### DuplicateAbsorptionDetails

One row per colliding *occurrence* of a duplicate UUID — the census detail and, since schema 1.19.0, the **original ↔ replacement mapping** of the healing.

| Column | Type | |
|---|---|---|
| `File_Name` | `VARCHAR` | |
| `Catalog` | `VARCHAR` | affected table |
| `Object_UUID` | `VARCHAR` | the duplicated *original* UUID |
| `Object_Name` | `VARCHAR` | |
| `Object_Type` | `VARCHAR` | |
| `Occurrence_Seq` | `BIGINT` | 1,2,… per occurrence, XML order |
| `Chunk_Seq` | `BIGINT` | source chunk; `-1` = merge point |
| `Parent_Name` | `VARCHAR` | container context (script for steps, layout for layout objects) |
| `Position` | `VARCHAR` | position inside the container, e.g. `Step 12` |
| `Display_Text` | `VARCHAR` | plain-text identification (capped) |
| `Payload_XML` | `VARCHAR` | raw XML excerpt (hard-capped) |
| `Healed_UUID` | `VARCHAR` | assigned replacement UUID; `NULL` = kept original / absorbed |
| `Heal_Status` | `VARCHAR` | `kept-original` · `healed` · `absorbed` |
| `Discriminator` | `VARCHAR` | identity value used, e.g. `script_id=421` — makes the stability basis auditable |

### MergeAbsorptions

Monitoring for what the chunk merge still deduplicates — including the unhealable clone-file case.

| Column | Type | |
|---|---|---|
| `Table_Name` | `VARCHAR` | catalog table whose merge absorbed duplicates |
| `File_Name` | `VARCHAR` | `NULL` when not attributable |
| `Absorbed_Count` | `BIGINT` | |
| `Merge_Path` | `VARCHAR` | `catmerge` |
| `Run_Timestamp` | `TIMESTAMP` | UTC |

## Querying the mapping

Both directions are one census query:

```sql
-- Original → replacement: which objects share original UUID X,
-- and under which catalog UUIDs are they reachable today?
SELECT Catalog, Object_Name, Occurrence_Seq, Heal_Status,
       COALESCE(Healed_UUID, Object_UUID) AS Catalog_UUID, Discriminator
FROM DuplicateAbsorptionDetails
WHERE Object_UUID = '<original uuid>' AND File_Name = '<file>'
ORDER BY Occurrence_Seq;

-- Replacement → original: which original (duplicated) UUID does a
-- healed catalog object carry in the FileMaker source?
SELECT Object_UUID AS Original_UUID, Catalog, Object_Name, File_Name
FROM DuplicateAbsorptionDetails
WHERE Healed_UUID = '<synthetic uuid>';
```

## Consumer notes

- **Where-used and dead-code analyses need no special casing:** references are distributed onto the correct twin at import, so a healed twin with zero incoming links is a *real* finding, not an import artifact.
- **External tools:** a synthetic UUID does not exist in the FileMaker source — `fmp://` jumps and XML text searches need the original UUID from the census (which is ambiguous in the source by definition: it names two objects).
- **Native-UUID filters stay clean:** clone detection across files and every dashboard that matches the native UUID shape automatically ignores synthetic UUIDs.

**See also:** [ObjectCatalog](object-catalog/ObjectCatalog.md) · [ObjectLinks](object-catalog/ObjectLinks.md) · [Katana XML Engine](../Wiki/katana-engine.md) · [Schema Version History](Schema%20Version%20History.md)
