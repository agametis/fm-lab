-- @template_type: report
-- @description: Healthcheck counts — Tables & occurrences group. Detection logic
--   DUPLICATED (v1.0 light) from the static-code-analysis rule bundles.

SELECT key, label, value, severity, action, action_args FROM (
  SELECT 1 AS ord, 'unused_base_table' AS key, 'Unused base tables' AS label,
         (SELECT COUNT(*) FROM (
            SELECT 1 FROM ObjectCatalog oc WHERE oc.Object_Type = 'BaseTable'
              AND NOT EXISTS (SELECT 1 FROM ObjectLinks ol WHERE ol.Target_UUID = oc.Object_UUID AND ol.Link_Role IN ('base_table'))
              AND (getvariable('file') IS NULL OR oc.File_Name = getvariable('file'))
         ) t) AS value,
         'warn' AS severity, 'openDashboard' AS action, 'id=unused_base_table' AS action_args
  UNION ALL
  SELECT 2, 'unused_table_occurrence', 'Unused table occurrences',
         (SELECT COUNT(*) FROM (
            SELECT 1 FROM ObjectCatalog oc WHERE oc.Object_Type = 'TableOccurrence'
              AND NOT EXISTS (SELECT 1 FROM ObjectLinks ol WHERE ol.Target_UUID = oc.Object_UUID AND ol.Link_Role IN ('context_table','portal_context','navigates_to_to','left_table','right_table','lookup_relationship'))
              AND (getvariable('file') IS NULL OR oc.File_Name = getvariable('file'))
         ) t),
         'warn', 'openDashboard', 'id=unused_table_occurrence'
  UNION ALL
  SELECT 3, 'table_many_fields', 'Tables with many fields',
         (SELECT COUNT(*) FROM (
            SELECT 1 FROM FieldsForTables f
            WHERE (getvariable('file') IS NULL OR f.File_Name = getvariable('file'))
            GROUP BY f.Table_UUID HAVING COUNT(*) >= CAST(COALESCE(getvariable('min_fields'), '100') AS INTEGER)
         ) t),
         'info', 'openDashboard', 'id=table_many_fields'
) WHERE (getvariable('severity') IS NULL OR getvariable('severity') = '' OR severity = getvariable('severity'))
  ORDER BY ord;
