-- Hand-maintained wrapper around the rule core (layout_calc_commented_out).
-- The object-type select (getvariable('object_type')) narrows all counts;
-- the calc_slot filter is deliberately NOT applied here — the per-slot counts
-- feed the chip badges, which must always show the true per-slot totals.
WITH slots AS (
    SELECT File_Name, Layout_ID, Object_Type, 'hide' AS calc_slot, Hide_Calculation_Text AS calc_text FROM LayoutObjects
    UNION ALL
    SELECT File_Name, Layout_ID, Object_Type, 'tooltip', Tooltip_Calculation_Text FROM LayoutObjects
    UNION ALL
    SELECT File_Name, Layout_ID, Object_Type, 'label', Label_Calculation_Text FROM LayoutObjects
)
SELECT COUNT(*) AS finding_count,
       COUNT(*) FILTER (WHERE s.calc_slot = 'hide') AS hide_count,
       COUNT(*) FILTER (WHERE s.calc_slot = 'tooltip') AS tooltip_count,
       COUNT(*) FILTER (WHERE s.calc_slot = 'label') AS label_count,
       COUNT(DISTINCT l.L_UUID) AS affected_layouts,
       COUNT(DISTINCT s.File_Name) AS affected_files
FROM slots s
JOIN Layouts l ON s.Layout_ID = l.L_ID AND s.File_Name = l.File_Name
WHERE trim(s.calc_text) LIKE '/*%' AND trim(s.calc_text) LIKE '%*/'
  AND (getvariable('object_type') IS NULL OR s.Object_Type = getvariable('object_type'))
  AND (getvariable('file') IS NULL OR s.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR l.L_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))));
