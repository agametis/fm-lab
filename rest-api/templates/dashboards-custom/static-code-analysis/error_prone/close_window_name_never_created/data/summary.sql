-- Hand-maintained wrapper around the rule core (close_window_name_never_created).
WITH closes AS (
    SELECT File_Name, Script_UUID, Step_Index, Calc_Text,
           regexp_full_match(Calc_Text, '"[^"]*"') AS is_literal
    FROM StepCalculations
    WHERE Step_ID = 121 AND Slot = 'Name' AND Is_Enabled
),
producers AS (
    SELECT DISTINCT Calc_Text
    FROM StepCalculations
    WHERE Is_Enabled
      AND ((Step_ID IN (122, 74) AND Slot = 'Name') OR (Step_ID = 124 AND Slot = 'Rename'))
)
SELECT
    COUNT(*)                                  AS finding_count,
    COUNT(*) FILTER (WHERE c.is_literal)      AS dead_cleanup_count,
    COUNT(DISTINCT c.File_Name)               AS affected_files
FROM closes c
LEFT JOIN producers p ON p.Calc_Text = c.Calc_Text
WHERE p.Calc_Text IS NULL
  AND (getvariable('file') IS NULL OR c.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR c.Script_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))));
