-- Formulas whose comment markers cannot nest. FileMaker comments do not nest,
-- so a second /* inside an open comment, a stray */ after the block was already
-- closed, or a // line comment glued to an opening /* leaves the parser in a
-- state the author did not intend — parts of the formula are silently inside or
-- outside the comment. Translated from fmCheckMate CommentedOut.
--
-- Same calculation slots as the commented-out-formula rule, so both cover the
-- catalog identically.
WITH slots AS (
    SELECT File_Name, CF_UUID AS nav_uuid, 'CustomFunction' AS object_type, CF_Name AS object_name,
           'custom-function' AS calc_slot, NULL AS step_uuid, NULL AS step_no, NULL AS step_slot,
           Calculation_Code AS calc_text
    FROM CalcsForCustomFunctions
    UNION ALL
    SELECT File_Name, Field_UUID, 'Field', Table_Name || '::' || Field_Name,
           'field-calculation', NULL, NULL, NULL, Calculation_Text
    FROM FieldsForTables
    UNION ALL
    SELECT File_Name, Field_UUID, 'Field', Table_Name || '::' || Field_Name,
           'auto-enter', NULL, NULL, NULL, AE_Calc_Text
    FROM FieldsForTables
    UNION ALL
    SELECT File_Name, Field_UUID, 'Field', Table_Name || '::' || Field_Name,
           'validation', NULL, NULL, NULL, Validation_Calc_Text
    FROM FieldsForTables
    UNION ALL
    SELECT File_Name, Script_UUID, 'Script', Script_Name,
           'script-step', Step_UUID, Step_Index + 1, Slot, Calc_Text
    FROM StepCalculations
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
