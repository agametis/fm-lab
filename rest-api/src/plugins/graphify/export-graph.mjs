#!/usr/bin/env node
// @ts-nocheck
/**
 * graphify — graph export core (the shared kernel).
 *
 * This single Node script IS the execution core. Two thin entry points call it:
 *   • the REST backend (graphify.service.js spawns `node export-graph.mjs --ndjson …`)
 *   • the optional CLI wrapper (graphify.sh → the same `node export-graph.mjs`)
 * There is therefore no duplicated logic and the web export and the CLI export
 * are guaranteed identical. The backend depends on this file; the shell wrapper
 * is an independent, optional parallel branch over the same core.
 *
 * What it does (all heavy lifting via the native `duckdb` binary — nothing big is
 * ever held in Node memory):
 *   1. resolve the duckdb binary + a readable catalog DB (master → API copy)
 *   2. count nodes/edges (drives the progress bar + the meta header)
 *   3. run graph_export_full.sql → two JSON-array temp files (nodes, edges)
 *   4. stream-stitch them into one  output/graph_export_<ts>.json
 *      document shaped { meta, nodes, edges } (graphify-compatible)
 *
 * Progress/result is emitted as NDJSON on stdout (one JSON object per line) when
 * `--ndjson` is set; otherwise human-readable lines go to stderr. Exit code 0 on
 * success, non-zero on failure.
 *
 * Usage:
 *   node export-graph.mjs [--ndjson] [--out-dir <dir>] [--out <file>] [--db <path>]
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// rest-api/src/plugins/graphify → repo root
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const TEMPLATE_PATH = path.join(__dirname, 'graph_export_full.sql');

// ---------------------------------------------------------------------------
// Arg parsing (minimal)
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { ndjson: false, outDir: null, outFile: null, db: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ndjson') out.ndjson = true;
    else if (a === '--out-dir') out.outDir = argv[++i];
    else if (a === '--out') out.outFile = argv[++i];
    else if (a === '--db') out.db = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  process.stderr.write(
    'Usage: node export-graph.mjs [--ndjson] [--out-dir <dir>] [--out <file>] [--db <path>]\n'
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Event emission
// ---------------------------------------------------------------------------
function emit(evt) {
  if (args.ndjson) {
    process.stdout.write(JSON.stringify(evt) + '\n');
  } else {
    // Human-readable on stderr so stdout stays clean for piping.
    const tag = evt.event;
    if (tag === 'progress') process.stderr.write(`  [${evt.pct}%] ${evt.phase}\n`);
    else if (tag === 'log') process.stderr.write(`  ${evt.msg}\n`);
    else if (tag === 'done') process.stderr.write(evt.ok ? `✅ ${evt.msg || 'done'}\n` : `❌ failed (exit ${evt.exit_code})\n`);
    else if (tag === 'error') process.stderr.write(`❌ ${evt.message}\n`);
    else if (tag === 'start') process.stderr.write(`graphify export — db: ${evt.db}\n`);
  }
}

function nowIso() {
  return new Date().toISOString();
}

function fail(message, code = 1) {
  emit({ event: 'error', message });
  emit({ event: 'done', ok: false, exit_code: code });
  process.exit(code);
}

// ---------------------------------------------------------------------------
// duckdb binary + DB resolution
// ---------------------------------------------------------------------------
function resolveDuckdb() {
  if (process.env.DUCKDB_BIN && fs.existsSync(process.env.DUCKDB_BIN)) {
    return process.env.DUCKDB_BIN;
  }
  const probe = spawnSync('duckdb', ['--version'], { stdio: 'ignore' });
  if (!probe.error) return 'duckdb';
  const home = process.env.HOME || '';
  const candidates = [
    path.join(home, '.duckdb', 'cli', 'latest', 'duckdb'),
    '/opt/homebrew/bin/duckdb',
    '/usr/local/bin/duckdb',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/** Run the duckdb binary, capturing stdout/stderr. Resolves with { code, stdout, stderr }. */
function runDuck(duckBin, duckArgs) {
  return new Promise((resolve) => {
    const child = spawn(duckBin, duckArgs, { cwd: REPO_ROOT });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: stderr + err.message }));
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

/**
 * Pick the first catalog DB that actually opens read-only. Prefer the master
 * (single source of truth); if it is locked (a convert-xml run holds the RW
 * lock) fall back to the API read-only copy. With --db, only that path is tried.
 */
async function pickDb(duckBin) {
  const candidates = args.db
    ? [args.db]
    : [
        path.join(REPO_ROOT, 'db', 'fm_catalog.duckdb'),
        path.join(REPO_ROOT, 'rest-api', 'db', 'fm_catalog.duckdb'),
      ].filter((p) => fs.existsSync(p));

  if (candidates.length === 0) {
    throw new Error('No catalog DB found (expected db/fm_catalog.duckdb). Run convert-xml first.');
  }

  let lastErr = '';
  for (const db of candidates) {
    const probe = await runDuck(duckBin, ['-readonly', db, '-c', 'SELECT 1']);
    if (probe.code === 0) return db;
    lastErr = (probe.stderr || '').trim();
  }
  throw new Error(`Could not open any catalog DB read-only: ${lastErr}`);
}

// ---------------------------------------------------------------------------
// Stream helpers
// ---------------------------------------------------------------------------
/** Append a file's contents into an already-open write stream (no close). */
function appendFile(srcPath, dest) {
  return new Promise((resolve, reject) => {
    const rs = fs.createReadStream(srcPath, { encoding: 'utf8' });
    rs.on('error', reject);
    rs.on('end', resolve);
    rs.pipe(dest, { end: false });
  });
}

