SELECT 'autoenter-overwrites-existing' AS rule_id, 'info' AS severity,
    f.File_Name AS file_name, f.Field_UUID AS nav_uuid, f.Table_Name AS table_name, f.Field_Name AS field_name,
    'Auto-enter calc overwrites existing values' AS message,
    row_number() OVER (ORDER BY f.File_Name, f.Table_Name, f.Field_Name) AS row_key
FROM FieldsForTables f
WHERE f.AE_Calc_OverwriteExisting = 'True'
  AND (getvariable('file') IS NULL OR f.File_Name = getvariable('file'))
ORDER BY f.File_Name, f.Table_Name, f.Field_Name
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
