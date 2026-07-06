WITH seq AS (
    SELECT File_Name, Script_ID, Script_UUID, Script_Name, Step_Index, Step_ID, Step_UUID,
        lead(Step_ID) OVER (PARTITION BY File_Name, Script_ID ORDER BY Step_Index) AS next_step
    FROM v_script_block_tree
)
SELECT 'empty-if-branch' AS rule_id, 'warning' AS severity,
    File_Name AS file_name, Script_UUID AS nav_uuid, Script_Name AS script_name,
    Step_Index AS step_index, Step_UUID AS step_uuid,
    'Empty If branch at step ' || Step_Index AS message,
    row_number() OVER (ORDER BY File_Name, Script_Name, Step_Index) AS row_key
FROM seq
WHERE Step_ID = 68 AND next_step IN (69, 70, 125) AND (getvariable('file') IS NULL OR File_Name = getvariable('file'))
ORDER BY File_Name, Script_Name, Step_Index
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
