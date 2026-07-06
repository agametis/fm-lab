-- @template_type: report
-- @description: Healthcheck counts — Variables group. The global/superglobal tally is a
--   direct VariablesCatalog count (drills into the list_global_variables query);
--   global_variable_single_script is DUPLICATED (v1.0 light) from its SCA rule bundle.

SELECT key, label, value, severity, action, action_args FROM (
  SELECT 1 AS ord, 'global_variables' AS key, 'Global / superglobal variables' AS label,
         (SELECT COUNT(*) FROM VariablesCatalog v
            WHERE v.Variable_Scope IN ('global', 'superglobal')
              AND (getvariable('file') IS NULL OR list_contains(v.Files, getvariable('file')))
         ) AS value,
         'info' AS severity, 'runQuery' AS action, 'query=list_global_variables' AS action_args
  UNION ALL
  SELECT 2, 'global_variable_single_script', 'Global variable used in one script only',
         (SELECT COUNT(*) FROM (
            SELECT 1 FROM VariablesCatalog v
            WHERE v.Variable_Scope = 'global' AND v.Script_Count = 1 AND v.Set_Count > 0
              AND (getvariable('file') IS NULL OR list_contains(v.Files, getvariable('file')))
         ) t),
         'info', 'openDashboard', 'id=global_variable_single_script'
) WHERE (getvariable('severity') IS NULL OR getvariable('severity') = '' OR severity = getvariable('severity'))
  ORDER BY ord;
