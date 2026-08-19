-- Fields whose index is set to Minimal while automatic indexing is still on.
-- Minimal keeps only the word index and drops the value index, but with
-- automatic indexing enabled FileMaker rebuilds whatever a find needs anyway —
-- so the setting saves nothing predictable and mostly documents an index that
-- was cleared once and never reconsidered. Translated from fmCheckMate
-- IndexMinimalLocked.
--
-- The index setting itself is not a result column: the WHERE clause pins it
-- to 'Minimal', so it would repeat the rule's name in every row.
SELECT 'field-index-minimal-locked' AS rule_id, 'info' AS severity,
    f.File_Name AS file_name, f.Field_UUID AS nav_uuid,
    f.Table_Name AS table_name, f.Field_Name AS field_name,
    f.Field_Type AS field_type, f.Data_Type AS data_type,
    'Index is Minimal while automatic indexing is on' AS message,
    row_number() OVER (ORDER BY f.File_Name, f.Table_Name, f.Field_Name) AS row_key
FROM FieldsForTables f
WHERE f.Storage_Index = 'Minimal' AND f.Storage_AutoIndex
  AND (getvariable('file') IS NULL OR f.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR f.Field_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY row_key
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
