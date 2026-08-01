-- The scope filter (getvariable('scope'), default 'active') hides disabled
-- (inactive) Show Custom Dialog steps: a disabled step never runs, so it can't
-- trap the user in per-iteration prompts and is a false positive here. 'all'
-- shows every match, including disabled ones. Is_Enabled comes from
-- StepsForScripts (Step_UUID is 1:1 with v_script_block_tree).
SELECT 'show-dialog-in-loop' AS rule_id, 'warning' AS severity,
    t.File_Name AS file_name, t.Script_UUID AS nav_uuid, t.Script_Name AS script_name,
    t.Step_Index + 1 AS step_index, t.Step_UUID AS step_uuid,
    CASE WHEN s.Is_Enabled THEN 'active' ELSE 'inactive' END AS status,
    'Show Custom Dialog inside loop (depth ' || t.loop_depth_before || ') at step ' || (t.Step_Index + 1) AS message,
    row_number() OVER (ORDER BY t.File_Name, t.Script_Name, t.Step_Index) AS row_key
FROM v_script_block_tree t
JOIN StepsForScripts s ON s.Step_UUID = t.Step_UUID AND s.File_Name = t.File_Name
WHERE t.Step_ID = 87 AND t.loop_depth_before >= 1
  AND (getvariable('file') IS NULL OR t.File_Name = getvariable('file'))
  AND (COALESCE(getvariable('scope'), 'active') = 'all' OR s.Is_Enabled)
ORDER BY t.File_Name, t.Script_Name, t.Step_Index
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
