-- @template_type: content
-- @description: Detailed view of a FileMaker LayoutObject - type, position, calculations, and references
-- @params: uuid (required)
-- @output_format: content
-- @author: Marcel
-- @version: 2.0
-- @tags: layoutobjects, details, calculations, hide, tooltip, scripttrigger
-- @note: Shows LayoutObject properties, ALL attached calculations (generic via v_calc_anchors: Hide,
--        Tooltip, Label, ScriptTrigger, Conditional Formatting, Portal filter, Web-Viewer URL,
--        Placeholder, Tab/Popover title, Button action …), static vs. formula, and references

WITH object_match AS (
  SELECT
    lo.Object_UUID, lo.Object_Type, lo.Object_Name, lo.Object_ID,
    lo.Layout_ID, lo.Part_Type, lo.Object_Kind,
    lo.Bounds_Top, lo.Bounds_Left, lo.Bounds_Bottom, lo.Bounds_Right,
    lo.Parent_Object_ID, lo.Nesting_Level,
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
-- AP-2: ALLE am Objekt hängenden Berechnungen — generisch aus der kanonischen
-- Calc-Anker-Registry v_calc_anchors (Display_Text ist bereits entity-dekodiert).
calc_anchors AS (
  SELECT
    va.Kind_Label, va.Calc_Kind, va.Is_Static, va.Display_Text, va.Calc_Hash,
    ROW_NUMBER() OVER (ORDER BY va.Is_Static, va.Calc_Kind) AS ord
  FROM v_calc_anchors va
  WHERE va.Owner_UUID = getvariable('uuid')
    AND (getvariable('file') IS NULL OR va.Owner_File = getvariable('file'))
    AND va.Owner_Type = 'LayoutObject'
),
calc_lines AS (
  SELECT ord, Kind_Label, Is_Static,
    string_split(replace(COALESCE(Display_Text, ''), chr(13), chr(10)), chr(10)) AS arr
  FROM calc_anchors
),
-- All operational references (Field, Script connections)
child_refs AS (
  SELECT
    oc.Object_Type as Target_Type,
    oc.Object_Name as Target_Name,
    oc.File_Name as Target_File,
    ol.Link_Role,
    ol.Link_Subrole,
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

  -- Calculations block (generic) — one section per attached calc, static vs. formula
  SELECT 5, 0, '' WHERE (SELECT COUNT(*) FROM calc_anchors) > 0
  UNION ALL
  SELECT 5, 1,
    '--- Calculations (' || CAST((SELECT COUNT(*) FROM calc_anchors) AS VARCHAR) || ') ---'
  WHERE (SELECT COUNT(*) FROM calc_anchors) > 0
  UNION ALL
  -- Per-calc header line: "  <Kind_Label> [static|formula]:"
  SELECT 5, CAST(ca.ord * 1000 AS INTEGER),
    '  ' || ca.Kind_Label || CASE WHEN ca.Is_Static THEN '  [static]:' ELSE '  [formula]:' END
  FROM calc_anchors ca
  UNION ALL
  -- Per-calc body lines (indented reconstruction / literal)
  SELECT 5, CAST(cl.ord * 1000 + line_no AS INTEGER), '      ' || line
  FROM (
    SELECT ord, Is_Static,
      unnest(arr) AS line,
      unnest(range(1, length(arr) + 1)) AS line_no
    FROM calc_lines
  ) cl

  UNION ALL

  -- References header
  SELECT 10, 0, '' WHERE (SELECT COUNT(*) FROM child_refs) > 0
  UNION ALL
  SELECT 10, 1,
    '--- References (' || CAST((SELECT COUNT(*) FROM child_refs) AS VARCHAR) || ') ---'
  WHERE (SELECT COUNT(*) FROM child_refs) > 0

  UNION ALL

  -- Reference entries (Link_Subrole = calc_kind origin, when present)
  SELECT 11, CAST(ROW_NUMBER() OVER (ORDER BY Target_Type, Target_Name) AS INTEGER),
    '  -> ' || Target_Type || ': ' || Target_Name
    || CASE WHEN Is_Cross_File THEN ' [' || Target_File || ']' ELSE '' END
    || ' (' || Link_Role || COALESCE(' · ' || Link_Subrole, '') || ')'
  FROM child_refs
) details
ORDER BY sort_key, sub_key;
