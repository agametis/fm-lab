-- @template_type: report
-- @description: Variablen mit den meisten Set/Read-Operationen.
-- @params: limit (optional, default 10), file (optional)
-- Hinweis: VariablesCatalog ist aggregiert und hat keine eigene UUID — wir liefern
-- die UUID einer beliebigen Verwendungs-Instanz aus ObjectCatalog mit, damit Klicks
-- in die Detail-View springen können.

WITH agg AS (
    SELECT
        vc.Variable_Name,
        vc.Display_Name                                   AS name,
        vc.Variable_Scope                                 AS scope,
        vc.Set_Count                                      AS sets,
        vc.Read_Count                                     AS reads,
        vc.Set_Count + vc.Read_Count                      AS total,
        vc.Script_Count                                   AS scripts,
        vc.File_Count                                     AS files,
        vc.File_Name
    FROM VariablesCatalog vc
    WHERE (getvariable('file') IS NULL OR vc.File_Name = getvariable('file'))
)
SELECT
    (
        SELECT MIN(oc.Object_UUID)
        FROM ObjectCatalog oc
        WHERE oc.Object_Type = 'Variable'
          AND oc.Object_Name = a.Variable_Name
          AND oc.File_Name   = a.File_Name
    )                                                     AS uuid,
    a.name,
    a.scope,
    a.sets,
    a.reads,
    a.total,
    a.scripts,
    a.files
FROM agg a
ORDER BY a.total DESC
LIMIT CAST(COALESCE(getvariable('limit'), '10') AS INTEGER);
