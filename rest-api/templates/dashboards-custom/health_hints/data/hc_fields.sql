-- @template_type: report
-- @description: Healthcheck counts — Fields group. Detection logic DUPLICATED (v1.0
--   light) from the static-code-analysis rule bundles; tile count = drill-down count.

SELECT key, label, value, severity, action, action_args FROM (
  SELECT 1 AS ord, 'unused_field' AS key, 'Unused fields' AS label,
         (SELECT COUNT(*) FROM (
            SELECT 1 FROM ObjectCatalog oc
            WHERE oc.Object_Type = 'Field'
              AND NOT EXISTS (SELECT 1 FROM ObjectLinks ol WHERE ol.Target_UUID = oc.Object_UUID
                  AND ol.Link_Role IN ('lookup_source','finds_in_field','inputs_to_field','imports_to_field','right_field','sorts_by_field','sets_field','left_field','sort_field','reads_field','displays_field','exports_from_field','navigates_to_field'))
              AND (getvariable('file') IS NULL OR oc.File_Name = getvariable('file'))
         ) t) AS value,
         'warn' AS severity, 'openDashboard' AS action, 'id=unused_field' AS action_args
  UNION ALL
  SELECT 2, 'calculated_field_without_comment', 'Calculated fields without comment',
         (SELECT COUNT(*) FROM (
            WITH calc AS (
                SELECT (COALESCE(f.Field_Comment, '') <> ''
                     OR (f.DDR_Hash IS NOT NULL AND EXISTS (SELECT 1 FROM DDR_Calculations d WHERE d.Calc_Hash = f.DDR_Hash AND d.Chunk_Type = 'Comment'))) AS has_comment
                FROM FieldsForTables f
                WHERE f.Field_Type = 'Calculated' AND (getvariable('file') IS NULL OR f.File_Name = getvariable('file'))
            )
            SELECT 1 FROM calc WHERE has_comment = (COALESCE(getvariable('comment'), 'without') = 'with')
         ) t),
         'info', 'openDashboard', 'id=calculated_field_without_comment'
  UNION ALL
  SELECT 3, 'global_stored_field', 'Global storage fields',
         (SELECT COUNT(*) FROM (
            SELECT 1 FROM FieldsForTables f
            WHERE f.Is_Global = 'True' AND (getvariable('file') IS NULL OR f.File_Name = getvariable('file'))
         ) t),
         'info', 'openDashboard', 'id=global_stored_field'
  UNION ALL
  SELECT 4, 'autoenter_overwrites_existing', 'Auto-enter overwrites existing value',
         (SELECT COUNT(*) FROM (
            SELECT 1 FROM FieldsForTables f
            WHERE f.AE_Calc_OverwriteExisting = 'True' AND (getvariable('file') IS NULL OR f.File_Name = getvariable('file'))
         ) t),
         'warn', 'openDashboard', 'id=autoenter_overwrites_existing'
) WHERE (getvariable('severity') IS NULL OR getvariable('severity') = '' OR severity = getvariable('severity'))
  ORDER BY ord;
