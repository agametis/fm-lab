-- Auto-generiert aus dem core der Rule (disabled_script_steps). Nicht von Hand editieren.
SELECT
    COUNT(*)                     AS finding_count,
    'info'          AS severity,
    COUNT(DISTINCT file_name)   AS affected_files
FROM (
SELECT 'disabled-script-steps' AS rule_id, 'info' AS severity,
    File_Name AS file_name, any_value(Script_UUID) AS nav_uuid, any_value(Script_Name) AS script_name,
    COUNT(*) AS disabled_count, COUNT(*) || ' disabled steps' AS message,
    row_number() OVER (ORDER BY COUNT(*) DESC) AS row_key
FROM StepsForScripts
WHERE Is_Enabled = false AND (getvariable('file') IS NULL OR File_Name = getvariable('file'))
GROUP BY File_Name, Script_ID
HAVING COUNT(*) >= 5
ORDER BY disabled_count DESC
) _summary;
