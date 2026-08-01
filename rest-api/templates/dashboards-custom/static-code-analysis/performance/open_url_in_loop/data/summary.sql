-- Auto-generiert aus dem core der Rule (open_url_in_loop). Nicht von Hand editieren.
SELECT
    COUNT(*)                     AS finding_count,
    'warning'          AS severity,
    COUNT(DISTINCT file_name)   AS affected_files
FROM (
SELECT
    'open-url-in-loop'   AS rule_id,
    'warning' AS severity,
    File_Name     AS file_name,
    Script_UUID   AS nav_uuid,
    Script_Name   AS script_name,
    Step_Index + 1    AS step_index,
    Step_UUID     AS step_uuid,
    'Open URL inside Loop (loop depth ' || loop_depth_before || ') at step ' || (Step_Index + 1) AS message,
    row_number() OVER (ORDER BY File_Name, Script_Name, Step_Index) AS row_key
FROM v_script_block_tree
WHERE Step_ID = 111 AND loop_depth_before >= 1
  AND (getvariable('file') IS NULL OR File_Name = getvariable('file'))
ORDER BY File_Name, Script_Name, Step_Index
) _summary;
