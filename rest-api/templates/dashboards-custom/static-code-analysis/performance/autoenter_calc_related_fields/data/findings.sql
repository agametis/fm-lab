-- Auto-enter calculations that read related fields ('::' syntax). The
-- relationship is traversed on every write of the record — extra network work
-- per commit on remote clients, invisible in the scripts that trigger it.
--
-- '::' inside string literals or formula comments also matches — documented
-- false-positive class, hence severity info. related_ref_count is the raw
-- number of '::' occurrences: a rough size indicator, not a resolved
-- dependency count.
SELECT
    'autoenter-calc-related-fields' AS rule_id,
    'info' AS severity,
    f.File_Name AS file_name,
    f.Field_UUID AS nav_uuid,
    f.Table_Name AS table_name,
    f.Field_Name AS field_name,
    CAST((length(f.AE_Calc_Text) - length(replace(f.AE_Calc_Text, '::', ''))) / 2 AS INTEGER) AS related_ref_count,
    substr(regexp_replace(trim(f.AE_Calc_Text), '\s+', ' ', 'g'), 1, 120) AS formula_start,
    'Auto-enter calculation reads related fields ('
      || CAST((length(f.AE_Calc_Text) - length(replace(f.AE_Calc_Text, '::', ''))) / 2 AS INTEGER)
      || ' reference(s)) — evaluated on every write' AS message,
    row_number() OVER (ORDER BY f.File_Name, f.Table_Name, f.Field_Name) AS row_key
FROM FieldsForTables f
WHERE f.AE_Calc_Text LIKE '%::%'
  AND (getvariable('file') IS NULL OR f.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR f.Field_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY f.File_Name, f.Table_Name, f.Field_Name
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
