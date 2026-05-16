-- @template_type: object
-- @title: Globale und Superglobale Variablen
-- @description: Alle $$- und $$$-Variablen mit Set/Read-Statistik.
-- @icon: variable
-- @category: Variablen
-- @display: list
-- @params: file (optional)
-- @click_action: openObject
-- @click_args: uuid={{uuid}}
-- @output_format: uuid, name, type, scope, set_count, read_count, file_count, files
-- @author: Marcel
-- @version: 1.0
-- @tags: variables, analysis, globals

-- VariablesCatalog ist pro Variable aggregiert. Für die UUID nehmen wir den ersten
-- passenden Object-Eintrag aus dem ObjectCatalog (Variable kann in mehreren Files
-- gleichzeitig existieren).
WITH var_uuid AS (
    SELECT
        Object_Name,
        File_Name,
        Object_UUID,
        ROW_NUMBER() OVER (PARTITION BY Object_Name ORDER BY File_Name) AS rn
    FROM ObjectCatalog
    WHERE Object_Type = 'Variable'
)
SELECT
    u.Object_UUID                  AS uuid,
    v.Display_Name                 AS name,
    'Variable'                     AS type,
    v.Variable_Scope               AS scope,
    v.Set_Count                    AS set_count,
    v.Read_Count                   AS read_count,
    v.File_Count                   AS file_count,
    array_to_string(v.Files, ', ') AS files
FROM VariablesCatalog v
JOIN var_uuid u ON u.Object_Name = v.Display_Name AND u.rn = 1
WHERE v.Variable_Scope IN ('global', 'superglobal')
  AND (getvariable('file') IS NULL OR list_contains(v.Files, getvariable('file')))
ORDER BY v.Variable_Scope DESC, v.Display_Name;
