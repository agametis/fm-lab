-- Auto-generiert aus dem core der Rule (onrecordload_trigger). Nicht von Hand editieren.
SELECT
    COUNT(*)                     AS finding_count,
    'info'          AS severity,
    COUNT(DISTINCT file_name)   AS affected_files
FROM (
SELECT 'onrecordload-trigger' AS rule_id, 'info' AS severity,
    File_Name AS file_name, Script_UUID AS nav_uuid, Script_Name AS script_name, Owner_Type AS owner_type,
    'OnRecordLoad trigger runs the script for every record' AS message,
    row_number() OVER (ORDER BY File_Name, Script_Name) AS row_key
FROM ScriptTriggers
WHERE Trigger_Action = 'OnRecordLoad' AND (getvariable('file') IS NULL OR File_Name = getvariable('file'))
ORDER BY File_Name, Script_Name
) _summary;
