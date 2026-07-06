SELECT 'find-without-error-capture' AS rule_id, 'info' AS severity,
    File_Name AS file_name, any_value(Script_UUID) AS nav_uuid, any_value(Script_Name) AS script_name,
    COUNT(*) FILTER (WHERE Step_ID = 28) AS find_count,
    'Perform Find without Set Error Capture' AS message,
    row_number() OVER (ORDER BY File_Name, any_value(Script_Name)) AS row_key
FROM StepsForScripts
WHERE (getvariable('file') IS NULL OR File_Name = getvariable('file'))
GROUP BY File_Name, Script_ID
HAVING COUNT(*) FILTER (WHERE Step_ID = 28) > 0 AND COUNT(*) FILTER (WHERE Step_ID = 86) = 0
ORDER BY file_name, script_name
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
