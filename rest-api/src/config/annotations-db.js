const { DuckDBInstance } = require('@duckdb/node-api');
const path = require('path');
const fs = require('fs');
const environment = require('./environment');

/**
 * Sidecar-DB für User-Annotationen (Noise-Filter & semantische Anreicherung).
 *
 * Eigene SCHREIBBARE DuckDB-Datei (`db/fm_annotations.duckdb`), getrennt von der
 * READ_ONLY-Analyse-Kopie. Damit kollidieren Frontend-Schreibvorgänge NICHT mit
 * dem File-Lock von convert-xml/cluster.sh (die nur fm_catalog.duckdb sperren) und
 * der Master→Kopie-Sync überschreibt die Annotationen nicht (anderer Dateiname).
 *
 * Inhalt:
 *   - NodeVisibility            — objekt-genaue Sichtbarkeit (uuid::file), stabil
 *   - CommunityAnnotation       — Name/Notiz je (Engine, Community) — Live-Overlay
 *   - CommunityAnnotationMembers— Member-Snapshot für P4-Offline-Survival (Votum)
 *
 * Guarded: lässt sich der Sidecar nicht öffnen (oder ANNOTATIONS_ENABLED=false),
 * bleibt `available()` false und alle Overlays/Schreiber sind No-ops — der Rest
 * der API läuft unverändert weiter (gleiche „weiche Naht" wie enrichCommunities).
 */

let instance = null;
let connection = null;
let available = false;

function dbPath() {
  // Per Lösung (Bundle-Master, RW) — zentral aufgelöst in solutions.js;
  // ANNOTATIONS_DB_PATH überschreibt weiterhin.
  return require('./solutions').resolveAnnotationsPath();
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS NodeVisibility (
     Object_UUID VARCHAR NOT NULL,
     File_Name   VARCHAR,
     Visible     BOOLEAN NOT NULL DEFAULT TRUE,
     Updated_At  TIMESTAMP DEFAULT now()
   )`,
  // Live-Overlay-Key (Engine, Community) — stabil zwischen zwei Re-Cluster-Läufen.
  `CREATE TABLE IF NOT EXISTS CommunityAnnotation (
     Engine     VARCHAR NOT NULL,
     Community  INTEGER NOT NULL,
     User_Name  VARCHAR,
     User_Notes VARCHAR,
     Updated_At TIMESTAMP DEFAULT now()
   )`,
  // Member-Snapshot (objekt-genau) — nur für P4: überlebt Re-Clustering via
  // Mehrheitsvotum (Community-IDs driften, Objektidentität bleibt).
  `CREATE TABLE IF NOT EXISTS CommunityAnnotationMembers (
     Engine      VARCHAR NOT NULL,
     Community   INTEGER NOT NULL,
     Object_UUID VARCHAR NOT NULL,
     File_Name   VARCHAR
   )`,
  // R3 — objekt-granularer, durabler Skill-Namen-Snapshot. Spiegelt die
  // Master-`Semantic_Name`/`Semantic_Description` (Copy) in den Sidecar, damit
  // sie einen Force-Rebuild (rm master) überleben — genau wie die User-Namen.
  // Geschrieben NUR von der API (Reload-Hook); cluster.sh fasst den
  // RW-gelockten Sidecar nie an.
  `CREATE TABLE IF NOT EXISTS SemanticNameSidecarCache (
     Object_UUID          VARCHAR NOT NULL,
     File_Name            VARCHAR,
     Semantic_Name        VARCHAR,
     Semantic_Description VARCHAR,
     Engine               VARCHAR,
     Cached_At            TIMESTAMP DEFAULT now()
   )`,
  // R3 — (Engine, Community)-Overlay der nach Repartition per Mehrheitsvotum
  // restaurierten Skill-Namen. Wird bei jedem Reload neu geschrieben und vom
  // Coverage-/Graph-Label-Pfad als 3. Namensquelle gelesen.
  `CREATE TABLE IF NOT EXISTS SemanticNameRestore (
     Engine               VARCHAR NOT NULL,
     Community            INTEGER NOT NULL,
     Semantic_Name        VARCHAR,
     Semantic_Description VARCHAR,
     Updated_At           TIMESTAMP DEFAULT now()
   )`,
];

async function initialize() {
  if (connection) return connection;
  if (!environment.annotations.enabled) {
    console.log('Annotations sidecar disabled (ANNOTATIONS_ENABLED=false) — annotation features off.');
    available = false;
    return null;
  }
  try {
    const p = dbPath();
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    instance = await DuckDBInstance.create(p, { access_mode: 'READ_WRITE' });
    connection = await instance.connect();
    for (const ddl of SCHEMA) {
      await (await connection.prepare(ddl)).run();
    }
    available = true;
    console.log(`Annotations sidecar ready (READ_WRITE) at: ${p}`);
    return connection;
  } catch (err) {
    // Häufigster Fall: ein anderer Prozess hält die Datei bereits RW (zweite API-
    // Instanz). Dann bleibt das Feature aus, der Rest der API läuft normal weiter.
    console.warn(`Annotations sidecar unavailable — feature disabled: ${err.message}`);
    available = false;
    instance = null;
    connection = null;
    return null;
  }
}

function isAvailable() {
  return available && !!connection;
}

// Request-Kontext-Kontrakt — wie config/database.js: ctx-erste
// Signaturen, Phase 1.5 ignoriert ctx funktional (Ausbaustufe M poolt den
// Sidecar je Lösung mit). Legacy-Form (sql-first) → einmalige WARN.
const warnedLegacySites = new Set();

function normalizeArgs(ctx, sql, params, fn) {
  if (typeof ctx === 'string') {
    const stack = String(new Error().stack || '').split('\n');
    const line = stack.find((l) => l.includes('/src/') && !l.includes('config/annotations-db.js'));
    const site = line ? line.trim() : 'unknown';
    if (!warnedLegacySites.has(site)) {
      warnedLegacySites.add(site);
      console.warn(`[annotations-db] DEPRECATED contextless ${fn}() call — pass the request context. At: ${site}`);
    }
    return { sql: ctx, params: Array.isArray(sql) ? sql : [] };
  }
  return { sql, params: params || [] };
}

/** Lese-Query → rows (leeres Array, wenn der Sidecar nicht verfügbar ist). */
async function query(ctx, sqlArg, paramsArg = []) {
  const { sql, params } = normalizeArgs(ctx, sqlArg, paramsArg, 'query');
  if (!isAvailable()) return [];
  let stmt = null;
  try {
    stmt = await connection.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    const result = await stmt.run();
    return await result.getRowObjectsJS();
  } finally {
    if (stmt) { try { stmt.destroySync(); } catch { /* freed */ } }
  }
}

/** Schreib-Statement (INSERT/UPDATE/DELETE). Wirft, wenn nicht verfügbar. */
async function run(ctx, sqlArg, paramsArg = []) {
  const { sql, params } = normalizeArgs(ctx, sqlArg, paramsArg, 'run');
  if (!isAvailable()) throw new Error('Annotations sidecar not available');
  let stmt = null;
  try {
    stmt = await connection.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    await stmt.run();
  } finally {
    if (stmt) { try { stmt.destroySync(); } catch { /* freed */ } }
  }
}

async function close() {
  available = false;
  try {
    if (connection) connection.disconnectSync();
    if (instance) instance.closeSync();
  } catch (err) {
    console.warn(`Annotations sidecar close error: ${err.message}`);
  } finally {
    connection = null;
    instance = null;
  }
}

module.exports = { initialize, isAvailable, query, run, close, dbPath };
