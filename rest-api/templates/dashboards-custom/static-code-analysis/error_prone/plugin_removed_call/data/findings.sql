-- Removed plug-in function calls (maintenance axis, plugin evidence).
-- Verbatim layer: reference/plugin_spec.duckdb (ATTACHed as 'plugref' by the
-- API connection; the fm-test direct path attaches it itself), derived from
-- the MBS docs mirror. status/removed_in are verbatim vendor statements
-- (plugin_functions.status = 'removed', removed_in extracted from the
-- "removed for MBS FileMaker Plugin Y" note).
-- Severity model: 'error' - unlike deprecated, a removed function no longer
-- exists in current plugin releases, the call fails at runtime. Unresolved
-- functions are surfaced by the deprecated sibling rule, never here: an
-- error row in this rule always means a real defect.
-- Maintenance axis only - no statement about runtime environments.
WITH plugin_calls AS (
    -- Direct plugin-function usage (edges resolved at import). The '::' filter
    -- excludes the known misclassified PluginFunction rows without a qualified
    -- name (see analysis-workflows.md, platform pitfalls).
    SELECT src.Object_UUID AS nav_uuid, src.Object_Type AS object_type,
           src.Object_Name AS object_name, src.File_Name AS file_name,
           CASE WHEN src.Object_Type = 'Script' THEN 'script' ELSE 'layout' END AS evidence_kind,
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
    -- One-level custom-function wrapper: Script -> CF -> plugin function
    -- (the standard error-handling idiom; deeper CF chains are out of scope).
    SELECT s.Object_UUID, s.Object_Type, s.Object_Name, s.File_Name,
           'script', cf.Object_Name, tgt.Object_Name
    FROM ObjectLinks sc
    JOIN ObjectCatalog s   ON sc.Source_UUID = s.Object_UUID AND s.Object_Type = 'Script'
    JOIN ObjectCatalog cf  ON sc.Target_UUID = cf.Object_UUID AND cf.Object_Type = 'CustomFunction'
    JOIN ObjectLinks pl    ON pl.Source_UUID = cf.Object_UUID AND pl.Link_Role = 'calls_pluginfunction'
    JOIN ObjectCatalog tgt ON pl.Target_UUID = tgt.Object_UUID AND tgt.Object_Type = 'PluginFunction'
    WHERE sc.Link_Role = 'calls_customfunction'
      AND tgt.Object_Name LIKE '%::%'
),
grouped AS (
    SELECT nav_uuid, object_type, object_name, file_name, evidence_kind,
           via_custom_function, target_name, COUNT(*) AS usage_count
    FROM plugin_calls
    GROUP BY ALL
),
-- Name resolution: catalog name 'MBS:Files.FileSize::Files.FileSize' ->
-- prefix before the first ':' matches plugins.detect_prefix, sub-name after
-- the last '::' matches plugin_functions (case-insensitive), old names
-- resolve via plugin_function_aliases.
named AS (
    SELECT g.*,
           split_part(g.target_name, ':', 1) AS plugin_prefix,
           regexp_replace(g.target_name, '^.*::', '') AS raw_name,
           p.plugin_id,
           COALESCE(f.function_name, af.function_name) AS canonical_name
    FROM grouped g
    LEFT JOIN plugref.plugins p
           ON lower(p.detect_prefix) = lower(split_part(g.target_name, ':', 1))
    LEFT JOIN plugref.plugin_functions f
           ON f.plugin_id = p.plugin_id
          AND lower(f.function_name) = lower(regexp_replace(g.target_name, '^.*::', ''))
    LEFT JOIN plugref.plugin_function_aliases af
           ON af.plugin_id = p.plugin_id
          AND lower(af.alias) = lower(regexp_replace(g.target_name, '^.*::', ''))
),
enriched AS (
    SELECT n.*, fc.component, fc.status, fc.since_version, fc.removed_in, fc.status_note
    FROM named n
    LEFT JOIN plugref.plugin_functions fc
           ON fc.plugin_id = n.plugin_id AND fc.function_name = n.canonical_name
),
core AS (
    SELECT 'plugin-removed-call' AS rule_id,
        'error' AS severity,
        'removed' AS finding_kind,
        e.file_name, e.nav_uuid, e.object_type, e.object_name AS script_name,
        e.plugin_id, e.canonical_name AS function_name,
        e.component, e.since_version, e.removed_in, e.status_note,
        e.via_custom_function, e.evidence_kind, e.usage_count,
        e.plugin_prefix || ' function ' || e.canonical_name || ' was removed in MBS Plugin '
            || COALESCE(e.removed_in, '(release not documented)')
            || ' - the call fails with any current plugin (use an older plugin or migrate)'
            || CASE WHEN e.via_custom_function IS NOT NULL
                    THEN ' - called via custom function "' || e.via_custom_function || '"' ELSE '' END
            AS message
    FROM enriched e
    WHERE e.status = 'removed'
    -- Direct evidence wins over the CF wrapper for the same script+function.
    QUALIFY row_number() OVER (
        PARTITION BY e.nav_uuid, e.canonical_name
        ORDER BY (e.via_custom_function IS NOT NULL), e.via_custom_function) = 1
)
SELECT *,
    row_number() OVER (ORDER BY file_name, script_name, function_name) AS row_key
FROM core
WHERE (getvariable('file') IS NULL OR file_name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR nav_uuid IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY file_name, script_name, function_name
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
