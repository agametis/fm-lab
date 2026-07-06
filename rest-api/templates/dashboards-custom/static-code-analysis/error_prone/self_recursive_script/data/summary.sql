-- Auto-generiert aus dem core der Rule (self_recursive_script). Nicht von Hand editieren.
SELECT
    COUNT(*)                     AS finding_count,
    'info'          AS severity,
    COUNT(DISTINCT file_name)   AS affected_files
FROM (
SELECT 'self-recursive-script' AS rule_id, 'info' AS severity,
    oc.File_Name AS file_name, oc.Object_UUID AS nav_uuid, oc.Object_Name AS script_name,
    'Script calls itself (recursion)' AS message,
    row_number() OVER (ORDER BY oc.File_Name, oc.Object_Name) AS row_key
FROM ObjectLinks ol
JOIN ObjectCatalog oc ON oc.Object_UUID = ol.Source_UUID AND oc.Object_Type = 'Script'
WHERE ol.Link_Role = 'calls_script' AND ol.Source_UUID = ol.Target_UUID AND (getvariable('file') IS NULL OR oc.File_Name = getvariable('file'))
GROUP BY oc.File_Name, oc.Object_UUID, oc.Object_Name
ORDER BY oc.File_Name, oc.Object_Name
) _summary;
