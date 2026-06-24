const { LRUCache } = require('lru-cache');
const templateService = require('./template.service');
const db = require('../config/database');

/**
 * LRU-Cache für Subgraph-Antworten („LRU-Cache cacht (focus, depth,
 * direction, mode)"). Schlüssel = vollständige Parametermenge. Der Explorer
 * fragt denselben Fokus beim Filter-Togglen oft erneut ab — Cache spart die
 * Recursive-CTE. Invalidierung über TTL; nach einem convert-xml-Reload sind die
 * Daten neu, aber die kurze TTL fängt das praktisch ab (Worst Case: 5 min stale).
 */
const subgraphCache = new LRUCache({
  max: 200,
  ttl: 1000 * 60 * 5, // 5 min
});

function subgraphCacheKey(p) {
  return [
    p.focus, p.focus_file ?? '', p.depth, p.direction, p.mode,
    p.types ?? '', p.roles ?? '',
    p.include_builtins, p.node_limit, p.hub_degree,
  ].join('|');
}

/**
 * Graph Service (Subgraph-Backend)
 *
 * Liefert fokus-zentrierte k-Hop-Subgraphen aus ObjectCatalog/ObjectLinks.
 * SQL-Kern: templates/sql/graph_subgraph.sql (Recursive CTE, mode=logical via
 * graph_logical_links.sql-Logik, Deckel + ehrliche Truncation).
 *
 * Dieser Service ist Core.
 */

