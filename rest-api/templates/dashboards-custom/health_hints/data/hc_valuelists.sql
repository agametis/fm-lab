-- @template_type: report
-- @description: Healthcheck counts — Value lists group. Detection logic DUPLICATED
--   (v1.0 light) from the static-code-analysis rule bundles.

SELECT key, label, value, severity, action, action_args FROM (
  SELECT 1 AS ord, 'unused_value_list' AS key, 'Unused value lists' AS label,
         (SELECT COUNT(*) FROM (
            SELECT 1 FROM ObjectCatalog oc WHERE oc.Object_Type = 'ValueList'
              AND NOT EXISTS (SELECT 1 FROM ObjectLinks ol WHERE ol.Target_UUID = oc.Object_UUID AND ol.Link_Role IN ('uses_valuelist','sorts_by_valuelist','source_valuelist'))
              AND (getvariable('file') IS NULL OR oc.File_Name = getvariable('file'))
         ) t) AS value,
         'info' AS severity, 'openDashboard' AS action, 'id=unused_value_list' AS action_args
  UNION ALL
  SELECT 2, 'value_list_hardcoded_values', 'Value lists with hard-coded values',
         (SELECT COUNT(*) FROM (
            SELECT 1 FROM (SELECT DISTINCT File_Name, VL_Name, VL_UUID FROM OptionsForValueLists WHERE Source_Type = 'Custom') vl
            WHERE (getvariable('file') IS NULL OR vl.File_Name = getvariable('file'))
         ) t),
         'info', 'openDashboard', 'id=value_list_hardcoded_values'
) WHERE (getvariable('severity') IS NULL OR getvariable('severity') = '' OR severity = getvariable('severity'))
  ORDER BY ord;
