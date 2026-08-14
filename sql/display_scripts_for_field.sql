-- Display all scripts where a specific field is used
--
-- This template displays all FileMaker scripts that reference a specific field
-- in their script steps (e.g., Set Field, Go to Field, etc.).
--
-- Usage:
--   duckdb db/fm_catalog.duckdb < sql/display_scripts_for_field.sql
--
-- To change the Field UUID, modify the SET VARIABLE field_uuid line below.
--
-- Current Field UUID: AFEB8FB9-B55F-442C-A17A-1737A5F1E584 (Lieferanten::Referenzlisten Auswahl)

.mode box
.header on

SET VARIABLE field_uuid = 'AFEB8FB9-B55F-442C-A17A-1737A5F1E584';  -- << Change this value to display scripts for different fields

-- Display field information
SELECT
    Field_ID,
    Table_Name || '::' || Field_Name as Field_Reference,
    Field_Type,
    Data_Type,
    Field_UUID
FROM FieldsForTables
WHERE Field_UUID = getvariable('field_uuid');

SELECT ''; -- Empty line for better readability

-- Display all scripts and steps where this field is used
WITH ddr_by_hash AS (
    -- UUID-Healing-Fallback (Schema 1.19.0): geheilte Step-Zwillinge (synthetische
    -- Step_UUID ohne DDR-Zeile) lösen ihren Klartext über den Inhalts-Hash auf;
    -- any_value dedupliziert hash-gleiche Zeilen (identischer Text).
    SELECT Step_Hash, File_Name, any_value(Step_Text) AS Step_Text
    FROM DDR_ScriptSteps
    GROUP BY Step_Hash, File_Name
)
SELECT
    s.Script_Name,
    step.Step_Index + 1 as Step_Number,
    step.Step_Name,
    CASE
        WHEN (SELECT Has_DDR_INFO FROM XMLMetadata LIMIT 1) = 'True'
        THEN COALESCE(ddr.Step_Text, dh.Step_Text, step.Step_Name)
        ELSE step.Step_Name
    END as Step_Text,
    step.Calculation_Text
FROM StepsForScripts step
JOIN ScriptCatalog s ON step.Script_UUID = s.Script_UUID
LEFT JOIN DDR_ScriptSteps ddr ON step.Step_UUID = ddr.Step_UUID
LEFT JOIN ddr_by_hash dh ON step.DDR_Hash = dh.Step_Hash AND step.File_Name = dh.File_Name
WHERE step.Parameters_XML::TEXT LIKE '%' || getvariable('field_uuid') || '%'
   OR step.Calculation_Text LIKE '%' || getvariable('field_uuid') || '%'
ORDER BY s.Script_Name, step.Step_Index;
