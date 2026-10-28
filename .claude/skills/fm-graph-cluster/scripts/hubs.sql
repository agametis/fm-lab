-- @title: Hubs / god-nodes by logical cluster degree
-- @description: Top-N nodes of the clustered graph (ClusterEdges), with their community, the
--               number of objects that use them and the link role that makes up their degree.
-- @version: 1.1.0
-- @tags: graph, cluster, hubs
-- @note: read-only. Degree = logical cluster degree (v2) — NOT the raw ObjectLinks degree
--        (multi-edges/un-hoisted sub-objects over-report by up to ~77×). Builtins and
--        Calculation instances never appear (excluded from ClusterEdges by design).
--        Degree measures connectedness, not importance: a migration script that maps 300
--        fields has a high degree and no caller. The two annotation columns make that visible
--        without changing the ranking:
--          Inbound_Users  — distinct objects that use this one (ObjectLinks edges whose role
--                           is a where-used usage in LinkRoleRegistry: calls_script,
--                           triggers_script from buttons/layouts/file, field reads, …);
--                           Unreferenced = true when there is none (e.g. no caller of a script)
--          Dominant_Role  — the link role with the largest share of the node's own edges
--                           (both directions; containment and restriction edges left out),
--                           with that share in percent
-- Variables: engine (required) · limit (default 20)
-- ClusterEdges scanned exactly once (MATERIALIZED); node key (uuid, file) — clones stay distinct.
WITH edges AS MATERIALIZED (
  SELECT Source_UUID AS s, Source_File AS sf, Target_UUID AS t, Target_File AS tf FROM ClusterEdges
),
logical_degree AS MATERIALIZED (
  SELECT uuid, file, COUNT(*) AS degree
  FROM (SELECT s AS uuid, sf AS file FROM edges UNION ALL SELECT t, tf FROM edges)
  GROUP BY uuid, file
),
-- The ranking first, the annotations only for the N rows that survive it.
top AS MATERIALIZED (
  SELECT oc.Object_UUID AS uuid, oc.File_Name AS file, oc.Object_Type, oc.Object_Name, d.degree
  FROM logical_degree d
  JOIN ObjectCatalog oc
    ON oc.Object_UUID = d.uuid AND oc.File_Name IS NOT DISTINCT FROM d.file
  ORDER BY d.degree DESC, oc.Object_Name
  LIMIT (COALESCE(getvariable('limit'), 20))
),
inbound AS (
  SELECT t.uuid, t.file, COUNT(DISTINCT (ol.Source_UUID, ol.Source_File)) AS users
  FROM top t
  JOIN ObjectLinks ol
    ON ol.Target_UUID = t.uuid AND ol.Target_File IS NOT DISTINCT FROM t.file
  JOIN LinkRoleRegistry r
    ON r.Link_Role = ol.Link_Role AND r.Link_Kind = 'usage' AND r.Counts_For_Where_Used
  WHERE ol.Source_UUID <> t.uuid
  GROUP BY t.uuid, t.file
),
role_mix AS (
  SELECT uuid, file, arg_max(Link_Role, n) AS role, max(n) * 100.0 / sum(n) AS share
  FROM (
    SELECT t.uuid, t.file, ol.Link_Role, COUNT(*) AS n
    FROM top t
    JOIN ObjectLinks ol
      ON (ol.Source_UUID = t.uuid AND ol.Source_File IS NOT DISTINCT FROM t.file)
      OR (ol.Target_UUID = t.uuid AND ol.Target_File IS NOT DISTINCT FROM t.file)
    JOIN LinkRoleRegistry r
      ON r.Link_Role = ol.Link_Role AND r.Link_Kind = 'usage'
    GROUP BY t.uuid, t.file, ol.Link_Role
  )
  GROUP BY uuid, file
)
SELECT t.Object_Type, t.Object_Name, t.file AS File_Name, t.degree, cl.Community,
       COALESCE(cn.Semantic_Name, cn.Heuristic_Name) AS Community_Name,
       COALESCE(i.users, 0) AS Inbound_Users,
       COALESCE(i.users, 0) = 0 AS Unreferenced,
       rm.role AS Dominant_Role,
       CAST(round(rm.share) AS INTEGER) AS Dominant_Share_Pct
FROM top t
LEFT JOIN inbound i USING (uuid, file)
LEFT JOIN role_mix rm USING (uuid, file)
LEFT JOIN ObjectClusters cl
  ON cl.Object_UUID = t.uuid AND cl.File_Name IS NOT DISTINCT FROM t.file
 AND cl.Engine = getvariable('engine')
LEFT JOIN CommunityNames cn
  ON cn.Community = cl.Community AND cn.Engine = cl.Engine
ORDER BY t.degree DESC, t.Object_Name;
