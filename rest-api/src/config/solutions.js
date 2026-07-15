const fs = require('fs');
const path = require('path');

/**
 * Multi-Solution-Auflösung (Phase 1) — die EINE zentrale Stelle, an der aus
 * dem Aktiv-Zustand die konkreten Pfade werden.
 *
 * Layout:
 *   solutions/<id>/                 Bundle (Master-DB, XML-Eingang, State)
 *   rest-api/db/solutions/<id>/     READ_ONLY-Kopie für diese API (Sync-Hook)
 *   .fmlab/active_solution.json     Server-Default („aktive Lösung") — Quelle
 *                                   der Wahrheit; die db/-Symlinks im Repo-Root
 *                                   sind nur deren Projektion für CLI-Leser.
 *
 * Wichtig: Die API liest NIEMALS über den Symlink — Routing hängt
 * ausschließlich an Pointer-Datei (Server-Default) bzw. künftig am
 * Request-Kontext (X-Solution-Header, Ausbaustufe M). Phase 1 füllt den
 * Request-Kontext konstant mit dem Server-Default.
 */

const REST_API_ROOT = path.resolve(__dirname, '../..');        // rest-api/
const REPO_ROOT = path.resolve(REST_API_ROOT, '..');           // Projekt-Root
const SOLUTIONS_ROOT = path.join(REPO_ROOT, 'solutions');
const API_COPIES_ROOT = path.join(REST_API_ROOT, 'db', 'solutions');
const POINTER_PATH = path.join(REPO_ROOT, '.fmlab', 'active_solution.json');
const DEFAULT_ID = 'default';

/** Lösungs-IDs sind Ordnernamen: kein Pfad-Traversal, nicht leer. */
function isValidId(id) {
  return typeof id === 'string'
    && id.length > 0
    && id !== '.' && id !== '..'
    && !id.includes('/') && !id.includes('\\')
    && !id.includes('\0');
}

/**
 * Server-Default aus der Pointer-Datei; fehlt sie → 'default'.
 *
 * Invariante I1: Zeigt der Pointer auf eine gelöschte/fehlende
 * Lösung, fällt die Auflösung explizit auf 'default' zurück (WARN einmal pro
 * fehlender ID — der Getter läuft mehrfach pro Request, kein Log-Spam).
 */
let warnedMissingActive = null;
function getActiveSolutionId() {
  try {
    const raw = JSON.parse(fs.readFileSync(POINTER_PATH, 'utf-8'));
    if (raw && isValidId(raw.active)) {
      if (fs.existsSync(solutionDir(raw.active))) return raw.active;
      if (warnedMissingActive !== raw.active) {
        warnedMissingActive = raw.active;
        console.warn(`[solutions] active-solution pointer names missing solution '${raw.active}' — falling back to '${DEFAULT_ID}'`);
      }
      return DEFAULT_ID;
    }
  } catch { /* missing/invalid pointer → default */ }
  return DEFAULT_ID;
}

/**
 * Kontext für Pfade OHNE Request (Startup, Reload-Hook, SSE-Hub, Jobs) —
 * die EINZIGE legitime Quelle kontextloser Kontexte. Macht an
 * jeder Stelle ablesbar, dass bewusst der Server-Default gemeint ist.
 */
function serverDefaultContext() {
  return { solution: getActiveSolutionId(), requested: null };
}

/**
 * Request-Kontext (Ausbaustufe M, scharf): Ein mitgesendeter
 * `X-Solution`-Header wählt die Lösung DIESES Requests — ungültige/unbekannte
 * IDs sind ein harter 404 (niemals stiller Fallback: eine falsch adressierte
 * Analyse gegen die falsche DB ist genau die Vermischungs-Fehlerklasse, die
 * getrennte Bundles eliminieren). Ohne Header greift der Server-Default.
 * Wirft mit err.code='SOLUTION_NOT_FOUND' (+ err.status=404) — die Middleware
 * in index.js übersetzt das in die JSON-Fehlerantwort.
 */
function getRequestContext(req) {
  const requested = (req && typeof req.get === 'function' && req.get('X-Solution')) || null;
  if (requested) {
    if (!isValidId(requested) || !fs.existsSync(solutionDir(requested))) {
      const err = new Error(`Unknown solution: ${requested}`);
      err.code = 'SOLUTION_NOT_FOUND';
      err.status = 404;
      throw err;
    }
    return { solution: requested, requested };
  }
  return { solution: getActiveSolutionId(), requested: null };
}

