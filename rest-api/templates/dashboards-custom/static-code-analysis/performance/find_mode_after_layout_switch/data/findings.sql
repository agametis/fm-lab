-- Go to Layout immediately followed by Enter Find Mode. The Claris-documented
-- cost: switching the layout first materializes the browse context of the
-- target table — the client downloads its first records only for the find that
-- follows to throw them away. Reversing the two steps avoids the download.
--
-- The pair is detected on the sequence of ENABLED, NON-COMMENT steps: comments
-- and blank lines both serialize as step 89 and would otherwise hide real
-- adjacencies. Adjacency is the deliberately sharp condition — with other
-- steps in between, the browse context may be used on purpose.
--
-- Step ids, never step names (names are localized): 6 = Go to Layout,
-- 22 = Enter Find Mode, 89 = comment/blank line. The pause option of Enter
-- Find Mode is read via its numeric option id (16777216) — the type attribute
-- of the Boolean parameter follows the export language and must not be matched.
--
-- Deep link: `step` anchors on the Go to Layout step, `marks` highlights both
-- steps of the pair.
WITH enabled AS (
    SELECT File_Name, Script_UUID, Script_Name, Step_Index, Step_ID, Step_UUID, Step_XML,
           row_number() OVER (PARTITION BY File_Name, Script_UUID ORDER BY Step_Index) AS seq
    FROM StepsForScripts
    WHERE Is_Enabled AND Step_ID <> 89
)
SELECT
    'find-mode-after-layout-switch' AS rule_id,
    'warning' AS severity,
    g.File_Name AS file_name,
    g.Script_UUID AS nav_uuid,
    g.Script_Name AS script_name,
    g.Step_Index + 1 AS goto_step,
    e.Step_Index + 1 AS find_mode_step,
    CASE WHEN regexp_matches(e.Step_XML, 'id="16777216" value="True"')
         THEN 'pause' ELSE 'no pause' END AS pause_option,
    g.Step_UUID AS step_uuid,
    g.Step_UUID || ',' || e.Step_UUID AS marks,
    'Go to Layout (step ' || (g.Step_Index + 1) || ') is immediately followed by Enter Find Mode (step '
      || (e.Step_Index + 1) || ') — swap the two steps so the target layout''s records are never downloaded' AS message,
    row_number() OVER (ORDER BY g.File_Name, g.Script_Name, g.Step_Index) AS row_key
FROM enabled g
JOIN enabled e
  ON g.File_Name = e.File_Name AND g.Script_UUID = e.Script_UUID AND e.seq = g.seq + 1
WHERE g.Step_ID = 6 AND e.Step_ID = 22
  AND (getvariable('file') IS NULL OR g.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR g.Script_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY g.File_Name, g.Script_Name, g.Step_Index
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
