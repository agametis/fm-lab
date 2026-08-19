-- Hide, tooltip and label calculation slots whose entire text is one /* ... */
-- comment block. Such a slot never evaluates, so the intended behavior is
-- silently disabled. Translated from fmCheckMate ReportBrokenCalculationCommentedOut.
-- The slot chips (getvariable('calc_slot')) and the object-type select
-- (getvariable('object_type')) narrow the result server-side — unset means
-- no filter.
WITH slots AS (
    SELECT File_Name, Layout_ID, Object_UUID, Object_Type, Object_Name, Part_Type,
           Bounds_Left, Bounds_Top, Bounds_Right, Bounds_Bottom,
           'hide' AS calc_slot, Hide_Calculation_Text AS calc_text
    FROM LayoutObjects
    UNION ALL
    SELECT File_Name, Layout_ID, Object_UUID, Object_Type, Object_Name, Part_Type,
           Bounds_Left, Bounds_Top, Bounds_Right, Bounds_Bottom,
           'tooltip', Tooltip_Calculation_Text
    FROM LayoutObjects
    UNION ALL
    SELECT File_Name, Layout_ID, Object_UUID, Object_Type, Object_Name, Part_Type,
           Bounds_Left, Bounds_Top, Bounds_Right, Bounds_Bottom,
           'label', Label_Calculation_Text
    FROM LayoutObjects
)
SELECT 'layout-calc-commented-out' AS rule_id, 'error' AS severity,
    s.File_Name AS file_name, l.L_UUID AS nav_uuid, l.L_Name AS layout_name,
    s.Object_UUID AS object_uuid, s.Object_Type AS object_type, s.Object_Name AS object_name,
    s.Part_Type AS part_type, s.calc_slot,
    s.Bounds_Left AS x, s.Bounds_Top AS y, (s.Bounds_Right - s.Bounds_Left) AS w, (s.Bounds_Bottom - s.Bounds_Top) AS h,
    'The ' || s.calc_slot || ' calculation is completely commented out — ' || substr(trim(s.calc_text), 1, 120) AS message,
    row_number() OVER (ORDER BY s.File_Name, l.L_Name, s.Object_UUID, s.calc_slot) AS row_key
FROM slots s
JOIN Layouts l ON s.Layout_ID = l.L_ID AND s.File_Name = l.File_Name
WHERE trim(s.calc_text) LIKE '/*%' AND trim(s.calc_text) LIKE '%*/'
  AND (getvariable('calc_slot') IS NULL OR s.calc_slot = getvariable('calc_slot'))
  AND (getvariable('object_type') IS NULL OR s.Object_Type = getvariable('object_type'))
  AND (getvariable('file') IS NULL OR s.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR l.L_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY row_key
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
