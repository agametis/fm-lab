-- @title: Semantic Name Cache — Save (snapshot before re-cluster)
-- @description: Objekt-granularer Snapshot der aktuellen Semantic_Name/-Description in SemanticNameCache
-- @version: 2.0.0
-- @author: Marcel / Claude
-- @tags: graph, cluster, P5, community, cache
-- @note: Läuft gegen die Master-DB (read-write), VOR cluster_load.sql (das CommunityNames ersetzt).
-- @changelog 2.0.0: Klon-Knoten-Key — Cache auf (Object_UUID, File_Name). CREATE OR
--        REPLACE TABLE (statt CREATE IF NOT EXISTS + DELETE) macht das Schema
--        selbst-heilend: eine alte UUID-only-Cache-Tabelle (vor dem Klon-Fix) wird
--        beim ersten Lauf sauber durch das (uuid,file)-Schema ersetzt.
--
-- ============================================================================
-- VORBEDINGUNG (von cluster.sh geprüft + gesetzt)
-- ============================================================================
--   SET VARIABLE resolution = <float>;   -- Provenienz der gecachten Partition
--   ObjectClusters + CommunityNames existieren UND CommunityNames trägt ≥1
--   non-NULL Semantic_Name (sonst ruft cluster.sh diese Datei gar nicht erst auf —
--   ein leerer Snapshot würde sonst einen guten Cache überschreiben).
--
-- ============================================================================
-- ZWECK
-- ============================================================================
-- cluster_load.sql baut CommunityNames per CREATE OR REPLACE neu → jeder Lauf
-- verwirft Semantic_Name. Dieser Snapshot friert die Namen auf OBJEKT-Ebene ein
-- ((Object_UUID, File_Name) → Name), damit cache_apply.sql sie nach dem Re-Cluster
-- per Mehrheitsvotum auf die NEUEN Communities zurückspielen kann. Objekt-Ebene
-- umgeht das instabile Community-ID-Mapping. Der File_Name-Teil hält
-- divergente Klon-Namen auseinander (zwei Klone derselben UUID = zwei Cache-Keys).
--
-- Latest-Snapshot-Semantik: CREATE OR REPLACE (kein Akkumulieren). Nur Objekte in
-- BENANNTEN Communities werden gecacht; dirty/unbenannte tragen nichts bei.

CREATE OR REPLACE TABLE SemanticNameCache AS
SELECT
  cl.Object_UUID,
  cl.File_Name,
  cn.Semantic_Name,
  cn.Semantic_Description,
  cl.Community                              AS Source_Community,
  cl.Engine,
  CAST(getvariable('resolution') AS DOUBLE) AS Resolution,
  now()                                     AS Cached_At
FROM ObjectClusters cl
JOIN CommunityNames cn
  ON cn.Community = cl.Community AND cn.Engine = cl.Engine
WHERE cn.Semantic_Name IS NOT NULL;
