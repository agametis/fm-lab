-- @template_type: report
-- @description: Projekt-Header-Kennzahlen aus FilesCatalog und ObjectCatalog.
-- @params: none

WITH meta AS (
    SELECT
        COUNT(*)                                                    AS file_count,
        string_agg(DISTINCT FileMaker_Version, ', ')                 AS fm_versions,
        bool_or(Has_DDR_INFO)                                        AS any_ddr,
        bool_and(Has_DDR_INFO)                                       AS all_ddr,
        max(Import_Timestamp)                                        AS last_import
    FROM FilesCatalog
)
SELECT
    file_count,
    fm_versions,
    CASE WHEN all_ddr THEN 'full'
         WHEN any_ddr THEN 'partial'
         ELSE 'none' END                                              AS ddr_status,
    last_import,
    (SELECT COUNT(*) FROM ObjectCatalog)                              AS total_objects,
    (SELECT string_agg(File_Name, ', ' ORDER BY File_Name)
     FROM FilesCatalog)                                               AS file_names
FROM meta;
