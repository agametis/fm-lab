-- @template_type: report
-- @description: Single-row layout metadata (context TO, theme, menu set, width, view configuration) for the layout detail properties panel
-- @params: uuid (optional), name (optional), id (optional), file (optional)
-- @output_format: report
-- @author: Marcel
-- @version: 1.0
-- @tags: layouts, metadata, views, react
-- @note: Komplementär zu display_layout_objects_data / display_layout_parts_data.
-- @note: Liefert die eine Metadaten-Zeile für das Eigenschaften-Panel neben dem
-- @note: Layout-Canvas. View-Spalten (Schema 1.8.0) stammen aus dem <Options>-Bitfeld.

WITH layout_match AS (
  SELECT
    L_ID, L_Name, L_UUID, File_Name,
    L_TO_Name, L_TO_UUID, L_Width,
    L_Theme_ID, L_Theme_Name, L_Theme_UUID, L_Theme_Base,
    L_MenuSet_ID, L_MenuSet_Name,
    Options_Raw,
    View_Form_Available, View_List_Available, View_Table_Available,
    Default_View,
    Auto_Save_Changes, Show_Field_Frames, Frame_Current_Record_Only,
    Show_Current_Record_List, Quick_Find_Enabled,
    Is_Hidden, Modified_By, Modified_At, Modifications
  FROM Layouts
  -- Klon-Scoping analog object_details_layout.sql: in JEDEM Zweig auf die aufgelöste
  -- Datei einschränken (getvariable('file')=NULL → Graceful Downgrade).
  WHERE (
    (getvariable('uuid') IS NOT NULL AND L_UUID = getvariable('uuid')
     AND (getvariable('file') IS NULL OR File_Name = getvariable('file')))
    OR
    (getvariable('name') IS NOT NULL AND L_Name = getvariable('name')
     AND (getvariable('file') IS NULL OR File_Name = getvariable('file')))
    OR
    (getvariable('id') IS NOT NULL AND L_ID = CAST(getvariable('id') AS INTEGER)
     AND (getvariable('file') IS NULL OR File_Name = getvariable('file')))
  )
  LIMIT 1
)

SELECT
  L_Name                AS layout_name,
  L_UUID                AS layout_uuid,
  lm.File_Name          AS file_name,
  L_TO_Name             AS to_name,
  L_TO_UUID             AS to_uuid,
  L_Width               AS width,
  L_Theme_ID            AS theme_id,
  L_Theme_Name          AS theme_name,
  -- Lokalisierter Anzeigename aus ThemeCatalog (z.B. „Apex Blau"); Fallback im Frontend.
  tc.Theme_Display      AS theme_display,
  L_Theme_UUID          AS theme_uuid,
  L_Theme_Base          AS theme_base,
  -- L_MenuSet_* ist NULL für den Built-in "[File Default]" (siehe P1-Normalisierung).
  L_MenuSet_Name        AS menuset_name,
  Options_Raw           AS options_raw,
  View_Form_Available   AS view_form_available,
  View_List_Available   AS view_list_available,
  View_Table_Available  AS view_table_available,
  Default_View          AS default_view,
  Auto_Save_Changes         AS auto_save_changes,
  Show_Field_Frames         AS show_field_frames,
  Frame_Current_Record_Only AS frame_current_record_only,
  Show_Current_Record_List  AS show_current_record_list,
  Quick_Find_Enabled        AS quick_find_enabled,
  Is_Hidden             AS is_hidden,
  Modified_By           AS modified_by,
  Modified_At           AS modified_at,
  Modifications         AS modifications
FROM layout_match lm
LEFT JOIN ThemeCatalog tc
  ON tc.Theme_UUID = lm.L_Theme_UUID AND tc.File_Name = lm.File_Name;