// ── Pfad-Helfer (alle absolut) ──────────────────────────────────────────────
function solutionDir(id) { return path.join(SOLUTIONS_ROOT, id); }
function manifestPath(id) { return path.join(SOLUTIONS_ROOT, id, 'solution.json'); }
function xmlDir(id) { return path.join(SOLUTIONS_ROOT, id, 'xml'); }
function stateDir(id) { return path.join(SOLUTIONS_ROOT, id, 'state'); }
function masterDbPath(id) { return path.join(SOLUTIONS_ROOT, id, 'db', 'fm_catalog.duckdb'); }
function apiCopyPath(id) { return path.join(API_COPIES_ROOT, id, 'fm_catalog.duckdb'); }

/**
 * resolveDbPath([solutionId]):
 *   1. DUCKDB_PATH explizit gesetzt → unverändert — aber NUR für den
 *      Server-Default (der Override meint „die eine Dev-DB", nicht jede
 *      Lösung des Pools)
 *   2. sonst: Lösung → rest-api/db/solutions/<id>/fm_catalog.duckdb
 *   3. Fallback (Kopie existiert noch nicht, z. B. unmigrierter Workspace,
 *      nur für den Server-Default): ./db/fm_catalog.duckdb
 * Ohne Argument (Startup, Stats): der Server-Default.
 */
function resolveDbPath(solutionId) {
  const active = getActiveSolutionId();
  const id = solutionId || active;
  if (process.env.DUCKDB_PATH && id === active) {
    return path.resolve(REST_API_ROOT, process.env.DUCKDB_PATH);
  }
  const perSolution = apiCopyPath(id);
  if (fs.existsSync(perSolution)) return perSolution;
  if (id === active) {
    const legacy = path.resolve(REST_API_ROOT, './db/fm_catalog.duckdb');
    if (fs.existsSync(legacy)) return legacy;
  }
  // Neue/leere Lösung: der per-Solution-Pfad ist das Ziel — der Aufrufer
  // (database-Pool-Factory) legt dort bei Bedarf eine Platzhalter-DB an.
  return perSolution;
}

/**
 * Annotations-Sidecar ist PER LÖSUNG (Cluster-Namen/Sichtbarkeit dürfen nicht
 * zwischen Lösungen bluten) und lebt im Bundle (Master, RW — kein Kopie-Muster,
 * die API ist der einzige Laufzeit-Schreiber). ANNOTATIONS_DB_PATH überschreibt
 * — wie DUCKDB_PATH nur für den Server-Default, nicht für Pool-Fremdlösungen.
 */
function resolveAnnotationsPath(solutionId) {
  const active = getActiveSolutionId();
  const id = solutionId || active;
  if (process.env.ANNOTATIONS_DB_PATH && id === active) {
    return path.resolve(REST_API_ROOT, process.env.ANNOTATIONS_DB_PATH);
  }
  return path.join(SOLUTIONS_ROOT, id, 'db', 'fm_annotations.duckdb');
}

/** State-Verzeichnis der aktiven Lösung (Lock, last_xml_run.json, cluster*.json, logs/). */
function resolveStateDir() { return stateDir(getActiveSolutionId()); }
/** XML-Eingang der aktiven Lösung. */
function resolveXmlDir() { return xmlDir(getActiveSolutionId()); }

function readManifest(id) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(id), 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Dauer des letzten Konvertierungs-Laufs einer Lösung (ms) aus dem
 * per-Solution-Run-Record. CLI-Läufe stempeln duration_ms=null → aus
 * started_at/finished_at rechnen. Best-effort, nie werfen.
 */
function readLastRunDurationMs(id) {
  try {
    const r = JSON.parse(fs.readFileSync(path.join(stateDir(id), 'last_xml_run.json'), 'utf-8'));
    if (typeof r.duration_ms === 'number') return r.duration_ms;
    if (r.started_at && r.finished_at) {
      const start = Date.parse(r.started_at);
      const end = Date.parse(r.finished_at);
      if (Number.isFinite(start) && Number.isFinite(end)) return Math.max(0, end - start);
    }
  } catch { /* kein Run-Record (noch nie konvertiert) */ }
  return null;
}

