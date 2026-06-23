-- @title: Logical Edge Export (Community-Detection input)
-- @description: Gesäuberte, ungerichtete Kantenliste (logische Sicht, ohne Builtins/Orphans) → edges.csv
-- @version: 2.0.0
-- @author: Marcel / Claude
-- @tags: graph, cluster, export, P5
-- @note: Input für cluster_louvain.mjs / cluster_leiden.py.
--
-- ============================================================================
-- ZWECK
-- ============================================================================
-- Community-Detection (P5) läuft auf dem GESÄUBERTEN Graphen:
--   • operationale Links (keine Containment-Hierarchie),
--   • logische Sicht (Sub-Objekte auf ihren Container hochgezogen),
--   • OHNE Builtins (and/or/Case … sind God-Nodes, die Communities verschmelzen),
--   • OHNE Orphans (beide Endpunkte katalogisiert).
-- Genau dieser Graph ist das, was der Explorer in mode=logical rendert — die
-- Cluster-Färbung ist damit konsistent mit der gezeigten Topologie.
--
-- ============================================================================
-- 2.0.0 — View-Read statt Inline-CTE
-- ============================================================================
-- Der Kantensatz ist ab v2 als VIEW ClusterEdges materialisiert (in convert-xml
-- Phase 5, sql/convert-xml/convert_xml_05_homes.sql). ClusterEdges =
-- LogicalLinks (kanonisch, graph_logical_links.sql) minus Builtins, (a,b)-dedupl.
-- Dieselbe View speist auch die Skill-Grad-/Hub-Analyse und perspektivisch den
-- Explorer — EINE Single Source of Truth, keine 3-fach inline duplizierte Logik.
--
-- HARTE ANFORDERUNG: Das edges.csv aus der View ist BIT-IDENTISCH zum vorherigen
-- Inline-Stand (1.0.0). Andernfalls bräche die Determinismus-/Farb-Zusage
-- (gleicher Seed + Auflösung ⇒ identische Partition). ORDER BY source, target
-- bleibt zwingend (v1.2-Determinismus-Fix). Voraussetzung: ClusterEdges existiert
-- (frischer convert-xml --batch erzeugt sie in P5); cluster.sh ruft read-only auf.
--
-- AUSGABE: edges.csv (header: source,target) — eine Zeile je distinkter
-- (Quelle, Ziel)-Paarung. Mehrfach-Rollen zwischen demselben Paar werden zu EINER
-- Kante kollabiert (ungewichteter, einfacher Graph; Louvain/Leiden behandeln den
-- ungerichteten Graphen, mergeEdge dedupliziert (a,b)/(b,a)).
--
-- Pfad: relativ zum CWD des duckdb-Aufrufs (cluster.sh cd't ins Arbeitsverzeichnis).

COPY (
  SELECT DISTINCT Source_UUID AS source, Target_UUID AS target
  FROM ClusterEdges
  -- Stabile Zeilenreihenfolge: ohne ORDER BY liefert DuckDB dieselbe DISTINCT-Menge
  -- in wechselnder Reihenfolge (Hash/Parallelität), was Louvain/Leiden — die
  -- ordnungssensitiv sind — zwischen Läufen leicht abweichende Partitionen liefern
  -- lässt. Determinismus („Farben springen nicht"): gleicher Seed +
  -- gleiche Auflösung ⇒ bit-identische edges.csv ⇒ identische Partition.
  ORDER BY source, target
) TO 'edges.csv' (HEADER, DELIMITER ',');
