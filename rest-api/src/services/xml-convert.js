const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const settingsStore = require('../plugins/settings-store');
const db = require('../config/database');
const annoDb = require('../config/annotations-db');
const environment = require('../config/environment');

/**
 * XML-Convert Bridge
 *
 * Spawnt `tools/convert_fm_xml.sh --batch --quiet` und parst dessen NDJSON-Output
 * Zeile für Zeile zu Events. Wird von `POST /api/xml/convert` (SSE) genutzt.
 * Verwaltet außerdem den persistierten Run-Record (.fmlab/last_xml_run.json)
 * und liefert den Status der XML-Dateien für `GET /api/xml/status`.
 */

const REPO_ROOT = settingsStore.resolveRepoRoot();
const SCRIPT_PATH = path.join(REPO_ROOT, 'tools', 'convert_fm_xml.sh');
const XML_DIR = path.join(REPO_ROOT, 'xml');
const FMLAB_DIR = path.join(REPO_ROOT, '.fmlab');
const LAST_RUN_PATH = path.join(FMLAB_DIR, 'last_xml_run.json');
const LOCK_PATH = path.join(FMLAB_DIR, 'xml_convert.lock');

// ---------------------------------------------------------------------------
// Laufzeit-/Reveal-Kontext für die „Ordner öffnen"-Affordance der Empty-State-
// Karte. Statisch über die Prozesslebensdauer → einmal beim Laden berechnen.
//   runtime       'native' | 'container' — expliziter Marker, sonst /.dockerenv
//   host_xml_dir  Host-Pfad des xml/-Ordners (nur Container, via Env injiziert)
//   can_reveal    nativ + verfügbarer Datei-Manager-Opener (open / xdg-open)
// ---------------------------------------------------------------------------
function detectRuntime() {
  const explicit = String(process.env.FMLAB_RUNTIME || '').trim().toLowerCase();
  if (explicit === 'container' || explicit === 'native') return explicit;
  if (fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv')) return 'container';
  return 'native';
}

function commandOnPath(cmd) {
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  return dirs.some((d) => {
    try { fs.accessSync(path.join(d, cmd), fs.constants.X_OK); return true; }
    catch { return false; }
  });
}

const RUNTIME = detectRuntime();
const HOST_REPO_ROOT = String(process.env.FMLAB_HOST_REPO_ROOT || '').trim();
// Host-xml/-Pfad nur posix verknüpfen (macOS/Linux-Host bzw. Repo INNERHALB WSL2).
const HOST_XML_DIR = HOST_REPO_ROOT
  ? `${HOST_REPO_ROOT.replace(/[\\/]+$/, '')}/xml`
  : null;
const REVEAL_COMMAND = process.platform === 'darwin'
  ? 'open'
  : (process.platform === 'linux' ? 'xdg-open' : null);
const CAN_REVEAL = RUNTIME === 'native'
  && REVEAL_COMMAND != null
  && (process.platform === 'darwin' || commandOnPath(REVEAL_COMMAND));

const RUN_RECORD_SCHEMA_VERSION = 1;
const MAX_EVENTS_RETAINED = 5000;

// Transiente Live-Lebenszyklus-Events (Turbo-Pfad): treiben ausschließlich die
// Live-Datei-Statusanzeige (useXmlConvertFileStates) WÄHREND eines Laufs. Der
// Log-Renderer (eventToLine) ignoriert sie, und auf einen Reload werden sie nicht
// erneut abgespielt. `import_progress` feuert pro Chunk (bei großen Builds tausende)
// und würde den persistierten Record (Cap MAX_EVENTS_RETAINED) fluten und den
// nützlichen Tail (Phasen-Marker, done) abschneiden. → live weiterreichen (SSE),
// aber NICHT in `.fmlab/last_xml_run.json` persistieren.
const TRANSIENT_EVENTS = new Set([
  'file_plan', 'file_skip', 'chunk_start', 'chunk_done',
  'import_start', 'import_progress', 'import_done',
]);

function nowIso() {
  return new Date().toISOString();
}

async function ensureFmlabDir() {
  await fsp.mkdir(FMLAB_DIR, { recursive: true });
}

/**
 * Listet das `xml/`-Verzeichnis. Liefert `{ filename, size, mtime }`-Tupel
 * (mtime als ISO-String). Fehlende Verzeichnisse → leere Liste.
 */
async function listXmlDirectory() {
  let entries;
  try {
    entries = await fsp.readdir(XML_DIR, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const files = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.toLowerCase().endsWith('.xml')) continue;
    if (e.name.startsWith('.')) continue;
    try {
      const stat = await fsp.stat(path.join(XML_DIR, e.name));
      files.push({
        filename: e.name,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        mtime_ms: stat.mtimeMs,
      });
    } catch {
      // Datei verschwand zwischen readdir und stat — ignorieren
    }
  }
  files.sort((a, b) => a.filename.localeCompare(b.filename, 'de'));
  return files;
}

/**
 * Liest `FilesCatalog` und gibt eine Map `filename → { imported_at, mtime_ms }`
 * zurück. Falls die DB-Datei nicht existiert oder die Tabelle leer ist, wird
 * eine leere Map geliefert (kein Fehler).
 *
 * FileMaker-XMLs liegen in `xml/<File>.xml`, FilesCatalog speichert nur den
 * `File_Name` (ohne Pfad und ohne .xml-Suffix). Wir vergleichen daher
 * über die Basis `<File>` (ohne Endung).
 */
async function readFilesCatalog() {
  try {
    // Import_Timestamp wird als UTC-naiver TIMESTAMP gespeichert (s. extract.sql
    // `now() AT TIME ZONE 'UTC'`). Wir serialisieren ihn server-seitig EXPLIZIT als
    // UTC-ISO mit `Z`-Suffix und liefern den Epoch (naiv als UTC interpretiert). So ist
    // die Anzeige TZ-unabhängig — der Browser rendert via `new Date(iso)` korrekt in die
    // lokale Zone, ohne dass ein naiver String fälschlich als Browser-Lokalzeit geparst
    // wird (das war der ~7h/DST-Versatz-Bug). Treiber-Date-vs-String-Mehrdeutigkeit entfällt.
    const { rows } = await db.executeQuery(
      `SELECT File_Name,
              strftime(Import_Timestamp, '%Y-%m-%dT%H:%M:%S') || 'Z' AS imported_at,
              epoch_ms(Import_Timestamp AT TIME ZONE 'UTC')        AS imported_ms
       FROM FilesCatalog`
    );
    const map = new Map();
    for (const row of rows) {
      if (!row || !row.File_Name) continue;
      const importedAt = row.imported_at != null ? String(row.imported_at) : null;
      const importedMs = row.imported_ms != null ? Number(row.imported_ms) : null;
      map.set(String(row.File_Name).normalize('NFC').toLowerCase(), {
        file_name: row.File_Name,
        imported_at: importedAt,
        imported_ms: Number.isFinite(importedMs) ? importedMs : null,
      });
    }
    return map;
  } catch (err) {
    // DB fehlt komplett oder Tabelle existiert nicht — als "leer" werten.
    if (/no such table|does not exist|catalog.*FilesCatalog/i.test(err.message)) {
      return new Map();
    }
    if (/ENOENT|database.*not exist/i.test(err.message)) {
      return new Map();
    }
    throw err;
  }
}

function stripXmlSuffix(name) {
  return name.replace(/\.xml$/i, '');
}

const STATUS_EMOJI = {
  current: '✅',
  outdated: '✴️',
  new: '➡️',
};

/**
 * Aggregiert die Datei-Liste mit dem FilesCatalog zu Status-Zeilen.
 * Emoji-Logik:
 *   - in DB UND Datei-Mtime ≤ Import-Timestamp  → 'current'  ✅
 *   - in DB UND Datei-Mtime >  Import-Timestamp → 'outdated' ✴️
 *   - nicht in DB                                → 'new'      ➡️
 */
/**
 * Ampel-Band für eine Coverage-Kennzahl: ≥warn → ok, ≥crit → warn, sonst critical.
 */
function bandState(pct, warn, crit) {
  if (pct >= warn) return 'ok';
  if (pct >= crit) return 'warn';
  return 'critical';
}

/**
 * semantic_names-Block — zwei orthogonale Drift-Kennzahlen, deterministisch
 * aus dem aktuellen Knotenraum `U` (ClusterNodeUniverse, jeder Import frisch) und der
 * Partition (ObjectClusters, nur bei Cluster-Läufen aktualisiert), KEINE Shadow-
 * Simulation. Berechnung = Copy-Query (READ_ONLY) + Sidecar-Query, in JS gemerged
 * (kein Cross-DB-JOIN). Beide Namensquellen zählen: Skill-`Semantic_Name`
 * (Copy) ∪ User-`User_Name` (Sidecar) ∪ R3-`SemanticNameRestore` (Sidecar).
 *
 *   ① Struktur-Abdeckung = partitioned / U          (Heilung: Button, Frontend)
 *   ② Benennungs-Abdeckung = covered / partitioned   (Heilung: Skill, CLI)
 *
 * Liefert `{ available:false }`, solange keine Partition/Universe existiert (frischer
 * Import vor dem ersten Cluster-Lauf) → Frontend zeigt beide „--".
 */
async function computeSemanticNames() {
  const unavailable = { available: false };

  // Cluster-/Universe-Tabellen vorhanden? (Copy kann frisch & ungeclustert sein.)
  try {
    const r = await db.executeQuery(
      `SELECT
         (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='ObjectClusters')      AS oc,
         (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='ClusterNodeUniverse')  AS cnu`
    );
    const p = r.rows[0] || {};
    if (Number(p.oc) === 0 || Number(p.cnu) === 0) return unavailable;
  } catch {
    return unavailable;
  }

  // (a) Copy: partitionierte Universe-Knoten je Community + Skill-Benennung + Totale.
  let comm = [];
  let universeTotal = 0;
  let partitioned = 0;
  try {
    comm = (await db.executeQuery(
      `WITH comm AS (
         SELECT oc.Engine, oc.Community, COUNT(*) AS u_nodes
         FROM ClusterNodeUniverse u JOIN ObjectClusters oc USING (Object_UUID, File_Name)
         GROUP BY 1, 2
       )
       SELECT c.Engine AS engine, c.Community AS community, c.u_nodes AS u_nodes,
              (cn.Semantic_Name IS NOT NULL) AS skill_named
       FROM comm c LEFT JOIN CommunityNames cn USING (Engine, Community)`
    )).rows;
    universeTotal = Number((await db.executeQuery(
      `SELECT COUNT(*) AS n FROM ClusterNodeUniverse`
    )).rows[0]?.n ?? 0);
    partitioned = Number((await db.executeQuery(
      `SELECT COUNT(*) AS n FROM ClusterNodeUniverse u
         JOIN ObjectClusters oc USING (Object_UUID, File_Name)`
    )).rows[0]?.n ?? 0);
  } catch (err) {
    console.warn(`[xml-convert] semantic_names copy query failed: ${err.message}`);
    return unavailable;
  }
  if (universeTotal === 0) return unavailable;

  // (b) Sidecar: Communities mit User-Name ODER R3-Restore. Best-effort (Tabellen
  // fehlen evtl. auf einem noch nicht neugestarteten Server) → leere Sets.
  const sidecarNamed = new Set();
  let userCount = 0;
  let restoredCount = 0;
  try {
    const userRows = await annoDb.query(
      `SELECT Engine, Community FROM CommunityAnnotation WHERE User_Name IS NOT NULL`
    );
    const restoreRows = await annoDb.query(
      `SELECT Engine, Community FROM SemanticNameRestore WHERE Semantic_Name IS NOT NULL`
    );
    for (const r of userRows) sidecarNamed.add(`${r.Engine}|${Number(r.Community)}`);
    userCount = userRows.length;
    for (const r of restoreRows) sidecarNamed.add(`${r.Engine}|${Number(r.Community)}`);
    restoredCount = restoreRows.length;
  } catch (err) {
    console.warn(`[xml-convert] semantic_names sidecar query skipped: ${err.message}`);
  }

  // (c) JS-Merge: drei Eimer, zwei Kennzahlen. Knoten-, nicht Community-gewichtet.
  let covered = 0;
  let skillCount = 0;
  const namedCommSet = new Set();
  const engineNodes = new Map();
  for (const row of comm) {
    const eng = row.engine;
    const key = `${eng}|${Number(row.community)}`;
    const nodes = Number(row.u_nodes) || 0;
    engineNodes.set(eng, (engineNodes.get(eng) ?? 0) + nodes);
    if (row.skill_named) skillCount += 1;
    if (row.skill_named || sidecarNamed.has(key)) {
      covered += nodes;
      namedCommSet.add(key);
    }
  }
  const unnamed = partitioned - covered;
  const unpartitioned = universeTotal - partitioned;
  const structCovPct = Math.round((100 * partitioned) / universeTotal);
  const nameCovPct = partitioned ? Math.round((100 * covered) / partitioned) : null;

  // Dominante Engine (meiste Universe-Knoten).
  let engine = null;
  let engBest = -1;
  for (const [eng, n] of engineNodes) if (n > engBest) { engBest = n; engine = eng; }

  const structTh = environment.semanticNames.structDrift;
  const nameTh = environment.semanticNames.nameDrift;

  // ① Struktur: partitioned=0 → „none" (noch nicht geclustert, Button heilt).
  const structState = partitioned === 0
    ? 'none'
    : bandState(structCovPct, structTh.warn, structTh.crit);
  // ② Benennung: keine benannte/keine partitionierte → „none" (Skill heilt).
  const nameState = (partitioned === 0 || covered === 0)
    ? 'none'
    : bandState(nameCovPct, nameTh.warn, nameTh.crit);

  return {
    available: true,
    universe_nodes: universeTotal,
    structure: {
      state: structState,
      coverage_pct: structCovPct,
      unpartitioned,
      thresholds: { warn: structTh.warn, crit: structTh.crit },
    },
    naming: {
      state: nameState,
      coverage_pct: nameCovPct,
      unnamed_nodes: unnamed,
      thresholds: { warn: nameTh.warn, crit: nameTh.crit },
    },
    named_communities: namedCommSet.size,
    total_communities: comm.length,
    sources: { skill: skillCount, user: userCount, restored: restoredCount },
    engine,
  };
}

async function getStatus() {
  const [files, catalog, semanticNames] = await Promise.all([
    listXmlDirectory(),
    readFilesCatalog(),
    computeSemanticNames().catch((err) => {
      console.warn(`[xml-convert] semantic_names compute failed: ${err.message}`);
      return { available: false };
    }),
  ]);

  const dbEmpty = catalog.size === 0;
  const lastRun = await readLastRunMeta();

  // Billige Running-Detektion (Lock+PID ODER aktiver Hub-Lauf) +
  // flaches active_run (phase/pct/processed/total) für den 6-s-Soft-Refresh → die
  // UI weiß beim Eintritt sofort „es läuft" und kann auf /convert/stream abonnieren.
  let running = false;
  let activeRun = null;
  try {
    const hub = require('./xml-convert-hub');
    running = isRunning() || hub.isActive();
    activeRun = hub.getActiveRunMeta();
  } catch (err) {
    console.warn(`[xml-convert] running-detection skipped: ${err.message}`);
  }

  const rows = files.map(f => {
    const base = stripXmlSuffix(f.filename).normalize('NFC').toLowerCase();
    const entry = catalog.get(base);
    let status;
    if (!entry) {
      status = 'new';
    } else if (entry.imported_ms != null && f.mtime_ms > entry.imported_ms) {
      status = 'outdated';
    } else {
      status = 'current';
    }
    return {
      filename: f.filename,
      size: f.size,
      mtime: f.mtime,
      status,
      emoji: STATUS_EMOJI[status],
      imported_at: entry?.imported_at || null,
    };
  });

  return {
    xml_dir: XML_DIR,
    host_xml_dir: HOST_XML_DIR,
    runtime: RUNTIME,
    can_reveal: CAN_REVEAL,
    db_empty: dbEmpty,
    files: rows,
    last_run: lastRun,
    semantic_names: semanticNames,
    running,
    active_run: activeRun,
  };
}

/**
 * Schmale Variante für das Home-Dashboard im leeren Zustand: Liefert nur die
 * Dateinamen, keine Status-Logik. Für den Monospace-Block.
 */
async function getDirectoryListing() {
  const files = await listXmlDirectory();
  return files.map(f => ({
    filename: f.filename,
    size: f.size,
    mtime: f.mtime,
  }));
}

/**
 * Öffnet das XML-Verzeichnis im nativen Datei-Manager (macOS: `open`,
 * Linux: `xdg-open`). Nur im nativen Lauf mit verfügbarem Opener. Nutzt
 * AUSSCHLIESSLICH den server-aufgelösten XML_DIR (kein Client-Pfad) und spawnt
 * ohne Shell (Argument-Array) → keine Command-Injection. Wirft
 * `REVEAL_UNSUPPORTED`, wenn die Laufzeit das Reveal nicht beherrscht (Container).
 */
async function revealXmlDir() {
  if (!CAN_REVEAL || !REVEAL_COMMAND) {
    const err = new Error('Folder reveal is not supported in this runtime.');
    err.code = 'REVEAL_UNSUPPORTED';
    throw err;
  }
  await fsp.mkdir(XML_DIR, { recursive: true });
  await new Promise((resolve, reject) => {
    const child = spawn(REVEAL_COMMAND, [XML_DIR], { stdio: 'ignore', detached: true });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
  return XML_DIR;
}

// ---------------------------------------------------------------------------
// Run-Record (Persistenz des Logs)
// ---------------------------------------------------------------------------

async function readLastRun() {
  try {
    const raw = await fsp.readFile(LAST_RUN_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    console.warn(`[xml-convert] failed to read last-run record: ${err.message}`);
    return null;
  }
}

function computeDurationMs(record) {
  if (!record || typeof record.duration_ms === 'number') return record?.duration_ms ?? null;
  if (!record.started_at || !record.finished_at) return null;
  const start = Date.parse(record.started_at);
  const end = Date.parse(record.finished_at);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

/**
 * Liest den letzten Run als kompakte Meta-Struktur (ohne `events[]`) für
 * `/api/xml/status`. Spart Bandbreite, wenn niemand das Log braucht.
 */
async function readLastRunMeta() {
  const r = await readLastRun();
  if (!r) return null;
  return {
    run_id: r.run_id,
    started_at: r.started_at,
    finished_at: r.finished_at,
    duration_ms: computeDurationMs(r),
    ok: r.ok,
    processed: r.processed,
    total: r.total,
    error_count: r.error_count,
  };
}

async function readLastRunLog() {
  const r = await readLastRun();
  if (!r) return null;
  return {
    run_id: r.run_id,
    started_at: r.started_at,
    finished_at: r.finished_at,
    duration_ms: computeDurationMs(r),
    ok: r.ok,
    processed: r.processed,
    total: r.total,
    error_count: r.error_count,
    events: Array.isArray(r.events) ? r.events : [],
  };
}

/**
 * Atomarer Write: erst .tmp schreiben, dann renamen. Schützt den Run-Record
 * gegen halbgeschriebene Dateien, falls der Server während eines laufenden
 * Streams gekillt wird.
 */
async function writeRunRecord(record) {
  await ensureFmlabDir();
  const tmpPath = `${LAST_RUN_PATH}.tmp`;
  await fsp.writeFile(tmpPath, JSON.stringify(record, null, 2), 'utf-8');
  await fsp.rename(tmpPath, LAST_RUN_PATH);
}

/**
 * Erzeugt ein neues, leeres Run-Record-Skelett und speichert es. Wird zu
 * Beginn einer Konvertierung aufgerufen — danach hängen wir Events an und
 * persistieren das Record jeweils nach einem Update.
 */
function newRunRecord() {
  const startedAt = nowIso();
  return {
    $schema_version: RUN_RECORD_SCHEMA_VERSION,
    run_id: startedAt,
    started_at: startedAt,
    finished_at: null,
    duration_ms: null,
    ok: null,
    exit_code: null,
    processed: 0,
    total: 0,
    error_count: 0,
    events: [],
  };
}

// ---------------------------------------------------------------------------
// Lock-File Inspection (ohne Acquire — das macht das Bash-Skript selbst).
// ---------------------------------------------------------------------------

function readLockSync() {
  try {
    const raw = fs.readFileSync(LOCK_PATH, 'utf-8').split('\n');
    const pid = Number(String(raw[0] || '').trim());
    if (!Number.isFinite(pid) || pid <= 0) return null;
    return {
      pid,
      started_at: raw[1] ? raw[1].trim() : null,
      source: raw[2] ? raw[2].trim() : null,
    };
  } catch {
    return null;
  }
}

function lockOwnerAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Prüft, ob aktuell eine Konvertierung läuft. True nur wenn die Lock-Datei
 * existiert UND der Owner-PID noch lebt.
 */
function isRunning() {
  const lock = readLockSync();
  if (!lock) return false;
  return lockOwnerAlive(lock.pid);
}

// ---------------------------------------------------------------------------
// Spawn-Wrapper für den eigentlichen Convert-Lauf
// ---------------------------------------------------------------------------

/**
 * Spawnt das Convert-Skript im --quiet-Modus. Für jede empfangene NDJSON-Zeile
 * wird onEvent() aufgerufen. Parallel wird der Run-Record gepflegt — der
 * Aufrufer (Controller) bekommt also keinen leeren Record, falls der Stream
 * abreißt. Resolvet mit `{ exit_code, ok }`.
 */
function runConverter({ onEvent, signal, changedOnly = true } = {}) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(SCRIPT_PATH)) {
      const err = new Error(`Convert script not found: ${SCRIPT_PATH}`);
      err.code = 'SCRIPT_NOT_FOUND';
      reject(err);
      return;
    }

    // Turbo ist die Default-Engine und immer aktiv. --changed-only (Manifest-Skip
    // auf Datei-Ebene) überspringt unveränderte XML; bei changedOnly=false (UI-Toggle
    // aus) läuft ein voller Turbo-Build (alle Dateien neu, kein Manifest-Skip).
    const args = [SCRIPT_PATH, '--batch', '--quiet', '--turbo'];
    if (changedOnly) args.push('--changed-only');
    const child = spawn('bash', args, {
      cwd: REPO_ROOT,
      env: { ...process.env, FMLAB_CONVERT_QUIET: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const record = newRunRecord();
    let persistDirty = false;
    let persistInflight = false;

    // Drosselt Disk-Writes: max. alle ~500 ms. Sehr lange Läufe haben sonst
    // viele tausend rename-Calls; einmaliges Schreiben pro Event ist Overkill.
    const flushSoon = () => {
      persistDirty = true;
      if (persistInflight) return;
      persistInflight = true;
      setTimeout(async () => {
        try {
          if (persistDirty) {
            persistDirty = false;
            await writeRunRecord(record);
          }
        } catch (err) {
          console.warn(`[xml-convert] persist failed: ${err.message}`);
        } finally {
          persistInflight = false;
          if (persistDirty) flushSoon();
        }
      }, 500);
    };

    const pushEvent = (evt) => {
      // Transiente Live-Events nur live weiterreichen, nicht persistieren (s.o.).
      const transient = TRANSIENT_EVENTS.has(evt.event);
      // Kappen, damit das JSON nicht ins Unendliche wächst.
      if (!transient) {
        if (record.events.length < MAX_EVENTS_RETAINED) {
          record.events.push(evt);
        } else if (record.events.length === MAX_EVENTS_RETAINED) {
          record.events.push({ event: 'log', level: 'warn', msg: `[truncated: more than ${MAX_EVENTS_RETAINED} events]` });
        }
      }

      // Counter aus bekannten Events hochziehen, damit der Status-Endpoint
      // ohne Event-Replay auskommt.
      if (evt.event === 'file_start') {
        // Trägt die Gesamtzahl schon vor dem ersten abgeschlossenen File —
        // ohne das stünde `total` bis zum ersten `file`-Event auf 0.
        if (typeof evt.total === 'number') record.total = evt.total;
      }
      if (evt.event === 'file') {
        if (typeof evt.total === 'number') record.total = evt.total;
        if (typeof evt.index === 'number' && evt.ok !== false) {
          record.processed = Math.max(record.processed, evt.index);
        }
        if (evt.ok === false) record.error_count += 1;
      }
      if (evt.event === 'log' && evt.level === 'error') {
        // Echte Error-Events zählen ebenfalls — aber nicht doppelt mit `file`.
      }
      if (evt.event === 'done') {
        record.ok = evt.ok !== false;
        if (typeof evt.exit_code === 'number') record.exit_code = evt.exit_code;
      }

      // Transiente Events ändern den Record nicht → kein Persist nötig (spart bei
      // der import_progress-Flut tausende unnötige Schreibvorgänge). Live-Weitergabe
      // an den SSE-Stream (onEvent) passiert unabhängig davon immer.
      if (!transient) flushSoon();
      if (onEvent) {
        try { onEvent(evt); } catch (err) { console.warn(`[xml-convert] onEvent threw: ${err.message}`); }
      }
    };

    const dispatchLine = (channel, raw) => {
      const line = raw.trim();
      if (!line) return;
      let evt;
      try {
        evt = JSON.parse(line);
      } catch {
        evt = {
          event: 'log',
          level: channel === 'stderr' ? 'warn' : 'info',
          msg: line,
        };
      }
      if (typeof evt !== 'object' || evt === null) {
        evt = { event: 'log', level: 'info', msg: String(line) };
      }
      pushEvent(evt);
    };

    const buffers = { stdout: '', stderr: '' };
    const onChunk = (channel) => (chunk) => {
      buffers[channel] += chunk.toString();
      let idx;
      while ((idx = buffers[channel].indexOf('\n')) >= 0) {
        const part = buffers[channel].slice(0, idx);
        buffers[channel] = buffers[channel].slice(idx + 1);
        dispatchLine(channel, part);
      }
    };

    child.stdout.on('data', onChunk('stdout'));
    child.stderr.on('data', onChunk('stderr'));

    if (signal) {
      signal.addEventListener('abort', () => {
        try { child.kill('SIGTERM'); } catch { /* gone */ }
      }, { once: true });
    }

    child.on('error', (err) => reject(err));
    child.on('close', async (code) => {
      if (buffers.stdout) dispatchLine('stdout', buffers.stdout);
      if (buffers.stderr) dispatchLine('stderr', buffers.stderr);

      const exitCode = code ?? 0;
      record.exit_code = record.exit_code ?? exitCode;
      record.ok = record.ok ?? (exitCode === 0);
      record.finished_at = nowIso();
      record.duration_ms = computeDurationMs(record);

      // Final persist — ohne Throttle.
      try {
        await writeRunRecord(record);
      } catch (err) {
        console.warn(`[xml-convert] final persist failed: ${err.message}`);
      }

      resolve({ exit_code: exitCode, ok: exitCode === 0, record });
    });
  });
}

module.exports = {
  SCRIPT_PATH,
  XML_DIR,
  LAST_RUN_PATH,
  getStatus,
  getDirectoryListing,
  revealXmlDir,
  readLastRunLog,
  isRunning,
  runConverter,
};
