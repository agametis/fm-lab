-- Layout objects that display a field repetition beyond the repetition count
-- of the field they are bound to. The displayed repetition is only available
-- in the raw object XML (the catalog resolves the field, not the repetition
-- index), the field itself comes from the resolved displays_field link.
-- Container objects are excluded: their XML embeds the markup of their
-- children, so the first FieldReference found there may belong to a child.
-- Translated from fmCheckMate ReportRepetitionOutOfRange.
WITH leaf AS (
    SELECT lo.*
    FROM LayoutObjects lo
    WHERE lo.Object_XML LIKE '%<FieldReference%'
      AND NOT EXISTS (SELECT 1 FROM LayoutObjects k
                      WHERE k.Parent_Object_ID = lo.Object_ID
                        AND k.Layout_ID = lo.Layout_ID
                        AND k.File_Name = lo.File_Name)
),
shown AS (
    SELECT l.File_Name, l.Layout_ID, l.Object_UUID, l.Object_Type, l.Object_Name, l.Part_Type,
           l.Bounds_Left, l.Bounds_Top, l.Bounds_Right, l.Bounds_Bottom,
           TRY_CAST(regexp_extract(l.Object_XML, '<FieldReference[^>]*repetition="(\d+)"', 1) AS INTEGER) AS repetition,
           ol.Target_UUID AS field_uuid
    FROM leaf l
    JOIN ObjectLinks ol ON ol.Source_UUID = l.Object_UUID AND ol.Link_Role = 'displays_field'
)
SELECT 'layout-repetition-out-of-range' AS rule_id, 'error' AS severity,
    s.File_Name AS file_name, ly.L_UUID AS nav_uuid, ly.L_Name AS layout_name,
    s.Object_UUID AS object_uuid, s.Object_Type AS object_type, s.Object_Name AS object_name,
    s.Part_Type AS part_type,
    f.Field_Name AS field, s.repetition, f.Max_Repetitions AS max_repetitions,
    s.Bounds_Left AS x, s.Bounds_Top AS y,
    (s.Bounds_Right - s.Bounds_Left) AS w, (s.Bounds_Bottom - s.Bounds_Top) AS h,
    'Object shows repetition ' || s.repetition || ', the field has only ' || f.Max_Repetitions AS message,
    row_number() OVER (ORDER BY s.File_Name, ly.L_Name, s.Object_UUID) AS row_key
FROM shown s
JOIN FieldsForTables f ON s.field_uuid = f.Field_UUID
JOIN Layouts ly ON s.Layout_ID = ly.L_ID AND s.File_Name = ly.File_Name
WHERE s.repetition IS NOT NULL
  AND f.Max_Repetitions IS NOT NULL
  AND s.repetition > f.Max_Repetitions
  AND (getvariable('file') IS NULL OR s.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR ly.L_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY row_key
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
