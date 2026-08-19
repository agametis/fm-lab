-- Lookups whose source field no longer exists. A lookup that cannot resolve
-- copies nothing and reports nothing — the field simply stays empty on every
-- new record. Translated from fmCheckMate BrokenLookup.
--
-- Resolution mechanic, deliberately NOT built on dangling UUIDs: cross-file
-- references routinely carry a stale UUID while the target is perfectly intact
-- (FileMaker caches foreign UUIDs but resolves at runtime through the id), so a
-- UUID-based check reports mostly healthy references. The chain used here is
-- lookup table occurrence → its base table → the file that base table lives in
-- → the field, matched inside the resolved target file.
--
-- Two guards keep unprovable cases out of the finding set:
--   (1) the target file must be part of the export — otherwise the lookup is
--       unverifiable, not broken;
--   (2) the data source must resolve to a file at all.
-- Both are counted in the summary as `unverifiable` instead.
WITH lookups AS (
    SELECT f.File_Name, f.Field_UUID, f.Table_Name, f.Field_Name,
           f.Lookup_TO_Name, f.Lookup_Field_Name, f.Lookup_Field_UUID,
           t.BT_Name, t.DS_UUID, t.TO_UUID
    FROM FieldsForTables f
    LEFT JOIN TableOccurrenceCatalog t ON f.Lookup_TO_UUID = t.TO_UUID
    WHERE f.AutoEnter_Type = 'Looked_up'
),
resolved AS (
    SELECT l.*,
           COALESCE(m.Resolved_File, l.File_Name) AS target_file,
           m.Resolved_File IS NULL AND l.DS_UUID IS NOT NULL AS ds_unresolved
    FROM lookups l
    LEFT JOIN DataSourceFileMap m ON m.File_Name = l.File_Name AND m.DS_UUID = l.DS_UUID
),
checked AS (
    SELECT r.*,
           r.target_file IN (SELECT File_Name FROM FilesCatalog) AS target_in_corpus,
           EXISTS (SELECT 1 FROM BaseTableCatalog b
                    WHERE b.File_Name = r.target_file AND b.BT_Name = r.BT_Name) AS bt_found,
           EXISTS (SELECT 1 FROM FieldsForTables ff
                     JOIN BaseTableCatalog b ON ff.Table_UUID = b.BT_UUID
                    WHERE b.File_Name = r.target_file AND b.BT_Name = r.BT_Name
                      AND ff.Field_Name = r.Lookup_Field_Name) AS field_found
    FROM resolved r
)
SELECT 'field-broken-lookup' AS rule_id, 'error' AS severity,
    c.File_Name AS file_name, c.Field_UUID AS nav_uuid,
    c.Table_Name AS table_name, c.Field_Name AS field_name,
    c.Lookup_TO_Name AS lookup_to, c.Lookup_Field_Name AS lookup_field,
    c.target_file,
    CASE WHEN c.TO_UUID IS NULL THEN 'missing-relationship'
         WHEN NOT c.bt_found THEN 'missing-table'
         ELSE 'missing-field' END AS defect,
    CASE WHEN c.TO_UUID IS NULL
           THEN 'Lookup points at a table occurrence that no longer exists'
         WHEN NOT c.bt_found
           THEN 'Lookup source table ' || c.BT_Name || ' does not exist in ' || c.target_file
         ELSE 'Lookup source field ' || c.Lookup_Field_Name || ' does not exist in ' || c.BT_Name
    END AS message,
    row_number() OVER (ORDER BY c.File_Name, c.Table_Name, c.Field_Name) AS row_key
FROM checked c
WHERE (c.TO_UUID IS NULL OR (c.target_in_corpus AND NOT c.ds_unresolved AND NOT c.field_found))
  AND (getvariable('file') IS NULL OR c.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR c.Field_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY row_key
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
