WITH hit AS (
    SELECT d.Calc_Hash, d.File_Name, d.Chunk_Content,
        upper(regexp_extract(d.Calc_UUID, '_([0-9A-Fa-f-]{36})_', 1)) AS anchor_uuid
    FROM DDR_Calculations d
    WHERE d.Chunk_Type = 'NoRef'
      AND regexp_matches(d.Chunk_Content, '[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}')
      AND (getvariable('file') IS NULL OR d.File_Name = getvariable('file'))
),
step_owner AS (
    SELECT upper(Step_UUID) AS anchor, File_Name, any_value(Step_UUID) AS step_uuid,
        any_value(Script_UUID) AS owner_uuid, any_value(Script_Name) AS owner_name
    FROM StepsForScripts GROUP BY upper(Step_UUID), File_Name
),
oc_owner AS (
    SELECT upper(Object_UUID) AS anchor, File_Name, any_value(Object_UUID) AS owner_uuid,
        any_value(Object_Type) AS owner_type, any_value(Object_Name) AS owner_name
    FROM ObjectCatalog GROUP BY upper(Object_UUID), File_Name
)
SELECT 'hardcoded-ip-in-calc' AS rule_id, 'warning' AS severity,
    h.File_Name AS file_name,
    COALESCE(s.owner_name, o.owner_name, '—') AS owner,
    regexp_extract(h.Chunk_Content, '([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})', 1) AS ip,
    COALESCE(s.owner_uuid, o.owner_uuid) AS nav_uuid,
    CASE WHEN s.owner_uuid IS NOT NULL THEN 'Script' ELSE o.owner_type END AS nav_type,
    s.step_uuid AS step_uuid,
    row_number() OVER (ORDER BY h.File_Name) AS row_key
FROM hit h
LEFT JOIN step_owner s ON s.anchor = h.anchor_uuid AND s.File_Name = h.File_Name
LEFT JOIN oc_owner o ON o.anchor = h.anchor_uuid AND o.File_Name = h.File_Name
ORDER BY h.File_Name
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
