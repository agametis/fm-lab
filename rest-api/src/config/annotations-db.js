const { DuckDBInstance } = require('@duckdb/node-api');
const path = require('path');
const fs = require('fs');
const environment = require('./environment');

/**
 * Sidecar-DB für User-Annotationen (Noise-Filter & semantische Anreicherung).
 *
 * Eigene SCHREIBBARE DuckDB-Datei (`solutions/<id>/db/fm_annotations.duckdb`),
 * getrennt von der READ_ONLY-Analyse-Kopie. Damit kollidieren Frontend-
 * Schreibvorgänge NICHT mit dem File-Lock von convert-xml/cluster.sh (die nur
 * fm_catalog.duckdb sperren) und der Master→Kopie-Sync überschreibt die
 * Annotationen nicht (anderer Dateiname).
 *
 * Ausbaustufe M: EIN Sidecar je Lösung (Cluster-Namen/Sichtbarkeit dürfen
 * nicht zwischen Lösungen bluten), gepoolt parallel zum Katalog-Pool in
 * config/database.js — dessen Eviction schließt den Sidecar der Lösung mit
 * (closeSolution). Kein eigener LRU-Deckel: die Lebensdauer folgt dem
 * Katalog-Eintrag. Single-Writer bleibt gewahrt (ein API-Prozess schreibt).
 *
 * Inhalt:
 *   - NodeVisibility            — objekt-genaue Sichtbarkeit (uuid::file), stabil
 *   - CommunityAnnotation       — Name/Notiz je (Engine, Community) — Live-Overlay
 *   - CommunityAnnotationMembers— Member-Snapshot für P4-Offline-Survival (Votum)
 *
 * Guarded: lässt sich ein Sidecar nicht öffnen (oder ANNOTATIONS_ENABLED=false),
 * bleibt `isAvailable(ctx)` für diese Lösung false und alle Overlays/Schreiber
 * sind No-ops — der Rest der API läuft unverändert weiter.
 */

const pool = new Map(); // solutionId → slot { solutionId, promise, entry, available }

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

function dbPath(solutionId) {
  // Per Lösung (Bundle-Master, RW) — zentral aufgelöst in solutions.js;
  // ANNOTATIONS_DB_PATH überschreibt weiterhin (nur für den Server-Default).
  return require('./solutions').resolveAnnotationsPath(solutionId);
}

function ctxSolution(ctx) {
  if (ctx && typeof ctx.solution === 'string') return ctx.solution;
  return require('./solutions').getActiveSolutionId();
}

async function openEntry(solutionId) {
  const p = dbPath(solutionId);
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const instance = await DuckDBInstance.create(p, { access_mode: 'READ_WRITE' });
  const connection = await instance.connect();
  for (const ddl of SCHEMA) {
    await (await connection.prepare(ddl)).run();
  }
  console.log(`Annotations sidecar ready (READ_WRITE, solution: ${solutionId}) at: ${p}`);
  return { instance, connection };
}

/** Slot beschaffen (lazy, in-flight-dedupliziert). Öffnen scheitert weich. */
async function acquireSlot(solutionId) {
  if (!environment.annotations.enabled) return null;
  let slot = pool.get(solutionId);
  if (!slot) {
    slot = { solutionId, promise: null, entry: null, available: false };
    slot.promise = openEntry(solutionId)
      .then((entry) => {
        slot.entry = entry;
        slot.available = true;
        return entry;
      })
      .catch((err) => {
        // Häufigster Fall: ein anderer Prozess hält die Datei bereits RW (zweite
        // API-Instanz). Feature für diese Lösung aus, Rest der API läuft weiter.
        console.warn(`Annotations sidecar unavailable (solution: ${solutionId}) — feature disabled: ${err.message}`);
        slot.available = false;
        slot.entry = null;
        return null;
      });
    pool.set(solutionId, slot);
  }
  await slot.promise;
  return slot;
}

/** Boot-Pfad: Sidecar der Server-Default-Lösung öffnen (wie bisher initialize()). */
async function initialize() {
  if (!environment.annotations.enabled) {
    console.log('Annotations sidecar disabled (ANNOTATIONS_ENABLED=false) — annotation features off.');
    return null;
  }
  const slot = await acquireSlot(require('./solutions').getActiveSolutionId());
  return slot && slot.entry ? slot.entry.connection : null;
}

/**
 * Verfügbarkeit für die Kontext-Lösung — ASYNC (Ausbaustufe M): der erste
 * Aufruf einer Lösung öffnet ihren Sidecar lazy. Aufrufer: `await isAvailable(ctx)`.
 */
async function isAvailable(ctx) {
  if (!environment.annotations.enabled) return false;
  const slot = await acquireSlot(ctxSolution(ctx));
  return !!(slot && slot.available && slot.entry);
}

// Request-Kontext-Kontrakt — wie config/database.js: ctx-erste Signaturen.
// Legacy-Form (sql-first) → einmalige WARN, läuft mit Server-Default weiter.
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
    return { ctx: null, sql: ctx, params: Array.isArray(sql) ? sql : [] };
  }
  return { ctx, sql, params: params || [] };
}

/** Lese-Query → rows (leeres Array, wenn der Sidecar der Lösung nicht verfügbar ist). */
async function query(ctxArg, sqlArg, paramsArg = []) {
  const { ctx, sql, params } = normalizeArgs(ctxArg, sqlArg, paramsArg, 'query');
  const slot = await acquireSlot(ctxSolution(ctx));
  if (!slot || !slot.available || !slot.entry) return [];
  let stmt = null;
  try {
    stmt = await slot.entry.connection.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    const result = await stmt.run();
    return await result.getRowObjectsJS();
  } finally {
    if (stmt) { try { stmt.destroySync(); } catch { /* freed */ } }
  }
}

/** Schreib-Statement (INSERT/UPDATE/DELETE). Wirft, wenn nicht verfügbar. */
async function run(ctxArg, sqlArg, paramsArg = []) {
  const { ctx, sql, params } = normalizeArgs(ctxArg, sqlArg, paramsArg, 'run');
  const slot = await acquireSlot(ctxSolution(ctx));
  if (!slot || !slot.available || !slot.entry) throw new Error('Annotations sidecar not available');
  let stmt = null;
  try {
    stmt = await slot.entry.connection.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    await stmt.run();
  } finally {
    if (stmt) { try { stmt.destroySync(); } catch { /* freed */ } }
  }
}

/**
 * Sidecar GENAU EINER Lösung schließen — gerufen von der Pool-Eviction/dem
 * gezielten Reload in config/database.js und vor Delete/Rename einer Lösung.
 */
async function closeSolution(solutionId) {
  const slot = pool.get(solutionId);
  if (!slot) return false;
  pool.delete(solutionId);
  try {
    const entry = await slot.promise;
    if (entry) {
      entry.connection.disconnectSync();
      entry.instance.closeSync();
      console.log(`Annotations sidecar closed (solution: ${solutionId})`);
    }
  } catch (err) {
    console.warn(`Annotations sidecar close error (solution: ${solutionId}): ${err.message}`);
  }
  return true;
}

/** Shutdown: alle Sidecars schließen. */
async function close() {
  const ids = [...pool.keys()];
  for (const id of ids) {
    await closeSolution(id);
  }
}

module.exports = { initialize, isAvailable, query, run, close, closeSolution, dbPath };
