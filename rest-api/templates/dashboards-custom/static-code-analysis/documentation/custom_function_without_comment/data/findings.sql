-- The comment filter (getvariable('comment'), default 'without') toggles between
-- custom functions WITHOUT and WITH an inline comment (DDR Comment chunk) in the
-- function body. Only functions with a resolvable body (DDR_Hash) can be judged.
WITH cf AS (
    SELECT c.File_Name, c.CF_UUID, c.CF_Name,
        EXISTS (SELECT 1 FROM DDR_Calculations d
                WHERE d.Calc_Hash = c.DDR_Hash AND d.Chunk_Type = 'Comment') AS has_comment
    FROM CustomFunctionsCatalog c
    WHERE c.DDR_Hash IS NOT NULL
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
