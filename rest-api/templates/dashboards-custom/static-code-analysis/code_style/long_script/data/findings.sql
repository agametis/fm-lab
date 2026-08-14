SELECT 'long-script' AS rule_id, 'info' AS severity,
    File_Name AS file_name, any_value(Script_UUID) AS nav_uuid, any_value(Script_Name) AS script_name,
    COUNT(*) AS step_count,
    COUNT(*) || ' steps' AS message,
    row_number() OVER (ORDER BY COUNT(*) DESC) AS row_key
FROM StepsForScripts
WHERE (getvariable('file') IS NULL OR File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR Script_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
GROUP BY File_Name, Script_ID
HAVING COUNT(*) >= CAST(COALESCE(getvariable('min_steps'), '150') AS INTEGER)
ORDER BY step_count DESC
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
