-- @template_type: content
-- @description: Detailed view of a FileMaker value list - source type, custom values, field references
-- @params: uuid (required)
-- @output_format: content
-- @author: Marcel
-- @version: 1.0
-- @tags: valuelists, details, options
-- @note: Shows value list properties, custom values or field source, and usage references

WITH vl_match AS (
  -- Clone-Scoping: UUID ist bei geklonten Dateien nicht eindeutig -> zusaetzlich nach File_Name filtern
  SELECT vl.VL_ID, vl.VL_Name, vl.Source_Type, vl.VL_UUID, vl.File_Name
  FROM ValueListCatalog vl
  JOIN ObjectCatalog oc ON vl.VL_UUID = oc.Object_UUID AND oc.File_Name = vl.File_Name
  WHERE oc.Object_UUID = getvariable('uuid')
    AND (getvariable('file') IS NULL OR vl.File_Name = getvariable('file'))
  LIMIT 1
),
vl_options AS (
  SELECT
    ovl.Source_Type,
    ovl.Custom_Values,
    ovl.Field_Name as Source_Field,
    ovl.TO_Name as Source_Table,
    ovl.Field_UUID as Source_Field_UUID,
    ovl.TO_UUID as Source_TO_UUID
  FROM OptionsForValueLists ovl
  JOIN vl_match vm ON ovl.VL_UUID = vm.VL_UUID AND ovl.File_Name = vm.File_Name
  LIMIT 1
),
vl_usage AS (
  SELECT
    oc.Object_Type as Used_By_Type,
    oc.Object_Name as Used_By_Name,
    oc.File_Name as Used_By_File,
    ol.Link_Role,
    ol.Is_Cross_File
  FROM ObjectLinks ol
  JOIN ObjectCatalog oc ON ol.Source_UUID = oc.Object_UUID AND oc.File_Name = ol.Source_File
  WHERE ol.Target_UUID = getvariable('uuid')
    AND (getvariable('file') IS NULL OR ol.Target_File = getvariable('file'))
    AND ol.Link_Type = 'operational'
  ORDER BY oc.Object_Type, oc.Object_Name
)

SELECT content FROM (
  -- Header
  SELECT 1 as sort_key, 0 as sub_key,
    '=== ValueList Details ===' as content
  FROM vl_match

  UNION ALL
  SELECT 2, 0, '' FROM vl_match

  UNION ALL

  -- Value list properties
  SELECT 3, 1, 'Name:         ' || vm.VL_Name FROM vl_match vm
  UNION ALL
  SELECT 3, 2, 'Source Type:  ' || vm.Source_Type FROM vl_match vm
  UNION ALL
  SELECT 3, 3, 'File:         ' || vm.File_Name FROM vl_match vm
  UNION ALL
  SELECT 3, 4, 'UUID:         ' || vm.VL_UUID FROM vl_match vm

  UNION ALL

  -- Custom values (if source type is custom)
  SELECT 5, 0, '' WHERE (SELECT COUNT(*) FROM vl_options WHERE Custom_Values IS NOT NULL AND len(Custom_Values) > 0) > 0
  UNION ALL
  SELECT 5, 1, '--- Custom Values ---'
  WHERE (SELECT COUNT(*) FROM vl_options WHERE Custom_Values IS NOT NULL AND len(Custom_Values) > 0) > 0
  UNION ALL
  SELECT 6, idx,
    '  - ' || val
  FROM vl_options vo, LATERAL unnest(vo.Custom_Values) WITH ORDINALITY AS t(val, idx)
  WHERE vo.Custom_Values IS NOT NULL AND len(vo.Custom_Values) > 0

  UNION ALL

  -- Field source (if source type is field)
  SELECT 5, 0, '' WHERE (SELECT COUNT(*) FROM vl_options WHERE Source_Field IS NOT NULL) > 0
  AND (SELECT COUNT(*) FROM vl_options WHERE Custom_Values IS NOT NULL AND len(Custom_Values) > 0) = 0
  UNION ALL
  SELECT 5, 1, '--- Field Source ---'
  WHERE (SELECT COUNT(*) FROM vl_options WHERE Source_Field IS NOT NULL) > 0
  AND (SELECT COUNT(*) FROM vl_options WHERE Custom_Values IS NOT NULL AND len(Custom_Values) > 0) = 0
  UNION ALL
  SELECT 5, 2, '  Table:      ' || COALESCE(vo.Source_Table, '-')
  FROM vl_options vo WHERE vo.Source_Field IS NOT NULL
  AND (SELECT COUNT(*) FROM vl_options WHERE Custom_Values IS NOT NULL AND len(Custom_Values) > 0) = 0
  UNION ALL
  SELECT 5, 3, '  Field:      ' || COALESCE(vo.Source_Field, '-')
  FROM vl_options vo WHERE vo.Source_Field IS NOT NULL
  AND (SELECT COUNT(*) FROM vl_options WHERE Custom_Values IS NOT NULL AND len(Custom_Values) > 0) = 0

  UNION ALL

  -- Usage references
  SELECT 8, 0, '' WHERE (SELECT COUNT(*) FROM vl_usage) > 0
  UNION ALL
  SELECT 8, 1,
    '--- Used in --- (' || CAST((SELECT COUNT(*) FROM vl_usage) AS VARCHAR) || ')'
  WHERE (SELECT COUNT(*) FROM vl_usage) > 0
  UNION ALL
  SELECT 9, ROW_NUMBER() OVER (ORDER BY Used_By_Type, Used_By_Name),
    '  <- ' || Used_By_Type || ': ' || Used_By_Name
    || CASE WHEN Is_Cross_File THEN ' [' || Used_By_File || ']' ELSE '' END
    || ' (' || Link_Role || ')'
  FROM vl_usage
) details
ORDER BY sort_key, sub_key;
