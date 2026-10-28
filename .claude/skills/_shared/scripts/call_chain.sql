-- Shared recursive script call-chain queries (fm-analyze, Step 3b).
-- Substitute <SCRIPT_UUID> and <FILE>; run each statement via: duckdb db/fm_catalog.duckdb -c "…".
-- Every hop matches on UUID AND file: clone and modular files share script UUIDs, and a
-- UUID-only join would walk into the clone's call graph.
-- Depth is capped at 5 hops to prevent cycles and output explosion.
-- The Path column is the arrow-joined chain, ready to render as the report's call chain.

-- CC-FWD — forward: what does this script call (transitively)?
WITH RECURSIVE chain AS (
    SELECT
        ol.Source_UUID, ol.Target_UUID,
        oc_t.Object_Name AS Target_Name,
        oc_t.File_Name   AS Target_File,
        1 AS Depth,
        oc_t.Object_Name AS Path
    FROM ObjectLinks ol
    JOIN ObjectCatalog oc_t ON oc_t.Object_UUID = ol.Target_UUID AND oc_t.File_Name = ol.Target_File
    WHERE ol.Source_UUID = '<SCRIPT_UUID>'
      AND ol.Source_File = '<FILE>'
      AND ol.Link_Role = 'calls_script'

    UNION ALL

    SELECT
        ol.Source_UUID, ol.Target_UUID,
        oc_t.Object_Name,
        oc_t.File_Name,
        c.Depth + 1,
        c.Path || ' → ' || oc_t.Object_Name
    FROM chain c
    JOIN ObjectLinks ol   ON ol.Source_UUID = c.Target_UUID AND ol.Source_File = c.Target_File
    JOIN ObjectCatalog oc_t ON oc_t.Object_UUID = ol.Target_UUID AND oc_t.File_Name = ol.Target_File
    WHERE ol.Link_Role = 'calls_script'
      AND c.Depth < 5
)
SELECT DISTINCT Depth, Target_Name, Target_File, Path FROM chain
ORDER BY Depth, Target_Name;

-- CC-BWD — backward: who calls this script (transitively)?
WITH RECURSIVE callers AS (
    SELECT
        ol.Source_UUID,
        oc_s.Object_Name AS Source_Name,
        oc_s.File_Name   AS Source_File,
        1 AS Depth,
        oc_s.Object_Name AS Path
    FROM ObjectLinks ol
    JOIN ObjectCatalog oc_s ON oc_s.Object_UUID = ol.Source_UUID AND oc_s.File_Name = ol.Source_File
    WHERE ol.Target_UUID = '<SCRIPT_UUID>'
      AND ol.Target_File = '<FILE>'
      AND ol.Link_Role = 'calls_script'

    UNION ALL

    SELECT
        ol.Source_UUID,
        oc_s.Object_Name,
        oc_s.File_Name,
        c.Depth + 1,
        oc_s.Object_Name || ' → ' || c.Path
    FROM callers c
    JOIN ObjectLinks ol   ON ol.Target_UUID = c.Source_UUID AND ol.Target_File = c.Source_File
    JOIN ObjectCatalog oc_s ON oc_s.Object_UUID = ol.Source_UUID AND oc_s.File_Name = ol.Source_File
    WHERE ol.Link_Role = 'calls_script'
      AND c.Depth < 5
)
SELECT DISTINCT Depth, Source_Name, Source_File, Path FROM callers
ORDER BY Depth, Source_Name;
