-- Close Window [Name: X] where X is never produced by any window-name producer
-- ANYWHERE in the imported corpus (producers: New Window @Name, Go to Related
-- Record @Name, Set Window Title @Rename — its @Name slot is the *target*, not a
-- producer). Window names are app-global, so producers are matched corpus-wide
-- (no file scoping on the producer side). A literal close with no producer is a
-- guaranteed no-op (dead cleanup, severity error); a dynamic name (variable /
-- expression) is only comparable textually (severity info — verify at runtime).
-- Formula source is the CalculationsCatalog (Owner_UUID = Step_UUID, slot
-- selected via the instance's Source_Path); StepsForScripts contributes the
-- step type, enabled state and script context.
WITH closes AS (
    SELECT c.File_Name, s.Script_UUID, s.Script_Name, s.Step_Index, c.Owner_UUID AS Step_UUID,
           COALESCE(c.Formula_Text, c.Display_Text) AS Calc_Text,
           regexp_full_match(COALESCE(c.Formula_Text, c.Display_Text), '"[^"]*"') AS is_literal
    FROM CalculationsCatalog c
    JOIN StepsForScripts s ON s.Step_UUID = c.Owner_UUID AND s.File_Name = c.File_Name
    WHERE s.Step_ID = 121 AND c.Source_Path = 'Step/Name' AND s.Is_Enabled
),
producers AS (
    SELECT DISTINCT COALESCE(c.Formula_Text, c.Display_Text) AS Calc_Text
    FROM CalculationsCatalog c
    JOIN StepsForScripts s ON s.Step_UUID = c.Owner_UUID AND s.File_Name = c.File_Name
    WHERE s.Is_Enabled
      AND ((s.Step_ID IN (122, 74) AND c.Source_Path = 'Step/Name')
           OR (s.Step_ID = 124 AND c.Source_Path = 'Step/Rename'))
)
SELECT 'close-window-name-never-created' AS rule_id,
    CASE WHEN c.is_literal THEN 'error' ELSE 'info' END AS severity,
    c.File_Name AS file_name, c.Script_UUID AS nav_uuid, c.Script_Name AS script_name,
    c.Step_Index + 1 AS step_no, c.Step_UUID AS step_uuid,
    c.Calc_Text AS window_name,
    CASE WHEN c.is_literal
         THEN 'Close Window targets ' || c.Calc_Text || ' — this name is never produced anywhere in the imported corpus (dead cleanup)'
         ELSE 'Close Window targets dynamic name ' || c.Calc_Text || ' with no textually matching producer (heuristic — verify at runtime)'
    END AS message,
    row_number() OVER (ORDER BY c.is_literal DESC, c.File_Name, c.Script_Name, c.Step_Index) AS row_key
FROM closes c
LEFT JOIN producers p ON p.Calc_Text = c.Calc_Text
WHERE p.Calc_Text IS NULL
  AND (getvariable('file') IS NULL OR c.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR c.Script_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY severity, file_name, script_name, step_no
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
