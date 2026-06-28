-- @template_type: report
-- @title: Graph Atlas — Topology Meta-Graph (Super-Nodes + Inter-Segment-Kanten)
-- @description: Topologie-Achse des Graph-Atlas — 1 Super-Node je Segment (Community/Datei), Kanten = aggregierte Kopplung
-- @params: weight, segment_by, include_builtins
-- @version: 1.0.0
-- @author: Marcel / Claude
-- @tags: graph, atlas, overview, meta-graph, topology
-- @note: Endpoint /api/graph/overview (view=topology). Nur segment_by=community|file.
--        Cytoscape-fertig: getaggte Union (row_kind='node'|'edge'), die der Service partitioniert
--        — analog graph_subgraph.sql. Top-K/„Rest"-Faltung der Super-Nodes übernimmt der Service.
--
-- ============================================================================
-- PARAMETER
-- ============================================================================
--   weight            'domain' (ClusterEdges) | 'logical' (LogicalLinks)  (Default 'domain')
--   segment_by        'community' | 'file'                                (Default 'community')
--   include_builtins  BOOL — nur bei weight='logical' relevant            (Default FALSE)
--
-- AUSGABE — getaggte Union:
--   row_kind='node' → key, label, member_count, weight, color_type, top_member_uuid, top_member_file
--   row_kind='edge' → source, target, weight   (ungerichtet, least/greatest-normalisiert)
-- Inter-Segment-Kanten kommen IMMER aus ClusterEdges (Domänen-Kopplung), unabhängig vom
-- Knoten-Gewicht — sie sind das Topologie-Signal des Atlas.
-- ============================================================================

WITH
-- ClusterEdges genau einmal materialisieren — wird sowohl für den Knoten-Grad (deg, bei
-- weight=domain) ALS AUCH für die Inter-Segment-Kanten (immer Domänen-Kopplung) gebraucht.
-- Mehrfach-Scan der teuren View-Kette → OOM bei 8 Threads/2GB.
ce AS MATERIALIZED (
  SELECT Source_UUID AS s, Source_File AS sf, Target_UUID AS t, Target_File AS tf FROM ClusterEdges
),
-- Aktive Kanten-Sicht für den Knoten-Grad (domain ← ce, logical ← LogicalLinks).
edges AS MATERIALIZED (
  SELECT s, sf, t, tf FROM ce WHERE getvariable('weight') = 'domain'
  UNION ALL
  SELECT Source_UUID, Source_File, Target_UUID, Target_File
    FROM LogicalLinks WHERE getvariable('weight') = 'logical'
),
deg AS MATERIALIZED (
  SELECT uuid, file, COUNT(*) AS w FROM (
    SELECT s AS uuid, sf AS file FROM edges
    UNION ALL SELECT t, tf FROM edges
  ) GROUP BY ALL
),
node AS MATERIALIZED (
  -- Object_Name ungenutzt (Labels: CommunityNames bzw. Datei-Key) → kleinerer Peak.
  SELECT d.uuid, d.file, d.w,
         oc.Object_Type,
         cl.Community, cl.Engine
  FROM deg d
  LEFT JOIN ObjectCatalog  oc ON oc.Object_UUID = d.uuid AND oc.File_Name IS NOT DISTINCT FROM d.file
  LEFT JOIN ObjectClusters cl ON cl.Object_UUID = d.uuid AND cl.File_Name IS NOT DISTINCT FROM d.file
  WHERE (getvariable('weight') = 'domain'
     OR getvariable('include_builtins') = TRUE
     OR oc.Object_Type <> 'BuiltinFunction')
    AND (getvariable('exclude_types') IS NULL
         OR oc.Object_Type NOT IN (SELECT unnest(string_split(CAST(getvariable('exclude_types') AS VARCHAR), ','))))
),
-- ── Super-Nodes: 1 je Segment ───────────────────────────────────────────────
nodes_community AS (
  SELECT
    CAST(n.Community AS VARCHAR)                                        AS key,
    COALESCE(any_value(cn.Semantic_Name), any_value(cn.Heuristic_Name),
             'Community ' || CAST(n.Community AS VARCHAR))              AS label,
    COUNT(*)                                                           AS member_count,
    SUM(n.w)                                                           AS weight,
    COALESCE(any_value(cn.Dominant_Type), arg_max(n.Object_Type, n.w)) AS color_type,
    arg_max(n.uuid, n.w)                                               AS top_member_uuid,
    arg_max(n.file, n.w)                                               AS top_member_file
  FROM node n
  LEFT JOIN CommunityNames cn ON cn.Community = n.Community AND cn.Engine = n.Engine
  WHERE getvariable('segment_by') = 'community' AND n.Community IS NOT NULL
  GROUP BY n.Community
),
nodes_file AS (
  SELECT
    n.file                                AS key,
    n.file                                AS label,
    COUNT(*)                              AS member_count,
    SUM(n.w)                              AS weight,
    arg_max(n.Object_Type, n.w)           AS color_type,
    arg_max(n.uuid, n.w)                  AS top_member_uuid,
    arg_max(n.file, n.w)                  AS top_member_file
  FROM node n
  WHERE getvariable('segment_by') = 'file' AND n.file IS NOT NULL
  GROUP BY n.file
),
seg_nodes AS (
  SELECT * FROM nodes_community
  UNION ALL
  SELECT * FROM nodes_file
),
-- ── Inter-Segment-Kanten aus ClusterEdges (ungerichtet, normalisiert) ───────
edges_community AS (
  SELECT
    CAST(least(a.Community, b.Community) AS VARCHAR)    AS source,
    CAST(greatest(a.Community, b.Community) AS VARCHAR) AS target,
    COUNT(*)                                           AS weight
  FROM ce e
  JOIN ObjectClusters a ON a.Object_UUID = e.s AND a.File_Name IS NOT DISTINCT FROM e.sf
  JOIN ObjectClusters b ON b.Object_UUID = e.t AND b.File_Name IS NOT DISTINCT FROM e.tf
  WHERE getvariable('segment_by') = 'community'
    AND a.Community IS NOT NULL AND b.Community IS NOT NULL
    AND a.Community <> b.Community
  GROUP BY 1, 2
),
edges_file AS (
  SELECT
    least(e.sf, e.tf)    AS source,
    greatest(e.sf, e.tf) AS target,
    COUNT(*)             AS weight
  FROM ce e
  WHERE getvariable('segment_by') = 'file'
    AND e.sf IS NOT NULL AND e.tf IS NOT NULL
    AND e.sf <> e.tf
  GROUP BY 1, 2
),
seg_edges AS (
  SELECT * FROM edges_community
  UNION ALL
  SELECT * FROM edges_file
)
-- ── getaggte Ausgabe ────────────────────────────────────────────────────────
SELECT
  'node'            AS row_kind,
  key,
  label,
  member_count,
  weight,
  color_type,
  top_member_uuid,
  top_member_file,
  NULL              AS source,
  NULL              AS target
FROM seg_nodes
UNION ALL
SELECT
  'edge'            AS row_kind,
  NULL              AS key,
  NULL              AS label,
  NULL              AS member_count,
  weight,
  NULL              AS color_type,
  NULL              AS top_member_uuid,
  NULL              AS top_member_file,
  source,
  target
FROM seg_edges
ORDER BY row_kind, weight DESC;
