-- @template_type: report
-- @description: Curated health indicators — one row per indicator.
-- @params: none
--
-- The `label` column carries an English default text. The web frontend
-- additionally looks it up under `dashboard.cellValues.<label>` so locale
-- packs can present the row in any active language. A missing translation
-- falls back to the English default.

-- Efficient variant via LEFT JOIN instead of correlated NOT-EXISTS subqueries.
-- Every lookup set is materialised once and then joined.
WITH field_usage AS (
    SELECT DISTINCT Target_UUID
    FROM ObjectLinks
    WHERE Link_Role IN ('displays_field', 'reads_field')
),
script_callers AS (
    SELECT DISTINCT Target_UUID
    FROM ObjectLinks
    WHERE Link_Role IN ('calls_script', 'trigger_script', 'triggers_script')
),
unused_fields AS (
    SELECT COUNT(*) AS n
    FROM FieldsForTables f
    LEFT JOIN field_usage fu ON f.Field_UUID = fu.Target_UUID
    WHERE fu.Target_UUID IS NULL
),
undoc_fields AS (
    SELECT COUNT(*) AS n
    FROM FieldsForTables
    WHERE Field_Comment IS NULL OR trim(Field_Comment) = ''
),
unused_scripts AS (
    SELECT COUNT(*) AS n
    FROM ScriptCatalog s
    LEFT JOIN script_callers sc ON s.Script_UUID = sc.Target_UUID
    WHERE (s.Folder_Type IS NULL)
      AND NOT s.Is_Separator
      AND sc.Target_UUID IS NULL
),
-- KPI counts file pairs with operational cross-file links — matches the detail
-- query `cross_file_links.sql`, which also aggregates per file pair.
cross_file AS (
    SELECT COUNT(*) AS n FROM (
        SELECT 1
        FROM ObjectLinks ol
        JOIN ObjectCatalog s ON ol.Source_UUID = s.Object_UUID
        JOIN ObjectCatalog t ON ol.Target_UUID = t.Object_UUID
        WHERE ol.Is_Cross_File = TRUE
          AND ol.Link_Type = 'operational'
        GROUP BY s.File_Name, t.File_Name
    )
),
global_vars AS (
    SELECT COUNT(*) AS n
    FROM VariablesCatalog
    WHERE Variable_Scope IN ('global', 'superglobal')
)
SELECT 'unused_fields'    AS key, 'Fields without layout usage'      AS label,
       (SELECT n FROM unused_fields)   AS value, 'info'    AS severity,
       'runQuery'         AS action,
       'query=find_unused_fields'      AS action_args
UNION ALL SELECT 'undoc_fields',    'Fields without comment',
       (SELECT n FROM undoc_fields),    'info',
       'runQuery', 'query=find_undocumented_fields'
UNION ALL SELECT 'unused_scripts',  'Scripts without callers',
       (SELECT n FROM unused_scripts),  'warn',
       'runQuery', 'query=find_unused_scripts'
UNION ALL SELECT 'cross_file_refs', 'File-to-file relationships',
       (SELECT n FROM cross_file),      'info',
       'runQuery', 'query=cross_file_links'
UNION ALL SELECT 'global_vars',     'Global / superglobal variables',
       (SELECT n FROM global_vars),     'info',
       'runQuery', 'query=list_global_variables';
