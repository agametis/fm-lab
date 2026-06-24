#!/usr/bin/env node
/**
 * sweep.mjs — resolution-sweep driver + scoring rubric for fm-graph-cluster.
 *
 * Exports the cleaned logical edge list ONCE, runs the community engine for each
 * candidate resolution (N×, no DB write load), computes the raw metrics + the
 * score per candidate, and emits a complete ranking as JSON on stdout (logs on stderr).
 *
 * Export once, engine N times — never N cluster_load.sql /
 * sync round-trips. This script touches the master DB read-only (the edge export
 * and the n_files query both run with -readonly); it writes only temp CSVs in a
 * workdir and the JSON result on stdout.
 *
 * Usage:
 *   node sweep.mjs --db=<path> --tools=<dir> \
 *        [--candidates=0.5,0.75,1.0,1.5,2.0,3.0] [--seed=42] [--engine=auto|louvain|leiden]
 *
 * Output (stdout): a single JSON object — see buildResult(). The orchestrating
 * SKILL.md reads `winner.resolution`, the `candidates[]` ranking table, `size`,
 * `engine`, `q_available` and `near_tie`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';

// ── Rubric constants (justierbar, an echter DB kalibrieren) ─────────────────
const W = { Q: 1.0, big: 1.5, frag: 1.0, band: 0.5 };  // term weights
const TAU = { big: 0.25, frag: 0.40 };                  // penalty thresholds
const AVG_LO = 30;   // finest acceptable mean module size  → K_hi = n_nodes/AVG_LO
const AVG_HI = 150;  // coarsest acceptable mean module size → K_lo = n_nodes/AVG_HI
const TIE_EPSILON = 0.03;  // top-1 vs top-2 score gap below which we flag a near-tie
const DEFAULT_CANDIDATES = [0.5, 0.75, 1.0, 1.5, 2.0, 3.0];

// ── Arg parsing ─────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
    else if (a.startsWith('--')) out[a.slice(2)] = true;
  }
  return out;
}
const args = parseArgs(process.argv);

const DB_FILE = args.db;
const TOOLS_DIR = args.tools;
if (!DB_FILE || !TOOLS_DIR) {
  console.error('usage: node sweep.mjs --db=<path> --tools=<dir> [--candidates=…] [--seed=42] [--engine=auto]');
  process.exit(2);
}
const SEED = args.seed ? Number(args.seed) : 42;
const CANDIDATES = args.candidates
  ? args.candidates.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0)
  : DEFAULT_CANDIDATES;
let engineArg = (args.engine || 'auto').toLowerCase();

const EXPORT_SQL = path.join(TOOLS_DIR, 'graph_export_logical.sql');
const LOUVAIN = path.join(TOOLS_DIR, 'cluster_louvain.mjs');
const LEIDEN = path.join(TOOLS_DIR, 'cluster_leiden.py');

// ── Locate duckdb (CLAUDE.md well-known locations) ──────────────────────────
function findDuckdb() {
  const which = spawnSync('bash', ['-lc', 'command -v duckdb'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  const candidates = [
    path.join(os.homedir(), '.duckdb/cli/latest/duckdb'),
    '/opt/homebrew/bin/duckdb',
    '/usr/local/bin/duckdb',
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}
const DUCKDB = findDuckdb();
if (!DUCKDB) {
  console.error('ERROR: duckdb binary not found (see CLAUDE.md for install locations).');
  process.exit(3);
}

// ── Engine resolution (mirrors cluster.sh: auto prefers leiden when available) ─
function igraphAvailable() {
  const r = spawnSync('python3', ['-c', 'import igraph'], { stdio: 'ignore' });
  return r.status === 0;
}
let engine, engineReason;
if (engineArg === 'auto') {
  if (igraphAvailable()) { engine = 'leiden'; engineReason = 'auto → leiden (python3 + igraph present)'; }
  else { engine = 'louvain'; engineReason = 'auto → louvain (python3 + igraph not available)'; }
} else if (engineArg === 'leiden') {
  if (!igraphAvailable()) {
    console.error('ERROR: --engine=leiden but python3+igraph not available.');
    process.exit(5);
  }
  engine = 'leiden'; engineReason = 'forced leiden';
} else {
  engine = 'louvain'; engineReason = 'forced louvain';
}

// ── Workdir (temp CSVs; duckdb COPY/read_csv are CWD-relative) ───────────────
const WORKDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fmlab-sweep-'));
process.on('exit', () => { try { fs.rmSync(WORKDIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const log = (m) => process.stderr.write(`${m}\n`);
const nowMs = () => Number(process.hrtime.bigint() / 1000000n);

// ── 1) Export cleaned logical edges → edges.csv (ONCE, read-only) ───────────
log(`→ exporting logical edges (once) …`);
const tExport0 = nowMs();
const edgesPath = path.join(WORKDIR, 'edges.csv');
{
  const sql = fs.readFileSync(EXPORT_SQL, 'utf8');
  const r = spawnSync(DUCKDB, [DB_FILE, '-readonly'], { input: sql, cwd: WORKDIR, encoding: 'utf8' });
  if (r.status !== 0) {
    log(r.stderr || '');
    console.error('ERROR: edge export failed (is the master DB locked by convert-xml?).');
    process.exit(7);
  }
}
const exportMs = nowMs() - tExport0;

// node/edge counts from edges.csv (= the exact graph the engine clusters)
async function countEdges(p) {
  const nodes = new Set();
  let edges = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(p), crlfDelay: Infinity });
  let header = true;
  for await (const line of rl) {
    if (header) { header = false; continue; }
    if (!line) continue;
    const ix = line.indexOf(',');
    if (ix < 0) continue;
    const a = line.slice(0, ix), b = line.slice(ix + 1);
    if (!a || !b) continue;
    nodes.add(a); nodes.add(b);
    edges++;
  }
  return { nNodes: nodes.size, nEdges: edges };
}
const { nNodes, nEdges } = await countEdges(edgesPath);
if (nNodes === 0 || nEdges === 0) {
  console.error('ERROR: exported edge list is empty — graph not populated? Run convert-xml/Graphify first.');
  process.exit(7);
}

// ── 2) n_files of the clustered subgraph (read-only, identical to sweep input) ─
// Node IDs in edges.csv are composite `uuid::file` (export 3.0.0) — the file
// segment IS the node's file, so count distinct file segments directly (no
// ObjectCatalog join, and clone-correct: each (uuid,file) node carries its own
// file, vs. the old uuid-join which over-counted a clone's other files).
// NULL-file synthetics are bare `uuid` ⇒ split_part(…,2)='' ⇒ NULLIF → ignored.
const tFiles0 = nowMs();
let nFiles = null;
{
  const q = `WITH node_ids AS (
               SELECT source AS node FROM read_csv('edges.csv', header=true) WHERE source IS NOT NULL
               UNION
               SELECT target       FROM read_csv('edges.csv', header=true) WHERE target IS NOT NULL
             )
             SELECT COUNT(DISTINCT NULLIF(split_part(node, '::', 2), '')) AS n_files
             FROM node_ids;`;
  const r = spawnSync(DUCKDB, [DB_FILE, '-readonly', '-noheader', '-list', '-c', q], { cwd: WORKDIR, encoding: 'utf8' });
  if (r.status === 0) {
    const v = parseInt((r.stdout || '').trim(), 10);
    if (Number.isFinite(v)) nFiles = v;
  } else {
    log('  WARN: n_files query failed — band file-floor anchor disabled.');
  }
}
const filesMs = nowMs() - tFiles0;

// ── Band derived from solution size ─────────────────────────────────────────
// Acceptable community count K band: mean module size in [AVG_LO, AVG_HI].
//   K_hi = n_nodes / AVG_LO (finest)   K_lo = n_nodes / AVG_HI (coarsest)
// Soft file-floor: never want fewer modules than files (cross-file mega-modules).
const kHi = nNodes / AVG_LO;
let kLo = nNodes / AVG_HI;
if (nFiles != null) kLo = Math.max(kLo, nFiles);
const band = { k_lo: Math.round(kLo), k_hi: Math.round(kHi), avg_lo: AVG_LO, avg_hi: AVG_HI, file_floor: nFiles };

function bandPenalty(K) {
  if (K < kLo) return (kLo - K) / kLo;   // relative shortfall (too coarse)
  if (K > kHi) return (K - kHi) / kHi;   // relative excess (over-resolution)
  return 0;
}

// ── 3) Run engine per candidate + collect raw metrics ───────────────────────
function runEngine(resolution, outName) {
  const outPath = path.join(WORKDIR, outName);
  const t0 = nowMs();
  let r;
  if (engine === 'leiden') {
    r = spawnSync('python3', [LEIDEN, 'edges.csv', outName, String(resolution), String(SEED)], { cwd: WORKDIR, encoding: 'utf8' });
  } else {
    r = spawnSync('node', [LOUVAIN, 'edges.csv', outName, String(resolution), String(SEED)], { cwd: WORKDIR, encoding: 'utf8' });
  }
  const ms = nowMs() - t0;
  if (r.status !== 0) {
    log(r.stderr || '');
    throw new Error(`engine failed for resolution=${resolution}`);
  }
  // Q from stderr. Missing ⇒ ungepatchte Engine ⇒ Fallback (Q=null).
  const qm = (r.stderr || '').match(/modularity=([-\d.eE+]+)/);
  const Q = qm ? Number(qm[1]) : null;
  return { outPath, ms, Q };
}

// metrics purely from comm CSV (sizes per community)
function metricsFromComm(commPath) {
  const sizes = new Map();
  const data = fs.readFileSync(commPath, 'utf8');
  let total = 0;
  let first = true;
  for (const line of data.split('\n')) {
    if (first) { first = false; continue; } // header
    if (!line) continue;
    const ix = line.lastIndexOf(',');
    if (ix < 0) continue;
    const c = line.slice(ix + 1);
    sizes.set(c, (sizes.get(c) || 0) + 1);
    total++;
  }
  const sizeArr = [...sizes.values()].sort((a, b) => a - b);
  const K = sizeArr.length;
  const largest = sizeArr.length ? sizeArr[sizeArr.length - 1] : 0;
  const singletons = sizeArr.filter((s) => s === 1).length;
  const tinyNodes = sizeArr.filter((s) => s < 3).reduce((a, s) => a + s, 0);
  const median = K ? (K % 2 ? sizeArr[(K - 1) / 2] : (sizeArr[K / 2 - 1] + sizeArr[K / 2]) / 2) : 0;
  return {
    n_partitioned: total,
    K,
    largest_share: total ? largest / total : 0,
    singleton_share: K ? singletons / K : 0,
    tiny_node_share: total ? tinyNodes / total : 0,
    avg_size: K ? total / K : 0,
    median_size: median,
  };
}

log(`→ sweeping ${CANDIDATES.length} candidate(s) with ${engine} (seed=${SEED}) …`);
const tSweep0 = nowMs();
const raw = [];
for (const r of CANDIDATES) {
  const safe = String(r).replace(/[^0-9]/g, '_');
  const { outPath, ms, Q } = runEngine(r, `comm_${safe}.csv`);
  const m = metricsFromComm(outPath);
  raw.push({ resolution: r, Q, cluster_ms: ms, ...m });
  log(`  r=${r}: K=${m.K} Q=${Q ?? 'n/a'} largest_share=${m.largest_share.toFixed(3)} ` +
      `singleton_share=${m.singleton_share.toFixed(3)} avg_size=${m.avg_size.toFixed(1)} (${ms}ms)`);
}
const sweepMs = nowMs() - tSweep0;

// ── 4) Score + rank ─────────────────────────────────────────────────────────
const qVals = raw.map((c) => c.Q).filter((q) => q != null);
const qAvailable = qVals.length === raw.length && raw.length > 0;
// norm(Q): modularity is already on a ~[0,1] scale, so we use it directly (clamped).
// Deliberately NOT min-max-across-candidates — that would inflate trivial Q gaps
// (0.918 vs 0.907) into a 1.0-vs-0.78 spread and defeat the near-tie guard. Raw Q
// keeps score gaps faithful to real quality gaps (Q rewards real structure, the
// penalty terms reject degenerate partitions). No Q at all ⇒ 0 for
// every candidate (Q term drops out → fallback to distribution heuristics).
function normQ(Q) {
  if (Q == null || !qAvailable) return 0;
  return Math.min(1, Math.max(0, Q));
}

for (const c of raw) {
  c.norm_Q = normQ(c.Q);
  c.band_penalty = bandPenalty(c.K);
  c.score =
      W.Q * c.norm_Q
    - W.big * Math.max(0, c.largest_share - TAU.big)
    - W.frag * Math.max(0, c.singleton_share - TAU.frag)
    - W.band * c.band_penalty;
}
const ranked = [...raw].sort((a, b) => b.score - a.score);
ranked.forEach((c, i) => { c.rank = i + 1; });

const winner = ranked[0];
const runnerUp = ranked[1] || null;
const nearTie = !!(runnerUp && (winner.score - runnerUp.score) < TIE_EPSILON);

// ── 5) Emit JSON result ─────────────────────────────────────────────────────
function round(o) {
  return {
    ...o,
    Q: o.Q == null ? null : Number(o.Q.toFixed(6)),
    norm_Q: Number(o.norm_Q.toFixed(4)),
    largest_share: Number(o.largest_share.toFixed(4)),
    singleton_share: Number(o.singleton_share.toFixed(4)),
    tiny_node_share: Number(o.tiny_node_share.toFixed(4)),
    avg_size: Number(o.avg_size.toFixed(1)),
    median_size: Number(o.median_size),
    band_penalty: Number(o.band_penalty.toFixed(4)),
    score: Number(o.score.toFixed(4)),
  };
}
const result = {
  schema: 'fm-graph-cluster/sweep@1',
  engine,
  engine_reason: engineReason,
  seed: SEED,
  q_available: qAvailable,
  size: { n_nodes: nNodes, n_edges: nEdges, n_files: nFiles },
  band,
  weights: { ...W, tau_big: TAU.big, tau_frag: TAU.frag },
  tie_epsilon: TIE_EPSILON,
  near_tie: nearTie,
  timings_ms: { export: exportMs, files_query: filesMs, sweep_total: sweepMs },
  candidates: ranked.map(round),
  winner: round(winner),
  runner_up: runnerUp ? round(runnerUp) : null,
};
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
log(`→ winner: resolution=${winner.resolution} (score=${winner.score.toFixed(4)}, K=${winner.K}` +
    `${nearTie ? ', NEAR-TIE with runner-up' : ''})`);
