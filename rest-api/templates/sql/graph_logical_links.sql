-- @title: Logical Links View (Graph Explorer)
-- @description: Operationale Referenz-Kanten mit Sub-Objekten auf ihren Container hochgezogen
-- @version: 1.2.0
-- @author: Marcel / Claude
-- @tags: graph, subgraph, logical-view
-- @note: Ab v1.1.0 wird diese View regulär in convert-xml Phase 5 angelegt
--        (sql/convert-xml/convert_xml_05_homes.sql) — diese Datei bleibt die
--        KANONISCHE Definition; bei Änderung beide Stellen synchron halten.
--        v1.2.0 (Stufe C): lokale Variablen ($x) ausgeschlossen — siehe DEFINITION (5).
--
-- ============================================================================
-- ZWECK
-- ============================================================================
-- Die "logische Sicht" (mode=logical) des Graph Explorers zeigt nur Top-Level-
-- Objekte (Script, Field, Layout, CustomFunction, TableOccurrence, …). Sub-
-- Objekt-Links werden auf ihren Container hochgezogen, damit der Referenzgraph
-- nicht im ScriptStep-/LayoutObject-Rauschen ertrinkt (46 % aller Knoten
-- sind ScriptStep, 37 % LayoutObject).
--
-- ============================================================================
-- DATENBEFUND (gemessen auf db/fm_catalog.duckdb, 2026-06-23)
-- ============================================================================
-- Anders als das einleitende Plan-Beispiel ("ScriptStep --calls_script--> Script")
-- nahelegt, ist das Hochziehen auf der Quell-Seite NUR für LayoutObject nötig:
--
--   • ScriptStep taucht NIE als operationale Quelle auf — Skript-Referenzen
--     (calls_script, sets_field, reads_variable, …) sind im Datenmodell bereits
--     auf Script-Ebene aggregiert (Source_Type='Script'). Kein Hochziehen nötig.
--   • LayoutObject ist mit ~285k operationalen Links die einzige Sub-Objekt-
--     Quelle (displays_field, triggers_script, uses_valuelist, portal_context,
--     displays_variable, …) → Container = Layout.
--   • Auf der ZIEL-Seite ist KEIN Sub-Objekt vorhanden (Ziele sind alle
--     Top-Level: Layout/Field/Script/Variable/BaseTable/…) → kein Ziel-Hochziehen.
--
-- Container-Auflösung ist ein EINZIGER direkter Join, KEINE Rekursion:
--   • Alle 162.711 LayoutObjects (inkl. aller 51.851 verschachtelten) tragen
--     einen direkten parent_layout-Link → Layout.
--   • Alle 203.653 ScriptSteps tragen parent_script → Script (defensiv mit-
--     aufgenommen, falls künftig ScriptStep-Quellen emittiert werden).
--
-- ============================================================================
-- DEFINITION
-- ============================================================================
--   1. Nur operationale Links (Link_Type='operational'); strukturelles
--      Containment-Gerüst (parent_layout/parent_script/parent_object/parent_folder)
--      wird verworfen — es ist Hierarchie, keine Referenz. parent_table
--      (Field→BaseTable) BLEIBT: es verbindet zwei Top-Level-Objekte und ist eine
--      echte Referenz.
--   2. Jeder Endpunkt wird via `container` auf seinen Top-Level-Container ersetzt
--      (COALESCE: kein Container ⇒ Endpunkt bleibt unverändert).
--   3. Selbst-Schleifen (a=b), die durch das Hochziehen entstehen (z.B. zwei
--      LayoutObjects desselben Layouts), werden verworfen.
--   4. DISTINCT dedupliziert: 12 LayoutObjects, die dasselbe Feld zeigen,
--      werden zu EINER Layout→Field-Kante (vermeidet Doppelzählung, R3).
--   5. STUFE C: lokale Variablen ($x) werden als Endpunkt ausgeschlossen. Ihr
--      Scope_Anchor ist das Script (per-Script gekeyt) → Degree-1-Pendant, das nie
--      eine Brücke sein kann (33,9 % aller Cluster-Knoten, reiner Clutter). GLOBALE
--      ($$) / superglobale ($$$) BLEIBEN (Datei-/global-gekeyt = echte Brücken). Das
--      Semantik-Signal bleibt erhalten (Skills lesen Variablen aus VariableUsages/
--      VariablesCatalog per Script, nicht aus dem Graph).
--
-- Container-Logik bewusst analog zur Container-Mitgliedschaft in
-- back_references.sql (parent_layout/parent_script/parent_object).
--
-- ============================================================================
-- VERORTUNG / PROMOTION-PFAD
-- ============================================================================
-- Ab v1.1.0 ist die View PROMOTET: convert-xml Phase 5
-- (sql/convert-xml/convert_xml_05_homes.sql) legt LogicalLinks + die
-- Companion-View ClusterEdges (= LogicalLinks minus Builtins) am Phasenende per
-- CREATE OR REPLACE VIEW an. Auslöser: der
-- Cluster-Engine-Export (graph_export_logical.sql 2.0.0) und die Skill-Grad-/
-- Hub-Analyse (fm-graph-cluster) lesen ab v2 dieselbe View — EINE Single Source
-- of Truth statt 3-fach inline duplizierter Edge-Logik. Die Views werden vom
-- convert-xml-Sync in die READ_ONLY-API-Kopie gespiegelt → der Explorer kann sie
-- ebenfalls nutzen. Diese Datei bleibt die KANONISCHE Definition (Referenz +
-- standalone re-applizierbar):
--
--     duckdb db/fm_catalog.duckdb < graph_logical_links.sql
--
-- OFFEN (optional): graph_subgraph.sql trägt weiterhin eine
-- INLINE-KOPIE dieser CTE-Kette (logical_dedup). Mit der nun in P5 promoteten
-- View kann dort `SELECT * FROM LogicalLinks` die Inline-CTE ersetzen — separater
-- Folge-Schritt mit eigener Verifikation gegen die READ_ONLY-API-Kopie, nicht
-- Teil des kritischen Pfads. (Die VIEW materialisiert nichts.)

