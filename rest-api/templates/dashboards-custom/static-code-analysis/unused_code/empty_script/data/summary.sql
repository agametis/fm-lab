-- Auto-generiert aus dem core der Rule (empty_script). Nicht von Hand editieren.
SELECT
    COUNT(*)                     AS finding_count,
    'info'          AS severity,
    COUNT(DISTINCT file_name)   AS affected_files
FROM (
SELECT 'empty-script' AS rule_id, 'info' AS severity,
    sc.File_Name AS file_name, sc.Script_UUID AS nav_uuid, sc.Script_Name AS object_name,
    'Script has no steps' AS message,
    row_number() OVER (ORDER BY sc.File_Name, sc.Script_Name) AS row_key
FROM ScriptCatalog sc
WHERE (sc.Folder_Type IS NULL OR sc.Folder_Type = 'False') AND NOT sc.Is_Separator
  AND NOT EXISTS (SELECT 1 FROM StepsForScripts s WHERE s.Script_UUID = sc.Script_UUID)
  AND (getvariable('file') IS NULL OR sc.File_Name = getvariable('file'))
ORDER BY sc.File_Name, sc.Script_Name
) _summary;
