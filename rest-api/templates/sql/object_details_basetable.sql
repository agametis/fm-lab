-- @template_type: content
-- @description: Detailed view of a FileMaker base table - all fields, table occurrences, and statistics
-- @params: uuid (required)
-- @output_format: content
-- @author: Marcel
-- @version: 1.0
-- @tags: tables, details, fields, structure
-- @note: Shows table properties, field list with types, and associated table occurrences

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
    f.Is_Global, f.Field_Comment
  FROM FieldsForTables f
  JOIN table_match tm ON f.Table_Name = tm.BT_Name AND f.File_Name = tm.File_Name
  ORDER BY f.Field_ID
),
field_stats AS (
  SELECT
    COUNT(*) as total_fields,
    COUNT(*) FILTER (WHERE Field_Type = 'Normal') as normal_fields,
    COUNT(*) FILTER (WHERE Field_Type = 'Calculated') as calc_fields,
    COUNT(*) FILTER (WHERE Field_Type = 'Summary') as summary_fields
  FROM field_list
),
table_occurrences AS (
  SELECT toc.TO_ID, toc.TO_Name, toc.TO_UUID
  FROM TableOccurrenceCatalog toc
  JOIN table_match tm ON toc.BT_Name = tm.BT_Name AND toc.File_Name = tm.File_Name
  ORDER BY toc.TO_Name
)

SELECT content FROM (
  -- Header
  SELECT 1 as sort_key, 0 as sub_key,
    '=== BaseTable Details ===' as content
  FROM table_match

  UNION ALL
  SELECT 2, 0, '' FROM table_match

  UNION ALL

  -- Table properties
  SELECT 3, 1, 'Table:        ' || tm.BT_Name FROM table_match tm
  UNION ALL
  SELECT 3, 2, 'File:         ' || tm.File_Name FROM table_match tm
  UNION ALL
  SELECT 3, 3, 'UUID:         ' || tm.BT_UUID FROM table_match tm
  UNION ALL
  SELECT 3, 4, 'ID:           ' || CAST(tm.BT_ID AS VARCHAR) FROM table_match tm

  UNION ALL

  -- Field statistics
  SELECT 4, 0, '' FROM field_stats
  UNION ALL
  SELECT 4, 1,
    '--- Fields --- (' || CAST(fs.total_fields AS VARCHAR) || ' total: '
    || CAST(fs.normal_fields AS VARCHAR) || ' Normal, '
    || CAST(fs.calc_fields AS VARCHAR) || ' Calculated, '
    || CAST(fs.summary_fields AS VARCHAR) || ' Summary)'
  FROM field_stats fs

  UNION ALL

  -- Field list
  SELECT 5, CAST(fl.Field_ID AS INTEGER),
    '  ' || printf('%-30s', fl.Field_Name) || ' ' || printf('%-12s', fl.Field_Type)
    || ' ' || fl.Data_Type
    || CASE WHEN fl.Is_Global THEN ' [Global]' ELSE '' END
  FROM field_list fl

  UNION ALL

  -- Table Occurrences
  SELECT 7, 0, '' WHERE (SELECT COUNT(*) FROM table_occurrences) > 0
  UNION ALL
  SELECT 7, 1,
    '--- Table Occurrences --- (' || CAST((SELECT COUNT(*) FROM table_occurrences) AS VARCHAR) || ')'
  WHERE (SELECT COUNT(*) FROM table_occurrences) > 0
  UNION ALL
  SELECT 8, ROW_NUMBER() OVER (ORDER BY toc.TO_Name),
    '  - ' || toc.TO_Name
  FROM table_occurrences toc
) details
ORDER BY sort_key, sub_key;
