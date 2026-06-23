-- @template_type: report
-- @title: Graph Subgraph (Recursive k-Hop)
-- @description: Fokus-zentrierter k-Hop-Subgraph aus ObjectCatalog/ObjectLinks — gefiltert, gedeckelt, ehrlich gekürzt
-- @params: focus (required, UUID), depth, direction, mode, types, roles, include_builtins, node_limit, hub_degree
-- @version: 1.1.0
-- @author: Marcel / Claude
-- @tags: graph, subgraph, explorer
-- @note: Plan plan_graphify_style_visualisierung.md §6.1 + plan_graphify_cluster_v2.md §3.4. Core-Endpoint /api/graph/subgraph.
--        1.1.0: logische Sicht liest aus der View LogicalLinks (P5) statt Inline-CTE.
--        VORAUSSETZUNG: die READ_ONLY-API-Kopie muss die View enthalten (frischer
--        convert-xml --batch synct LogicalLinks/ClusterEdges mit). Ältere Kopien
--        ohne die View brechen hier — daher v2-Plan-Reihenfolge: erst B (P5-Views), dann das.
--
-- ============================================================================
-- PARAMETER (von graph.service.js via Joi mit Defaults gesetzt, string-interpoliert)
-- ============================================================================
--   focus            UUID des Fokus-Knotens                       (Pflicht)
--   depth            Rekursionstiefe 1..4                          (Default 1)
--   direction        'out' | 'in' | 'both'                        (Default 'both')
--   mode             'logical' | 'raw'                            (Default 'logical')
--   types            CSV der erlaubten Object_Type, NULL=alle      (Default NULL)
--   roles            CSV der erlaubten Link_Role, NULL=alle        (Default NULL)
--   include_builtins TRUE blendet BuiltinFunction-Ziele ein        (Default FALSE)
--   node_limit       harter Knoten-Deckel (LE-2)                   (Default 1000)
--   hub_degree       Grad-Schwelle für isHub-Markierung            (Default 100)
--
-- Die Template-Engine (template.service.js) ersetzt getvariable('x') durch das
-- escapte Literal. mode/direction werden als geschützte UNION-Zweige formuliert:
-- nach der Interpolation ist genau ein Zweig konstant-TRUE, den Optimizer kappt
-- den anderen (kein dynamisches SQL, weiterhin ein einziges Statement).
--
-- CLI-Test (getvariable existiert in DuckDB nativ):
--   SET VARIABLE focus = '…'; SET VARIABLE depth = 2; …  dann diese Datei.
--
-- ============================================================================
-- AUSGABE — eine getaggte Union (row_kind), die der Service partitioniert:
--   row_kind='node' → nodes[]   (id,label,type,file,depth,degree,is_hub,is_focus)
--   row_kind='edge' → edges[]   (id,source,target,role,subrole,link_type,cross_file)
-- `total_reachable` (auf jeder node-Zeile identisch) trägt die VOR-Deckel-Anzahl:
--   truncated = total_reachable > node_limit   (Prinzip "no silent caps").
--   nodeCount/edgeCount/maxDepthReached rechnet der Service aus den Arrays.
-- ============================================================================

