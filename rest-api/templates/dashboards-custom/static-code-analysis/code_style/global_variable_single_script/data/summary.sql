-- Auto-generiert aus dem core der Rule (global_variable_single_script). Nicht von Hand editieren.
SELECT
    COUNT(*)                     AS finding_count,
    'info'          AS severity,
    COUNT(DISTINCT file_name)   AS affected_files
FROM (
SELECT 'global-variable-single-script' AS rule_id, 'info' AS severity,
    CASE WHEN len(v.Files) > 0 THEN v.Files[1] ELSE '—' END AS file_name,
    v.Display_Name AS variable_name, v.Set_Count AS set_count, v.Read_Count AS read_count,
    row_number() OVER (ORDER BY v.Display_Name) AS row_key
FROM VariablesCatalog v
WHERE v.Variable_Scope = 'global' AND v.Script_Count = 1 AND v.Set_Count > 0
  AND (getvariable('file') IS NULL OR list_contains(v.Files, getvariable('file')))
ORDER BY v.Display_Name
) _summary;
