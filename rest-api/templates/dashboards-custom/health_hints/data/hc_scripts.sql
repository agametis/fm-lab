-- @template_type: report
-- @description: Healthcheck counts — Scripts group. Detection logic DUPLICATED (v1.0
--   light) from the static-code-analysis rule bundles; tile count = drill-down count.
--   loop_without_exit_loop_if / unbalanced_if_block read the analysis view v_script_block_tree.

SELECT key, label, value, severity, action, action_args FROM (
  SELECT 1 AS ord, 'unused_script' AS key, 'Unused scripts' AS label,
         (SELECT COUNT(*) FROM (
            SELECT 1 FROM ObjectCatalog oc WHERE oc.Object_Type = 'Script'
              AND NOT EXISTS (SELECT 1 FROM ObjectLinks ol WHERE ol.Target_UUID = oc.Object_UUID AND ol.Link_Role IN ('calls_script','triggers_script','trigger_script'))
              AND (getvariable('file') IS NULL OR oc.File_Name = getvariable('file'))
         ) t) AS value,
         'warn' AS severity, 'openDashboard' AS action, 'id=unused_script' AS action_args
  UNION ALL
  SELECT 2, 'empty_script', 'Empty scripts',
         (SELECT COUNT(*) FROM (
            SELECT 1 FROM ScriptCatalog sc
            WHERE (sc.Folder_Type IS NULL OR sc.Folder_Type = 'False') AND NOT sc.Is_Separator
              AND NOT EXISTS (SELECT 1 FROM StepsForScripts s WHERE s.Script_UUID = sc.Script_UUID)
              AND (getvariable('file') IS NULL OR sc.File_Name = getvariable('file'))
         ) t),
         'info', 'openDashboard', 'id=empty_script'
  UNION ALL
  SELECT 3, 'undocumented_script', 'Undocumented scripts',
         (SELECT COUNT(*) FROM (
            WITH s AS (
                SELECT File_Name, Script_ID, COUNT(*) AS step_count,
                    COUNT(*) FILTER (WHERE Step_ID = 89 AND (Step_XML LIKE '%<Comment value="%' OR Step_XML LIKE '%<Comment>%')) AS comment_steps
                FROM StepsForScripts
                WHERE (getvariable('file') IS NULL OR File_Name = getvariable('file'))
                GROUP BY File_Name, Script_ID HAVING COUNT(*) >= 10
            )
            SELECT 1 FROM s WHERE (comment_steps > 0) = (COALESCE(getvariable('comment'), 'without') = 'with')
         ) t),
         'info', 'openDashboard', 'id=undocumented_script'
  UNION ALL
  SELECT 4, 'loop_without_exit_loop_if', 'Loop without Exit Loop If',
         (SELECT COUNT(*) FROM (
            WITH auto_exit AS (
                SELECT DISTINCT t.File_Name, t.Script_ID
                FROM v_script_block_tree t
                JOIN StepsForScripts s ON s.Step_UUID = t.Step_UUID
                WHERE t.Step_ID IN (16, 99) AND t.loop_depth_before >= 1
                  AND regexp_matches(s.Step_XML, 'value="[34]">\s*<Boolean[^>]*value="True"')
            ),
            loops AS (
                SELECT File_Name, Script_ID,
                    COUNT(*) FILTER (WHERE Step_ID = 71) AS loop_count, COUNT(*) FILTER (WHERE Step_ID = 72) AS exit_if_count
                FROM v_script_block_tree WHERE (getvariable('file') IS NULL OR File_Name = getvariable('file'))
                GROUP BY File_Name, Script_ID
            )
            SELECT 1 FROM loops l LEFT JOIN auto_exit a ON a.File_Name = l.File_Name AND a.Script_ID = l.Script_ID
            WHERE l.loop_count > 0 AND l.exit_if_count = 0 AND a.Script_ID IS NULL
         ) t),
         'error', 'openDashboard', 'id=loop_without_exit_loop_if'
  UNION ALL
  SELECT 5, 'unbalanced_if_block', 'Unbalanced If / End If',
         (SELECT COUNT(*) FROM (
            WITH bal AS (
                SELECT File_Name, Script_ID,
                    CAST(SUM(if_delta) AS INTEGER) AS net_if_balance, CAST(MIN(if_running_depth) AS INTEGER) AS worst_running_depth
                FROM v_script_block_tree GROUP BY File_Name, Script_ID
            )
            SELECT 1 FROM bal WHERE (net_if_balance <> 0 OR worst_running_depth < 0) AND (getvariable('file') IS NULL OR File_Name = getvariable('file'))
         ) t),
         'warn', 'openDashboard', 'id=unbalanced_if_block'
) WHERE (getvariable('severity') IS NULL OR getvariable('severity') = '' OR severity = getvariable('severity'))
  ORDER BY ord;