WITH RECURSIVE
-- 1) Roh-Kanten mit Waisen-Filter (LE-4): beide Endpunkte katalogisiert.
raw_links AS (
  SELECT
    Source_UUID AS a, Target_UUID AS b,
    Link_Role, Link_Subrole, Link_Type, Is_Cross_File
  FROM ObjectLinks
  WHERE Source_UUID IN (SELECT Object_UUID FROM ObjectCatalog)
    AND Target_UUID IN (SELECT Object_UUID FROM ObjectCatalog)
),
-- 2) Logische Sicht: Sub-Objekt-Endpunkte auf Container hochziehen (LE-3).
--    Seit der VIEW-Promotion (plan_graphify_cluster_v2.md §3.4) liest dieser
--    Schritt direkt aus der in convert-xml Phase 5 angelegten View LogicalLinks
--    (kanonische Definition: graph_logical_links.sql) statt die container/hoist/
--    dedup-Kette inline zu wiederholen. Semantisch bit-identisch: LogicalLinks ist
--    exakt operational-Links, Sub-Objekte hochgezogen, Containment-Gerüst + Waisen
--    raus, (a,b,role,…)-dedupliziert, Selbst-Schleifen verworfen. Spalten auf das
--    interne (a,b)-Schema gemappt. raw_links BLEIBT (mode=raw + Fokus-Brücke
--    brauchen die strukturellen parent_*-Kanten, die LogicalLinks bewusst weglässt).
logical_dedup AS (
  SELECT
    Source_UUID AS a, Target_UUID AS b,
    Link_Role, Link_Subrole, Link_Type, Is_Cross_File
  FROM LogicalLinks
),
-- 3) Aktive Basis nach mode wählen (ein Zweig wird nach Interpolation gekappt).
base AS (
  SELECT a, b, Link_Role, Link_Subrole, Link_Type, Is_Cross_File
  FROM logical_dedup
  WHERE getvariable('mode') = 'logical'
  UNION ALL
  -- Fokus-Brücke (logical): ist der Fokus selbst ein Sub-Objekt (ScriptStep /
  -- LayoutObject), wurden alle seine operationalen Kanten auf den Container
  -- hochgezogen → er hätte keine eigene logische Kante und stünde isoliert da.
  -- Die echte strukturelle Parent-Kante (Fokus → Script/Layout) hält den
  -- Einstieg anschlussfähig: der Walk erreicht den Container und entfaltet von
  -- dort die hochgezogene Nachbarschaft. Greift nur für den Fokus (nicht für
  -- jeden Sub-Knoten — das wäre die verworfene „raw"-Sicht).
  SELECT a, b, Link_Role, Link_Subrole, Link_Type, Is_Cross_File
  FROM raw_links
  WHERE getvariable('mode') = 'logical'
    AND a = getvariable('focus')
    AND Link_Role IN ('parent_layout', 'parent_script')
  UNION ALL
  SELECT a, b, Link_Role, Link_Subrole, Link_Type, Is_Cross_File
  FROM raw_links
  WHERE getvariable('mode') = 'raw'
),
-- 4) Kanten-Filter: Builtins (LE-4) + optionale Rollen-Whitelist.
--    Builtin-Filter über den Ziel-Typ → Join auf ObjectCatalog.
base_f AS (
  SELECT base.a, base.b, base.Link_Role, base.Link_Subrole,
         base.Link_Type, base.Is_Cross_File
  FROM base
  JOIN ObjectCatalog tc ON tc.Object_UUID = base.b
  WHERE (getvariable('include_builtins') = TRUE OR tc.Object_Type <> 'BuiltinFunction')
    AND (getvariable('roles') IS NULL
         OR base.Link_Role IN (SELECT unnest(string_split(CAST(getvariable('roles') AS VARCHAR), ','))))
),
-- 5) Gerichtete Kantenmenge (direction): ein/beide Zweige nach Interpolation aktiv.
edges AS (
  SELECT a, b FROM base_f WHERE getvariable('direction') IN ('out', 'both')
  UNION
  SELECT b AS a, a AS b FROM base_f WHERE getvariable('direction') IN ('in', 'both')
  UNION
  -- Fokus-Brücke richtungsunabhängig walkbar halten (auch bei direction='in'),
  -- damit ein Sub-Objekt-Einstieg nie isoliert bleibt (s. base-CTE).
  SELECT a, b FROM base_f
  WHERE getvariable('mode') = 'logical'
    AND a = getvariable('focus')
    AND Link_Type = 'structural'
),
-- 6) Rekursiver Walk ab Fokus. UNION (nicht ALL) ⇒ Zyklen-Dedup.
walk AS (
  SELECT getvariable('focus') AS uuid, 0 AS depth
  UNION
  SELECT e.b, w.depth + 1
  FROM walk w
  JOIN edges e ON e.a = w.uuid
  WHERE w.depth < CAST(getvariable('depth') AS INT)
),
reached AS (
  SELECT uuid, MIN(depth) AS depth FROM walk GROUP BY uuid
),
-- 7) Globaler operationaler Grad — NUR für die erreichten Knoten (speicher-
--    schonend, LE-7). Direkt aus ObjectLinks mit IN-(reached)-Pushdown: DuckDB
--    streamt die 798k Kanten und behält nur die ~N Treffer, statt den ganzen
--    Graph zu aggregieren (vermeidet den 2-GB-OOM des Servers). Bewusst
--    `Link_Type='operational'`: Roh-Total-Grad würde jedes mehrschrittige Script
--    über seine parent_script-Links fälschlich als Hub markieren. Konsequenz:
--    in logical-Sicht ist der Grad eines Containers (Layout) sein EIGENER
--    operationaler Grad ohne die hochgezogenen Sub-Objekt-Kanten — als Hub-
--    Signal ausreichend (echte Hubs sind Builtins/zentrale Scripts).
deg AS (
  SELECT id, COUNT(*) AS degree
  FROM (
    SELECT Source_UUID AS id FROM ObjectLinks
    WHERE Link_Type = 'operational' AND Source_UUID IN (SELECT uuid FROM reached)
    UNION ALL
    SELECT Target_UUID AS id FROM ObjectLinks
    WHERE Link_Type = 'operational' AND Target_UUID IN (SELECT uuid FROM reached)
  )
  GROUP BY id
),
-- 8) Knoten + optionaler Typ-Filter; degree/depth für das Ranking.
nodes_ranked AS (
  SELECT
    r.uuid, r.depth,
    oc.Object_Type AS type, oc.Object_Name AS label, oc.File_Name AS file,
    COALESCE(d.degree, 0) AS degree
  FROM reached r
  JOIN ObjectCatalog oc ON oc.Object_UUID = r.uuid
  LEFT JOIN deg d ON d.id = r.uuid
  WHERE (getvariable('types') IS NULL
         OR oc.Object_Type IN (SELECT unnest(string_split(CAST(getvariable('types') AS VARCHAR), ','))))
),
-- 9) Deckel (LE-2): kleinste depth zuerst, dann höchster Grad. Materialisieren-
--    dann-Trimmen — der Walk ist günstig (~0,26 s selbst für 135k erreichbare
--    Knoten); die Ergebnis-Größe, nicht die CTE, ist der Engpass.
nodes_capped AS (
  SELECT *, ROW_NUMBER() OVER (ORDER BY depth ASC, degree DESC, label ASC) AS rn
  FROM nodes_ranked
),
kept AS (
  SELECT * FROM nodes_capped
  WHERE rn <= CAST(getvariable('node_limit') AS INT)
),
-- 10) Kanten des Subgraphen: beide Endpunkte überleben den Deckel.
final_edges AS (
  SELECT DISTINCT
    bf.a AS source, bf.b AS target,
    bf.Link_Role AS role, bf.Link_Subrole AS subrole,
    bf.Link_Type AS link_type, bf.Is_Cross_File AS cross_file
  FROM base_f bf
  WHERE bf.a IN (SELECT uuid FROM kept)
    AND bf.b IN (SELECT uuid FROM kept)
)
-- ── getaggte Ausgabe ───────────────────────────────────────────────────────
SELECT
  'node'                                                AS row_kind,
  k.uuid                                                AS id,
  k.label                                               AS label,
  k.type                                                AS type,
  k.file                                                AS file,
  k.depth                                               AS depth,
  k.degree                                              AS degree,
  (k.degree >= CAST(getvariable('hub_degree') AS INT))  AS is_hub,
  (k.uuid = getvariable('focus'))                       AS is_focus,
  (SELECT COUNT(*) FROM nodes_ranked)                   AS total_reachable,
  -- P5-Naht (LE-10): community/communityName werden NICHT hier gejoint, sondern
  -- im Service (graph.service.js enrichCommunities) nachgereicht — bewusst, damit
  -- der Subgraph READ_ONLY ohne ObjectClusters/CommunityNames läuft (ein harter
  -- JOIN auf eine fehlende Tabelle bräche den ganzen Explorer vor dem 1. Cluster-
  -- Lauf). Dieser Platzhalter bleibt NULL; der Service überschreibt ihn.
  NULL                                                  AS community,
  NULL                                                  AS source,
  NULL                                                  AS target,
  NULL                                                  AS role,
  NULL                                                  AS subrole,
  NULL                                                  AS link_type,
  NULL                                                  AS cross_file
FROM kept k
UNION ALL
SELECT
  'edge',
  (e.source || '|' || COALESCE(e.role, '') || '|' || e.target),
  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  e.source, e.target, e.role, e.subrole, e.link_type, e.cross_file
FROM final_edges e
ORDER BY row_kind, degree DESC NULLS LAST;
