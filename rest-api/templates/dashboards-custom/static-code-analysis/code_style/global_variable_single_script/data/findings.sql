SELECT 'global-variable-single-script' AS rule_id, 'info' AS severity,
    CASE WHEN len(v.Files) > 0 THEN v.Files[1] ELSE '—' END AS file_name,
    md5(v.Variable_Scope || '::' || v.Scope_Anchor || '::' || v.Variable_Name) AS nav_uuid,
    v.Display_Name AS variable_name, v.Set_Count AS set_count, v.Read_Count AS read_count,
    row_number() OVER (ORDER BY v.Display_Name) AS row_key
FROM VariablesCatalog v
WHERE v.Variable_Scope = 'global' AND v.Script_Count = 1 AND v.Set_Count > 0
  AND (getvariable('file') IS NULL OR list_contains(v.Files, getvariable('file')))
ORDER BY v.Display_Name
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
