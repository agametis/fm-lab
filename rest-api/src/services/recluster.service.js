const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const settingsStore = require('../plugins/settings-store');

/**
 * Recluster-Service — der Rebuild-Button. Spawnt `cluster.sh` mit
 * Standard-Sync (Repartition → cache_apply → sync_db.sh Copy + /api/admin/reload).
 * Der von cluster.sh ausgelöste Reload triggert im selben Server-Prozess den
 * R3-Restore + User-Namen-Remap (system-reload.js). Die Roh-Repartition ist billig
 * (kein LLM) — die Struktur-Heilung der ① Drift-Kennzahl.
 *
 * Zero-config (R6): Engine/Resolution/Seed kommen aus
 * `solutions/<id>/state/cluster.json` (Skill-Sweep-Gewinner; Fallback
 * .fmlab/cluster.json aus unmigrierten Workspaces) bzw. den cluster.sh-Defaults
 * — KEIN Granularitäts-Regler.
 *
 * Concurrency: Re-Cluster und Convert schreiben beide den Master → gegenseitiger
 * Ausschluss. Der Endpoint hält für die Laufzeit das per-Solution
 * `xml_convert.lock` (Source „cluster"), damit ein paralleler CLI-/API-Import
 * 409 bekommt; cluster.sh selbst nimmt KEINEN Lock (kein Deadlock).
 */

const solutions = require('../config/solutions');

const REPO_ROOT = settingsStore.resolveRepoRoot();
const CLUSTER_SCRIPT = path.join(REPO_ROOT, 'tools', 'graph-export', 'cluster.sh');
// Per aktive Lösung aufgelöst (Funktionen statt Konstanten — Lösungswechsel
// greift ohne Prozess-Neustart).
function lockPath() { return path.join(solutions.resolveStateDir(), 'xml_convert.lock'); }
function clusterJsonPath() {
  const p = path.join(solutions.resolveStateDir(), 'cluster.json');
  if (fs.existsSync(p)) return p;
  return path.join(REPO_ROOT, '.fmlab', 'cluster.json');
}

let reclusterActive = false;

function isReclusterActive() {
  return reclusterActive;
}

/**
 * R1 — Engine/Resolution/Seed aus .fmlab/cluster.json lesen (Skill Phase H).
 * Fehlt die Datei → cluster.sh-Defaults (auto/1.0/42). Eine hinterlegte
 * `leiden`-Engine wird auf `auto` heruntergestuft, damit cluster.sh auf einem
 * Host ohne python3+igraph nicht hart abbricht (Resolution/Seed bleiben).
 */
function readClusterConfig() {
  const cfg = { engine: 'auto', resolution: '1.0', seed: '42' };
  try {
    const raw = JSON.parse(fs.readFileSync(clusterJsonPath(), 'utf-8'));
    if (raw && raw.engine) cfg.engine = String(raw.engine);
    if (raw && raw.resolution != null) cfg.resolution = String(raw.resolution);
    if (raw && raw.seed != null) cfg.seed = String(raw.seed);
  } catch { /* missing/invalid → defaults */ }
  if (cfg.engine === 'leiden') cfg.engine = 'auto';
  return cfg;
}

function writeLock() {
  try {
    const p = lockPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, `${process.pid}\n${new Date().toISOString()}\ncluster\n`);
  } catch (err) {
    console.warn(`[recluster] could not write lock: ${err.message}`);
  }
}

function removeLock() {
  try { fs.unlinkSync(lockPath()); } catch { /* already gone */ }
}

/**
 * Spawnt cluster.sh (Sync AN) und streamt stdout/stderr zeilenweise an onEvent
 * als `log`-Events. Hält den Lock für die gesamte Laufzeit. Resolvet mit
 * `{ exit_code }`. Bricht der Client weg, läuft cluster.sh BEWUSST zu Ende (kein
 * SIGTERM mitten in cluster_load → keine halbe Partition); der Lock wird erst beim
 * regulären Ende freigegeben.
 */
function runRecluster({ onEvent } = {}) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(CLUSTER_SCRIPT)) {
      const err = new Error(`Cluster script not found: ${CLUSTER_SCRIPT}`);
      err.code = 'SCRIPT_NOT_FOUND';
      reject(err);
      return;
    }

    reclusterActive = true;
    writeLock();
    const cfg = readClusterConfig();
    if (onEvent) {
      onEvent({ event: 'log', level: 'info', msg: `cluster.sh (engine=${cfg.engine} resolution=${cfg.resolution} seed=${cfg.seed})` });
    }

    const child = spawn('bash', [CLUSTER_SCRIPT], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        FMLAB_CLUSTER_ENGINE: cfg.engine,
        FMLAB_CLUSTER_RESOLUTION: cfg.resolution,
        FMLAB_CLUSTER_SEED: cfg.seed,
        // Standard-Sync AN (kein FMLAB_CLUSTER_NO_SYNC) → cluster.sh kopiert die
        // Copy und triggert /api/admin/reload (R3-Restore im selben Prozess).
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buf = '';
    const onChunk = (chunk) => {
      buf += chunk.toString('utf-8');
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.trim() && onEvent) onEvent({ event: 'log', level: 'info', msg: line });
      }
    };
    child.stdout.on('data', onChunk);
    child.stderr.on('data', onChunk);

    child.on('error', (err) => {
      reclusterActive = false;
      removeLock();
      reject(err);
    });
    child.on('close', (code) => {
      if (buf.trim() && onEvent) onEvent({ event: 'log', level: 'info', msg: buf });
      reclusterActive = false;
      removeLock();
      resolve({ exit_code: typeof code === 'number' ? code : -1 });
    });
  });
}

module.exports = { runRecluster, isReclusterActive };
