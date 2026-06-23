-- @title: Cluster Loader + Heuristic Naming (P5)
-- @description: communities.csv → ObjectClusters; aggregiert CommunityNames (Hints + Heuristik-Name)
-- @version: 1.1.0
-- @author: Marcel / Claude
-- @tags: graph, cluster, P5, community
-- @note: Läuft gegen die Master-DB (read-write).
-- @changelog 1.1.0: Semantic_Description fest ins Schema (fm-graph-cluster deep-research).
--
-- ============================================================================
-- VORBEDINGUNG (von cluster.sh gesetzt)
-- ============================================================================
--   SET VARIABLE engine = 'louvain' | 'leiden';   -- Provenienz
--   communities.csv im CWD (Spalten: object_uuid,community)
--
-- ============================================================================
-- ZWEI-TABELLEN-MODELL
-- ============================================================================
--   ObjectClusters(Object_UUID PK, Community, Engine)         — reine Zugehörigkeit
--   CommunityNames(Community, Engine, …Hints…, Heuristic_Name, Semantic_Name)
-- Trennung, damit der optionale Claude-Skill Semantic_Name unabhängig von der
-- Zugehörigkeit nachpflegen kann (keine LLM-Vorbedingung). Anzeige im Explorer:
-- COALESCE(Semantic_Name, Heuristic_Name).

-- 1) Zugehörigkeit laden. CREATE OR REPLACE = re-runnable; Engine als Provenienz.
CREATE OR REPLACE TABLE ObjectClusters AS
SELECT
  object_uuid                       AS Object_UUID,
  CAST(community AS INTEGER)         AS Community,
  CAST(getvariable('engine') AS VARCHAR) AS Engine
FROM read_csv('communities.csv', header = true,
              columns = {'object_uuid': 'VARCHAR', 'community': 'INTEGER'});

-- 2) Operationaler Grad je Objekt (Anker-Wahl + Sample-Reihenfolge).
--    Voll-Aggregation über ObjectLinks — im Batch unkritisch.
CREATE OR REPLACE TABLE CommunityNames AS
WITH deg AS (
  SELECT id, COUNT(*) AS degree
  FROM (
    SELECT Source_UUID AS id FROM ObjectLinks WHERE Link_Type = 'operational'
    UNION ALL
    SELECT Target_UUID AS id FROM ObjectLinks WHERE Link_Type = 'operational'
  )
  GROUP BY id
),
members AS (
  SELECT
    cl.Community, cl.Engine,
    oc.Object_UUID, oc.Object_Type, oc.File_Name, oc.Object_Name,
    COALESCE(d.degree, 0) AS degree
  FROM ObjectClusters cl
  JOIN ObjectCatalog oc ON oc.Object_UUID = cl.Object_UUID
  LEFT JOIN deg d ON d.id = cl.Object_UUID
)
SELECT
  Community,
  Engine,
  COUNT(*)                                          AS Member_Count,
  mode(Object_Type)                                 AS Dominant_Type,
  mode(File_Name)                                   AS Dominant_File,
  arg_max(Object_UUID, degree)                      AS Top_Member_UUID,
  arg_max(Object_Name, degree)                      AS Top_Member_Label,
  (list(Object_Name ORDER BY degree DESC, Object_Name))[1:8] AS Sample_Labels,
  -- Heuristik (immer, deterministisch, ohne LLM): Kontext-Datei · Anker (+Rest)
  COALESCE(mode(File_Name), '?') || ' · '
    || COALESCE(arg_max(Object_Name, degree), '(ohne Namen)')
    || ' (+' || (COUNT(*) - 1) || ')'               AS Heuristic_Name,
  -- Semantische Ebene (optional, vom Skill fm-graph-cluster per UPDATE gefüllt):
  --   Semantic_Name        — kurzer Modulname (Default-Modus + deep-research)
  --   Semantic_Description  — 1–2 Sätze, was das Modul fachlich tut (nur deep-research)
  -- Fest im Schema (CREATE OR REPLACE baut sie bei jedem Lauf), damit der Skill
  -- ohne defensiven ALTER auskommt.
  CAST(NULL AS VARCHAR)                              AS Semantic_Name,
  CAST(NULL AS VARCHAR)                              AS Semantic_Description
FROM members
GROUP BY Community, Engine;
