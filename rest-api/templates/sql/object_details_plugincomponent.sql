-- @template_type: content
-- @description: Detail view of a MBS plugin component — contained functions + aggregated callers
-- @params: uuid (required)
-- @output_format: content
-- @author: Marcel
-- @version: 1.0
-- @tags: plugincomponent, details, mbs, aggregate
-- @note: Synthetic ObjectCatalog entry — Object_Name = 'MBS::XL', 'MBS::JSON', etc.
--        (PluginComponent behält das doppelte '::'; nur PluginFunction ist auf
--        'MBS:<Sub>::<Sub>' qualifiziert). Two-level result: (1) PluginFunctions of
--        this component via groups_into, (2) Callers per function via calls_pluginfunction.

WITH self AS (
  SELECT Object_UUID, Object_Type, Object_Name
  FROM ObjectCatalog
  WHERE Object_UUID = getvariable('uuid')
    AND Object_Type = 'PluginComponent'
  LIMIT 1
),
funcs AS (
  -- Ebene 1: alle Funktionen dieser Komponente (groups_into)
  -- Function_Name = fachlicher SubName (hinter dem letzten '::'); vgl. utils/plugin-name.js.
  SELECT pf.Object_UUID as Function_UUID,
         regexp_replace(pf.Object_Name, '^.*::', '') as Function_Name
  FROM self pc
  JOIN ObjectLinks ol ON ol.Target_UUID = pc.Object_UUID
                     AND ol.Link_Role = 'groups_into'
  JOIN ObjectCatalog pf ON pf.Object_UUID = ol.Source_UUID
                       AND pf.Object_Type = 'PluginFunction'
),
func_usage AS (
  -- Pro Funktion: Anzahl der Aufrufer
  SELECT
    f.Function_UUID,
    f.Function_Name,
    COUNT(ol.Source_UUID) as Caller_Count
  FROM funcs f
  LEFT JOIN ObjectLinks ol ON ol.Target_UUID = f.Function_UUID
                          AND ol.Link_Role = 'calls_pluginfunction'
  GROUP BY f.Function_UUID, f.Function_Name
),
callers AS (
  -- Ebene 2: Aufrufer pro Funktion mit Anzahl
  SELECT
    f.Function_Name,
    oc_src.Object_Type as Used_By_Type,
    oc_src.Object_Name as Used_By_Name,
    oc_src.File_Name as Used_By_File,
    COUNT(*) as Call_Count
  FROM funcs f
  JOIN ObjectLinks ol ON ol.Target_UUID = f.Function_UUID
                     AND ol.Link_Role = 'calls_pluginfunction'
  JOIN ObjectCatalog oc_src ON ol.Source_UUID = oc_src.Object_UUID
  GROUP BY f.Function_Name, oc_src.Object_Type, oc_src.Object_Name, oc_src.File_Name
),
total_callers AS (
  SELECT COUNT(*) as total FROM callers
),
used_funcs AS (
  SELECT COUNT(*) as n FROM func_usage WHERE Caller_Count > 0
)

SELECT content FROM (
  -- Header
  SELECT 1 as sort_key, 0 as sub_key,
    '=== Plugin Component Details ===' as content
  FROM self

  UNION ALL
  SELECT 2, 0, '' FROM self

  UNION ALL

  -- Properties
  SELECT 3, 1, 'Component:    ' || s.Object_Name FROM self s
  UNION ALL
  SELECT 3, 2, 'Type:         PluginComponent' FROM self
  UNION ALL
  SELECT 3, 3, 'Scope:        Plugin (lösungs-unabhängig)' FROM self
  UNION ALL
  SELECT 3, 4,
    'Functions:    ' || CAST((SELECT COUNT(*) FROM funcs) AS VARCHAR)
    || ' (' || CAST((SELECT n FROM used_funcs) AS VARCHAR) || ' verwendet)'
  FROM self
  UNION ALL
  SELECT 3, 5,
    'Total Calls:  ' || CAST((SELECT total FROM total_callers) AS VARCHAR)
  FROM self

  UNION ALL

  -- Contained functions
  SELECT 5, 0, '' WHERE (SELECT COUNT(*) FROM func_usage) > 0
  UNION ALL
  SELECT 5, 1,
    '--- Enthält ' || CAST((SELECT COUNT(*) FROM funcs) AS VARCHAR) || ' Funktionen ---'
  WHERE (SELECT COUNT(*) FROM funcs) > 0
  UNION ALL
  SELECT 6, ROW_NUMBER() OVER (ORDER BY Caller_Count DESC, Function_Name),
    '  · ' || Function_Name
    || ' (' || CAST(Caller_Count AS VARCHAR) || ' caller'
    || CASE WHEN Caller_Count != 1 THEN 's' ELSE '' END
    || ')'
  FROM func_usage

  UNION ALL

  -- Aggregated callers
  SELECT 8, 0, '' WHERE (SELECT COUNT(*) FROM callers) > 0
  UNION ALL
  SELECT 8, 1,
    '--- Verwendet in (' || CAST((SELECT COUNT(*) FROM callers) AS VARCHAR) || ' Aufrufstellen) ---'
  WHERE (SELECT COUNT(*) FROM callers) > 0
  UNION ALL
  SELECT 9, ROW_NUMBER() OVER (ORDER BY Function_Name, Used_By_Type, Used_By_Name),
    '  <- ' || Function_Name || '  via  '
    || Used_By_Type || ': ' || Used_By_Name
    || ' [' || COALESCE(Used_By_File, '-') || ']'
    || ' (' || CAST(Call_Count AS VARCHAR) || ' call'
    || CASE WHEN Call_Count > 1 THEN 's' ELSE '' END
    || ')'
  FROM callers
) details
ORDER BY sort_key, sub_key;
