-- @template_type: report
-- @description: Healthcheck counts — Custom functions group. Detection logic DUPLICATED
--   (v1.0 light) from the static-code-analysis rule bundles; tile count = drill-down count.

SELECT key, label, value, severity, action, action_args FROM (
  SELECT 1 AS ord, 'unused_custom_function' AS key, 'Unused custom functions' AS label,
         (SELECT COUNT(*) FROM (
            SELECT 1 FROM ObjectCatalog oc WHERE oc.Object_Type = 'CustomFunction'
              AND NOT EXISTS (SELECT 1 FROM ObjectLinks ol WHERE ol.Target_UUID = oc.Object_UUID AND ol.Link_Role IN ('calls_customfunction'))
              AND (getvariable('file') IS NULL OR oc.File_Name = getvariable('file'))
         ) t) AS value,
         'warn' AS severity, 'openDashboard' AS action, 'id=unused_custom_function' AS action_args
  UNION ALL
  SELECT 2, 'custom_function_without_comment', 'Custom functions without comment',
         (SELECT COUNT(*) FROM (
            WITH cf AS (
                SELECT EXISTS (SELECT 1 FROM DDR_Calculations d WHERE d.Calc_Hash = c.DDR_Hash AND d.Chunk_Type = 'Comment') AS has_comment
                FROM CustomFunctionsCatalog c
                WHERE c.DDR_Hash IS NOT NULL AND (getvariable('file') IS NULL OR c.File_Name = getvariable('file'))
            )
            SELECT 1 FROM cf WHERE has_comment = (COALESCE(getvariable('comment'), 'without') = 'with')
         ) t),
         'info', 'openDashboard', 'id=custom_function_without_comment'
) WHERE (getvariable('severity') IS NULL OR getvariable('severity') = '' OR severity = getvariable('severity'))
  ORDER BY ord;
