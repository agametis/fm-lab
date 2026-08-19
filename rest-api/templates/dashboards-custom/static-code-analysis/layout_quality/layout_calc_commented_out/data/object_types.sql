-- Distinct object types among the rule's findings — options dataset for the
-- object-type Select. Deliberately independent of the calc_slot and
-- object_type filters so the option list stays stable while filtering;
-- respects the file/scope filters.
WITH slots AS (
    SELECT File_Name, Layout_ID, Object_Type, Hide_Calculation_Text AS calc_text FROM LayoutObjects
    UNION ALL
    SELECT File_Name, Layout_ID, Object_Type, Tooltip_Calculation_Text FROM LayoutObjects
    UNION ALL
    SELECT File_Name, Layout_ID, Object_Type, Label_Calculation_Text FROM LayoutObjects
)
SELECT DISTINCT s.Object_Type AS value, s.Object_Type AS label
FROM slots s
JOIN Layouts l ON s.Layout_ID = l.L_ID AND s.File_Name = l.File_Name
WHERE trim(s.calc_text) LIKE '/*%' AND trim(s.calc_text) LIKE '%*/'
  AND (getvariable('file') IS NULL OR s.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR l.L_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY value;
