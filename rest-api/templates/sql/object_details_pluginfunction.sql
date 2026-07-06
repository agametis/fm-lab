-- @template_type: content
-- @description: Detail view of a Plugin function - callers aggregated by source type
-- @params: uuid (required)
-- @output_format: content
-- @author: Marcel
-- @version: 1.0
-- @tags: pluginfunction, details, mbs
-- @note: Synthetic ObjectCatalog entry — Object_Name = 'MBS:XL.Book.AddFormat::XL.Book.AddFormat'
--        for container plugins (früher 'MBS::<Sub>'), 'Fensternamen' for non-container plugins.
--        Aggregates callers from PluginFunctionUsages via ObjectLinks (calls_pluginfunction).

WITH self AS (
  SELECT Object_UUID, Object_Type, Object_Name, Source_Table
  FROM ObjectCatalog
  WHERE Object_UUID = getvariable('uuid')
    AND Object_Type = 'PluginFunction'
  LIMIT 1
),
self_parts AS (
  SELECT
    Object_Name,
    -- 'MBS:XL.Book.AddFormat::XL.Book.AddFormat' → Plugin='MBS', SubName='XL.Book.AddFormat'
    -- (format-tolerant auch für altes 'MBS::<Sub>'), 'Fensternamen' → Plugin='Fensternamen', SubName=NULL.
    -- Plugin-Namespace = vor dem ersten ':'; SubName = hinter dem letzten '::'.
    -- Kanonische Regel: rest-api/src/utils/plugin-name.js.
    CASE WHEN Object_Name LIKE '%::%'
         THEN regexp_extract(Object_Name, '^([^:]+):', 1)
         ELSE Object_Name END as Plugin_Name,
    CASE WHEN Object_Name LIKE '%::%'
         THEN regexp_replace(Object_Name, '^.*::', '')
         ELSE NULL END as Sub_Name
  FROM self
),
callers AS (
  SELECT
    oc_src.Object_Type as Used_By_Type,
    oc_src.Object_Name as Used_By_Name,
    oc_src.File_Name as Used_By_File,
    ol.Link_Subrole,
    COUNT(*) as Call_Count
  FROM ObjectLinks ol
  JOIN ObjectCatalog oc_src ON ol.Source_UUID = oc_src.Object_UUID
  WHERE ol.Target_UUID = getvariable('uuid')
    AND ol.Link_Role = 'calls_pluginfunction'
  GROUP BY oc_src.Object_Type, oc_src.Object_Name, oc_src.File_Name, ol.Link_Subrole
),
caller_type_counts AS (
  SELECT Used_By_Type, COUNT(*) as Type_Count
  FROM callers
  GROUP BY Used_By_Type
)

SELECT content FROM (
  -- Header
  SELECT 1 as sort_key, 0 as sub_key,
    '=== Plugin Function Details ===' as content
  FROM self

  UNION ALL
  SELECT 2, 0, '' FROM self

  UNION ALL

  -- Properties
  SELECT 3, 1, 'Display:      ' || sp.Object_Name FROM self_parts sp
  UNION ALL
  SELECT 3, 2, 'Plugin:       ' || sp.Plugin_Name FROM self_parts sp
  UNION ALL
  SELECT 3, 3, 'SubFunction:  ' || COALESCE(sp.Sub_Name, '(none)') FROM self_parts sp
  UNION ALL
  SELECT 3, 4, 'Type:         PluginFunction' FROM self
  UNION ALL
  SELECT 3, 5, 'Scope:        Plugin (lösungs-unabhängig)' FROM self

  UNION ALL

  -- Usage summary
  SELECT 5, 0, '' WHERE (SELECT COUNT(*) FROM callers) > 0
  UNION ALL
  SELECT 5, 1,
    '--- Usage Summary --- (' || CAST((SELECT COUNT(*) FROM callers) AS VARCHAR) || ' callers)'
  WHERE (SELECT COUNT(*) FROM callers) > 0
  UNION ALL
  SELECT 6, ROW_NUMBER() OVER (ORDER BY Used_By_Type),
    '  ' || Used_By_Type || ': ' || CAST(Type_Count AS VARCHAR)
  FROM caller_type_counts

  UNION ALL

  -- Detailed caller list
  SELECT 8, 0, '' WHERE (SELECT COUNT(*) FROM callers) > 0
  UNION ALL
  SELECT 8, 1, '--- Callers ---'
  WHERE (SELECT COUNT(*) FROM callers) > 0
  UNION ALL
  SELECT 9, ROW_NUMBER() OVER (ORDER BY Used_By_Type, Used_By_Name),
    '  <- ' || Used_By_Type || ': ' || Used_By_Name
    || ' [' || Used_By_File || ']'
    || ' (' || CAST(Call_Count AS VARCHAR) || ' call'
    || CASE WHEN Call_Count > 1 THEN 's' ELSE '' END
    || COALESCE(', ' || Link_Subrole, '')
    || ')'
  FROM callers
) details
ORDER BY sort_key, sub_key;
