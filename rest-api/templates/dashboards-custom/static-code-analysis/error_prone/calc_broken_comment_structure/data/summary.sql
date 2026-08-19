-- Hand-maintained wrapper around the rule core (calc_broken_comment_structure).
WITH slots AS (
    SELECT File_Name, CF_UUID AS nav_uuid, Calculation_Code AS calc_text FROM CalcsForCustomFunctions
    UNION ALL
    SELECT File_Name, Field_UUID, Calculation_Text FROM FieldsForTables
    UNION ALL
    SELECT File_Name, Field_UUID, AE_Calc_Text FROM FieldsForTables
    UNION ALL
    SELECT File_Name, Field_UUID, Validation_Calc_Text FROM FieldsForTables
    UNION ALL
    SELECT File_Name, Script_UUID, Calc_Text FROM StepCalculations
)
SELECT COUNT(*) AS finding_count,
       COUNT(*) FILTER (WHERE calc_text LIKE '%/*/*%') AS nested_open_count,
       COUNT(*) FILTER (WHERE calc_text LIKE '%*/*/%') AS double_close_count,
       COUNT(DISTINCT File_Name) AS affected_files
FROM slots
WHERE (calc_text LIKE '%/*/*%' OR calc_text LIKE '%*/*/%' OR calc_text LIKE '%/*//%')
  AND (getvariable('file') IS NULL OR File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR nav_uuid IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))));
