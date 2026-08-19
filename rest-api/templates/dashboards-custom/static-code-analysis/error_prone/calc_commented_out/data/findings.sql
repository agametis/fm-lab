-- Calculation slots whose entire formula is a single /* ... */ comment block.
-- Such a formula evaluates to nothing, so the intended behavior is silently
-- disabled while the slot still looks occupied in the FileMaker dialogs.
-- Translated from fmCheckMate ReportBrokenCalculationCommentedOut, widened
-- from the layout slots (covered by the layout-quality sibling rule) to the
-- catalog-wide calculation slots.
--
-- Sharpened against the source: a formula that merely STARTS and ENDS with a
-- comment can still carry live code in between. Only formulas with exactly one
-- comment block are reported, so `/* off */ code /* note */` stays out.
--
-- The slot chips (getvariable('calc_slot')) narrow the result server-side;
-- unset means no filter.
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
SELECT 'calc-commented-out' AS rule_id, 'warning' AS severity,
    s.File_Name AS file_name, s.nav_uuid, s.object_type, s.object_name,
    s.calc_slot,
    CASE WHEN s.step_no IS NULL THEN '' ELSE 'Step ' || s.step_no || ' · ' || s.step_slot END AS location,
    s.step_uuid,
    'The formula is completely commented out — ' || replace(substr(trim(s.calc_text), 1, 120), chr(10), ' ') AS message,
    row_number() OVER (ORDER BY s.File_Name, s.object_type, s.object_name, s.calc_slot, s.step_no) AS row_key
FROM slots s
WHERE trim(s.calc_text) LIKE '/*%' AND trim(s.calc_text) LIKE '%*/'
  AND (length(trim(s.calc_text)) - length(replace(trim(s.calc_text), '/*', ''))) / 2 = 1
  AND (getvariable('calc_slot') IS NULL OR s.calc_slot = getvariable('calc_slot'))
  AND (getvariable('file') IS NULL OR s.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR s.nav_uuid IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY row_key
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
