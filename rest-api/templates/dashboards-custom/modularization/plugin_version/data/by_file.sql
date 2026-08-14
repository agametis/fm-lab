-- Plugin version requirement per file - the per-file spread (e.g. 7.1-11.5)
-- shows which modules actually carry the requirement. Same evidence and
-- resolution as data/summary.sql - keep the CTEs in sync.
-- Comparison always runs on since_version_num, never on the version string.
WITH plugin_calls AS (
    SELECT src.Object_UUID AS nav_uuid, src.Object_Type AS object_type,
           src.Object_Name AS object_name, src.File_Name AS file_name,
           CAST(NULL AS VARCHAR) AS via_custom_function,
           tgt.Object_Name AS target_name
    FROM ObjectLinks ol
    JOIN ObjectCatalog src ON ol.Source_UUID = src.Object_UUID
    JOIN ObjectCatalog tgt ON ol.Target_UUID = tgt.Object_UUID
    WHERE ol.Link_Role = 'calls_pluginfunction'
      AND src.Object_Type IN ('Script', 'LayoutObject', 'Field')
      AND tgt.Object_Type = 'PluginFunction'
      AND tgt.Object_Name LIKE '%::%'
    UNION ALL
    SELECT s.Object_UUID, s.Object_Type, s.Object_Name, s.File_Name,
           cf.Object_Name, tgt.Object_Name
    FROM ObjectLinks sc
    JOIN ObjectCatalog s   ON sc.Source_UUID = s.Object_UUID AND s.Object_Type = 'Script'
    JOIN ObjectCatalog cf  ON sc.Target_UUID = cf.Object_UUID AND cf.Object_Type = 'CustomFunction'
    JOIN ObjectLinks pl    ON pl.Source_UUID = cf.Object_UUID AND pl.Link_Role = 'calls_pluginfunction'
    JOIN ObjectCatalog tgt ON pl.Target_UUID = tgt.Object_UUID AND tgt.Object_Type = 'PluginFunction'
    WHERE sc.Link_Role = 'calls_customfunction'
      AND tgt.Object_Name LIKE '%::%'
),
scoped AS (
    SELECT * FROM plugin_calls
    WHERE (getvariable('file') IS NULL OR file_name = getvariable('file'))
      AND (getvariable('scope_uuids') IS NULL
           OR nav_uuid IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
),
named AS (
    SELECT g.*, p.plugin_id,
           COALESCE(f.function_name, af.function_name) AS canonical_name
    FROM scoped g
    LEFT JOIN plugref.plugins p
           ON lower(p.detect_prefix) = lower(split_part(g.target_name, ':', 1))
    LEFT JOIN plugref.plugin_functions f
           ON f.plugin_id = p.plugin_id
          AND lower(f.function_name) = lower(regexp_replace(g.target_name, '^.*::', ''))
    LEFT JOIN plugref.plugin_function_aliases af
           ON af.plugin_id = p.plugin_id
          AND lower(af.alias) = lower(regexp_replace(g.target_name, '^.*::', ''))
    WHERE p.plugin_id IS NOT NULL
),
enriched AS (
    SELECT n.*, fc.since_version, fc.since_version_num
    FROM named n
    LEFT JOIN plugref.plugin_functions fc
           ON fc.plugin_id = n.plugin_id AND fc.function_name = n.canonical_name
)
SELECT
    e.file_name,
    e.plugin_id,
    arg_max(e.since_version, e.since_version_num) AS required_version,
    max(e.since_version_num) AS required_version_num,
    arg_max(e.canonical_name, e.since_version_num) AS top_driver,
    COUNT(DISTINCT e.canonical_name) AS functions,
    COUNT(*) AS callsites,
    COUNT(*) FILTER (WHERE e.canonical_name IS NULL) AS unresolved
FROM enriched e
GROUP BY e.file_name, e.plugin_id
ORDER BY required_version_num DESC NULLS LAST, e.file_name
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
