-- Auto-generiert aus dem core der Rule (export_records_in_loop). Nicht von Hand editieren.
SELECT
    COUNT(*)                     AS finding_count,
    'warning'          AS severity,
    COUNT(DISTINCT file_name)   AS affected_files
FROM (
SELECT
    'export-records-in-loop'   AS rule_id,
    'warning' AS severity,
    File_Name     AS file_name,
    Script_UUID   AS nav_uuid,
    Script_Name   AS script_name,
    Step_Index    AS step_index,
    Step_UUID     AS step_uuid,
    'Export Records inside Loop (loop depth ' || loop_depth_before || ') at step ' || Step_Index AS message,
    row_number() OVER (ORDER BY File_Name, Script_Name, Step_Index) AS row_key
FROM v_script_block_tree
WHERE Step_ID = 36 AND loop_depth_before >= 1
  AND (getvariable('file') IS NULL OR File_Name = getvariable('file'))
ORDER BY File_Name, Script_Name, Step_Index
) _summary;
