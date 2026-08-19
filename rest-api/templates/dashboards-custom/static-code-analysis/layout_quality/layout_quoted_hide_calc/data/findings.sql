-- Hide-object conditions that consist of a single quoted string literal with
-- no inner quotes — a constant, not a calculation; usually pasted together
-- with its quotes. Translated from fmCheckMate ReportBrokenCalculationQuoted.
SELECT 'layout-quoted-hide-calc' AS rule_id, 'error' AS severity,
    lo.File_Name AS file_name, l.L_UUID AS nav_uuid, l.L_Name AS layout_name,
    lo.Object_UUID AS object_uuid, lo.Object_Type AS object_type, lo.Object_Name AS object_name,
    lo.Part_Type AS part_type,
    lo.Bounds_Left AS x, lo.Bounds_Top AS y, (lo.Bounds_Right - lo.Bounds_Left) AS w, (lo.Bounds_Bottom - lo.Bounds_Top) AS h,
    'Hide condition is a quoted string constant, not a calculation — ' || trim(lo.Hide_Calculation_Text) AS message,
    row_number() OVER (ORDER BY lo.File_Name, l.L_Name, lo.Object_UUID) AS row_key
FROM LayoutObjects lo
JOIN Layouts l ON lo.Layout_ID = l.L_ID AND lo.File_Name = l.File_Name
WHERE trim(lo.Hide_Calculation_Text) LIKE '"%"'
  AND NOT trim(lo.Hide_Calculation_Text) LIKE '"%"%"'
  AND (getvariable('file') IS NULL OR lo.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR l.L_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY row_key
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
