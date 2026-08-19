-- Comment steps in scripts that carry a FIXME marker — a known defect that
-- was shipped. Part of the "Unfinished Work" rule family; the detector is the
-- canon of tools/tests/rules/unfinished_work_detector.sql:
--
--   FIXME: (?i)\bfix[\s\-_]?(it|me)\b
--
-- Case-insensitive and separator-tolerant on purpose (FIXME, FIX ME, FIX-IT,
-- fix_it), so the marker is found regardless of the developer's notation. The
-- word boundaries keep prose out ("fix item", "prefix message", "fixed").
--
-- Source column is StepsForScripts.Comment_Text — the decoded comment text the
-- converter extracts for Step_ID 89; no XML regex needed, and no entity
-- decoding in the rule. Comment_Text exists for step 89 only.
--
-- Grain: one finding per comment step. A comment carrying FIXME *and* TODO is
-- reported by both rules of the family — the overlap is intended (a line can
-- be a defect and a plan at once).
--
-- Disabled comment steps count too: a marker documents open work whether or
-- not the surrounding step is active.
--
-- Deep link: the row click opens the script, scrolls to the comment step
-- (`step`) and marks it (`marks`).
SELECT 'script-comment-fixme' AS rule_id, 'warning' AS severity,
    s.File_Name AS file_name,
    s.Script_UUID AS nav_uuid,
    'Script' AS nav_type,
    s.Script_Name AS script_name,
    s.Step_Index + 1 AS step_no,
    s.Step_UUID AS step_uuid,
    s.Step_UUID AS marks,
    regexp_extract(s.Comment_Text, '(?i)\bfix[\s\-_]?(it|me)\b', 0) AS marker,
    s.Comment_Text AS comment,
    'FIXME marker in a script comment' AS message,
    row_number() OVER (ORDER BY s.File_Name, s.Script_Name, s.Step_Index) AS row_key
FROM StepsForScripts s
WHERE s.Step_ID = 89   -- '# (Comment)' — Step_ID is locale-independent
  AND s.Comment_Text IS NOT NULL
  AND regexp_matches(s.Comment_Text, '(?i)\bfix[\s\-_]?(it|me)\b')
  AND (getvariable('file') IS NULL OR s.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR s.Script_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY row_key
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
