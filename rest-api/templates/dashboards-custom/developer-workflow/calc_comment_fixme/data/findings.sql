-- FIXME markers inside comments of FileMaker calculations. Part of the
-- "Unfinished Work" rule family; the detector is the canon of
-- tools/tests/rules/unfinished_work_detector.sql:
--
--   FIXME: (?i)\bfix[\s\-_]?(it|me)\b
--
-- The marker only counts INSIDE a comment segment — `//` to end of line or
-- `/* … */`. Without that restriction every string literal "FIX IT" in a
-- Substitute() would score. Code_Chunks does not help here: its chunk types
-- are NoRef | VariableReference | FunctionRef | CustomFunctionRef | FieldRef —
-- there is no comment type, comments sit inside the NoRef text. So the comment
-- segments are extracted by regex.
-- Known limit: a `//` inside a string literal (a URL) is read as a comment
-- start; a marker behind it would count. Measured on the reference corpus: no
-- such case.
--
-- Formula source is the CalculationsCatalog (single source for all calculation
-- slots); the roles map onto the established five slot values: custom-function
-- bodies, field calculations, auto-enter calculations, validation calculations
-- and script step calculations. Script-step instances anchor at the step
-- (Owner_UUID = Step_UUID) — StepsForScripts contributes the script context.
-- The step slot is by far the largest scan surface (~143k slots on the
-- reference corpus) and still runs in well under a second — it stays in the
-- rule rather than becoming a separate bundle.
--
-- Marker class: FIXME only. The TODO half of the family is calc_comment_todo.
WITH slots AS (
    SELECT c.File_Name,
           CASE c.Calc_Role
                WHEN 'custom_function' THEN 'custom_function'
                WHEN 'field_calculation' THEN 'field_calc'
                WHEN 'auto_enter' THEN 'field_autoenter'
                ELSE 'field_validation' END AS slot,
           c.Owner_UUID AS nav_uuid,
           CASE c.Owner_Type WHEN 'CustomFunction' THEN 'CustomFunction' ELSE 'Field' END AS nav_type,
           c.Owner_Name AS context,
           CAST(NULL AS VARCHAR) AS step_uuid, CAST(NULL AS INTEGER) AS step_no,
           COALESCE(c.Formula_Text, c.Display_Text) AS calc
    FROM CalculationsCatalog c
    WHERE c.Calc_Role IN ('custom_function', 'field_calculation', 'auto_enter', 'validation')
    UNION ALL
    SELECT c.File_Name, 'script_step', s.Script_UUID, 'Script',
           s.Script_Name, c.Owner_UUID, s.Step_Index + 1,
           COALESCE(c.Formula_Text, c.Display_Text)
    FROM CalculationsCatalog c
    JOIN StepsForScripts s ON s.Step_UUID = c.Owner_UUID AND s.File_Name = c.File_Name
    WHERE c.Calc_Role IN ('step_parameter', 'step_xslt')
),
marked AS (
    SELECT *, list_filter(regexp_extract_all(calc, '(?s)/\*.*?\*/|//[^\n\r]*'),
                          lambda seg: regexp_matches(seg, '(?i)\bfix[\s\-_]?(it|me)\b')) AS segments
    FROM slots
)
SELECT 'calc-comment-fixme' AS rule_id, 'warning' AS severity,
    m.File_Name AS file_name,
    m.nav_uuid,
    m.nav_type,
    m.slot,
    m.context,
    m.step_no,
    m.step_uuid,
    m.step_uuid AS marks,
    regexp_extract(m.segments[1], '(?i)\bfix[\s\-_]?(it|me)\b', 0) AS marker,
    trim(m.segments[1]) AS comment,
    len(m.segments) AS marked_comments,
    CASE m.slot
        WHEN 'custom_function'  THEN 'FIXME marker in a custom-function comment'
        WHEN 'field_calc'       THEN 'FIXME marker in a field calculation comment'
        WHEN 'field_autoenter'  THEN 'FIXME marker in an auto-enter calculation comment'
        WHEN 'field_validation' THEN 'FIXME marker in a validation calculation comment'
        ELSE 'FIXME marker in a script step calculation comment'
    END AS message,
    row_number() OVER (ORDER BY m.File_Name, m.slot, m.context, m.step_no) AS row_key
FROM marked m
WHERE len(m.segments) > 0
  AND (getvariable('file') IS NULL OR m.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR m.nav_uuid IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY row_key
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
