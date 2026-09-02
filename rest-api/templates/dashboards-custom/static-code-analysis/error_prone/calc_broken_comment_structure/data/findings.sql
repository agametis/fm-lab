-- Formulas whose comment markers cannot nest. FileMaker comments do not nest,
-- so a second /* inside an open comment, a stray */ after the block was already
-- closed, or a // line comment glued to an opening /* leaves the parser in a
-- state the author did not intend — parts of the formula are silently inside or
-- outside the comment. Translated from fmCheckMate CommentedOut.
--
-- Same calculation slots as the commented-out-formula rule, so both cover the
-- catalog identically. Formula source is the CalculationsCatalog (single
-- source for all calculation slots); script-step instances anchor at the step
-- (Owner_UUID = Step_UUID) — StepsForScripts contributes the script context.
WITH slots AS (
    SELECT c.File_Name, c.Owner_UUID AS nav_uuid,
           CASE c.Owner_Type WHEN 'CustomFunction' THEN 'CustomFunction' ELSE 'Field' END AS object_type,
           c.Owner_Name AS object_name,
           CASE c.Calc_Role
                WHEN 'custom_function' THEN 'custom-function'
                WHEN 'field_calculation' THEN 'field-calculation'
                WHEN 'auto_enter' THEN 'auto-enter'
                ELSE 'validation' END AS calc_slot,
           CAST(NULL AS VARCHAR) AS step_uuid, CAST(NULL AS INTEGER) AS step_no,
           CAST(NULL AS VARCHAR) AS step_slot,
           COALESCE(c.Formula_Text, c.Display_Text) AS calc_text
    FROM CalculationsCatalog c
    WHERE c.Calc_Role IN ('custom_function', 'field_calculation', 'auto_enter', 'validation')
    UNION ALL
    SELECT c.File_Name, s.Script_UUID, 'Script', s.Script_Name,
           'script-step', c.Owner_UUID, s.Step_Index + 1,
           substr(c.Source_Path, 6),
           COALESCE(c.Formula_Text, c.Display_Text)
    FROM CalculationsCatalog c
    JOIN StepsForScripts s ON s.Step_UUID = c.Owner_UUID AND s.File_Name = c.File_Name
    WHERE c.Calc_Role IN ('step_parameter', 'step_xslt')
)
SELECT 'calc-broken-comment-structure' AS rule_id, 'warning' AS severity,
    s.File_Name AS file_name, s.nav_uuid, s.object_type, s.object_name,
    s.calc_slot,
    CASE WHEN s.step_no IS NULL THEN '' ELSE 'Step ' || s.step_no || ' · ' || s.step_slot END AS location,
    s.step_uuid,
    CASE WHEN s.calc_text LIKE '%/*/*%' THEN 'nested-open'
         WHEN s.calc_text LIKE '%*/*/%' THEN 'double-close'
         ELSE 'line-in-block' END AS defect,
    'Comment markers cannot nest — ' || replace(substr(trim(s.calc_text), 1, 120), chr(10), ' ') AS message,
    row_number() OVER (ORDER BY s.File_Name, s.object_type, s.object_name, s.calc_slot, s.step_no) AS row_key
FROM slots s
WHERE (s.calc_text LIKE '%/*/*%' OR s.calc_text LIKE '%*/*/%' OR s.calc_text LIKE '%/*//%')
  AND (getvariable('file') IS NULL OR s.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR s.nav_uuid IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY row_key
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
