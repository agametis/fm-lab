-- Layout objects carrying a TODO marker in their text content, tooltip
-- calculation or label calculation. Part of the "Unfinished Work" rule family;
-- the detector is the canon of tools/tests/rules/unfinished_work_detector.sql:
--
--   TODO: (?i)(\bto[\s\-_]?do|\btbd\b|\bto[\s\-_]be[\s\-_](done|defined)\b)
--
-- The TODO family deliberately has NO trailing word boundary — otherwise real
-- markers such as "TO DOs" fall out. The leading \b keeps prose out ("today").
--
-- Deviation from the fmCheckMate source rule, deliberate and measured: the
-- source matches `LIKE '%TODO%'` case-sensitively and without separator
-- tolerance and therefore misses a text object whose entire content reads
-- "TO DO" — a real finding in the reference corpus. The family uses one
-- detector across scripts, layouts and calculations.
--
-- Slot sources: the text slot is LayoutObjects.Text_Content (static layout
-- text, not a calculation slot); the tooltip and label slots are the
-- CalculationsCatalog instances of the object (roles tooltip / button_label).
--
-- Severity is info (traffic light: neutral): a TODO is an inventory figure,
-- not a defect. The defect half of the family is layout_text_fixme.
--
-- One finding per object and slot; an object that carries the marker in two
-- slots is reported twice.
WITH slots AS (
    SELECT File_Name, Layout_ID, Object_UUID, Object_Type, Object_Name, Part_Type,
           Bounds_Left, Bounds_Top, Bounds_Right, Bounds_Bottom,
           'text' AS slot, Text_Content AS content
    FROM LayoutObjects WHERE Text_Content IS NOT NULL
    UNION ALL
    SELECT lo.File_Name, lo.Layout_ID, lo.Object_UUID, lo.Object_Type, lo.Object_Name, lo.Part_Type,
           lo.Bounds_Left, lo.Bounds_Top, lo.Bounds_Right, lo.Bounds_Bottom,
           CASE c.Calc_Role WHEN 'button_label' THEN 'label' ELSE 'tooltip' END AS slot,
           COALESCE(c.Formula_Text, c.Display_Text) AS content
    FROM CalculationsCatalog c
    JOIN LayoutObjects lo ON lo.Object_UUID = c.Owner_UUID AND lo.File_Name = c.File_Name
    WHERE c.Calc_Role IN ('tooltip', 'button_label')
)
SELECT 'layout-text-todo' AS rule_id, 'info' AS severity,
    s.File_Name AS file_name, ly.L_UUID AS nav_uuid, ly.L_Name AS layout_name,
    s.Object_UUID AS object_uuid, s.Object_Type AS object_type, s.Object_Name AS object_name,
    s.Part_Type AS part_type, s.slot,
    regexp_extract(s.content, '(?i)(\bto[\s\-_]?do|\btbd\b|\bto[\s\-_]be[\s\-_](done|defined)\b)', 0) AS marker,
    s.Bounds_Left AS x, s.Bounds_Top AS y,
    (s.Bounds_Right - s.Bounds_Left) AS w, (s.Bounds_Bottom - s.Bounds_Top) AS h,
    CASE s.slot
        WHEN 'text' THEN 'TODO marker in the text content'
        WHEN 'tooltip' THEN 'TODO marker in the tooltip calculation'
        ELSE 'TODO marker in the label calculation'
    END AS message,
    row_number() OVER (ORDER BY s.File_Name, ly.L_Name, s.Object_UUID, s.slot) AS row_key
FROM slots s
JOIN Layouts ly ON s.Layout_ID = ly.L_ID AND s.File_Name = ly.File_Name
WHERE regexp_matches(s.content, '(?i)(\bto[\s\-_]?do|\btbd\b|\bto[\s\-_]be[\s\-_](done|defined)\b)')
  AND (getvariable('file') IS NULL OR s.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR ly.L_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY row_key
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
