-- Layout object names that start and end with a double quote — almost always
-- a paste accident; breaks name-based references (GetLayoutObjectAttribute,
-- Go to Object). Translated from fmCheckMate ReportQuotedObjectNames.
SELECT 'layout-quoted-object-name' AS rule_id, 'warning' AS severity,
    lo.File_Name AS file_name, l.L_UUID AS nav_uuid, l.L_Name AS layout_name,
    lo.Object_UUID AS object_uuid, lo.Object_Type AS object_type, lo.Object_Name AS object_name,
    lo.Part_Type AS part_type,
    lo.Bounds_Left AS x, lo.Bounds_Top AS y, (lo.Bounds_Right - lo.Bounds_Left) AS w, (lo.Bounds_Bottom - lo.Bounds_Top) AS h,
    'Object name is wrapped in literal quotes — probably pasted by accident' AS message,
    row_number() OVER (ORDER BY lo.File_Name, l.L_Name, lo.Object_UUID) AS row_key
FROM LayoutObjects lo
JOIN Layouts l ON lo.Layout_ID = l.L_ID AND lo.File_Name = l.File_Name
WHERE lo.Object_Name LIKE '"%"'
  AND (getvariable('file') IS NULL OR lo.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR l.L_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY row_key
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
