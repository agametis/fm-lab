SELECT 'dead-code-after-exit' AS rule_id, 'warning' AS severity,
    File_Name AS file_name, Script_UUID AS nav_uuid, Script_Name AS script_name,
    dead_index + 1 AS step_no, dead_uuid AS step_uuid, dead_name AS dead_step,
    'Step ' || (dead_index + 1) || ' (' || dead_name || ') is unreachable — it follows unconditional ' || term_name || ' at step ' || (Step_Index + 1) AS message,
    row_number() OVER (ORDER BY File_Name, Script_Name, Step_Index) AS row_key
FROM (
    -- Comments (Step_ID 89) are skipped so that `Exit Script; # note; Close Window`
    -- still reports the executable follower. Terminators: 103 Exit Script, 90 Halt Script.
    -- Followers 69 Else / 70 End If / 73 End Loop / 125 Else If continue or close the
    -- branch and are reachable via the untaken path; anything else is dead.
    SELECT File_Name, Script_ID, Script_UUID, Script_Name, Step_Index, Step_ID,
           Step_Name AS term_name,
           lead(Step_ID)    OVER w AS dead_id,
           lead(Step_UUID)  OVER w AS dead_uuid,
           lead(Step_Name)  OVER w AS dead_name,
           lead(Step_Index) OVER w AS dead_index
    FROM v_script_block_tree
    WHERE Is_Enabled AND Step_ID <> 89
    WINDOW w AS (PARTITION BY File_Name, Script_ID ORDER BY Step_Index)
) t
WHERE Step_ID IN (103, 90)
  AND dead_id IS NOT NULL
  AND dead_id NOT IN (69, 70, 73, 125)
  AND (getvariable('file') IS NULL OR File_Name = getvariable('file'))
ORDER BY file_name, script_name, step_no
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
