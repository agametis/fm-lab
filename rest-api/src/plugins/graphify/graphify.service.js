const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const settingsStore = require('../settings-store');

/**
 * graphify export service.
 *
 * Spawns the shared kernel `node export-graph.mjs --ndjson` (the SAME script the
 * optional CLI wrapper runs) and forwards its NDJSON events. Mirrors the proven
 * spawn→NDJSON→SSE shape of services/xml-convert.js, but the export is read-only
 * and far simpler (no DB reload, no manifest skipping).
 *
 * State (`.fmlab/plugins/graphify/last_export.json`) records the last run for the
 * settings panel; the graph JSON itself is written to `output/`.
 */

const REPO_ROOT = settingsStore.resolveRepoRoot();
const EXPORT_SCRIPT = path.join(__dirname, 'export-graph.mjs');
const OUTPUT_DIR = path.join(REPO_ROOT, 'output');
const STATE_DIR = path.join(REPO_ROOT, '.fmlab', 'plugins', 'graphify');
const LAST_EXPORT_PATH = path.join(STATE_DIR, 'last_export.json');

let running = false;

function isRunning() {
  return running;
}

function nowIso() {
  return new Date().toISOString();
}

async function writeJsonAtomic(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  await fsp.rename(tmp, file);
}

async function readLastExport() {
  try {
    const raw = await fsp.readFile(LAST_EXPORT_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    console.warn(`[graphify] failed to read last_export.json: ${err.message}`);
    return null;
  }
}

/**
 * Lists previously exported graph files in output/ (newest first).
 */
async function listExports() {
  let entries;
  try {
    entries = await fsp.readdir(OUTPUT_DIR, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const files = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!/^graph_export_.*\.json$/.test(e.name)) continue;
    try {
      const stat = await fsp.stat(path.join(OUTPUT_DIR, e.name));
      files.push({
        filename: e.name,
        relPath: path.join('output', e.name),
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        mtime_ms: stat.mtimeMs,
      });
    } catch {
      // vanished between readdir and stat — ignore
    }
  }
  files.sort((a, b) => b.mtime_ms - a.mtime_ms);
  return files;
}

async function getStatus() {
  const [lastExport, files] = await Promise.all([readLastExport(), listExports()]);
  return {
    output_dir: 'output',
    running,
    last_export: lastExport,
    files,
  };
}

/**
 * Spawn the export kernel and stream its NDJSON events to onEvent(). Resolves
 * with { exit_code, ok }. Persists a last-run record on completion.
 */
function runExport({ onEvent, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(EXPORT_SCRIPT)) {
      const err = new Error(`Export script not found: ${EXPORT_SCRIPT}`);
      err.code = 'SCRIPT_NOT_FOUND';
      reject(err);
      return;
    }

    running = true;
    const startedAt = nowIso();
    const record = {
      started_at: startedAt,
      finished_at: null,
      ok: null,
      exit_code: null,
      file: null,
      relPath: null,
      nodes: null,
      edges: null,
      bytes: null,
    };

    const child = spawn('node', [EXPORT_SCRIPT, '--ndjson', '--out-dir', 'output'], {
      cwd: REPO_ROOT,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const dispatchLine = (channel, raw) => {
      const line = raw.trim();
      if (!line) return;
      let evt;
      try {
        evt = JSON.parse(line);
      } catch {
        evt = { event: 'log', level: channel === 'stderr' ? 'warn' : 'info', msg: line };
      }
      if (typeof evt !== 'object' || evt === null) {
        evt = { event: 'log', level: 'info', msg: String(line) };
      }

      if (evt.event === 'done') {
        record.ok = evt.ok !== false;
        if (typeof evt.exit_code === 'number') record.exit_code = evt.exit_code;
        if (evt.file) record.file = evt.file;
        if (evt.relPath) record.relPath = evt.relPath;
        if (typeof evt.nodes === 'number') record.nodes = evt.nodes;
        if (typeof evt.edges === 'number') record.edges = evt.edges;
        if (typeof evt.bytes === 'number') record.bytes = evt.bytes;
      }

      if (onEvent) {
        try { onEvent(evt); } catch (err) { console.warn(`[graphify] onEvent threw: ${err.message}`); }
      }
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

    child.on('error', (err) => {
      running = false;
      reject(err);
    });

    child.on('close', async (code) => {
      if (buffers.stdout) dispatchLine('stdout', buffers.stdout);
      if (buffers.stderr) dispatchLine('stderr', buffers.stderr);

      const exitCode = code ?? 0;
      record.exit_code = record.exit_code ?? exitCode;
      record.ok = record.ok ?? (exitCode === 0);
      record.finished_at = nowIso();

      try {
        await writeJsonAtomic(LAST_EXPORT_PATH, record);
      } catch (err) {
        console.warn(`[graphify] failed to persist last_export.json: ${err.message}`);
      }

      running = false;
      resolve({ exit_code: exitCode, ok: exitCode === 0, record });
    });
  });
}

module.exports = {
  EXPORT_SCRIPT,
  OUTPUT_DIR,
  isRunning,
  runExport,
  getStatus,
};
