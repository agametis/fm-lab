/**
 * Louvain community detection (P5 default/fallback engine).
 *
 * Reads a cleaned, undirected edge list (graph_export_logical.sql output) and
 * writes a node→community assignment. Node-only stack (graphology) — the
 * guaranteed baseline that runs without Python/igraph. The Leiden enhancement
 * (cluster_leiden.py) is an optional drop-in with the same I/O contract.
 *
 * Determinism (Cluster-Stabilität): fixed seed + resolution so colors
 * don't jump between runs. graphology-communities-louvain is seeded via `rng`.
 *
 * Usage:  node cluster_louvain.mjs <edges.csv> <communities.csv> [resolution] [seed]
 *   edges.csv         header: source,target   (one row per distinct pair)
 *   communities.csv   header: object_uuid,community
 *
 * Perf: prints edge/node counts, wall-clock and peak RSS to stderr.
 *
 * Quality signal: the stderr line also
 * carries `modularity=<Q>` — the partition's modularity, the primary ranking
 * metric the fm-graph-cluster resolution-sweep reads. Obtained via
 * `louvain.detailed()` (returns `{ communities, count, modularity, … }`) instead
 * of the bare `louvain()` (assignment only) — same partition, one extra field.
 */
import fs from 'node:fs';
import readline from 'node:readline';
import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';

const [, , edgesPath, outPath, resolutionArg, seedArg] = process.argv;
if (!edgesPath || !outPath) {
  console.error('usage: node cluster_louvain.mjs <edges.csv> <communities.csv> [resolution] [seed]');
  process.exit(2);
}
const resolution = resolutionArg ? Number(resolutionArg) : 1.0;
const seed = seedArg ? Number(seedArg) : 42;

/** Deterministic PRNG (mulberry32) so Louvain is reproducible across runs. */
function mulberry32(s) {
  return function () {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const t0 = process.hrtime.bigint();

  // Undirected simple graph; mergeEdge collapses (a,b)/(b,a) and duplicates.
  const g = new Graph({ type: 'undirected', multi: false });
  let edgeCount = 0;

  const rl = readline.createInterface({ input: fs.createReadStream(edgesPath), crlfDelay: Infinity });
  let header = true;
  for await (const line of rl) {
    if (header) { header = false; continue; } // skip "source,target"
    if (!line) continue;
    // UUIDs contain no commas → a single split is safe.
    const ix = line.indexOf(',');
    if (ix < 0) continue;
    const a = line.slice(0, ix);
    const b = line.slice(ix + 1);
    if (!a || !b || a === b) continue;
    if (!g.hasNode(a)) g.addNode(a);
    if (!g.hasNode(b)) g.addNode(b);
    if (!g.hasEdge(a, b)) { g.addEdge(a, b); edgeCount++; }
  }

  const tParsed = process.hrtime.bigint();
  // .detailed() yields the modularity Q (primary sweep metric) alongside
  // the node→community map — same partition as the bare louvain() call.
  const detailed = louvain.detailed(g, { resolution, rng: mulberry32(seed) });
  const assignment = detailed.communities;
  const tClustered = process.hrtime.bigint();

  // Write assignment. Compact integer community ids (Louvain already yields 0..k).
  const out = fs.createWriteStream(outPath);
  out.write('object_uuid,community\n');
  for (const node of g.nodes()) out.write(`${node},${assignment[node]}\n`);
  await new Promise((res) => out.end(res));

  const communities = detailed.count ?? new Set(Object.values(assignment)).size;
  const ms = (a, b) => Number(b - a) / 1e6;
  const rssMb = (process.memoryUsage().rss / 1024 / 1024).toFixed(0);
  console.error(
    `[louvain] nodes=${g.order} edges=${edgeCount} communities=${communities} ` +
    `modularity=${detailed.modularity.toFixed(6)} ` +
    `resolution=${resolution} seed=${seed} | parse=${ms(t0, tParsed).toFixed(0)}ms ` +
    `cluster=${ms(tParsed, tClustered).toFixed(0)}ms peakRSS=${rssMb}MB`
  );
}

main().catch((err) => { console.error(err); process.exit(1); });
