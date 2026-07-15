-- @template_type: report
-- @description: Best-practice rule (field_auto_index) — fields whose indexing is
--   'None' while "Automatically create indexes as needed" stays enabled. The first
--   find or sort silently triggers an uninterruptible server-side index build — a
--   latent performance time bomb (storage, backups, import speed).
-- @params: file (optional), limit (optional, default 500)
SELECT 'auto-index-field' AS rule_id, 'warn' AS severity,
    f.File_Name  AS file_name, f.Field_UUID AS nav_uuid,
    f.Table_Name AS table_name, f.Field_Name AS field_name,
    f.Data_Type  AS data_type,
    f.Table_Name || '::' || f.Field_Name AS qualified_name,
    row_number() OVER (ORDER BY f.File_Name, f.Table_Name, f.Field_Name) AS row_key
FROM FieldsForTables f
WHERE f.Storage_Index = 'None'
  AND f.Storage_AutoIndex = TRUE
  AND (getvariable('file') IS NULL OR f.File_Name = getvariable('file'))
ORDER BY f.File_Name, f.Table_Name, f.Field_Name
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
