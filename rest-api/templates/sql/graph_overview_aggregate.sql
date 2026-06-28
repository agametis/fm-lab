-- @template_type: report
-- @title: Graph Atlas — Aggregate Tiles (root + segment)
-- @description: Aggregat-Kacheln für den Graph-Atlas — eine Kachel je Segment (Community/Datei/Typ), Fläche = Σ Gewicht
-- @params: weight, group_dim, parent_community, parent_file, parent_type, include_builtins
-- @version: 1.0.0
-- @author: Marcel / Claude
-- @tags: graph, atlas, overview, treemap
-- @note: Endpoint /api/graph/overview (view=composition, level=root|segment).
--        Liefert die Aggregat-Ebenen des Treemap-Trichters. Die Blattebene (Einzelknoten)
--        kommt aus graph_overview_leaf.sql, der Meta-Graph aus graph_overview_topology.sql.
--
-- ============================================================================
-- PARAMETER (string-interpoliert via template.service.js / getvariable)
-- ============================================================================
--   weight            'domain' (ClusterEdges) | 'logical' (LogicalLinks)   (Default 'domain')
--   group_dim         'community' | 'file' | 'type'  — wonach Ebene gruppiert (Default 'community')
--   parent_community  INT  — Drill-Kontext (NULL = keine Einschränkung)     (Default NULL)
--   parent_file       TEXT — Drill-Kontext (NULL = keine Einschränkung)     (Default NULL)
--   parent_type       TEXT — Drill-Kontext (NULL = keine Einschränkung)     (Default NULL)
--   include_builtins  BOOL — nur bei weight='logical' relevant              (Default FALSE)
--
-- Die drei group_dim-Zweige sind als geschützte UNION formuliert (wie graph_subgraph.sql):
-- nach der Interpolation ist genau ein WHERE konstant-TRUE, der Optimizer kappt die übrigen.
--
-- AUSGABE — Aggregat-Kacheln, je Zeile ein Segment:
--   key, label, node_count, weight, color_type, kind='aggregate'
-- Sortiert nach Gewicht absteigend; Top-K/„Rest"-Faltung übernimmt der Service.
-- ============================================================================

WITH
-- 0) Aktive Kanten-Sicht GENAU EINMAL materialisieren. ClusterEdges/LogicalLinks sind
--    teure View-Ketten (LogicalLinks-Hoisting → god-node-Filter); sie mehrfach zu
--    scannen sprengt unter dem 2GB-READ_ONLY-Limit bei 8 Threads den Buffer-Manager.
--    Der inaktive weight-Zweig ist konstant-FALSE → 0 Zeilen.
edges AS MATERIALIZED (
  SELECT Source_UUID AS s, Source_File AS sf, Target_UUID AS t, Target_File AS tf
    FROM ClusterEdges WHERE getvariable('weight') = 'domain'
  UNION ALL
  SELECT Source_UUID, Source_File, Target_UUID, Target_File
    FROM LogicalLinks WHERE getvariable('weight') = 'logical'
),
-- 1) Knoten-Grad als Gewicht aus der materialisierten Kantenmenge (zweimal billig).
--    domain=ClusterEdges (Builtins + god-nodes bereits raus), logical=LogicalLinks.
deg AS MATERIALIZED (
  SELECT uuid, file, COUNT(*) AS w FROM (
    SELECT s AS uuid, sf AS file FROM edges
    UNION ALL SELECT t, tf FROM edges
  ) GROUP BY ALL
),
-- 2) Knoten anreichern: Typ/Name (DATEI-GENAU) + Community/Engine (Cluster-Partition,
--    single active engine — fm-graph-cluster ersetzt die Partition komplett).
--    MATERIALIZED: die drei group_dim-Zweige scannen `node` sonst je einmal neu.
node AS MATERIALIZED (
  -- Object_Name wird hier NICHT gebraucht (Labels: CommunityNames bzw. der Key selbst)
  -- → schmälere materialisierte Knotenmenge, niedrigerer Speicher-Peak.
  SELECT d.uuid, d.file, d.w,
         oc.Object_Type,
         cl.Community, cl.Engine
  FROM deg d
  LEFT JOIN ObjectCatalog  oc ON oc.Object_UUID = d.uuid AND oc.File_Name IS NOT DISTINCT FROM d.file
  LEFT JOIN ObjectClusters cl ON cl.Object_UUID = d.uuid AND cl.File_Name IS NOT DISTINCT FROM d.file
  WHERE (getvariable('weight') = 'domain'                -- ClusterEdges hat ohnehin keine Builtins
     OR getvariable('include_builtins') = TRUE
     OR oc.Object_Type <> 'BuiltinFunction')
    -- Objekttyp-Exclusion (Filterleiste): vor der Aggregation
    AND (getvariable('exclude_types') IS NULL
         OR oc.Object_Type NOT IN (SELECT unnest(string_split(CAST(getvariable('exclude_types') AS VARCHAR), ','))))
)
-- 3a) group_dim = community → Community-Kacheln (Label aus CommunityNames).
SELECT
  CAST(n.Community AS VARCHAR)                                    AS key,
  COALESCE(any_value(cn.Semantic_Name), any_value(cn.Heuristic_Name),
           'Community ' || CAST(n.Community AS VARCHAR))          AS label,
  COUNT(*)                                                        AS node_count,
  SUM(n.w)                                                        AS weight,
  COALESCE(any_value(cn.Dominant_Type), arg_max(n.Object_Type, n.w)) AS color_type,
  'aggregate'                                                     AS kind
