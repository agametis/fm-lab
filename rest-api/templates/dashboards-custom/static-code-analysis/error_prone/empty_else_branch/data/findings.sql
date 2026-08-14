WITH seq AS (
    SELECT File_Name, Script_ID, Script_UUID, Script_Name, Step_Index, Step_ID, Step_UUID,
        lead(Step_ID) OVER (PARTITION BY File_Name, Script_ID ORDER BY Step_Index) AS next_step
    FROM v_script_block_tree
)
SELECT 'empty-else-branch' AS rule_id, 'warning' AS severity,
    File_Name AS file_name, Script_UUID AS nav_uuid, Script_Name AS script_name,
    Step_Index + 1 AS step_index, Step_UUID AS step_uuid,
    'Empty Else branch at step ' || (Step_Index + 1) AS message,
    row_number() OVER (ORDER BY File_Name, Script_Name, Step_Index) AS row_key
FROM seq
WHERE Step_ID = 69 AND next_step = 70 AND (getvariable('file') IS NULL OR File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR Script_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY File_Name, Script_Name, Step_Index
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
