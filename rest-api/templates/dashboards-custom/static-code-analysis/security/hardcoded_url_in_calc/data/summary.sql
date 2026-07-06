-- Auto-generiert aus dem core der Rule (hardcoded_url_in_calc). Nicht von Hand editieren.
SELECT
    COUNT(*)                     AS finding_count,
    'warning'          AS severity,
    COUNT(DISTINCT file_name)   AS affected_files
FROM (
WITH hit AS (
    SELECT d.Calc_Hash, d.File_Name, d.Chunk_Content,
        upper(regexp_extract(d.Calc_UUID, '_([0-9A-Fa-f-]{36})_', 1)) AS anchor_uuid
    FROM DDR_Calculations d
    WHERE d.Chunk_Type = 'NoRef' AND regexp_matches(d.Chunk_Content, 'https?://[A-Za-z0-9]')
      AND (getvariable('file') IS NULL OR d.File_Name = getvariable('file'))
),
step_owner AS (
    SELECT upper(Step_UUID) AS anchor, any_value(Step_UUID) AS step_uuid,
        any_value(Script_UUID) AS owner_uuid, any_value(Script_Name) AS owner_name
    FROM StepsForScripts GROUP BY upper(Step_UUID)
),
oc_owner AS (
    SELECT upper(Object_UUID) AS anchor, any_value(Object_UUID) AS owner_uuid,
        any_value(Object_Type) AS owner_type, any_value(Object_Name) AS owner_name
    FROM ObjectCatalog GROUP BY upper(Object_UUID)
)
SELECT 'hardcoded-url-in-calc' AS rule_id, 'warning' AS severity,
    h.File_Name AS file_name,
    COALESCE(s.owner_name, o.owner_name, '—') AS owner,
    regexp_extract(h.Chunk_Content, '(https?://[^"''<>\s]+)', 1) AS url,
    COALESCE(s.owner_uuid, o.owner_uuid) AS nav_uuid,
    CASE WHEN s.owner_uuid IS NOT NULL THEN 'Script' ELSE o.owner_type END AS nav_type,
    s.step_uuid AS step_uuid,
    row_number() OVER (ORDER BY h.File_Name) AS row_key
FROM hit h
LEFT JOIN step_owner s ON s.anchor = h.anchor_uuid
LEFT JOIN oc_owner o ON o.anchor = h.anchor_uuid
ORDER BY h.File_Name
) _summary;
