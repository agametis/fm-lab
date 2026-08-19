-- Layout objects whose field reference no longer resolves.
--
-- Resolution runs over the NUMERIC IDs, never over UUIDs. Cross-file
-- references routinely carry a stale UUID while the field itself is intact —
-- FileMaker resolves them by id at runtime, and a UUID-based detector reports
-- the overwhelming majority of them as broken. The chain is:
--   object XML → TableOccurrenceReference@id → TableOccurrenceCatalog (file-local)
--              → data source file + base table → FieldsForTables.Field_ID
-- The TO join also runs over the id, because names in the raw XML are
-- entity-encoded (&#xE4; …) while the catalog holds them decoded.
--
-- Two guards keep the result honest:
--   1. Container objects are excluded — their XML embeds the markup of their
--      children, so a child's field reference would be attributed to the parent.
--   2. Objects whose target file is not part of the catalog are skipped: their
--      fields cannot be checked, and reporting them would be a guess.
-- Translated from fmCheckMate ReportBrokenFieldReferences.
WITH leaf AS (
    SELECT lo.*
    FROM LayoutObjects lo
    WHERE lo.Object_XML LIKE '%<FieldReference%'
      AND NOT EXISTS (SELECT 1 FROM LayoutObjects k
                      WHERE k.Parent_Object_ID = lo.Object_ID
                        AND k.Layout_ID = lo.Layout_ID
                        AND k.File_Name = lo.File_Name)
),
ref AS (
    SELECT l.File_Name, l.Layout_ID, l.Object_UUID, l.Object_Type, l.Object_Name, l.Part_Type,
           l.Bounds_Left, l.Bounds_Top, l.Bounds_Right, l.Bounds_Bottom,
           regexp_extract(l.Object_XML, '<FieldReference[^>]*id="(\d+)"', 1) AS f_id,
           regexp_extract(l.Object_XML, '<FieldReference[^>]*name="([^"]*)"', 1) AS f_name,
           regexp_extract(l.Object_XML, '<TableOccurrenceReference[^>]*id="(\d+)"', 1) AS to_id,
           regexp_extract(l.Object_XML, '<TableOccurrenceReference[^>]*name="([^"]*)"', 1) AS to_name
    FROM leaf l
),
resolved AS (
    SELECT r.*, t.TO_UUID, t.TO_Name AS to_catalog_name, t.BT_Name,
           COALESCE(NULLIF(regexp_replace(COALESCE(t.DS_Name, ''), '\.fmp12$', ''), ''), r.File_Name) AS target_file
    FROM ref r
    LEFT JOIN TableOccurrenceCatalog t
           ON t.File_Name = r.File_Name AND t.TO_ID = TRY_CAST(r.to_id AS BIGINT)
    WHERE r.to_id IS NOT NULL AND r.to_id <> ''
),
classified AS (
    SELECT rv.*,
        CASE
            WHEN rv.TO_UUID IS NULL THEN 'missing-to'
            WHEN rv.target_file NOT IN (SELECT File_Name FROM FilesCatalog) THEN NULL  -- unverifiable
            WHEN NOT EXISTS (SELECT 1 FROM FieldsForTables f
                             WHERE f.File_Name = rv.target_file
                               AND f.Table_Name = rv.BT_Name
                               AND f.Field_ID = TRY_CAST(rv.f_id AS BIGINT)) THEN 'missing-field'
        END AS defect
    FROM resolved rv
)
SELECT 'layout-broken-field-reference' AS rule_id, 'error' AS severity,
    c.File_Name AS file_name, ly.L_UUID AS nav_uuid, ly.L_Name AS layout_name,
    c.Object_UUID AS object_uuid, c.Object_Type AS object_type, c.Object_Name AS object_name,
    c.Part_Type AS part_type, c.defect,
    COALESCE(NULLIF(c.f_name, ''), '#' || c.f_id) AS field,
    COALESCE(c.to_catalog_name, NULLIF(c.to_name, ''), '#' || c.to_id) AS table_occurrence,
    c.Bounds_Left AS x, c.Bounds_Top AS y,
    (c.Bounds_Right - c.Bounds_Left) AS w, (c.Bounds_Bottom - c.Bounds_Top) AS h,
    CASE c.defect
        WHEN 'missing-to' THEN 'Table occurrence no longer exists in this file'
        ELSE 'Field no longer exists in the target table'
    END AS message,
    row_number() OVER (ORDER BY c.defect, c.File_Name, ly.L_Name, c.Object_UUID) AS row_key
FROM classified c
JOIN Layouts ly ON c.Layout_ID = ly.L_ID AND c.File_Name = ly.File_Name
WHERE c.defect IS NOT NULL
  AND (getvariable('file') IS NULL OR c.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR ly.L_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY row_key
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
