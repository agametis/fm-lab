SELECT 'set-field-by-name' AS rule_id, 'info' AS severity,
    File_Name AS file_name, Script_UUID AS nav_uuid, Script_Name AS script_name,
    Step_Index AS step_index, Step_UUID AS step_uuid,
    'Set Field By Name (dynamic target) at step ' || Step_Index AS message,
    row_number() OVER (ORDER BY File_Name, Script_Name, Step_Index) AS row_key
FROM v_script_block_tree
WHERE Step_ID = 147 AND (getvariable('file') IS NULL OR File_Name = getvariable('file'))
ORDER BY File_Name, Script_Name, Step_Index
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
