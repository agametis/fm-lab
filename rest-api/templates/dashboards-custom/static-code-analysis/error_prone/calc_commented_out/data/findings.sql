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
-- Formula source is the CalculationsCatalog (single source for all calculation
-- slots); the roles map onto the established chip values. Script-step
-- instances anchor at the step (Owner_UUID = Step_UUID) — StepsForScripts
-- contributes the script context and step number, the slot label comes from
-- the instance's Source_Path.
--
-- The slot chips (getvariable('calc_slot')) narrow the result server-side;
-- unset means no filter.
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
