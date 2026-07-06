-- Auto-generiert aus dem core der Rule (allow_user_abort_off). Nicht von Hand editieren.
SELECT
    COUNT(*)                     AS finding_count,
    'info'          AS severity,
    COUNT(DISTINCT file_name)   AS affected_files
FROM (
SELECT 'allow-user-abort-off' AS rule_id, 'info' AS severity,
    b.File_Name AS file_name, b.Script_UUID AS nav_uuid, b.Script_Name AS script_name,
    b.Step_Index AS step_index, b.Step_UUID AS step_uuid,
    'Allow User Abort [Off] at step ' || b.Step_Index AS message,
    row_number() OVER (ORDER BY b.File_Name, b.Script_Name, b.Step_Index) AS row_key
FROM v_script_block_tree b
JOIN StepsForScripts s ON s.Step_UUID = b.Step_UUID
WHERE b.Step_ID = 85 AND s.Boolean_Value = 'False' AND (getvariable('file') IS NULL OR b.File_Name = getvariable('file'))
ORDER BY b.File_Name, b.Script_Name, b.Step_Index
) _summary;
