-- @template_type: report
-- @description: Healthcheck counts — Relationships group. Detection logic DUPLICATED
--   (v1.0 light) from the static-code-analysis rule bundles; tile count = drill-down count.

SELECT key, label, value, severity, action, action_args FROM (
  SELECT 1 AS ord, 'cascade_delete_relationship' AS key, 'Cascading delete relationships' AS label,
         (SELECT COUNT(*) FROM (
            SELECT 1 FROM (SELECT DISTINCT File_Name, Rel_ID, Left_TO_Name, Right_TO_Name, Left_Delete, Right_Delete FROM RelationshipCatalog WHERE Left_Delete OR Right_Delete) r
            WHERE (getvariable('file') IS NULL OR r.File_Name = getvariable('file'))
         ) t) AS value,
         'warn' AS severity, 'openDashboard' AS action, 'id=cascade_delete_relationship' AS action_args
  UNION ALL
  SELECT 2, 'cross_product_relationship', 'Cartesian (×) relationships',
         (SELECT COUNT(*) FROM (
            SELECT 1 FROM (SELECT DISTINCT File_Name, Rel_ID, Left_TO_Name, Right_TO_Name FROM RelationshipCatalog WHERE Operator = 'CartesianProduct') r
            WHERE (getvariable('file') IS NULL OR r.File_Name = getvariable('file'))
         ) t),
         'warn', 'openDashboard', 'id=cross_product_relationship'
  UNION ALL
  SELECT 3, 'relationship_with_sort', 'Relationships with sorted records',
         (SELECT COUNT(*) FROM (
            SELECT 1 FROM (SELECT DISTINCT File_Name, Rel_ID, Left_TO_Name, Right_TO_Name, Left_Sort_Enabled, Right_Sort_Enabled FROM RelationshipCatalog WHERE Left_Sort_Enabled = 'True' OR Right_Sort_Enabled = 'True') r
            WHERE (getvariable('file') IS NULL OR r.File_Name = getvariable('file'))
         ) t),
         'info', 'openDashboard', 'id=relationship_with_sort'
) WHERE (getvariable('severity') IS NULL OR getvariable('severity') = '' OR severity = getvariable('severity'))
  ORDER BY ord;
