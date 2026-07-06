-- The OnRecordLoad trigger sits on a Layout; resolve Owner_UUID to the layout
-- name (file-scoped join) so the list shows *which* layout fires the script.
SELECT 'onrecordload-trigger' AS rule_id, 'info' AS severity,
    t.File_Name AS file_name, t.Script_UUID AS nav_uuid, t.Script_Name AS script_name,
    l.L_Name AS layout_name,
    'OnRecordLoad trigger runs the script for every record' AS message,
    row_number() OVER (ORDER BY t.File_Name, t.Script_Name) AS row_key
FROM ScriptTriggers t
LEFT JOIN Layouts l ON l.L_UUID = t.Owner_UUID AND l.File_Name = t.File_Name
WHERE t.Trigger_Action = 'OnRecordLoad' AND (getvariable('file') IS NULL OR t.File_Name = getvariable('file'))
ORDER BY t.File_Name, t.Script_Name
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
