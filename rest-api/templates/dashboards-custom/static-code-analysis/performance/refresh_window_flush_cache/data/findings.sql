-- Enabled Refresh Window steps that flush the join cache (option id 256) or
-- the external-data cache (option id 512). Claris documents the cost: the
-- flush discards cached related records, so every subsequent display of
-- related data re-fetches from the server.
--
-- The options are matched by their NUMERIC ids. The type attribute of the
-- Boolean parameter is localized with the export language (German files carry
-- "Join-Ergebnisse im Cache löschen") — a text match silently loses those
-- findings. Measured on the calibration corpus: 88 id-based vs. 81 with an
-- English text match.
--
-- Loop context via v_script_block_tree: a flush inside a loop repeats the
-- cache invalidation per iteration and weighs heavier.
WITH flushes AS (
    SELECT File_Name, Script_UUID, Script_Name, Step_Index, Step_UUID,
           regexp_matches(Step_XML, 'id="256" value="True"')  AS flush_join,
           regexp_matches(Step_XML, 'id="512" value="True"')  AS flush_external
    FROM StepsForScripts
    WHERE Step_ID = 80 AND Is_Enabled
      AND (regexp_matches(Step_XML, 'id="256" value="True"')
           OR regexp_matches(Step_XML, 'id="512" value="True"'))
)
SELECT
    'refresh-window-flush-cache' AS rule_id,
    'warning' AS severity,
    f.File_Name AS file_name,
    f.Script_UUID AS nav_uuid,
    f.Script_Name AS script_name,
    f.Step_Index + 1 AS step_nr,
    CASE WHEN f.flush_join AND f.flush_external THEN 'join+external'
         WHEN f.flush_join THEN 'join' ELSE 'external' END AS flush_class,
    CAST(COALESCE(b.loop_depth_before, 0) AS INTEGER) AS loop_depth,
    f.Step_UUID AS step_uuid,
    'Refresh Window at step ' || (f.Step_Index + 1) || ' flushes '
      || CASE WHEN f.flush_join AND f.flush_external THEN 'cached join results and external data'
              WHEN f.flush_join THEN 'cached join results' ELSE 'cached external data' END
      || CASE WHEN COALESCE(b.loop_depth_before, 0) > 0 THEN ' inside a loop' ELSE '' END AS message,
    row_number() OVER (ORDER BY f.File_Name, f.Script_Name, f.Step_Index) AS row_key
FROM flushes f
LEFT JOIN v_script_block_tree b
  ON b.File_Name = f.File_Name AND b.Script_UUID = f.Script_UUID AND b.Step_Index = f.Step_Index
WHERE (getvariable('flush_kind') IS NULL
       OR (getvariable('flush_kind') = 'join' AND f.flush_join)
       OR (getvariable('flush_kind') = 'external' AND f.flush_external))
  AND (getvariable('file') IS NULL OR f.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR f.Script_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY f.File_Name, f.Script_Name, f.Step_Index
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
