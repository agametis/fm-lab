-- @title: Semantic Name Cache — Apply (majority-vote restore after re-cluster)
-- @description: Restauriert Semantic_Name/-Description auf die NEUEN Communities per Mehrheitsvotum
-- @version: 2.0.0
-- @author: Marcel / Claude
-- @tags: graph, cluster, P5, community, cache
-- @note: Läuft gegen die Master-DB (read-write), NACH cluster_load.sql.
-- @changelog 2.0.0: Klon-Knoten-Key — der Cache-Vote-Join ist datei-genau
--        ((Object_UUID, File_Name) per IS NOT DISTINCT FROM). Damit erbt eine neue
--        Community den Namen genau der (uuid,file)-Instanz, die in ihr liegt; zwei
--        Klone derselben UUID können divergente gecachte Namen tragen.
--
-- ============================================================================
-- VORBEDINGUNG (von cluster.sh geprüft + gesetzt)
-- ============================================================================
--   SET VARIABLE tau_purity   = <float>;   -- Default 0.6 (cluster.sh)
--   SET VARIABLE tau_coverage = <float>;   -- Default 0.5
--   SemanticNameCache existiert und hat Zeilen (sonst no-op-Aufruf vermieden).
--   ObjectClusters/CommunityNames frisch aus cluster_load.sql (Semantic_Name=NULL).
--
-- ============================================================================
-- VERFAHREN — objekt-granulares Mehrheitsvotum
-- ============================================================================
-- Jede NEUE Community erbt den Mehrheits-Cache-Namen ihrer Mitglieder:
--   purity   = Top-Cache-Name-Stimmen / cache-abgedeckte Member  ≥ τ_purity
--   coverage = cache-abgedeckte Member / Member gesamt           ≥ τ_coverage
-- 1:1-Constraint: ein gecachter Name darf nur an EINE neue Community (Split-Schutz:
-- die stimmstärkere gewinnt, die andere bleibt dirty = NULL → echtes neues Submodul).
-- Merges (Purity ~0.5) und überwiegend neue Module (niedrige Coverage) bleiben dirty.

CREATE OR REPLACE TEMP TABLE _cache_winners AS
WITH votes AS (
  -- Stimmen je (neue Community, gecachter Name)
  SELECT cl.Community AS comm, sc.Semantic_Name AS name, sc.Semantic_Description AS descr,
         COUNT(*) AS v
  FROM ObjectClusters cl
  JOIN SemanticNameCache sc
    ON sc.Object_UUID = cl.Object_UUID
   AND sc.File_Name IS NOT DISTINCT FROM cl.File_Name   -- datei-genau (Klon-Key)
  WHERE sc.Semantic_Name IS NOT NULL
  GROUP BY 1, 2, 3
),
sz AS (
  SELECT Community AS comm, COUNT(*) AS n FROM ObjectClusters GROUP BY 1
),
ranked AS (
  SELECT
    v.comm, v.name, v.descr, v.v,
    SUM(v.v) OVER (PARTITION BY v.comm) AS covered,
    sz.n,
    ROW_NUMBER() OVER (PARTITION BY v.comm ORDER BY v.v DESC, v.name) AS rk
  FROM votes v
  JOIN sz ON sz.comm = v.comm
),
top AS (
  SELECT comm, name, descr,
         v          AS top_votes,
         covered, n,
         v::DOUBLE / covered AS purity,
         covered::DOUBLE / n AS coverage
  FROM ranked
  WHERE rk = 1
),
eligible AS (
  SELECT * FROM top
  WHERE purity   >= CAST(getvariable('tau_purity')   AS DOUBLE)
    AND coverage >= CAST(getvariable('tau_coverage') AS DOUBLE)
),
oneone AS (
  -- 1:1: ein Cache-Name nur an die stimmstärkste neue Community
  SELECT *,
         ROW_NUMBER() OVER (PARTITION BY name ORDER BY top_votes DESC, comm) AS name_rk
  FROM eligible
)
SELECT comm, name, descr, top_votes, covered, n, purity, coverage
FROM oneone
WHERE name_rk = 1;

-- Restore: Semantic_Name/-Description auf die gewinnenden neuen Communities setzen.
UPDATE CommunityNames
SET Semantic_Name = w.name, Semantic_Description = w.descr
FROM _cache_winners w
WHERE CommunityNames.Community = w.comm;
