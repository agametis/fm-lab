-- Hardcoded http(s) URLs in the active code of any calculation slot.
-- Instance base is the CalculationsCatalog (single source for all calculation
-- slots, DDR-less instances included). Comments are stripped before matching
-- so documentation links do not score: /* ... */ blocks and // line comments
-- (a // that is part of a URL scheme is protected). Known limit: a // inside
-- a string literal that is not a scheme still strips to end of line — same
-- convention as the comment-marker rule family.
-- Script-step instances anchor at the step (Owner_UUID = Step_UUID);
-- StepsForScripts contributes the script context for navigation.
WITH hit AS (
    SELECT c.File_Name, c.Owner_UUID, c.Owner_Type, c.Owner_Name,
        regexp_replace(
            regexp_replace(COALESCE(c.Formula_Text, c.Display_Text), '(?s)/\*.*?\*/', ' ', 'g'),
            '(?m)(^|[^:])//[^\n\r]*', '\1', 'g') AS active_text
    FROM CalculationsCatalog c
    WHERE (getvariable('file') IS NULL OR c.File_Name = getvariable('file'))
)
SELECT 'hardcoded-url-in-calc' AS rule_id, 'warning' AS severity,
    h.File_Name AS file_name,
    COALESCE(s.Script_Name, h.Owner_Name, '—') AS owner,
    regexp_extract(h.active_text, '(https?://[^"''<>\s]+)', 1) AS url,
    COALESCE(s.Script_UUID, h.Owner_UUID) AS nav_uuid,
    CASE WHEN s.Script_UUID IS NOT NULL THEN 'Script' ELSE h.Owner_Type END AS nav_type,
    CASE WHEN s.Script_UUID IS NOT NULL THEN h.Owner_UUID END AS step_uuid,
    row_number() OVER (ORDER BY h.File_Name) AS row_key
FROM hit h
LEFT JOIN StepsForScripts s ON h.Owner_Type = 'ScriptStep'
     AND s.Step_UUID = h.Owner_UUID AND s.File_Name = h.File_Name
WHERE regexp_matches(h.active_text, 'https?://[A-Za-z0-9]')
ORDER BY h.File_Name
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