function writeChunk(dest, str) {
  return new Promise((resolve, reject) => {
    dest.write(str, (err) => (err ? reject(err) : resolve()));
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const duckBin = resolveDuckdb();
  if (!duckBin) {
    fail('duckdb binary not found. Set DUCKDB_BIN or install DuckDB (see CLAUDE.md).');
    return;
  }

  let db;
  try {
    db = await pickDb(duckBin);
  } catch (err) {
    fail(err.message);
    return;
  }

  const outDir = args.outDir
    ? path.resolve(REPO_ROOT, args.outDir)
    : path.join(REPO_ROOT, 'output');
  fs.mkdirSync(outDir, { recursive: true });

  const stamp = nowIso().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
  const outName = args.outFile || `graph_export_${stamp}.json`;
  const finalPath = path.join(outDir, outName);

  emit({ event: 'start', ts: nowIso(), db });
  emit({ event: 'progress', pct: 2, phase: 'count' });

  // --- 1) Counts (meta + progress) ---
  const countSql =
    'SELECT ' +
    '(SELECT COUNT(*) FROM ObjectCatalog) AS nodes, ' +
    '(SELECT COUNT(*) FROM ObjectLinks ' +
    '  WHERE Source_UUID IN (SELECT Object_UUID FROM ObjectCatalog) ' +
    '    AND Target_UUID IN (SELECT Object_UUID FROM ObjectCatalog)) AS edges, ' +
    '(SELECT COUNT(*) FROM ObjectLinks) AS edges_total, ' +
    '(SELECT COUNT(*) FROM FilesCatalog) AS files;';

  const countRes = await runDuck(duckBin, ['-json', '-readonly', db, '-c', countSql]);
  if (countRes.code !== 0) {
    fail(`Count query failed: ${(countRes.stderr || '').trim()}`);
    return;
  }
  let counts;
  try {
    counts = JSON.parse(countRes.stdout)[0];
  } catch {
    fail('Could not parse count result from duckdb.');
    return;
  }
  const nodeCount = Number(counts.nodes) || 0;
  const edgeCount = Number(counts.edges) || 0;
  const edgesTotal = Number(counts.edges_total) || 0;
  const fileCount = Number(counts.files) || 0;
  emit({ event: 'log', level: 'info', msg: `${nodeCount} nodes, ${edgeCount} edges (${edgesTotal - edgeCount} orphans dropped)` });
  emit({ event: 'progress', pct: 12, phase: 'count' });

  // --- 2) Export the two arrays via native COPY ---
  const nodesTmp = path.join(os.tmpdir(), `graphify-${process.pid}-nodes.json`);
  const edgesTmp = path.join(os.tmpdir(), `graphify-${process.pid}-edges.json`);

  let template;
  try {
    template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  } catch (err) {
    fail(`Could not read SQL template: ${err.message}`);
    return;
  }
  // COPY … TO requires a string literal — substitute the temp paths in.
  const sql = template
    .split('{{NODES_OUT}}').join(nodesTmp.replace(/'/g, "''"))
    .split('{{EDGES_OUT}}').join(edgesTmp.replace(/'/g, "''"));

  emit({ event: 'progress', pct: 18, phase: 'export' });
  const exportRes = await runDuck(duckBin, ['-readonly', db, '-c', sql]);
  if (exportRes.code !== 0) {
    safeUnlink(nodesTmp); safeUnlink(edgesTmp);
    fail(`Export query failed: ${(exportRes.stderr || '').trim()}`);
    return;
  }
  emit({ event: 'progress', pct: 80, phase: 'assemble' });

  // --- 3) Stitch { meta, nodes, edges } ---
  const meta = {
    schema: 'fmlab-graph/1.0',
    generator: 'graphify-plugin',
    generatedAt: nowIso(),
    source: {
      db: path.relative(REPO_ROOT, db) || db,
      nodes: nodeCount,
      edges: edgeCount,
      edgesTotal,
      orphansDropped: edgesTotal - edgeCount,
      files: fileCount,
    },
    mapping: 'ObjectCatalog→nodes, ObjectLinks→edges (orphan-filtered: both endpoints catalogued)',
  };

  try {
    await new Promise((resolve, reject) => {
      const dest = fs.createWriteStream(finalPath, { encoding: 'utf8' });
      dest.on('error', reject);
      (async () => {
        await writeChunk(dest, '{\n"meta": ' + JSON.stringify(meta, null, 2) + ',\n"nodes": ');
        await appendFile(nodesTmp, dest);
        await writeChunk(dest, ',\n"edges": ');
        await appendFile(edgesTmp, dest);
        await writeChunk(dest, '\n}\n');
        dest.end();
      })().catch(reject);
      dest.on('finish', resolve);
    });
  } catch (err) {
    safeUnlink(nodesTmp); safeUnlink(edgesTmp);
    fail(`Assembling output failed: ${err.message}`);
    return;
  }

  safeUnlink(nodesTmp);
  safeUnlink(edgesTmp);

  let bytes = 0;
  try { bytes = fs.statSync(finalPath).size; } catch { /* ignore */ }

  emit({ event: 'progress', pct: 100, phase: 'assemble' });
  emit({
    event: 'done',
    ok: true,
    exit_code: 0,
    file: finalPath,
    relPath: path.relative(REPO_ROOT, finalPath),
    nodes: nodeCount,
    edges: edgeCount,
    bytes,
    msg: `wrote ${path.relative(REPO_ROOT, finalPath)} (${nodeCount} nodes, ${edgeCount} edges, ${(bytes / 1048576).toFixed(1)} MB)`,
  });
}

function safeUnlink(p) {
  try { fs.unlinkSync(p); } catch { /* ignore */ }
}

main().catch((err) => {
  fail(err && err.message ? err.message : String(err));
});
