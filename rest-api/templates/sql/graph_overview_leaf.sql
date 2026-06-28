-- @template_type: report
-- @title: Graph Atlas — Leaf Tiles (Einzelknoten Top-N)
-- @description: Blattebene des Graph-Atlas — Top-N Einzelknoten eines Segments (bzw. globale Direkt-Hubs), nach Gewicht
-- @params: weight, parent_community, parent_file, parent_type, include_builtins, limit
-- @version: 1.0.0
-- @author: Marcel / Claude
-- @tags: graph, atlas, overview, treemap, leaf
-- @note: Endpoint /api/graph/overview (view=composition, level=leaf bzw. segment_by=hubs).
--        Liefert Einzelknoten (Klick → Graph Explorer). Die Aggregat-Ebenen kommen aus
--        graph_overview_aggregate.sql.
--
-- ============================================================================
-- PARAMETER (string-interpoliert via template.service.js / getvariable)
-- ============================================================================
--   weight            'domain' (ClusterEdges) | 'logical' (LogicalLinks)  (Default 'domain')
--   parent_community  INT  — Segment-Einschränkung (NULL = global/Hubs)    (Default NULL)
--   parent_file       TEXT — Segment-Einschränkung (NULL = global/Hubs)    (Default NULL)
--   parent_type       TEXT — Segment-Einschränkung (NULL = global/Hubs)    (Default NULL)
--   include_builtins  BOOL — nur bei weight='logical' relevant             (Default FALSE)
--   limit             INT  — harter Top-N-Deckel                           (Default 50)
--
-- AUSGABE — Einzelknoten, je Zeile ein Knoten (kind='leaf'):
--   key=uuid::file, uuid, file, label, type, community, weight, total_count, kind
-- total_count (auf jeder Zeile identisch) = Knoten VOR dem Top-N-Deckel →
--   truncated = total_count > limit  (Prinzip „no silent caps"). Der Service baut daraus
--   die „+N weitere"-Sammelkachel.
-- ============================================================================

WITH
-- Aktive Kanten-Sicht genau einmal materialisieren (s. graph_overview_aggregate.sql:
-- teure View-Kette, Mehrfach-Scan → OOM bei 8 Threads/2GB).
edges AS MATERIALIZED (
  SELECT Source_UUID AS s, Source_File AS sf, Target_UUID AS t, Target_File AS tf
    FROM ClusterEdges WHERE getvariable('weight') = 'domain'
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
  SELECT d.uuid, d.file, d.w,
         oc.Object_Type, oc.Object_Name,
         cl.Community
  FROM deg d
  LEFT JOIN ObjectCatalog  oc ON oc.Object_UUID = d.uuid AND oc.File_Name IS NOT DISTINCT FROM d.file
  LEFT JOIN ObjectClusters cl ON cl.Object_UUID = d.uuid AND cl.File_Name IS NOT DISTINCT FROM d.file
  WHERE (getvariable('weight') = 'domain'
     OR getvariable('include_builtins') = TRUE
     OR oc.Object_Type <> 'BuiltinFunction')
    AND (getvariable('exclude_types') IS NULL
         OR oc.Object_Type NOT IN (SELECT unnest(string_split(CAST(getvariable('exclude_types') AS VARCHAR), ','))))
),
filtered AS (
  SELECT n.uuid, n.file, n.w, n.Object_Type, n.Object_Name, n.Community
  FROM node n
  WHERE (getvariable('parent_community') IS NULL OR n.Community    = CAST(getvariable('parent_community') AS INT))
    AND (getvariable('parent_file')      IS NULL OR n.file         = getvariable('parent_file'))
    AND (getvariable('parent_type')      IS NULL OR n.Object_Type  = getvariable('parent_type'))
),
ranked AS (
  SELECT
    uuid, file, w AS weight, Object_Type AS type, Object_Name AS label, Community AS community,
    COUNT(*) OVER ()                                       AS total_count,
    ROW_NUMBER() OVER (ORDER BY w DESC, Object_Name ASC)   AS rn
  FROM filtered
)
SELECT
  uuid || COALESCE('::' || file, '')  AS key,
  uuid,
  file,
  label,
  type,
  community,
  weight,
  total_count,
  'leaf'                              AS kind
FROM ranked
WHERE rn <= CAST(getvariable('limit') AS INT)
ORDER BY rn;
