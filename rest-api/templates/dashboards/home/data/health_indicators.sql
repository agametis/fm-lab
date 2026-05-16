-- @template_type: report
-- @description: Kuratierte Health-Indikatoren — je eine Zeile pro Indikator.
-- @params: none

-- Effiziente Variante via LEFT JOIN statt korrelierter NOT-EXISTS-Subqueries.
-- Jede Lookup-Menge wird einmal materialisiert und dann gejoint.
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
-- KPI zählt Datei-Paare mit operationalen Cross-File-Links — passend zur
-- Detail-Query `cross_file_links.sql`, die ebenfalls pro Datei-Paar aggregiert.
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
SELECT 'unused_fields'    AS key, 'Felder ohne Layout-Verwendung'    AS label,
       (SELECT n FROM unused_fields)   AS value, 'info'    AS severity,
       'runQuery'         AS action,
       'query=find_unused_fields'      AS action_args
UNION ALL SELECT 'undoc_fields',    'Felder ohne Kommentar',
       (SELECT n FROM undoc_fields),    'info',
       'runQuery', 'query=find_undocumented_fields'
UNION ALL SELECT 'unused_scripts',  'Scripts ohne Aufrufer',
       (SELECT n FROM unused_scripts),  'warn',
       'runQuery', 'query=find_unused_scripts'
UNION ALL SELECT 'cross_file_refs', 'Datei-zu-Datei-Beziehungen',
       (SELECT n FROM cross_file),      'info',
       'runQuery', 'query=cross_file_links'
UNION ALL SELECT 'global_vars',     'Globale/Superglobale Variablen',
       (SELECT n FROM global_vars),     'info',
       'runQuery', 'query=list_global_variables';
