-- @template_type: report
-- @description: Healthcheck counts — Layouts group. Detection logic DUPLICATED (v1.0
--   light) from the static-code-analysis rule bundles; tile count = drill-down count.

SELECT key, label, value, severity, action, action_args FROM (
  SELECT 1 AS ord, 'unused_layout' AS key, 'Unused layouts' AS label,
         (SELECT COUNT(*) FROM (
            SELECT 1 FROM ObjectCatalog oc WHERE oc.Object_Type = 'Layout'
              AND NOT EXISTS (SELECT 1 FROM ObjectLinks ol WHERE ol.Target_UUID = oc.Object_UUID AND ol.Link_Role IN ('navigates_to_layout','default_layout'))
              AND (getvariable('file') IS NULL OR oc.File_Name = getvariable('file'))
         ) t) AS value,
         'warn' AS severity, 'openDashboard' AS action, 'id=unused_layout' AS action_args
  UNION ALL
  SELECT 2, 'empty_layout', 'Empty layouts',
         (SELECT COUNT(*) FROM (
            SELECT 1 FROM Layouts l
            WHERE NOT EXISTS (SELECT 1 FROM LayoutObjects o WHERE o.Layout_ID = l.L_ID AND o.File_Name = l.File_Name)
              AND (l.Folder_Type IS NULL OR l.Folder_Type = 'False') AND NOT l.Is_Separator
              AND (getvariable('file') IS NULL OR l.File_Name = getvariable('file'))
         ) t),
         'info', 'openDashboard', 'id=empty_layout'
  UNION ALL
  SELECT 3, 'layout_without_context', 'Layouts without table context',
         (SELECT COUNT(*) FROM (
            SELECT 1 FROM Layouts l
            WHERE COALESCE(l.L_TO_Name, '') = ''
              AND (l.Folder_Type IS NULL OR l.Folder_Type = 'False') AND NOT l.Is_Separator
              AND (getvariable('file') IS NULL OR l.File_Name = getvariable('file'))
         ) t),
         'warn', 'openDashboard', 'id=layout_without_context'
  UNION ALL
  SELECT 4, 'layout_without_body', 'Layouts without Body part',
         (SELECT COUNT(*) FROM (
            SELECT 1 FROM Layouts l
            WHERE NOT EXISTS (SELECT 1 FROM LayoutParts p WHERE p.Layout_ID = l.L_ID AND p.File_Name = l.File_Name AND p.Part_Type = 'Body')
              AND (l.Folder_Type IS NULL OR l.Folder_Type = 'False') AND NOT l.Is_Separator
              AND (getvariable('file') IS NULL OR l.File_Name = getvariable('file'))
         ) t),
         'info', 'openDashboard', 'id=layout_without_body'
) WHERE (getvariable('severity') IS NULL OR getvariable('severity') = '' OR severity = getvariable('severity'))
  ORDER BY ord;
