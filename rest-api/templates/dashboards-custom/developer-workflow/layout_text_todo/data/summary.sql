-- Hand-maintained wrapper around the rule core (layout_text_todo).
-- Keep the detector and the filters in sync with data/findings.sql.
WITH slots AS (
    SELECT File_Name, Layout_ID, Object_UUID, 'text' AS slot, Text_Content AS content
    FROM LayoutObjects WHERE Text_Content IS NOT NULL
    UNION ALL
    SELECT File_Name, Layout_ID, Object_UUID, 'tooltip', Tooltip_Calculation_Text
    FROM LayoutObjects WHERE Tooltip_Calculation_Text IS NOT NULL
    UNION ALL
    SELECT File_Name, Layout_ID, Object_UUID, 'label', Label_Calculation_Text
    FROM LayoutObjects WHERE Label_Calculation_Text IS NOT NULL
)
SELECT COUNT(*) AS finding_count,
       COUNT(DISTINCT ly.L_UUID) AS affected_layouts,
       COUNT(DISTINCT s.File_Name) AS affected_files
FROM slots s
JOIN Layouts ly ON s.Layout_ID = ly.L_ID AND s.File_Name = ly.File_Name
WHERE regexp_matches(s.content, '(?i)(\bto[\s\-_]?do|\btbd\b|\bto[\s\-_]be[\s\-_](done|defined)\b)')
  AND (getvariable('file') IS NULL OR s.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR ly.L_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))));
