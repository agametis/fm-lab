-- Hand-maintained wrapper around the rule core (calc_commented_out).
-- The calc_slot filter is deliberately NOT applied here — the per-slot counts
-- feed the chip badges, which must always show the true per-slot totals.
WITH slots AS (
    SELECT File_Name, CF_UUID AS nav_uuid, 'custom-function' AS calc_slot, Calculation_Code AS calc_text
    FROM CalcsForCustomFunctions
    UNION ALL
    SELECT File_Name, Field_UUID, 'field-calculation', Calculation_Text FROM FieldsForTables
    UNION ALL
    SELECT File_Name, Field_UUID, 'auto-enter', AE_Calc_Text FROM FieldsForTables
    UNION ALL
    SELECT File_Name, Field_UUID, 'validation', Validation_Calc_Text FROM FieldsForTables
    UNION ALL
    SELECT File_Name, Script_UUID, 'script-step', Calc_Text FROM StepCalculations
)
SELECT COUNT(*) AS finding_count,
       COUNT(*) FILTER (WHERE calc_slot = 'custom-function')   AS custom_function_count,
       COUNT(*) FILTER (WHERE calc_slot = 'field-calculation') AS field_calculation_count,
       COUNT(*) FILTER (WHERE calc_slot = 'auto-enter')        AS auto_enter_count,
       COUNT(*) FILTER (WHERE calc_slot = 'validation')        AS validation_count,
       COUNT(*) FILTER (WHERE calc_slot = 'script-step')       AS script_step_count,
       COUNT(DISTINCT File_Name) AS affected_files
FROM slots
WHERE trim(calc_text) LIKE '/*%' AND trim(calc_text) LIKE '%*/'
  AND (length(trim(calc_text)) - length(replace(trim(calc_text), '/*', ''))) / 2 = 1
  AND (getvariable('file') IS NULL OR File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR nav_uuid IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))));
