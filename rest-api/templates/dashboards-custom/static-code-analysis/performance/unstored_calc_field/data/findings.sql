-- @template_type: report
-- @description: Performance rule (unstored_calc_field) — calculation fields whose
--   result is NOT stored. Each is recomputed on demand; many on one layout (especially
--   a list view) can noticeably slow rendering because the calc runs per displayed record.
-- @params: file (optional), limit (optional, default 500)
SELECT 'unstored-calc-field' AS rule_id, 'warn' AS severity,
    f.File_Name  AS file_name, f.Field_UUID AS nav_uuid,
    f.Table_Name AS table_name, f.Field_Name AS field_name,
    f.Data_Type  AS data_type,
    f.Table_Name || '::' || f.Field_Name AS qualified_name,
    row_number() OVER (ORDER BY f.File_Name, f.Table_Name, f.Field_Name) AS row_key
FROM FieldsForTables f
WHERE f.Field_Type = 'Calculated'
  AND f.Storage_StoreCalcResults = FALSE
  AND (getvariable('file') IS NULL OR f.File_Name = getvariable('file'))
ORDER BY f.File_Name, f.Table_Name, f.Field_Name
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
