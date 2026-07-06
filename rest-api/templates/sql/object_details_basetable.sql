-- @template_type: report
-- @description: Structured detail of a BaseTable — field-type statistics, full field list (clickable), and every table occurrence (local + cross-file) built on it
-- @params: uuid (required), file (optional, clone-scoping)
-- @output_format: json
-- @author: Marcel
-- @version: 2.0
-- @tags: tables, details, fields, structure
-- @note: Flat rows with a `section` discriminator:
--          'meta'  → one row, table-level scalars + field-type counts + TO counts (local/cross-file).
--          'field' → one row per field: id, name, type, data type, comment, UUID (clickable → field detail).
--          'to'    → one row per table occurrence built on this base table, resolved via the graph
--                    (ObjectLinks base_table role) so cross-file occurrences are included; `is_cross_file`
--                    drives the Scope column (local vs. Cross-File).

-- Clone-Scoping: Object_UUID ist bei geklonten/modularen Lösungen nicht eindeutig — Identität ist (UUID, File_Name)
WITH table_match AS (
  SELECT bt.BT_ID, bt.BT_Name, bt.BT_UUID, bt.File_Name
  FROM BaseTableCatalog bt
  JOIN ObjectCatalog oc ON bt.BT_UUID = oc.Object_UUID AND oc.File_Name = bt.File_Name
  WHERE oc.Object_UUID = getvariable('uuid')
    AND (getvariable('file') IS NULL OR bt.File_Name = getvariable('file'))
  LIMIT 1
),
field_list AS (
  SELECT
    f.Field_ID, f.Field_Name, f.Field_Type, f.Data_Type,
    f.Is_Global, f.Field_Comment, f.Field_UUID, f.File_Name, f.Storage_Index
  FROM FieldsForTables f
  JOIN table_match tm ON f.Table_Name = tm.BT_Name AND f.File_Name = tm.File_Name
),
field_stats AS (
  SELECT
    COUNT(*) AS total_fields,
    COUNT(*) FILTER (WHERE Field_Type = 'Normal') AS normal_fields,
    COUNT(*) FILTER (WHERE Field_Type = 'Calculated') AS calc_fields,
    COUNT(*) FILTER (WHERE Field_Type = 'Summary') AS summary_fields,
    COUNT(*) FILTER (WHERE Field_Type NOT IN ('Normal', 'Calculated', 'Summary')) AS other_fields
  FROM field_list
),
-- Table Occurrences über den Graph (base_table-Rolle) auflösen: erfasst lokale UND
-- cross-file-Auftreten, die via externer Datenquelle auf diese Basistabelle zeigen.
-- (Der reine TableOccurrenceCatalog-Join fände nur die datei-lokalen TOs.)
to_list AS (
  SELECT
    oc.Object_Name AS to_name,
    ol.Source_UUID AS to_uuid,
    ol.Source_File AS to_file,
    ol.Is_Cross_File AS is_cross_file
  FROM table_match tm
  JOIN ObjectLinks ol
    ON ol.Target_UUID = tm.BT_UUID AND ol.Target_File = tm.File_Name
   AND ol.Source_Type = 'TableOccurrence'
   AND ol.Link_Role = 'base_table'
  JOIN ObjectCatalog oc ON oc.Object_UUID = ol.Source_UUID AND oc.File_Name = ol.Source_File
),
to_stats AS (
  SELECT
    COUNT(*) AS to_count,
    COUNT(*) FILTER (WHERE NOT is_cross_file) AS to_local_count,
    COUNT(*) FILTER (WHERE is_cross_file) AS to_crossfile_count
  FROM to_list
)

SELECT * EXCLUDE (order_hint, seq) FROM (
  -- ── META (one row) ──
  SELECT
    'meta' AS section,
    0 AS order_hint,
    CAST(NULL AS BIGINT) AS seq,
    tm.BT_Name   AS bt_name,
    tm.File_Name AS file_name,
    tm.BT_UUID   AS bt_uuid,
    tm.BT_ID     AS bt_id,
    fs.total_fields, fs.normal_fields, fs.calc_fields, fs.summary_fields, fs.other_fields,
    ts.to_count, ts.to_local_count, ts.to_crossfile_count,
    CAST(NULL AS VARCHAR) AS field_name,
    CAST(NULL AS VARCHAR) AS field_type,
    CAST(NULL AS VARCHAR) AS data_type,
    CAST(NULL AS VARCHAR) AS field_comment,
    CAST(NULL AS VARCHAR) AS field_uuid,
    CAST(NULL AS BOOLEAN) AS is_global,
    CAST(NULL AS VARCHAR) AS field_file,
    CAST(NULL AS VARCHAR) AS index_mode,
    CAST(NULL AS VARCHAR) AS to_name,
    CAST(NULL AS VARCHAR) AS to_uuid,
    CAST(NULL AS VARCHAR) AS to_file,
    CAST(NULL AS BOOLEAN) AS is_cross_file
  FROM table_match tm, field_stats fs, to_stats ts

  UNION ALL

  -- ── FIELDS (one row each) ──
  SELECT
    'field', 1,
    fl.Field_ID,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    fl.Field_Name, fl.Field_Type, fl.Data_Type, fl.Field_Comment, fl.Field_UUID, fl.Is_Global, fl.File_Name,
    COALESCE(fl.Storage_Index, 'None'),
    NULL, NULL, NULL, NULL
  FROM field_list fl

  UNION ALL

  -- ── TABLE OCCURRENCES (one row each) ──
  SELECT
    'to', 2,
    ROW_NUMBER() OVER (ORDER BY tl.is_cross_file, tl.to_name),
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    tl.to_name, tl.to_uuid, tl.to_file, tl.is_cross_file
  FROM to_list tl
) details
ORDER BY order_hint, seq NULLS FIRST;
