-- @template_type: report
-- @title: Script network round-trip ranking
-- @description: Scripts ranked by an ESTIMATE of the network interactions their loops generate on a remote client. Counted per script are the remote-heavy steps inside loop bodies — Go to Related Record, Perform Find, Commit, Sort, Set Field on a related (::) target, and Go to Layout — each weighted by its loop nesting depth. A static estimate, not a measurement: iteration counts are unknown at analysis time, so the number orders scripts by risk rather than predicting traffic. Scripts also called via Perform Script on Server are flagged — their loops run next to the data and cost no WAN round trips in that call path. Pattern source: FileMaker DevCon 2019, "Doing it Right: Fast Solutions Developed WAN First" (Chris Irvine).
-- @icon: gauge
-- @category: Scripts
-- @display: table
-- @params: file (optional), limit (optional, default 500), min_ops (optional, default 1)
-- @click_action: openObject
-- @click_args: uuid={{_nav_uuid}}&type=Script&file={{file_name}}
-- @output_format: file_name, script_name, roundtrip_ops, depth_weight, gtrr, find, commit, sort, related_set, goto_layout, called_via_psos, _message
-- @object_types: Script
-- @output_types: count, inventory-table
-- @scope: solution, file, object, object-list, cluster
-- @default_result: { "aggregate": "row_count", "type": "number", "name": "roundtrip_scripts", "meaning": "Scripts with remote-heavy steps inside loops (inventory — an estimate, not a defect count)" }
-- @author: fm-lab core
-- @version: 1.0
-- @tags: scripts, performance, wan, loops, community-patterns
--
-- Loop context comes from v_script_block_tree (loop_depth_before > 0 = the
-- step sits inside at least one loop). Step ids, never names: 74 GTRR,
-- 28 Perform Find, 75 Commit, 39/154 Sort, 76/147 Set Field, 6 Go to Layout.
-- A Set Field only counts as remote when its calculation reads a related
-- field ('::' — string literals containing '::' are a documented FP class).
--
-- depth_weight sums the loop nesting depth over all counted steps: a commit
-- in a double loop weighs 2. called_via_psos matches the script's UUID in
-- ScriptReference attributes of enabled PSoS steps (164/210); same-file
-- references are reliable, cross-file UUIDs can be stale — context, not a
-- filter.
WITH loop_steps AS (
    SELECT b.File_Name, b.Script_UUID, any_value(b.Script_Name) AS script_name,
           CAST(count(*) FILTER (WHERE b.Step_ID = 74) AS INTEGER)  AS gtrr,
           CAST(count(*) FILTER (WHERE b.Step_ID = 28) AS INTEGER)  AS find,
           CAST(count(*) FILTER (WHERE b.Step_ID = 75) AS INTEGER)  AS commit,
           CAST(count(*) FILTER (WHERE b.Step_ID IN (39, 154)) AS INTEGER) AS sort,
           CAST(count(*) FILTER (WHERE b.Step_ID IN (76, 147)
                                 AND s.Calculation_Text LIKE '%::%') AS INTEGER) AS related_set,
           CAST(count(*) FILTER (WHERE b.Step_ID = 6) AS INTEGER)   AS goto_layout,
           CAST(COALESCE(sum(b.loop_depth_before) FILTER (
                    WHERE b.Step_ID IN (74, 28, 75, 39, 154, 6)
                       OR (b.Step_ID IN (76, 147) AND s.Calculation_Text LIKE '%::%')
                ), 0) AS INTEGER) AS depth_weight
    FROM v_script_block_tree b
    JOIN StepsForScripts s USING (File_Name, Script_UUID, Step_Index)
    WHERE b.Is_Enabled AND b.loop_depth_before > 0
    GROUP BY 1, 2
),
psos_targets AS (
    SELECT DISTINCT unnest(regexp_extract_all(Step_XML, 'UUID="([0-9A-Fa-f-]+)"', 1)) AS target_uuid
    FROM StepsForScripts
    WHERE Step_ID IN (164, 210) AND Is_Enabled
)
SELECT
    l.File_Name AS file_name,
    l.Script_UUID AS _nav_uuid,
    l.script_name,
    l.gtrr + l.find + l.commit + l.sort + l.related_set + l.goto_layout AS roundtrip_ops,
    l.depth_weight,
    l.gtrr, l.find, l.commit, l.sort, l.related_set, l.goto_layout,
    CASE WHEN p.target_uuid IS NOT NULL THEN 'yes' ELSE '' END AS called_via_psos,
    'Estimated ' || (l.gtrr + l.find + l.commit + l.sort + l.related_set + l.goto_layout)
      || ' remote-heavy step(s) inside loops (depth weight ' || l.depth_weight || ')'
      || CASE WHEN p.target_uuid IS NOT NULL THEN ' — also called via PSoS' ELSE '' END AS _message
FROM loop_steps l
LEFT JOIN psos_targets p ON p.target_uuid = l.Script_UUID
WHERE l.gtrr + l.find + l.commit + l.sort + l.related_set + l.goto_layout
      >= CAST(COALESCE(getvariable('min_ops'), '1') AS INTEGER)
  AND (getvariable('file') IS NULL OR l.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR l.Script_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY depth_weight DESC, roundtrip_ops DESC, l.File_Name, l.script_name
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