function escapeLiteral(value) {
  return String(value).replace(/'/g, "''");
}

/**
 * P5-Naht — Community-Anreicherung, abgesichert gegen fehlende Tabellen.
 *
 * Bewusst NICHT als LEFT JOIN in graph_subgraph.sql: der Subgraph läuft READ_ONLY
 * gegen die rest-api-Kopie und muss funktionieren, BEVOR P5-Clustering jemals lief
 * (ein harter Join auf eine nicht existierende ObjectClusters-Tabelle würde den
 * GESAMTEN Explorer brechen). Stattdessen reichert der Service nach: existieren
 * ObjectClusters + CommunityNames, wird eine schlanke IN-(≤node_limit)-Abfrage
 * nachgeschoben; sonst bleiben community/communityName null (= Verhalten vor P5).
 * Hält den Subgraph cluster-unabhängig (kein convert-xml-Wiring).
 *
 * Memoisiert (einmal pro Prozess); clearCache() setzt zurück, damit ein Reload
 * (frisch geclusterte DB) die Tabellen neu erkennt.
 */
let _communityTablesPresent = null;

async function communityTablesPresent() {
  if (_communityTablesPresent !== null) return _communityTablesPresent;
  const result = await db.executeQuery(
    `SELECT COUNT(*) AS cnt FROM information_schema.tables
      WHERE table_name IN ('ObjectClusters', 'CommunityNames')`
  );
  const row = result.rows[0];
  const cnt = typeof row.cnt === 'bigint' ? Number(row.cnt) : row.cnt;
  _communityTablesPresent = cnt === 2;
  return _communityTablesPresent;
}

/**
 * Setzt community (INT-Key, für die Farb-Bucketing-Palette) + communityName
 * (COALESCE(Semantic_Name, Heuristic_Name), für Anzeige/Legende) auf den Knoten.
 * Mutiert `nodes` in place. No-op, wenn keine Cluster-Tabellen vorhanden sind.
 */
async function enrichCommunities(nodes) {
  if (nodes.length === 0) return;
  if (!(await communityTablesPresent())) return;

  // Klon-Robustheit: ObjectClusters ist auf (Object_UUID, File_Name) gekeyt (Cluster-
  // Node-Key) → Community-Match DATEI-GENAU,
  // damit zwei Klone derselben UUID NICHT die Community teilen. Wir laden über die rohe
  // n.uuid (IN-Liste ≤ node_limit) und matchen client-seitig über den composite Key
  // `uuid::file` — exakt das Node-id-Format aus graph_subgraph.sql (NULL-File ⇒ bare uuid).
  const uuids = [...new Set(nodes.map((n) => n.uuid).filter(Boolean))];
  if (uuids.length === 0) return;
  const inList = uuids.map((u) => `'${escapeLiteral(u)}'`).join(',');
  const result = await db.executeQuery(
    `SELECT c.Object_UUID AS uuid,
            c.File_Name    AS file,
            c.Community    AS community,
            COALESCE(cn.Semantic_Name, cn.Heuristic_Name) AS community_name
       FROM ObjectClusters c
       LEFT JOIN CommunityNames cn
         ON cn.Community = c.Community AND cn.Engine = c.Engine
      WHERE c.Object_UUID IN (${inList})`
  );
  const keyOf = (uuid, file) => `${uuid}::${file ?? ''}`;
  const byKey = new Map(result.rows.map((r) => [keyOf(r.uuid, r.file), r]));
  for (const n of nodes) {
    const hit = byKey.get(keyOf(n.uuid, n.file)) ?? null;
    n.community = hit ? Number(hit.community) : null;
    n.communityName = hit ? (hit.community_name ?? null) : null;
  }
}

/**
 * Fokus-Auflösung im ObjectCatalog (clone-aware). Liefert den Existenz-/
 * Eindeutigkeits-Status, damit der Controller drei Fälle unterscheiden kann:
 *   - { exists:false }                    → Fokus unbekannt (404)
 *   - { exists:true, ambiguous:true }     → UUID in mehreren Dateien, ohne focus_file (409)
 *   - { exists:true, ambiguous:false }    → eindeutig (bzw. via focus_file eingegrenzt) → 200
 * Geteilte UUIDs entstehen bei geklonten/modularen Dateien.
 * @param {string} uuid
 * @param {string} [file] - optionaler File_Name (focus_file)
 */
async function objectFocusStatus(uuid, file) {
  const where = file
    ? `Object_UUID = '${escapeLiteral(uuid)}' AND File_Name = '${escapeLiteral(file)}'`
    : `Object_UUID = '${escapeLiteral(uuid)}'`;
  const result = await db.executeQuery(
    `SELECT File_Name FROM ObjectCatalog WHERE ${where}`
  );
  const files = [...new Set(result.rows.map((r) => r.File_Name))].sort();
  return { exists: result.rows.length > 0, ambiguous: !file && files.length > 1, files };
}

/**
 * Rückwärtskompatibler Existenz-Check (bare UUID, ignoriert Mehrdeutigkeit).
 */
async function objectExists(uuid, file) {
  const { exists } = await objectFocusStatus(uuid, file);
  return exists;
}

/** Validierte Query-Params → graph_subgraph.sql-Parameter (NULL für optionale CSV). */
function toSubgraphParams(p) {
  return {
    focus: p.focus,
    // Klon-Robustheit: focus_file an das Template durchreichen — der Walk seedet auf
    // (focus, focus_file) und folgt der Kante datei-genau (sonst merged eine geklonte
    // Fokus-UUID die Nachbarschaften aller Dateien). NULL → Katalog-Auflösung (Nicht-Klon).
    focus_file: p.focus_file ?? null,
    depth: p.depth,
    direction: p.direction,
    mode: p.mode,
    types: p.types ?? null,
    roles: p.roles ?? null,
    include_builtins: p.include_builtins,
    node_limit: p.node_limit,
    hub_degree: p.hub_degree,
  };
}

/**
 * Fokus-zentrierter Subgraph.
 * @param {Object} p - Joi-validierte Query-Params (Defaults bereits angewandt)
 * @returns {Promise<{payload: Object, sql: string}>}
 */
async function getSubgraph(p) {
  const cacheKey = subgraphCacheKey(p);
  const cached = subgraphCache.get(cacheKey);
  if (cached) {
    return { payload: cached.payload, sql: cached.sql, cached: true };
  }

  const result = await templateService.executeTemplate(
    'graph_subgraph',
    toSubgraphParams(p),
    'report'
  );

  const nodes = [];
  const edges = [];
  let totalReachable = 0;
  let maxDepthReached = 0;

  // Getaggte Union partitionieren (row_kind = 'node' | 'edge').
  for (const r of result.data) {
    if (r.row_kind === 'node') {
      totalReachable = Number(r.total_reachable ?? 0); // auf jeder Knoten-Zeile identisch
      const depth = Number(r.depth ?? 0);
      if (depth > maxDepthReached) maxDepthReached = depth;
      nodes.push({
        id: r.id,            // composite (uuid::file) — eindeutiger Graph-Key bei Klonen
        uuid: r.uuid,        // rohe UUID für Navigation / Lazy-Expand / fmIDE
        label: r.label,
        type: r.type,
        file: r.file,
        depth,
        degree: Number(r.degree ?? 0),
        isHub: r.is_hub === true,
        isFocus: r.is_focus === true,
        community: null,      // P5-Naht — via enrichCommunities() gesetzt
        communityName: null,
      });
    } else if (r.row_kind === 'edge') {
      edges.push({
        id: r.id,
        source: r.source,
        target: r.target,
        role: r.role,
        subrole: r.subrole,
        linkType: r.link_type,
        crossFile: r.cross_file === true,
      });
    }
  }

  // P5-Naht: Community-Daten nachreichen (no-op ohne Cluster-Tabellen).
  await enrichCommunities(nodes);

  const payload = {
    focus: p.focus,
    params: {
      depth: p.depth,
      direction: p.direction,
      mode: p.mode,
      types: p.types ?? null,
      roles: p.roles ?? null,
      includeBuiltins: p.include_builtins,
      nodeLimit: p.node_limit,
      hubDegree: p.hub_degree,
    },
    truncated: totalReachable > p.node_limit, // "no silent caps"
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      totalReachable,
      maxDepthReached,
    },
    nodes,
    edges,
  };

  subgraphCache.set(cacheKey, { payload, sql: result.sql });
  return { payload, sql: result.sql, cached: false };
}

/**
 * 1-Hop-Expansion eines Knotens (Lazy-Expand im Explorer).
 * = Subgraph mit depth=1 — kein eigenes Template nötig.
 */
async function getNeighbors(p) {
  return getSubgraph({ ...p, depth: 1 });
}

/**
 * Fokus-Autocomplete über ObjectCatalog (Sucheingabe).
 * @returns {Promise<{payload: Object, sql: string}>}
 */
async function search(p) {
  const result = await templateService.executeTemplate(
    'graph_search',
    { q: p.q, type: p.type ?? null, file: p.file ?? null, limit: p.limit },
    'report'
  );
  const results = result.data.map(r => ({
    id: r.id,
    label: r.label,
    type: r.type,
    file: r.file,
  }));
  return {
    payload: { query: p.q, count: results.length, results },
    sql: result.sql,
  };
}

/**
 * Drop all cached subgraph responses. Called from performReload() so a DB swap
 * (XML re-import) or template change can never serve stale results within the
 * 5-min TTL window.
 */
function clearCache() {
  subgraphCache.clear();
  _communityTablesPresent = null; // nach Reload neu erkennen (P5-Tabellen könnten neu sein)
}

module.exports = {
  objectExists,
  objectFocusStatus,
  getSubgraph,
  getNeighbors,
  search,
  clearCache,
};