CREATE OR REPLACE VIEW LogicalLinks AS
WITH container AS (
  -- Sub-Objekt-UUID → Top-Level-Container-UUID (ein direkter Hop, keine Rekursion)
  SELECT Source_UUID AS child, Target_UUID AS parent
  FROM ObjectLinks
  WHERE Link_Role IN ('parent_layout', 'parent_script')
),
local_var AS (
  -- Stufe C: lokale Variablen ($x; global=$$, superglobal=$$$). Prefix-Test
  -- exhaustiv (alle Variablen-Knoten beginnen mit '$'); Object_Type-Guard schützt
  -- vor '$'-benannten Nicht-Variablen.
  SELECT Object_UUID
  FROM ObjectCatalog
  WHERE Object_Type = 'Variable'
    AND Object_Name LIKE '$%'
    AND Object_Name NOT LIKE '$$%'
),
hoisted AS (
  SELECT
    COALESCE(cs.parent, ol.Source_UUID) AS a,
    -- Klon-Robustheit: Datei mitführen. Containment (parent_layout/parent_script) ist
    -- datei-lokal → der hochgezogene Container liegt in DERSELBEN Datei wie das Sub-
    -- Objekt → a_file = ol.Source_File (analog b_file). Erlaubt dem Subgraph-Walk, einer
    -- Kante datei-genau zu folgen statt eine geklonte UUID über alle Dateien zu mergen.
    ol.Source_File AS a_file,
    COALESCE(ct.parent, ol.Target_UUID) AS b,
    ol.Target_File AS b_file,
    ol.Link_Role,
    ol.Link_Subrole,
    ol.Link_Type,
    ol.Is_Cross_File
  FROM ObjectLinks ol
  LEFT JOIN container cs ON cs.child = ol.Source_UUID
  LEFT JOIN container ct ON ct.child = ol.Target_UUID
  WHERE ol.Link_Type = 'operational'
    -- Containment-Gerüst raus (parent_table bleibt: echte Field→BaseTable-Referenz)
    AND ol.Link_Role NOT IN
        ('parent_layout', 'parent_script', 'parent_object', 'parent_folder')
    -- Waisen raus: beide Endpunkte müssen katalogisiert sein
    AND ol.Source_UUID IN (SELECT Object_UUID FROM ObjectCatalog)
    AND ol.Target_UUID IN (SELECT Object_UUID FROM ObjectCatalog)
)
SELECT DISTINCT
  a            AS Source_UUID,
  a_file       AS Source_File,
  b            AS Target_UUID,
  b_file       AS Target_File,
  Link_Role,
  Link_Subrole,
  Link_Type,
  Is_Cross_File
FROM hoisted
WHERE a <> b   -- durch Hochziehen entstandene Selbst-Schleifen verwerfen
  -- Stufe C: lokale Variablen-Pendants (beide Endpunkte) entfernen
  AND a NOT IN (SELECT Object_UUID FROM local_var)
  AND b NOT IN (SELECT Object_UUID FROM local_var);
