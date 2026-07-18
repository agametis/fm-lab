-- @template_type: report
-- @description: Healthcheck KPI header — one row with the number of checks that HAVE
--   findings (>0) per severity bucket (error / warn / info) plus the total. Feeds the
--   clickable KPI strip that drives the dashboard-wide `severity` filter. Detection
--   logic mirrors the hc_* group datasets (v1.0 light duplication); EXISTS
--   short-circuits so this stays cheap. Honours the file filter; ignores `severity`
--   (the KPIs must always show every bucket).

WITH checks AS (
  -- ── Security (all warn) ──────────────────────────────────────────────
  SELECT 'warn' AS sev, EXISTS(
    SELECT 1 FROM ObjectLinks ol
    JOIN ObjectCatalog p ON p.Object_UUID = ol.Target_UUID AND p.File_Name IS NOT DISTINCT FROM ol.Target_File AND p.Object_Name = '[Full Access]'
    JOIN ObjectCatalog acc ON acc.Object_UUID = ol.Source_UUID AND acc.File_Name = ol.Source_File AND acc.Object_Type = 'Account'
    WHERE ol.Link_Role = 'privilege_set'
      AND (getvariable('file') IS NULL OR acc.File_Name = getvariable('file'))) AS hit
  UNION ALL SELECT 'warn', EXISTS(
    SELECT 1 FROM FieldsForTables f
    WHERE regexp_matches(LOWER(f.Field_Name), '(password|passwort|kennwort|\bpin\b)')
      AND f.Field_Type = 'Normal' AND COALESCE(f.Is_Global, '') <> 'True'
      AND (getvariable('file') IS NULL OR f.File_Name = getvariable('file')))
  UNION ALL SELECT 'warn', EXISTS(
    WITH pw AS (
      SELECT f.Field_UUID, f.File_Name FROM FieldsForTables f
      WHERE regexp_matches(LOWER(f.Field_Name), '(password|passwort|kennwort|\bpin\b)')
        AND f.Field_Type = 'Normal' AND COALESCE(f.Is_Global, '') <> 'True')
    SELECT 1 FROM ObjectLinks ol
    JOIN pw ON pw.Field_UUID = ol.Target_UUID AND pw.File_Name IS NOT DISTINCT FROM ol.Target_File
    JOIN LayoutObjects lo ON lo.Object_UUID = ol.Source_UUID AND lo.File_Name = ol.Source_File
    JOIN Layouts l ON l.L_ID = lo.Layout_ID AND l.File_Name = lo.File_Name
    WHERE ol.Link_Role = 'displays_field' AND ol.Source_Type = 'LayoutObject'
      AND lo.Object_XML NOT LIKE '%<Display Style="7"%'
      AND (getvariable('file') IS NULL OR lo.File_Name = getvariable('file')))
  UNION ALL SELECT 'warn', EXISTS(
    SELECT 1 FROM VariablesCatalog v
    WHERE v.Variable_Scope IN ('global', 'superglobal')
      AND regexp_matches(LOWER(v.Display_Name), '(password|passwort|secret|token|apikey|api_key)')
      AND (getvariable('file') IS NULL OR list_contains(v.Files, getvariable('file'))))
  UNION ALL SELECT 'warn', EXISTS(
    SELECT 1 FROM StepsForScripts s
    JOIN DDR_ScriptSteps d ON s.Step_UUID = d.Step_UUID AND d.File_Name = s.File_Name
    WHERE d.Step_Text IS NOT NULL
      AND regexp_matches(LOWER(d.Step_Text), '(password|passwort|pswd|kennwort|pwd|secret|apikey|api_key|api-key|credential|passphrase|token|bearer|mdp|senha|contrase|authorization|client_secret|clientsecret|access_token|accesstoken|refresh_token|refreshtoken|private_key|privatekey|basic_auth|hmac|signingkey|userpass|login_password|signature)')
      AND (getvariable('file') IS NULL OR s.File_Name = getvariable('file')))
  -- ── Fields ───────────────────────────────────────────────────────────
  UNION ALL SELECT 'warn', EXISTS(
    SELECT 1 FROM ObjectCatalog oc WHERE oc.Object_Type = 'Field'
      AND NOT EXISTS (SELECT 1 FROM ObjectLinks ol WHERE ol.Target_UUID = oc.Object_UUID AND ol.Target_File IS NOT DISTINCT FROM oc.File_Name
          AND ol.Link_Role IN ('lookup_source','finds_in_field','inputs_to_field','imports_to_field','right_field','sorts_by_field','sets_field','left_field','sort_field','reads_field','displays_field','exports_from_field','navigates_to_field'))
      AND (getvariable('file') IS NULL OR oc.File_Name = getvariable('file')))
  UNION ALL SELECT 'info', EXISTS(
    WITH calc AS (
      SELECT (COALESCE(f.Field_Comment, '') <> ''
           OR (f.DDR_Hash IS NOT NULL AND EXISTS (SELECT 1 FROM DDR_Calculations d WHERE d.Calc_Hash = f.DDR_Hash AND d.Chunk_Type = 'Comment'))) AS has_comment
      FROM FieldsForTables f
      WHERE f.Field_Type = 'Calculated' AND (getvariable('file') IS NULL OR f.File_Name = getvariable('file')))
    SELECT 1 FROM calc WHERE has_comment = (COALESCE(getvariable('comment'), 'without') = 'with'))
  UNION ALL SELECT 'info', EXISTS(
    SELECT 1 FROM FieldsForTables f
    WHERE f.Is_Global = 'True' AND (getvariable('file') IS NULL OR f.File_Name = getvariable('file')))
  UNION ALL SELECT 'warn', EXISTS(
    SELECT 1 FROM FieldsForTables f
    WHERE f.AE_Calc_OverwriteExisting = 'True' AND (getvariable('file') IS NULL OR f.File_Name = getvariable('file')))
  -- ── Scripts ──────────────────────────────────────────────────────────
  UNION ALL SELECT 'warn', EXISTS(
    SELECT 1 FROM ObjectCatalog oc WHERE oc.Object_Type = 'Script'
      AND NOT EXISTS (SELECT 1 FROM ObjectLinks ol WHERE ol.Target_UUID = oc.Object_UUID AND ol.Target_File IS NOT DISTINCT FROM oc.File_Name AND ol.Link_Role IN ('calls_script','triggers_script','trigger_script'))
      AND (getvariable('file') IS NULL OR oc.File_Name = getvariable('file')))
  UNION ALL SELECT 'info', EXISTS(
    SELECT 1 FROM ScriptCatalog sc
    WHERE (sc.Folder_Type IS NULL OR sc.Folder_Type = 'False') AND NOT sc.Is_Separator
      AND NOT EXISTS (SELECT 1 FROM StepsForScripts s WHERE s.Script_UUID = sc.Script_UUID AND s.File_Name = sc.File_Name)
      AND (getvariable('file') IS NULL OR sc.File_Name = getvariable('file')))
  UNION ALL SELECT 'info', EXISTS(
    WITH s AS (
      SELECT File_Name, Script_ID, COUNT(*) AS step_count,
        COUNT(*) FILTER (WHERE Step_ID = 89 AND (Step_XML LIKE '%<Comment value="%' OR Step_XML LIKE '%<Comment>%')) AS comment_steps
      FROM StepsForScripts
      WHERE (getvariable('file') IS NULL OR File_Name = getvariable('file'))
      GROUP BY File_Name, Script_ID HAVING COUNT(*) >= 10)
    SELECT 1 FROM s WHERE (comment_steps > 0) = (COALESCE(getvariable('comment'), 'without') = 'with'))
  UNION ALL SELECT 'error', EXISTS(
    WITH auto_exit AS (
      SELECT DISTINCT t.File_Name, t.Script_ID
      FROM v_script_block_tree t
      JOIN StepsForScripts s ON s.Step_UUID = t.Step_UUID AND s.File_Name = t.File_Name
      WHERE t.Step_ID IN (16, 99) AND t.loop_depth_before >= 1
        AND regexp_matches(s.Step_XML, 'value="[34]">\s*<Boolean[^>]*value="True"')),
    loops AS (
      SELECT File_Name, Script_ID,
        COUNT(*) FILTER (WHERE Step_ID = 71) AS loop_count, COUNT(*) FILTER (WHERE Step_ID = 72) AS exit_if_count
      FROM v_script_block_tree WHERE (getvariable('file') IS NULL OR File_Name = getvariable('file'))
      GROUP BY File_Name, Script_ID)
    SELECT 1 FROM loops l LEFT JOIN auto_exit a ON a.File_Name = l.File_Name AND a.Script_ID = l.Script_ID
    WHERE l.loop_count > 0 AND l.exit_if_count = 0 AND a.Script_ID IS NULL)
  UNION ALL SELECT 'warn', EXISTS(
    WITH bal AS (
      SELECT File_Name, Script_ID,
        CAST(SUM(if_delta) AS INTEGER) AS net_if_balance, CAST(MIN(if_running_depth) AS INTEGER) AS worst_running_depth
      FROM v_script_block_tree GROUP BY File_Name, Script_ID)
    SELECT 1 FROM bal WHERE (net_if_balance <> 0 OR worst_running_depth < 0) AND (getvariable('file') IS NULL OR File_Name = getvariable('file')))
  -- ── Relationships ────────────────────────────────────────────────────
  UNION ALL SELECT 'warn', EXISTS(
    SELECT 1 FROM (SELECT DISTINCT File_Name, Rel_ID FROM RelationshipCatalog WHERE Left_Delete OR Right_Delete) r
    WHERE (getvariable('file') IS NULL OR r.File_Name = getvariable('file')))
  UNION ALL SELECT 'warn', EXISTS(
    SELECT 1 FROM (SELECT DISTINCT File_Name, Rel_ID FROM RelationshipCatalog WHERE Operator = 'CartesianProduct') r
    WHERE (getvariable('file') IS NULL OR r.File_Name = getvariable('file')))
  UNION ALL SELECT 'info', EXISTS(
    SELECT 1 FROM (SELECT DISTINCT File_Name, Rel_ID FROM RelationshipCatalog WHERE Left_Sort_Enabled = 'True' OR Right_Sort_Enabled = 'True') r
    WHERE (getvariable('file') IS NULL OR r.File_Name = getvariable('file')))
  -- ── Tables & occurrences ─────────────────────────────────────────────
  UNION ALL SELECT 'warn', EXISTS(
    SELECT 1 FROM ObjectCatalog oc WHERE oc.Object_Type = 'BaseTable'
      AND NOT EXISTS (SELECT 1 FROM ObjectLinks ol WHERE ol.Target_UUID = oc.Object_UUID AND ol.Target_File IS NOT DISTINCT FROM oc.File_Name AND ol.Link_Role IN ('base_table'))
      AND (getvariable('file') IS NULL OR oc.File_Name = getvariable('file')))
  UNION ALL SELECT 'warn', EXISTS(
    SELECT 1 FROM ObjectCatalog oc WHERE oc.Object_Type = 'TableOccurrence'
      AND NOT EXISTS (SELECT 1 FROM ObjectLinks ol WHERE ol.Target_UUID = oc.Object_UUID AND ol.Target_File IS NOT DISTINCT FROM oc.File_Name AND ol.Link_Role IN ('context_table','portal_context','navigates_to_to','left_table','right_table','lookup_relationship'))
      AND (getvariable('file') IS NULL OR oc.File_Name = getvariable('file')))
  UNION ALL SELECT 'info', EXISTS(
    SELECT 1 FROM FieldsForTables f
    WHERE (getvariable('file') IS NULL OR f.File_Name = getvariable('file'))
    GROUP BY f.File_Name, f.Table_UUID HAVING COUNT(*) >= CAST(COALESCE(getvariable('min_fields'), '100') AS INTEGER))
  -- ── Layouts ──────────────────────────────────────────────────────────
  UNION ALL SELECT 'warn', EXISTS(
    SELECT 1 FROM ObjectCatalog oc WHERE oc.Object_Type = 'Layout'
      AND NOT EXISTS (SELECT 1 FROM ObjectLinks ol WHERE ol.Target_UUID = oc.Object_UUID AND ol.Target_File IS NOT DISTINCT FROM oc.File_Name AND ol.Link_Role IN ('navigates_to_layout','default_layout'))
      AND (getvariable('file') IS NULL OR oc.File_Name = getvariable('file')))
  UNION ALL SELECT 'info', EXISTS(
    SELECT 1 FROM Layouts l
    WHERE NOT EXISTS (SELECT 1 FROM LayoutObjects o WHERE o.Layout_ID = l.L_ID AND o.File_Name = l.File_Name)
      AND (l.Folder_Type IS NULL OR l.Folder_Type = 'False') AND NOT l.Is_Separator
      AND (getvariable('file') IS NULL OR l.File_Name = getvariable('file')))
  UNION ALL SELECT 'warn', EXISTS(
    SELECT 1 FROM Layouts l
    WHERE COALESCE(l.L_TO_Name, '') = ''
      AND (l.Folder_Type IS NULL OR l.Folder_Type = 'False') AND NOT l.Is_Separator
      AND (getvariable('file') IS NULL OR l.File_Name = getvariable('file')))
  UNION ALL SELECT 'info', EXISTS(
    SELECT 1 FROM Layouts l
    WHERE NOT EXISTS (SELECT 1 FROM LayoutParts p WHERE p.Layout_ID = l.L_ID AND p.File_Name = l.File_Name AND p.Part_Type = 'Body')
      AND (l.Folder_Type IS NULL OR l.Folder_Type = 'False') AND NOT l.Is_Separator
      AND (getvariable('file') IS NULL OR l.File_Name = getvariable('file')))
  -- ── Variables ────────────────────────────────────────────────────────
  UNION ALL SELECT 'info', EXISTS(
    SELECT 1 FROM VariablesCatalog v
    WHERE v.Variable_Scope IN ('global', 'superglobal')
      AND (getvariable('file') IS NULL OR list_contains(v.Files, getvariable('file'))))
  UNION ALL SELECT 'info', EXISTS(
    SELECT 1 FROM VariablesCatalog v
    WHERE v.Variable_Scope = 'global' AND v.Script_Count = 1 AND v.Set_Count > 0
      AND (getvariable('file') IS NULL OR list_contains(v.Files, getvariable('file'))))
  -- ── Value lists ──────────────────────────────────────────────────────
  UNION ALL SELECT 'info', EXISTS(
    SELECT 1 FROM ObjectCatalog oc WHERE oc.Object_Type = 'ValueList'
      AND NOT EXISTS (SELECT 1 FROM ObjectLinks ol WHERE ol.Target_UUID = oc.Object_UUID AND ol.Target_File IS NOT DISTINCT FROM oc.File_Name AND ol.Link_Role IN ('uses_valuelist','sorts_by_valuelist','source_valuelist'))
      AND (getvariable('file') IS NULL OR oc.File_Name = getvariable('file')))
  UNION ALL SELECT 'info', EXISTS(
    SELECT 1 FROM (SELECT DISTINCT File_Name, VL_UUID FROM OptionsForValueLists WHERE Source_Type = 'Custom') vl
    WHERE (getvariable('file') IS NULL OR vl.File_Name = getvariable('file')))
  -- ── Custom functions ─────────────────────────────────────────────────
  UNION ALL SELECT 'warn', EXISTS(
    SELECT 1 FROM ObjectCatalog oc WHERE oc.Object_Type = 'CustomFunction'
      AND NOT EXISTS (SELECT 1 FROM ObjectLinks ol WHERE ol.Target_UUID = oc.Object_UUID AND ol.Target_File IS NOT DISTINCT FROM oc.File_Name AND ol.Link_Role IN ('calls_customfunction'))
      AND (getvariable('file') IS NULL OR oc.File_Name = getvariable('file')))
  UNION ALL SELECT 'info', EXISTS(
    WITH cf AS (
      SELECT EXISTS (SELECT 1 FROM DDR_Calculations d WHERE d.Calc_Hash = c.DDR_Hash AND d.Chunk_Type = 'Comment') AS has_comment
      FROM CustomFunctionsCatalog c
      WHERE c.DDR_Hash IS NOT NULL AND (getvariable('file') IS NULL OR c.File_Name = getvariable('file')))
    SELECT 1 FROM cf WHERE has_comment = (COALESCE(getvariable('comment'), 'without') = 'with'))
)
SELECT
  COUNT(*) FILTER (WHERE hit)                     AS total,
  COUNT(*) FILTER (WHERE sev = 'error' AND hit)   AS error,
  COUNT(*) FILTER (WHERE sev = 'warn'  AND hit)   AS warn,
  COUNT(*) FILTER (WHERE sev = 'info'  AND hit)   AS info
FROM checks;