/**
 * Live-Import-Detektion je Lösung: Wahrheit ist das
 * per-Solution-Lock `state/xml_convert.lock` (PID + Timestamp + Source) mit
 * PID-Liveness — so sind auch reine CLI-Läufe sichtbar, stale Locks nicht.
 * Bewusst lokale Kopie der Lock-Parse-Logik aus xml-convert.js: der Service
 * hängt von diesem Modul ab (kein Zyklus riskieren).
 */
function readImportLock(id) {
  try {
    const raw = fs.readFileSync(path.join(stateDir(id), 'xml_convert.lock'), 'utf-8').split('\n');
    const pid = Number(String(raw[0] || '').trim());
    if (!Number.isFinite(pid) || pid <= 0) return null;
    try { process.kill(pid, 0); } catch { return null; /* stale */ }
    return {
      pid,
      started_at: raw[1] ? raw[1].trim() : null,
      source: raw[2] ? raw[2].trim() : null,
    };
  } catch {
    return null;
  }
}

/**
 * GET /api/solutions — Scan über solutions/*\/solution.json + Dateigrößen.
 * Kennzahlen kommen aus dem Manifest-Metrik-Cache — KEIN Öffnen von
 * N DuckDB-Dateien fürs Listing.
 */
function listSolutions() {
  const active = getActiveSolutionId();
  let entries = [];
  try {
    entries = fs.readdirSync(SOLUTIONS_ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory() && isValidId(e.name));
  } catch { /* solutions/ fehlt (unmigrierter Workspace) → leere Liste */ }

  // Hub-Läufe ergänzen die Lock-Sicht (kleines Fenster zwischen Hub-Start und
  // Lock-Acquire des Skripts). Lazy require — der Hub hängt von diesem Modul ab.
  let hubActive = () => false;
  try {
    const hub = require('../services/xml-convert-hub');
    hubActive = (id) => hub.isActive(id);
  } catch { /* Hub nicht geladen (z. B. CLI-Kontext) */ }

  return entries.map((e) => {
    const id = e.name;
    const manifest = readManifest(id) || {};
    let sizeMb = null;
    try {
      const stat = fs.statSync(masterDbPath(id));
      sizeMb = Math.round((stat.size / 1024 / 1024) * 100) / 100;
    } catch { /* noch keine Master-DB (leere Lösung) */ }
    const lock = readImportLock(id);
    const importRunning = lock != null || hubActive(id);
    return {
      id,
      uuid: manifest.uuid || null,
      display_name: manifest.display_name || id,
      description: manifest.description || '',
      maintainer: manifest.maintainer || '',
      created_at: manifest.created_at || null,
      size_mb: sizeMb,
      file_count: manifest.metrics ? manifest.metrics.files ?? null : null,
      objects: manifest.metrics ? manifest.metrics.objects ?? null : null,
      last_import_at: manifest.technical ? manifest.technical.last_import_at ?? null : null,
      last_run_duration_ms: readLastRunDurationMs(id),
      db_schema_version: manifest.technical ? manifest.technical.db_schema_version ?? null : null,
      metrics_generated_at: manifest.metrics ? manifest.metrics.generated_at ?? null : null,
      is_active: id === active,
      import_running: importRunning,
      import_source: lock ? (lock.source || null) : (importRunning ? 'api' : null),
      import_started_at: lock ? lock.started_at : null,
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

function solutionExists(id) {
  return isValidId(id) && fs.existsSync(solutionDir(id));
}

/**
 * Invariante I1: Die Lösung 'default' existiert IMMER — sie ist
 * der definierte Einstiegspunkt (XML-Ablage ohne Kennung, Pointer-Fallback).
 * Stellt Bundle-Skelett + Minimal-Manifest idempotent und still her; wird beim
 * API-Start aufgerufen (CLI-Pendants: convert_fm_xml.sh, tools/solution.sh).
 */
function ensureDefaultSolution() {
  try {
    fs.mkdirSync(xmlDir(DEFAULT_ID), { recursive: true });
    fs.mkdirSync(path.join(solutionDir(DEFAULT_ID), 'db'), { recursive: true });
    fs.mkdirSync(path.join(stateDir(DEFAULT_ID), 'logs'), { recursive: true });
    if (!fs.existsSync(manifestPath(DEFAULT_ID))) {
      const manifest = {
        manifest_version: 1,
        uuid: require('crypto').randomUUID(),
        id: DEFAULT_ID,
        display_name: DEFAULT_ID,
        description: '',
        maintainer: '',
        url: '',
        contact: { name: '', email: '' },
        created_at: new Date().toISOString(),
        notes: '',
      };
      const target = manifestPath(DEFAULT_ID);
      fs.writeFileSync(`${target}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`);
      fs.renameSync(`${target}.tmp`, target);
    }
  } catch (err) {
    // Selbstheilung ist best-effort — ein Read-only-FS o. Ä. darf den Start
    // nicht verhindern (der Empty-State der API greift dann wie bisher).
    console.warn(`[solutions] ensureDefaultSolution failed: ${err.message}`);
  }
}

/**
 * Symlink umhängen — atomar (temp-Link + rename) und defensiv: ein REALES
 * File am Linkort wird niemals gelöscht (nur fehlend/Symlink wird ersetzt).
 */
function repointSymlink(linkPath, target) {
  let st = null;
  try { st = fs.lstatSync(linkPath); } catch { /* fehlt → anlegen */ }
  if (st && !st.isSymbolicLink()) {
    console.warn(`[solutions] ${linkPath} is a real file — symlink NOT re-pointed`);
    return false;
  }
  const tmp = `${linkPath}.tmp-${process.pid}`;
  try {
    try { fs.unlinkSync(tmp); } catch { /* kein Rest */ }
    fs.symlinkSync(target, tmp);
    fs.renameSync(tmp, linkPath);
    return true;
  } catch (err) {
    console.warn(`[solutions] symlink ${linkPath} → ${target} failed: ${err.message}`);
    try { fs.unlinkSync(tmp); } catch { /* aufgeräumt */ }
    return false;
  }
}

/**
 * Workspace-Symlinks (relativ, wie von der Migration angelegt) auf `id`
 * projizieren — die drei Leseprojektionen für CLI-Leser (CLAUDE.md §2):
 *   db/fm_catalog.duckdb        → ../solutions/<id>/db/fm_catalog.duckdb
 *   db/fm_annotations.duckdb    → ../solutions/<id>/db/fm_annotations.duckdb
 *   rest-api/db/fm_catalog.duckdb → solutions/<id>/fm_catalog.duckdb
 *
 * Idempotent und defensiv (repointSymlink lässt ein REALES File unberührt →
 * ein unmigrierter Alt-Workspace wird nie überschrieben, nur mit einer
 * WARN-Zeile markiert). Wird sowohl beim Umschalten (setActiveSolution) als
 * auch bei jedem API-Start aufgerufen, damit der dokumentierte Lesepfad auch
 * für Ein-Lösungs-Installationen entsteht, die nie umschalten. Best-effort:
 * die Parent-Verzeichnisse werden bei Bedarf angelegt; ein Read-only-FS o. Ä.
 * darf den Start nicht verhindern.
 */
function ensureWorkspaceSymlinks(id = getActiveSolutionId()) {
  try {
    fs.mkdirSync(path.join(REPO_ROOT, 'db'), { recursive: true });
    fs.mkdirSync(path.join(REST_API_ROOT, 'db'), { recursive: true });
  } catch { /* best-effort — repointSymlink meldet ein Scheitern selbst */ }
  repointSymlink(
    path.join(REPO_ROOT, 'db', 'fm_catalog.duckdb'),
    `../solutions/${id}/db/fm_catalog.duckdb`
  );
  repointSymlink(
    path.join(REPO_ROOT, 'db', 'fm_annotations.duckdb'),
    `../solutions/${id}/db/fm_annotations.duckdb`
  );
  repointSymlink(
    path.join(REST_API_ROOT, 'db', 'fm_catalog.duckdb'),
    `solutions/${id}/fm_catalog.duckdb`
  );
}

/**
 * Aktive Lösung setzen: Pointer-Datei schreiben (Quelle der Wahrheit)
 * + Workspace-Symlinks umhängen (Projektion für CLI-Leser). Der API-Reload
 * ist Sache des Aufrufers (admin.controller → performReload()).
 */
function setActiveSolution(id) {
  if (!solutionExists(id)) {
    const err = new Error(`Unknown solution: ${id}`);
    err.code = 'SOLUTION_NOT_FOUND';
    throw err;
  }
  // Pointer atomar schreiben.
  const pointer = { active: id, switched_at: new Date().toISOString() };
  fs.mkdirSync(path.dirname(POINTER_PATH), { recursive: true });
  const tmp = `${POINTER_PATH}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(pointer, null, 2)}\n`);
  fs.renameSync(tmp, POINTER_PATH);

  // Workspace-Symlinks auf die neue aktive Lösung projizieren.
  ensureWorkspaceSymlinks(id);
  return pointer;
}

/**
 * Neue Lösung anlegen: Bundle-Skelett + Manifest v1 (nur der Anwender-Block —
 * technical/metrics stempelt convert-xml beim ersten Import).
 */
function createSolution(id, { displayName, description } = {}) {
  if (!isValidId(id)) {
    const err = new Error(`Invalid solution id: ${id}`);
    err.code = 'INVALID_SOLUTION_ID';
    throw err;
  }
  // Dev-Container-FS ist case-insensitiv: keine zwei IDs, die sich nur in
  // Groß-/Kleinschreibung unterscheiden.
  const clash = listSolutions().find((s) => s.id.toLowerCase() === id.toLowerCase());
  if (clash) {
    const err = new Error(`Solution already exists: ${clash.id}`);
    err.code = 'SOLUTION_EXISTS';
    throw err;
  }
  const { randomUUID } = require('crypto');
  fs.mkdirSync(xmlDir(id), { recursive: true });
  fs.mkdirSync(path.join(solutionDir(id), 'db'), { recursive: true });
  fs.mkdirSync(path.join(stateDir(id), 'logs'), { recursive: true });
  const manifest = {
    manifest_version: 1,
    uuid: randomUUID(),
    id,
    display_name: displayName || id,
    description: description || '',
    maintainer: '',
    url: '',
    contact: { name: '', email: '' },
    created_at: new Date().toISOString(),
    notes: '',
  };
  fs.writeFileSync(manifestPath(id), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/**
 * Beschreibungs-Block (Anwender-Eigner) aktualisieren — Key-scoped
 * Merge: nur die genannten Root-Schlüssel werden ersetzt, technical/metrics
 * (Eigner convert-xml) bleiben unangetastet. Atomarer Write (tmp + rename).
 */
const USER_EDITABLE_KEYS = ['display_name', 'description', 'maintainer', 'url', 'notes'];

function updateSolutionMeta(id, patch) {
  if (!solutionExists(id)) {
    const err = new Error(`Unknown solution: ${id}`);
    err.code = 'SOLUTION_NOT_FOUND';
    throw err;
  }
  const manifest = readManifest(id) || {
    manifest_version: 1,
    uuid: require('crypto').randomUUID(),
    id,
    display_name: id,
    created_at: new Date().toISOString(),
  };
  for (const key of USER_EDITABLE_KEYS) {
    if (typeof patch[key] === 'string') manifest[key] = patch[key];
  }
  const target = manifestPath(id);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.renameSync(tmp, target);
  return manifest;
}

/**
 * Bundle-Rename: Ordnername/`id` ändern — die UUID bleibt, sie
 * ist die Identität. Kein Rename während eines Imports (Lock). War die
 * Lösung aktiv, wird der Aktiv-Zustand nachgezogen (Pointer + Symlinks); den
 * API-Reload macht der Aufrufer (admin.controller).
 *
 * Sonderfall `default` („meine Arbeitslösung bekommt einen richtigen Namen"):
 * das Bundle wandert komplett nach <to> (Inhalt, DB, State, UUID — keine
 * Kopie), danach wird `default` sofort LEER neu erzeugt (neue UUID) —
 * Invariante I1 bleibt gewahrt. War `default` aktiv, wird die umbenannte
 * Lösung aktiv; das frische `default` steht leer daneben.
 */
function renameSolution(from, to) {
  if (!isValidId(from) || !isValidId(to)) {
    const err = new Error(`Invalid solution id: ${!isValidId(from) ? from : to}`);
    err.code = 'INVALID_SOLUTION_ID';
    throw err;
  }
  if (!solutionExists(from)) {
    const err = new Error(`Unknown solution: ${from}`);
    err.code = 'SOLUTION_NOT_FOUND';
    throw err;
  }
  if (to === from) {
    const err = new Error('New id equals the current id — nothing to rename.');
    err.code = 'INVALID_SOLUTION_ID';
    throw err;
  }
  // Case-insensitiv-Kollisionen ablehnen (Dev-Container-FS) — aber die
  // Eigen-ID case-SENSITIV vergleichen, damit der reine Case-Rename derselben
  // Lösung (Sales → sales) erlaubt bleibt.
  const clash = listSolutions().find(
    (s) => s.id !== from && s.id.toLowerCase() === to.toLowerCase()
  );
  if (clash) {
    const err = new Error(`Solution already exists: ${clash.id}`);
    err.code = 'SOLUTION_EXISTS';
    throw err;
  }
  if (readImportLock(from)) {
    const err = new Error(`Solution '${from}' has a running import — try again after it finishes.`);
    err.code = 'SOLUTION_LOCKED';
    throw err;
  }

  const wasActive = getActiveSolutionId() === from;

  // Case-only-Rename (Sales → sales): auf dem case-insensitiven
  // Dev-Container-FS löst der Zielname auf dasselbe Verzeichnis auf — ein
  // direkter rename kann dort als No-op enden. Zweischritt über einen
  // Temp-Namen ist auf beiden FS-Typen eindeutig.
  const caseOnly = from.toLowerCase() === to.toLowerCase();
  const renameDir = (fromPath, toPath) => {
    if (!caseOnly) {
      fs.renameSync(fromPath, toPath);
      return;
    }
    const tmp = `${fromPath}.tmp-rename-${process.pid}`;
    fs.renameSync(fromPath, tmp);
    fs.renameSync(tmp, toPath);
  };

  // Bundle + API-Kopie verschieben (Inhalt, DB, State, UUID wandern mit).
  renameDir(solutionDir(from), solutionDir(to));
  try {
    if (fs.existsSync(path.join(API_COPIES_ROOT, from))) {
      renameDir(path.join(API_COPIES_ROOT, from), path.join(API_COPIES_ROOT, to));
    }
  } catch (err) {
    console.warn(`[solutions] rename: API copy move failed (${err.message}) — next sync recreates it`);
  }

  // Manifest-`id` nachziehen — die UUID bleibt.
  const manifest = readManifest(to) || {};
  manifest.id = to;
  if (manifest.display_name === from) manifest.display_name = to;
  const target = manifestPath(to);
  fs.writeFileSync(`${target}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.renameSync(`${target}.tmp`, target);

  // Invariante I1: `default` sofort leer neu erzeugen (neues Manifest, neue UUID).
  if (from === DEFAULT_ID) ensureDefaultSolution();

  if (wasActive) setActiveSolution(to);

  return { from, to, was_active: wasActive, uuid: manifest.uuid || null };
}

/**
 * Lösung löschen — entfernt das GESAMTE Bundle (inklusive XML-Quellen!) und
 * die API-Kopie. Die aktive Lösung ist nicht löschbar (erst umschalten). Die
 * doppelte Bestätigung mit explizitem XML-Hinweis + Export-Angebot ist Sache
 * des UI-/CLI-Aufrufers — hier nur die harten Guards.
 */
function deleteSolution(id) {
  if (!solutionExists(id)) {
    const err = new Error(`Unknown solution: ${id}`);
    err.code = 'SOLUTION_NOT_FOUND';
    throw err;
  }
  // Invariante I1: 'default' ist nie löschbar — auch wenn gerade eine andere
  // Lösung aktiv ist (der Aktiv-Guard darunter reicht dafür nicht).
  if (id === DEFAULT_ID) {
    const err = new Error("The 'default' solution cannot be deleted — it is the fixed entry point of this instance.");
    err.code = 'SOLUTION_DEFAULT';
    throw err;
  }
  if (id === getActiveSolutionId()) {
    const err = new Error('Cannot delete the active solution — activate another one first.');
    err.code = 'SOLUTION_ACTIVE';
    throw err;
  }
  if (readImportLock(id)) {
    const err = new Error(`Solution '${id}' has a running import — try again after it finishes.`);
    err.code = 'SOLUTION_LOCKED';
    throw err;
  }
  fs.rmSync(solutionDir(id), { recursive: true, force: true });
  fs.rmSync(path.join(API_COPIES_ROOT, id), { recursive: true, force: true });
  return { deleted: id };
}

module.exports = {
  DEFAULT_ID,
  REPO_ROOT,
  isValidId,
  getActiveSolutionId,
  getRequestContext,
  serverDefaultContext,
  solutionDir,
  manifestPath,
  xmlDir,
  stateDir,
  masterDbPath,
  apiCopyPath,
  resolveDbPath,
  resolveAnnotationsPath,
  resolveStateDir,
  resolveXmlDir,
  readManifest,
  listSolutions,
  solutionExists,
  ensureDefaultSolution,
  ensureWorkspaceSymlinks,
  setActiveSolution,
  createSolution,
  updateSolutionMeta,
  renameSolution,
  deleteSolution,
};
