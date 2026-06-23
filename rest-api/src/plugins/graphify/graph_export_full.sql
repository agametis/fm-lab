-- @title: Graphify Full Graph Export
-- @description: ObjectCatalog → nodes, ObjectLinks → edges (orphan-filtered) as JSON arrays
-- @version: 1.0.0
--
-- Full graph export for the `graphify` plugin. Emits TWO JSON arrays via native
-- DuckDB COPY (memory-bounded — DuckDB streams, nothing is materialised in Node):
--   {{NODES_OUT}}  — one object per ObjectCatalog row
--   {{EDGES_OUT}}  — one object per ObjectLinks row, orphans removed
--
-- The two `{{…}}` tokens are substituted with absolute temp-file paths by
-- export-graph.mjs before the file is handed to the duckdb binary. They are NOT
-- DuckDB syntax — `COPY … TO` requires a string literal target, so the path
-- cannot be a getvariable()/parameter. The .mjs core then streams both arrays
-- into one `{ meta, nodes, edges }` document under output/.
--
-- Run against a READ_ONLY connection — COPY … TO writes to the OS filesystem,
-- not the database, so it is allowed without write access (verified, DuckDB 1.5).

-- Nodes: every catalogued object + its undirected degree (in + out links).
COPY (
  WITH deg AS (
    SELECT id, SUM(d) AS degree FROM (
      SELECT Source_UUID AS id, COUNT(*) AS d FROM ObjectLinks WHERE Source_UUID IS NOT NULL GROUP BY 1
      UNION ALL
      SELECT Target_UUID AS id, COUNT(*) AS d FROM ObjectLinks WHERE Target_UUID IS NOT NULL GROUP BY 1
    ) GROUP BY id
  )
  SELECT
    oc.Object_UUID                 AS id,
    oc.Object_Name                 AS label,
    oc.Object_Type                 AS type,
    oc.File_Name                   AS file,
    COALESCE(deg.degree, 0)::INT   AS degree
  FROM ObjectCatalog oc
  LEFT JOIN deg ON deg.id = oc.Object_UUID
  ORDER BY degree DESC, oc.Object_Type, oc.Object_Name
) TO '{{NODES_OUT}}' (FORMAT json, ARRAY true);

-- Edges: every link whose BOTH endpoints exist in the catalog (LE-4 orphan
-- filter). `relation` = Link_Role; `confidence` is EXTRACTED (deterministic from
-- the XML) for all links in this MVP.
COPY (
  SELECT
    (ol.Source_UUID || '|' || COALESCE(ol.Link_Role, '') || '|' || ol.Target_UUID) AS id,
    ol.Source_UUID    AS source,
    ol.Target_UUID    AS target,
    ol.Link_Role      AS relation,
    ol.Link_Subrole   AS subrole,
    ol.Link_Type      AS linkType,
    ol.Is_Cross_File  AS crossFile,
    'EXTRACTED'       AS confidence
  FROM ObjectLinks ol
  WHERE ol.Source_UUID IN (SELECT Object_UUID FROM ObjectCatalog)
    AND ol.Target_UUID IN (SELECT Object_UUID FROM ObjectCatalog)
) TO '{{EDGES_OUT}}' (FORMAT json, ARRAY true);
