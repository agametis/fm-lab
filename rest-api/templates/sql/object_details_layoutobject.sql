-- @template_type: content
-- @description: Detailed view of a FileMaker LayoutObject - type, position, calculations, and references
-- @params: uuid (required)
-- @output_format: content
-- @author: Marcel
-- @version: 1.0
-- @tags: layoutobjects, details, calculations, hide, tooltip, scripttrigger
-- @note: Shows LayoutObject properties, calculations (Hide, Tooltip, Label, ScriptTrigger), and references

WITH object_match AS (
  SELECT
    lo.Object_UUID, lo.Object_Type, lo.Object_Name, lo.Object_ID,
    lo.Layout_ID, lo.Part_Type, lo.Object_Kind,
    lo.Bounds_Top, lo.Bounds_Left, lo.Bounds_Bottom, lo.Bounds_Right,
    lo.Parent_Object_ID, lo.Nesting_Level,
    lo.Hide_Calculation_Text,
    lo.Tooltip_Calculation_Text,
    lo.Label_Calculation_Text,
    lo.ScriptTrigger_Parameter_Text,
    lo.File_Name
  FROM LayoutObjects lo
  -- Clone-Scoping: Object_UUID ist über Modul-Dateien hinweg geklont → auf die aufgelöste Datei einschränken
  WHERE lo.Object_UUID = getvariable('uuid')
    AND (getvariable('file') IS NULL OR lo.File_Name = getvariable('file'))
  LIMIT 1
),
layout_info AS (
  SELECT L_ID, L_Name, L_UUID
  FROM Layouts
  WHERE L_ID = (SELECT Layout_ID FROM object_match)
    AND File_Name = (SELECT File_Name FROM object_match)
  LIMIT 1
),
parent_object AS (
  SELECT Object_UUID, Object_Type, Object_Name
  FROM LayoutObjects
  WHERE Object_ID = (SELECT Parent_Object_ID FROM object_match)
    AND Layout_ID = (SELECT Layout_ID FROM object_match)
    AND File_Name = (SELECT File_Name FROM object_match)
  LIMIT 1
),
-- All operational references (Field, Script connections)
child_refs AS (
  SELECT
    oc.Object_Type as Target_Type,
    oc.Object_Name as Target_Name,
    oc.File_Name as Target_File,
    ol.Link_Role,
    ol.Is_Cross_File
  FROM ObjectLinks ol
  -- Clone-Scoping: geklonte UUIDs → Link und Ziel-Catalog auf die aufgelöste Datei einschränken
  JOIN ObjectCatalog oc ON ol.Target_UUID = oc.Object_UUID AND oc.File_Name = ol.Target_File
  WHERE ol.Source_UUID = getvariable('uuid')
    AND (getvariable('file') IS NULL OR ol.Source_File = getvariable('file'))
    AND ol.Link_Type = 'operational'
  ORDER BY oc.Object_Type, oc.Object_Name
)

