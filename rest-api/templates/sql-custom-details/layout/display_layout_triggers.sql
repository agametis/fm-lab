-- @template_type: report
-- @description: Layout-level script triggers of a layout (event + activated script) for the detail properties panel
-- @params: uuid (optional), name (optional), id (optional), file (optional)
-- @output_format: report
-- @author: Marcel
-- @version: 1.0
-- @tags: layouts, triggers, scripts, react
-- @note: Nutzt die vorhandene Tabelle ScriptTriggers (Owner_Type='Layout',
-- @note: Owner_UUID=L_UUID). Trigger_Action ist kanonisch (englischer Enum-Name);
-- @note: die Lokalisierung der Ereignis-Bezeichnung übernimmt das Frontend.

WITH layout_match AS (
  SELECT L_ID, L_Name, L_UUID, File_Name
  FROM Layouts
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
  st.Trigger_ID                    AS trigger_id,
  st.Trigger_Action                AS trigger_action,
  (st.Trigger_BrowseMode = 'True') AS browse_mode,
  st.Script_ID                     AS script_id,
  st.Script_Name                   AS script_name,
  st.Script_UUID                   AS script_uuid,
  lm.File_Name                     AS file_name
FROM layout_match lm
JOIN ScriptTriggers st
  ON st.Owner_UUID = lm.L_UUID
 AND st.File_Name  = lm.File_Name
 AND st.Owner_Type = 'Layout'
ORDER BY st.Trigger_ID;
