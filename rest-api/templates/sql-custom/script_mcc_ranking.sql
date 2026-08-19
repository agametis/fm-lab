-- @template_type: report
-- @title: Script complexity ranking (MCC)
-- @description: Scripts ranked by cyclomatic complexity — one branch point per If and per Else If, plus one for the script itself. A metric, not a defect list. High values are not automatically wrong (a dispatcher legitimately branches a lot), but the top of this ranking is where a change is hardest to reason about and where testing every path stops being realistic. The min_mcc parameter sets the floor, default 10. Based on the fmCheckMate check "ScriptComplexityUsingMcc" — https://github.com/mrwatson-de/fmCheckMate-XSLT
-- @icon: git-branch
-- @category: Scripts
-- @display: table
-- @params: file (optional), limit (optional, default 500), min_mcc (optional, default 10)
-- @click_action: openObject
-- @click_args: uuid={{_nav_uuid}}&type=Script&file={{file_name}}
-- @output_format: file_name, script_name, mcc, if_count, else_if_count, loop_count, step_count, _message
-- @object_types: Script
-- @output_types: count, inventory-table
-- @scope: solution, file, object, object-list, cluster
-- @default_result: { "aggregate": "row_count", "type": "number", "name": "complex_scripts", "meaning": "Scripts at or above the complexity floor (inventory — a metric, not a defect count)" }
-- @author: fm-lab core
-- @version: 1.0
-- @tags: scripts, complexity, metrics, fmcheckmate
--
-- MCC is counted the way the source counts it: 1 + every branch point. In
-- FileMaker that is the If step and the Else If step — Else opens no new path
-- (it is the complement of the If) and End If closes one. Step ids are used
-- rather than step names, because the names are localised in the catalog.
--
-- Loops are reported alongside but deliberately NOT counted into the metric,
-- so the number stays comparable with the source and with the existing
-- nesting-depth rules. Disabled steps are excluded: they contribute no path.
WITH branch AS (
    SELECT s.File_Name, s.Script_UUID, s.Script_Name,
           COUNT(*) FILTER (WHERE st.Step_ID = 68)  AS if_count,
           COUNT(*) FILTER (WHERE st.Step_ID = 125) AS else_if_count,
           COUNT(*) FILTER (WHERE st.Step_ID = 71)  AS loop_count,
           COUNT(*) AS step_count
    FROM ScriptCatalog s
    JOIN StepsForScripts st ON st.Script_UUID = s.Script_UUID
    WHERE st.Is_Enabled
      AND (s.Folder_Type IS NULL OR s.Folder_Type = 'False') AND NOT s.Is_Separator
    GROUP BY 1, 2, 3
)
SELECT
    b.File_Name AS file_name,
    b.Script_UUID AS _nav_uuid,
    b.Script_Name AS script_name,
    1 + b.if_count + b.else_if_count AS mcc,
    b.if_count, b.else_if_count, b.loop_count, b.step_count,
    'Complexity ' || (1 + b.if_count + b.else_if_count) || ' from ' || b.if_count
      || ' If and ' || b.else_if_count || ' Else If over ' || b.step_count || ' steps' AS _message
FROM branch b
WHERE 1 + b.if_count + b.else_if_count >= CAST(COALESCE(getvariable('min_mcc'), '10') AS INTEGER)
  AND (getvariable('file') IS NULL OR b.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR b.Script_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY mcc DESC, b.step_count DESC, b.File_Name, b.Script_Name
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
