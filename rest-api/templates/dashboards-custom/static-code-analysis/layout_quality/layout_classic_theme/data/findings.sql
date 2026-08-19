-- Layouts whose theme resolves to the deprecated Classic theme (internal name
-- com.filemaker.theme.classic — locale-independent, unlike the display name).
-- Translated from fmCheckMate ReportObjectsWithClassicStyle.
--
-- Classic detection runs as an OR chain over the RAW columns on purpose — it is
-- correct on every catalog version, including those imported before the resolved
-- theme columns existed (schema 1.21.0). Referencing L_Theme_Resolved_Name here
-- would turn an old catalog into a hard binder error instead of a result:
--   1. L_Theme_Base  — Classic named as the base theme (explicit exports)
--   2. L_Theme_Name  — Classic referenced by name
--   3. L_Theme_ID IS NULL — the SaXML case: FileMaker writes Classic as an EMPTY
--      <LayoutThemeReference/> with no id/name/UUID/Base at all, so every Classic
--      layout carries NULL and the literal string appears in no layout row. This
--      branch is what actually fires on SaXML exports; without it a solution that
--      is entirely Classic reports zero findings.
-- Folders (isFolder 'True'/'Marker') and separators never carry a theme and would
-- otherwise all match branch 3 — excluded with the same predicate P4 uses.
SELECT 'layout-classic-theme' AS rule_id, 'warning' AS severity,
    ly.File_Name AS file_name, ly.L_UUID AS nav_uuid, ly.L_Name AS layout_name,
    NULL AS object_uuid,
    COALESCE(ly.L_Theme_Name, 'com.filemaker.theme.classic') AS theme_name,
    'Layout uses the deprecated Classic theme' AS message,
    row_number() OVER (ORDER BY ly.File_Name, ly.L_Name) AS row_key
FROM Layouts ly
WHERE (ly.Folder_Type IS NULL OR ly.Folder_Type = 'False')
  AND NOT COALESCE(ly.Is_Separator, FALSE)
  AND (ly.L_Theme_Base = 'com.filemaker.theme.classic'
       OR ly.L_Theme_Name = 'com.filemaker.theme.classic'
       OR ly.L_Theme_ID IS NULL)
  AND (getvariable('file') IS NULL OR ly.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR ly.L_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY row_key
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
