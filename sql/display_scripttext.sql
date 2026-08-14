-- Display Script Steps with full DDR Text and automatic indentation
--
-- This template displays FileMaker script steps with proper indentation for
-- nested control structures (If/Else/End If, Loop/End Loop).
--
-- Usage:
--   duckdb db/fm_catalog.duckdb < sql/display_scripttext.sql
--
-- To change the Script ID, modify the SET VARIABLE script_id line below.
--
-- Current Script ID: 39

.mode line
.header off

SET VARIABLE script_id = 39;  -- << Change this value to display different scripts

WITH step_changes AS (
  SELECT
    s.Step_Index,
    s.Step_Name,
    s.Step_UUID,
    s.DDR_Hash,
    s.File_Name,
    -- Calculate depth change for the NEXT step
    CASE
      WHEN s.Step_Name IN ('If', 'Loop') THEN 1
      WHEN s.Step_Name IN ('End If', 'End Loop') THEN -1
      ELSE 0
    END AS depth_change_after,
    -- Calculate depth change for the CURRENT step
    CASE
      WHEN s.Step_Name IN ('Else', 'Else If', 'End If', 'End Loop') THEN -1
      ELSE 0
    END AS depth_change_self
  FROM StepsForScripts s
  JOIN ScriptCatalog sc ON s.Script_UUID = sc.Script_UUID
  WHERE sc.Script_ID = getvariable('script_id')
),
step_depths AS (
  SELECT
    Step_Index,
    Step_Name,
    Step_UUID,
    DDR_Hash,
    File_Name,
    -- Calculate the indentation depth for subsequent steps
    GREATEST(0,
      COALESCE(SUM(depth_change_after) OVER (
        ORDER BY Step_Index
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ), 0)
    ) AS base_depth,
    depth_change_self
  FROM step_changes
),
-- UUID-Healing-Fallback (Schema 1.19.0): geheilte Step-Zwillinge tragen eine
-- synthetische Step_UUID ohne DDR_ScriptSteps-Zeile (der DDR-Block ist nur über die
-- Quell-UUID gekeyt). Inhaltsgleiche Zwillinge lösen ihren Klartext stattdessen über
-- den Inhalts-Hash auf (StepsForScripts.DDR_Hash = DDR_ScriptSteps.Step_Hash);
-- any_value dedupliziert hash-gleiche Zeilen (identischer Text).
ddr_by_hash AS (
  SELECT Step_Hash, File_Name, any_value(Step_Text) AS Step_Text
  FROM DDR_ScriptSteps
  GROUP BY Step_Hash, File_Name
)
SELECT
  printf('%2d. %s%s',
    Step_Index + 1,
    repeat('  ', CAST(GREATEST(0, base_depth + depth_change_self) AS BIGINT)),
    CASE
      WHEN (SELECT Has_DDR_INFO FROM XMLMetadata LIMIT 1) = 'True'
      THEN COALESCE(d.Step_Text, dh.Step_Text, sd.Step_Name)
      ELSE sd.Step_Name
    END
  ) AS Step
FROM step_depths sd
LEFT JOIN DDR_ScriptSteps d ON sd.Step_UUID = d.Step_UUID
LEFT JOIN ddr_by_hash dh ON sd.DDR_Hash = dh.Step_Hash AND sd.File_Name = dh.File_Name
ORDER BY Step_Index;
