-- @template_type: report
-- @description: Script steps with indent, kind classification, and references for token-based output
-- @params: uuid (required)
-- @output_format: tokens
-- @author: Marcel
-- @version: 1.0
-- @tags: scripts, script-steps, ddr, tokens

WITH step_changes AS (
  SELECT
    s.Step_Index,
    s.Step_ID,
    s.Step_Name,
    s.Is_Enabled,
    s.Parameter_Type,
    s.Step_UUID,
    s.File_Name,
    CASE
      WHEN s.Step_Name IN ('If', 'Loop') THEN 1
      WHEN s.Step_Name IN ('End If', 'End Loop') THEN -1
      ELSE 0
    END AS depth_change_after,
    CASE
      WHEN s.Step_Name IN ('Else', 'Else If', 'End If', 'End Loop') THEN -1
      ELSE 0
    END AS depth_change_self
  FROM StepsForScripts s
  -- Klon-Disambiguierung: ohne File-Filter matcht eine geteilte Script_UUID die
  -- Schritte ALLER Klon-Dateien → jede Zeile erschiene mehrfach.
  WHERE s.Script_UUID = getvariable('uuid')
    AND (getvariable('file') IS NULL OR s.File_Name = getvariable('file'))
),
step_depths AS (
  SELECT
    *,
    GREATEST(0,
      COALESCE(SUM(depth_change_after) OVER (
        PARTITION BY File_Name
        ORDER BY Step_Index
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ), 0)
    ) + depth_change_self AS indent_level
  FROM step_changes
)
SELECT
  sd.Step_Index AS line_index,
  CAST(GREATEST(0, sd.indent_level) AS INTEGER) AS indent,
  sd.Step_ID AS step_id,
  sd.Step_UUID AS step_uuid,
  -- Synthetischer ScriptStepType-UUID
  -- für Cross-Navigation vom Step-Namen zur Pseudo-Objekt-Detailseite.
  md5('ScriptStepType::' || sd.Step_Name) AS step_type_uuid,
  sd.Step_Name AS step_name,
  sd.Is_Enabled AS enabled,
  sd.Parameter_Type AS parameter_type,
  -- FileMaker's script editor renders these keywords without the bare "[  ]"
  -- suffix that the DDR export still produces. Strip it here so all consumers
  -- (token clients, plain-text renderers, future ones) see the canonical form.
  CASE
    WHEN sd.Step_Name IN ('Else','End If','End Loop',
                          'Commit Transaction','Revert Transaction','Open Transaction')
         AND d.Step_Text IS NOT NULL
    THEN regexp_replace(d.Step_Text, '\s*\[\s*\]\s*$', '')
    ELSE d.Step_Text
  END AS step_text,
  CASE
    WHEN sd.Step_ID = 89 AND d.Step_Text IS NULL THEN 'empty'
    WHEN sd.Step_ID = 89                          THEN 'comment'
    ELSE 'step'
  END AS kind
FROM step_depths sd
-- Step_UUIDs sind ebenfalls geklont → DDR-Join auf die gleiche Datei skopieren,
-- sonst multipliziert der LEFT JOIN die Zeilen erneut.
LEFT JOIN DDR_ScriptSteps d ON sd.Step_UUID = d.Step_UUID AND sd.File_Name = d.File_Name
ORDER BY sd.File_Name, sd.Step_Index;
