-- The comment filter (getvariable('comment'), default 'without') toggles between
-- calculated fields WITHOUT any comment and those WITH one — a field comment or
-- an inline comment inside the calculation (DDR Comment chunk). Browsing the
-- commented ones is useful as documentation inspiration.
-- Instance base is the CalculationsCatalog field_calculation slot (single
-- source for all calculation slots); FieldsForTables contributes the field
-- comment, DDR_Calculations the chunk-level inline-comment detection.
WITH calc AS (
    SELECT c.File_Name, c.Owner_UUID AS Field_UUID, f.Table_Name, f.Field_Name,
        (COALESCE(f.Field_Comment, '') <> ''
         OR (c.Formula_Hash IS NOT NULL AND EXISTS (
              SELECT 1 FROM DDR_Calculations d
              WHERE d.Calc_Hash = c.Formula_Hash AND d.Chunk_Type = 'Comment'))) AS has_comment
    FROM CalculationsCatalog c
    JOIN FieldsForTables f ON f.Field_UUID = c.Owner_UUID AND f.File_Name = c.File_Name
    WHERE c.Calc_Role = 'field_calculation'
      AND (getvariable('file') IS NULL OR c.File_Name = getvariable('file'))
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
