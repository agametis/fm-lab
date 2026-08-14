SELECT 'disabled-script-steps' AS rule_id, 'info' AS severity,
    File_Name AS file_name, any_value(Script_UUID) AS nav_uuid, any_value(Script_Name) AS script_name,
    MIN(Step_Index) + 1 AS step_no,
    arg_min(Step_UUID, Step_Index) AS step_uuid,
    COUNT(*) AS disabled_count, COUNT(*) || ' disabled steps' AS message,
    row_number() OVER (ORDER BY COUNT(*) DESC) AS row_key
FROM StepsForScripts
WHERE Is_Enabled = false AND (getvariable('file') IS NULL OR File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR Script_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
GROUP BY File_Name, Script_ID
HAVING COUNT(*) >= 5
ORDER BY disabled_count DESC
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
