-- @template_type: report
-- @description: Layouts mit den meisten Objekten.
-- @params: limit (optional, default 10), file (optional)

WITH scored AS (
    SELECT
        l.L_UUID                  AS uuid,
        l.L_Name                  AS name,
        l.File_Name               AS file,
        COUNT(lo.Object_UUID)     AS object_count
    FROM Layouts l
    LEFT JOIN LayoutObjects lo ON lo.Layout_ID = l.L_ID
    WHERE (l.Folder_Type IS NULL) AND NOT l.Is_Separator
      AND (getvariable('file') IS NULL OR l.File_Name = getvariable('file'))
    GROUP BY ALL
)
SELECT uuid, name, file, object_count
FROM scored
WHERE object_count > 0
ORDER BY object_count DESC
LIMIT CAST(COALESCE(getvariable('limit'), '10') AS INTEGER);
