-- @template_type: report
-- @description: Structured layout-object data (one row per object) for interactive React rendering
-- @params: uuid (optional), name (optional), id (optional), file (optional)
-- @output_format: report
-- @author: Marcel
-- @version: 1.0
-- @tags: layouts, objects, data, react, interactive
-- @note: Ergänzt display_layout_svg.sql, das fertiges SVG-Markup liefert. Dieser Endpunkt
-- @note: gibt eine Zeile pro Layout-Objekt zurück mit allen Spalten, die das Frontend für
-- @note: Hover-Tooltip, Cross-Navigation, Suche, Filter und Label-Toggle benötigt.

WITH RECURSIVE layout_match AS (
  SELECT L_ID, L_Name, L_UUID, L_TO_Name, File_Name
  FROM Layouts
  WHERE (
    (getvariable('uuid') IS NOT NULL AND L_UUID = getvariable('uuid'))
    OR
    (getvariable('name') IS NOT NULL AND L_Name = getvariable('name')
     AND (getvariable('file') IS NULL OR File_Name = getvariable('file')))
    OR
    (getvariable('id') IS NOT NULL AND L_ID = CAST(getvariable('id') AS INTEGER))
  )
  LIMIT 1
),
layout_objects_raw AS (
  SELECT
    lo.Object_ID,
    lo.Object_Type,
    lo.Object_Name,
    lo.Object_UUID,
    lo.Bounds_Top,
    lo.Bounds_Left,
    lo.Bounds_Bottom,
    lo.Bounds_Right,
    lo.Parent_Object_ID,
    lo.Nesting_Level,
    lo.Z_Order,
    lo.Part_Type,
    lo.Hide_Calculation_Text,
    lo.Tooltip_Calculation_Text,
    lo.Label_Calculation_Text,
    lo.Text_Content,
    -- Bedingte Formatierung. Das Element <ConditionalFormat> existiert im SaXML
    -- NICHT (Marker war immer false → 0 Treffer trotz 12k+ betroffener Objekte). Realer
    -- Marker: <Conditions> umschließt DIREKT ein <Formatting> (whitespace-tolerant, da im
    -- gespeicherten XML Newlines zwischen den Tags stehen). Plain <Formatting> wäre zu breit
    -- (fängt die Daten-Formatierung aus <ExtendedAttributes>); <Conditions><Hide> ist die
    -- bedingte Sichtbarkeit (separat). Kein ':'-Token → API-:param-Präprozessor unkritisch.
    regexp_matches(CAST(lo.Object_XML AS VARCHAR), '<Conditions>\s*<Formatting') AS Has_Conditional_Fmt,
    lo.Layout_ID,
    lo.File_Name
  FROM LayoutObjects lo
  JOIN layout_match lm ON lo.Layout_ID = lm.L_ID
    AND lo.File_Name = lm.File_Name
),
-- Recursive CTE: convert relative child bounds to absolute layout coordinates
objects_absolute AS (
  -- Base: root objects (Level 0) - bounds are already absolute
  SELECT
    Object_ID, Object_Type, Object_Name, Object_UUID,
    Bounds_Top AS Abs_Top,
    Bounds_Left AS Abs_Left,
    Bounds_Bottom AS Abs_Bottom,
    Bounds_Right AS Abs_Right,
    Parent_Object_ID, Nesting_Level, Z_Order, Part_Type,
    Hide_Calculation_Text, Tooltip_Calculation_Text, Label_Calculation_Text,
    Text_Content, Has_Conditional_Fmt
  FROM layout_objects_raw
  WHERE Parent_Object_ID IS NULL

  UNION ALL

  -- Recursion: children - add parent absolute offset
  SELECT
    child.Object_ID, child.Object_Type, child.Object_Name, child.Object_UUID,
    parent.Abs_Top + child.Bounds_Top,
    parent.Abs_Left + child.Bounds_Left,
    parent.Abs_Top + child.Bounds_Bottom,
    parent.Abs_Left + child.Bounds_Right,
    child.Parent_Object_ID, child.Nesting_Level, child.Z_Order, child.Part_Type,
    child.Hide_Calculation_Text, child.Tooltip_Calculation_Text, child.Label_Calculation_Text,
    child.Text_Content, child.Has_Conditional_Fmt
  FROM layout_objects_raw child
  JOIN objects_absolute parent ON child.Parent_Object_ID = parent.Object_ID
),
-- Cross-Nav-Targets: erstes displays_field bzw. erstes triggers_script pro LayoutObject
field_targets AS (
  SELECT
    ol.Source_UUID AS lo_uuid,
    arg_min(oc.Object_UUID, oc.Object_Name) AS field_uuid,
    arg_min(oc.Object_Name, oc.Object_Name) AS field_name
  FROM ObjectLinks ol
  JOIN ObjectCatalog oc ON ol.Target_UUID = oc.Object_UUID
  WHERE ol.Source_Type = 'LayoutObject'
    AND ol.Link_Role = 'displays_field'
  GROUP BY ol.Source_UUID
),
script_targets AS (
  SELECT
    ol.Source_UUID AS lo_uuid,
    arg_min(oc.Object_UUID, oc.Object_Name) AS script_uuid,
    arg_min(oc.Object_Name, oc.Object_Name) AS script_name
  FROM ObjectLinks ol
  JOIN ObjectCatalog oc ON ol.Target_UUID = oc.Object_UUID
  WHERE ol.Source_Type = 'LayoutObject'
    AND ol.Link_Role = 'triggers_script'
  GROUP BY ol.Source_UUID
)

SELECT
  oa.Object_UUID                      AS object_uuid,
  oa.Object_ID                        AS object_id,
  oa.Object_Type                      AS object_type,
  NULLIF(oa.Object_Name, '')          AS object_name,
  NULLIF(oa.Text_Content, '')         AS text_content,
  oa.Abs_Top                          AS abs_top,
  oa.Abs_Left                         AS abs_left,
  oa.Abs_Bottom                       AS abs_bottom,
  oa.Abs_Right                        AS abs_right,
  oa.Nesting_Level                    AS nesting_level,
  oa.Z_Order                          AS z_order,
  oa.Parent_Object_ID                 AS parent_object_id,
  oa.Part_Type                        AS part_type,
  NULLIF(oa.Hide_Calculation_Text, '') AS hide_text,
  NULLIF(oa.Tooltip_Calculation_Text, '') AS tooltip_text,
  NULLIF(oa.Label_Calculation_Text, '') AS label_calc_text,
  oa.Has_Conditional_Fmt              AS has_conditional_fmt,
  ft.field_uuid                       AS field_uuid,
  ft.field_name                       AS field_name,
  st.script_uuid                      AS script_uuid,
  st.script_name                      AS script_name
FROM objects_absolute oa
LEFT JOIN field_targets  ft ON oa.Object_UUID = ft.lo_uuid
LEFT JOIN script_targets st ON oa.Object_UUID = st.lo_uuid
ORDER BY oa.Nesting_Level, COALESCE(oa.Z_Order, oa.Object_ID);
