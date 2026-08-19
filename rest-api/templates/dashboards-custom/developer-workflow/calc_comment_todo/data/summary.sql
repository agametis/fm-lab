-- Hand-maintained wrapper around the rule core (calc_comment_todo).
-- Keep the slot list, the detector and the filters in sync with
-- data/findings.sql.
WITH slots AS (
    SELECT File_Name, 'custom_function' AS slot, CF_UUID AS nav_uuid, Calculation_Code AS calc
    FROM CalcsForCustomFunctions WHERE Calculation_Code IS NOT NULL
    UNION ALL
    SELECT File_Name, 'field_calc', Field_UUID, Calculation_Text
    FROM FieldsForTables WHERE Calculation_Text IS NOT NULL
    UNION ALL
    SELECT File_Name, 'field_autoenter', Field_UUID, AE_Calc_Text
    FROM FieldsForTables WHERE AE_Calc_Text IS NOT NULL
    UNION ALL
    SELECT File_Name, 'field_validation', Field_UUID, Validation_Calc_Text
    FROM FieldsForTables WHERE Validation_Calc_Text IS NOT NULL
    UNION ALL
    SELECT File_Name, 'script_step', Script_UUID, Calc_Text
    FROM StepCalculations WHERE Calc_Text IS NOT NULL
),
marked AS (
    SELECT *, list_filter(regexp_extract_all(calc, '(?s)/\*.*?\*/|//[^\n\r]*'),
                          lambda seg: regexp_matches(seg, '(?i)(\bto[\s\-_]?do|\btbd\b|\bto[\s\-_]be[\s\-_](done|defined)\b)')) AS segments
    FROM slots
)
SELECT
    COUNT(*) AS finding_count,
    COUNT(*) FILTER (WHERE slot = 'custom_function') AS custom_function_count,
    COUNT(*) FILTER (WHERE slot IN ('field_calc', 'field_autoenter', 'field_validation')) AS field_count,
    COUNT(*) FILTER (WHERE slot = 'script_step') AS script_step_count,
    COUNT(DISTINCT File_Name) AS affected_files
FROM marked
WHERE len(segments) > 0
  AND (getvariable('file') IS NULL OR File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR nav_uuid IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))));
