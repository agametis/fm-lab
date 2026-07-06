SELECT 'tab-control-many-tabs' AS rule_id, 'info' AS severity,
    any_value(lo.File_Name) AS file_name, any_value(l.L_UUID) AS nav_uuid, any_value(l.L_Name) AS layout_name,
    COUNT(*) AS tab_count, COUNT(*) || ' tabs' AS message,
    row_number() OVER (ORDER BY COUNT(*) DESC) AS row_key
FROM LayoutObjects lo
JOIN Layouts l ON l.L_ID = lo.Layout_ID AND l.File_Name = lo.File_Name
WHERE lo.Object_Type = 'Panel'
  AND (getvariable('file') IS NULL OR lo.File_Name = getvariable('file'))
GROUP BY lo.Parent_Object_ID, lo.Layout_ID, lo.File_Name
HAVING COUNT(*) >= CAST(COALESCE(getvariable('min_tabs'), '6') AS INTEGER)
ORDER BY tab_count DESC
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