FROM node n
LEFT JOIN CommunityNames cn ON cn.Community = n.Community AND cn.Engine = n.Engine
WHERE getvariable('group_dim') = 'community'
  AND n.Community IS NOT NULL
  AND (getvariable('parent_community') IS NULL OR n.Community = CAST(getvariable('parent_community') AS INT))
  AND (getvariable('parent_file')      IS NULL OR n.file        = getvariable('parent_file'))
  AND (getvariable('parent_type')      IS NULL OR n.Object_Type = getvariable('parent_type'))
GROUP BY n.Community

UNION ALL
-- 3b) group_dim = file → Datei-Kacheln.
SELECT
  n.file                                  AS key,
  n.file                                  AS label,
  COUNT(*)                                AS node_count,
  SUM(n.w)                                AS weight,
  arg_max(n.Object_Type, n.w)             AS color_type,
  'aggregate'                             AS kind
FROM node n
WHERE getvariable('group_dim') = 'file'
  AND n.file IS NOT NULL
  AND (getvariable('parent_community') IS NULL OR n.Community = CAST(getvariable('parent_community') AS INT))
  AND (getvariable('parent_file')      IS NULL OR n.file        = getvariable('parent_file'))
  AND (getvariable('parent_type')      IS NULL OR n.Object_Type = getvariable('parent_type'))
GROUP BY n.file

UNION ALL
-- 3c) group_dim = type → Objekttyp-Kacheln.
SELECT
  n.Object_Type                           AS key,
  n.Object_Type                           AS label,
  COUNT(*)                                AS node_count,
  SUM(n.w)                                AS weight,
  n.Object_Type                           AS color_type,
  'aggregate'                             AS kind
FROM node n
WHERE getvariable('group_dim') = 'type'
  AND n.Object_Type IS NOT NULL
  AND (getvariable('parent_community') IS NULL OR n.Community = CAST(getvariable('parent_community') AS INT))
  AND (getvariable('parent_file')      IS NULL OR n.file        = getvariable('parent_file'))
  AND (getvariable('parent_type')      IS NULL OR n.Object_Type = getvariable('parent_type'))
GROUP BY n.Object_Type

ORDER BY weight DESC;
