-- The comment filter (getvariable('comment'), default 'without') toggles between
-- calculated fields WITHOUT any comment and those WITH one — a field comment or
-- an inline comment inside the calculation (DDR Comment chunk). Browsing the
-- commented ones is useful as documentation inspiration.
WITH calc AS (
    SELECT f.File_Name, f.Field_UUID, f.Table_Name, f.Field_Name,
        (COALESCE(f.Field_Comment, '') <> ''
         OR (f.DDR_Hash IS NOT NULL AND EXISTS (
              SELECT 1 FROM DDR_Calculations d
              WHERE d.Calc_Hash = f.DDR_Hash AND d.Chunk_Type = 'Comment'))) AS has_comment
    FROM FieldsForTables f
    WHERE f.Field_Type = 'Calculated'
      AND (getvariable('file') IS NULL OR f.File_Name = getvariable('file'))
)
SELECT 'calculated-field-without-comment' AS rule_id, 'info' AS severity,
    File_Name AS file_name, Field_UUID AS nav_uuid,
    Table_Name AS table_name, Field_Name AS field_name,
    Table_Name || '::' || Field_Name AS qualified_name,
    row_number() OVER (ORDER BY File_Name, Table_Name, Field_Name) AS row_key
FROM calc
WHERE has_comment = (COALESCE(getvariable('comment'), 'without') = 'with')
ORDER BY File_Name, Table_Name, Field_Name
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
