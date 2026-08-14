SELECT 'deep-if-nesting' AS rule_id, 'warning' AS severity,
    File_Name AS file_name, any_value(Script_UUID) AS nav_uuid, any_value(Script_Name) AS script_name,
    arg_max(Step_Index, if_depth_before) + 1 AS step_no,
    arg_max(Step_UUID, if_depth_before) AS step_uuid,
    MAX(if_depth_before) AS max_if_depth,
    'Max If nesting depth ' || MAX(if_depth_before) AS message,
    row_number() OVER (ORDER BY File_Name, any_value(Script_Name)) AS row_key
FROM v_script_block_tree
WHERE (getvariable('file') IS NULL OR File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR Script_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
GROUP BY File_Name, Script_ID
HAVING MAX(if_depth_before) >= 5
ORDER BY file_name, script_name
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