SELECT content FROM (
  -- Header
  SELECT 1 as sort_key, 0 as sub_key,
    '=== LayoutObject Details ===' as content
  FROM object_match

  UNION ALL

  SELECT 2, 0, '' FROM object_match

  UNION ALL

  -- Object properties
  SELECT 3, 1, 'Type:         ' || om.Object_Type FROM object_match om
  UNION ALL
  SELECT 3, 2, 'Name:         ' || COALESCE(NULLIF(om.Object_Name, ''), '(unnamed)') FROM object_match om
  UNION ALL
  SELECT 3, 3, 'Layout:       ' || COALESCE(li.L_Name, '?') || ' (ID: ' || CAST(om.Layout_ID AS VARCHAR) || ')'
  FROM object_match om LEFT JOIN layout_info li ON true
  UNION ALL
  SELECT 3, 4, 'Part:         ' || om.Part_Type FROM object_match om
  UNION ALL
  SELECT 3, 5, 'Position:     Top=' || om.Bounds_Top || ' Left=' || om.Bounds_Left
    || ' Bottom=' || om.Bounds_Bottom || ' Right=' || om.Bounds_Right
    || ' (' || (om.Bounds_Right - om.Bounds_Left) || 'x' || (om.Bounds_Bottom - om.Bounds_Top) || ')'
  FROM object_match om
  UNION ALL
  SELECT 3, 6, 'Nesting:      Level ' || om.Nesting_Level
    || CASE WHEN po.Object_Type IS NOT NULL
       THEN ' (in ' || po.Object_Type || COALESCE(': ' || NULLIF(po.Object_Name, ''), '') || ')'
       ELSE '' END
  FROM object_match om LEFT JOIN parent_object po ON true
  UNION ALL
  SELECT 3, 7, 'File:         ' || om.File_Name FROM object_match om
  UNION ALL
  SELECT 3, 8, 'UUID:         ' || om.Object_UUID FROM object_match om

  UNION ALL

  -- Hide Calculation
  SELECT 5, 0, '' WHERE (SELECT Hide_Calculation_Text FROM object_match) IS NOT NULL
  UNION ALL
  SELECT 5, 1, '--- Hide Condition ---'
  WHERE (SELECT Hide_Calculation_Text FROM object_match) IS NOT NULL
  UNION ALL
  SELECT 5, 2 + ROW_NUMBER() OVER (), '  ' || line
  FROM (
    SELECT UNNEST(string_split(
      replace((SELECT Hide_Calculation_Text FROM object_match), chr(13), chr(10)),
      chr(10)
    )) as line
  )
  WHERE (SELECT Hide_Calculation_Text FROM object_match) IS NOT NULL

  UNION ALL

  -- Tooltip Calculation
  SELECT 6, 0, '' WHERE (SELECT Tooltip_Calculation_Text FROM object_match) IS NOT NULL
  UNION ALL
  SELECT 6, 1, '--- Tooltip ---'
  WHERE (SELECT Tooltip_Calculation_Text FROM object_match) IS NOT NULL
  UNION ALL
  SELECT 6, 2 + ROW_NUMBER() OVER (), '  ' || line
  FROM (
    SELECT UNNEST(string_split(
      replace((SELECT Tooltip_Calculation_Text FROM object_match), chr(13), chr(10)),
      chr(10)
    )) as line
  )
  WHERE (SELECT Tooltip_Calculation_Text FROM object_match) IS NOT NULL

  UNION ALL

  -- Label Calculation
  SELECT 7, 0, '' WHERE (SELECT Label_Calculation_Text FROM object_match) IS NOT NULL
  UNION ALL
  SELECT 7, 1, '--- Calculated Label ---'
  WHERE (SELECT Label_Calculation_Text FROM object_match) IS NOT NULL
  UNION ALL
  SELECT 7, 2 + ROW_NUMBER() OVER (), '  ' || line
  FROM (
    SELECT UNNEST(string_split(
      replace((SELECT Label_Calculation_Text FROM object_match), chr(13), chr(10)),
      chr(10)
    )) as line
  )
  WHERE (SELECT Label_Calculation_Text FROM object_match) IS NOT NULL

  UNION ALL

  -- ScriptTrigger Parameters
  SELECT 8, 0, ''
  WHERE (SELECT ScriptTrigger_Parameter_Text FROM object_match) IS NOT NULL
    AND (SELECT ScriptTrigger_Parameter_Text FROM object_match) != ''
  UNION ALL
  SELECT 8, 1, '--- ScriptTrigger Parameter ---'
  WHERE (SELECT ScriptTrigger_Parameter_Text FROM object_match) IS NOT NULL
    AND (SELECT ScriptTrigger_Parameter_Text FROM object_match) != ''
  UNION ALL
  SELECT 8, 2 + ROW_NUMBER() OVER (), '  ' || line
  FROM (
    SELECT UNNEST(string_split(
      replace((SELECT ScriptTrigger_Parameter_Text FROM object_match), chr(13), chr(10)),
      chr(10)
    )) as line
  )
  WHERE (SELECT ScriptTrigger_Parameter_Text FROM object_match) IS NOT NULL
    AND (SELECT ScriptTrigger_Parameter_Text FROM object_match) != ''

  UNION ALL

  -- References header
  SELECT 10, 0, '' WHERE (SELECT COUNT(*) FROM child_refs) > 0
  UNION ALL
  SELECT 10, 1,
    '--- References (' || CAST((SELECT COUNT(*) FROM child_refs) AS VARCHAR) || ') ---'
  WHERE (SELECT COUNT(*) FROM child_refs) > 0

  UNION ALL

  -- Reference entries
  SELECT 11, ROW_NUMBER() OVER (ORDER BY Target_Type, Target_Name),
    '  -> ' || Target_Type || ': ' || Target_Name
    || CASE WHEN Is_Cross_File THEN ' [' || Target_File || ']' ELSE '' END
    || ' (' || Link_Role || ')'
  FROM child_refs
) details
ORDER BY sort_key, sub_key;
