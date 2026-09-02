-- The comment filter (getvariable('comment'), default 'without') toggles between
-- custom functions WITHOUT and WITH an inline comment (DDR Comment chunk) in the
-- function body. Only functions with a resolvable body (Formula_Hash) can be
-- judged. Instance base is the CalculationsCatalog custom_function slot;
-- DDR_Calculations contributes the chunk-level comment detection.
WITH cf AS (
    SELECT c.File_Name, c.Owner_UUID AS CF_UUID, c.Owner_Name AS CF_Name,
        EXISTS (SELECT 1 FROM DDR_Calculations d
                WHERE d.Calc_Hash = c.Formula_Hash AND d.Chunk_Type = 'Comment') AS has_comment
    FROM CalculationsCatalog c
    WHERE c.Calc_Role = 'custom_function'
      AND c.Formula_Hash IS NOT NULL
      AND (getvariable('file') IS NULL OR c.File_Name = getvariable('file'))
)
SELECT 'custom-function-without-comment' AS rule_id, 'info' AS severity,
    File_Name AS file_name, CF_UUID AS nav_uuid, CF_Name AS cf_name,
    CASE WHEN has_comment THEN 'Function body contains a comment'
         ELSE 'No comment in function body' END AS message,
    row_number() OVER (ORDER BY File_Name, CF_Name) AS row_key
FROM cf
WHERE has_comment = (COALESCE(getvariable('comment'), 'without') = 'with')
ORDER BY File_Name, CF_Name
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
