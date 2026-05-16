-- @template_type: report
-- @description: Per-Datei-Statistik mit Counts pro Objekttyp.
-- @params: none

SELECT
    f.File_Name,
    f.FileMaker_Version,
    f.Has_DDR_INFO,
    f.Import_Timestamp,
    COUNT(*) FILTER (WHERE oc.Object_Type = 'Script')          AS script_count,
    COUNT(*) FILTER (WHERE oc.Object_Type = 'BaseTable')       AS table_count,
    COUNT(*) FILTER (WHERE oc.Object_Type = 'Field')           AS field_count,
    COUNT(*) FILTER (WHERE oc.Object_Type = 'Layout')          AS layout_count,
    COUNT(*) FILTER (WHERE oc.Object_Type = 'CustomFunction')  AS cf_count
FROM FilesCatalog f
LEFT JOIN ObjectCatalog oc ON oc.File_Name = f.File_Name
GROUP BY ALL
ORDER BY f.File_Name;
