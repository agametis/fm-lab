-- Threshold is user-controlled via the header slider (getvariable('min_objects'),
-- default 250). Layouts with at least that many objects are listed.
SELECT 'layout-many-objects' AS rule_id, 'info' AS severity,
    any_value(lo.File_Name) AS file_name, any_value(l.L_UUID) AS nav_uuid, any_value(l.L_Name) AS layout_name,
    COUNT(*) AS object_count, COUNT(*) || ' objects' AS message,
    row_number() OVER (ORDER BY COUNT(*) DESC) AS row_key
FROM LayoutObjects lo
JOIN Layouts l ON l.L_ID = lo.Layout_ID AND l.File_Name = lo.File_Name
WHERE (getvariable('file') IS NULL OR lo.File_Name = getvariable('file'))
GROUP BY lo.Layout_ID, lo.File_Name
HAVING COUNT(*) >= CAST(COALESCE(getvariable('min_objects'), '250') AS INTEGER)
ORDER BY object_count DESC
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
