import {
  getResultsSummary, runResults,
  type ResultEnvelope, type ResultsSummary, type ResultsRunTarget,
} from '../api/resultsApi';
import { getSelectedSolution } from './solutionStore';

/**
 * Client-side result cache (R7 layer 2) — generalises the tests result cache
 * for the dashboard overview chips.
 *
 * sessionStorage `fmlab.results.cache.v1` + in-memory, keyed per solution:
 * the flat envelope map + the catalogFingerprint it was computed against.
 * Policy identical to testsStore: a foreign fingerprint DROPS the entry
 * (never shown as "stale" — results against an old catalog are potentially
 * wrong, not weaker). Aggregates are NOT cached client-side; folding the flat
 * map is cheap and the server aggregate exists for bundles.
 *
 * A tiny external-store subscription (useSyncExternalStore in
 * useDashboardSummary) lets TileGrid consume without prop drilling.
 */

const CACHE_KEY = 'fmlab.results.cache.v1';

interface SolutionCacheEntry {
  fingerprint: string | null;
  results: Record<string, ResultEnvelope>;
  at: number;
}

type CacheShape = Record<string, SolutionCacheEntry>;

let cache: CacheShape | null = null;
let version = 0;
const listeners = new Set<() => void>();

/** In-flight dedupe: one summary fetch / folder run at a time per key. */
const inflight = new Map<string, Promise<void>>();
/** Folder paths currently running (trigger UI shows per-tile skeletons). */
const runningFolders = new Set<string>();
const runningRefs = new Set<string>();

function notify(): void {
  version += 1;
  for (const l of listeners) l();
}

export function subscribeResultsStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getResultsStoreVersion(): number {
  return version;
}

function loadCache(): CacheShape {
  if (cache) return cache;
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    cache = raw ? (JSON.parse(raw) as CacheShape) : {};
    if (!cache || typeof cache !== 'object') cache = {};
  } catch {
    cache = {};
  }
  return cache;
}

function persistCache(): void {
  try {
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache ?? {}));
  } catch {
    /* quota exceeded — degrade silently to in-memory only */
  }
}

function solutionKey(): string {
  return getSelectedSolution() || '__default__';
}

/** Current envelope map for the selected solution (null = nothing loaded yet). */
export function getCachedSummary(): SolutionCacheEntry | null {
  const entry = loadCache()[solutionKey()];
  return entry || null;
}

function storeSummary(summary: ResultsSummary): void {
  const store = loadCache();
  const key = solutionKey();
  const existing = store[key];
  // Fingerprint change ⇒ discard, never merge across catalog generations.
  if (existing && existing.fingerprint !== summary.meta.catalogFingerprint) {
    delete store[key];
  }
  store[key] = {
    fingerprint: summary.meta.catalogFingerprint,
    results: summary.results,
    at: Date.now(),
  };
  persistCache();
  notify();
}

function mergeEnvelopes(fingerprint: string | null, envelopes: ResultEnvelope[]): void {
  const store = loadCache();
  const key = solutionKey();
  const existing = store[key];
  if (!existing || existing.fingerprint !== fingerprint) {
    // Base map missing or from an old catalog — a follow-up summary fetch
    // rebuilds it; merging into a foreign generation would mix truths.
    return;
  }
  for (const envelope of envelopes) {
    existing.results[`${envelope.ref.kind}:${envelope.ref.id}`] = envelope;
  }
  existing.at = Date.now();
  persistCache();
  notify();
}

/**
 * Ensures the summary for the selected solution is loaded (deduped).
 * The server summary is a pure cache read — pending units arrive as
 * `runStatus: "pending"` stubs, so this is always cheap.
 */
export function ensureSummaryLoaded(force = false): Promise<void> {
  const key = `summary:${solutionKey()}`;
  if (!force && getCachedSummary()) return Promise.resolve();
  let p = inflight.get(key);
  if (p) return p;
  p = getResultsSummary()
    .then(summary => {
      // A fingerprint different from the stored one invalidates implicitly —
      // storeSummary drops the old generation.
      storeSummary(summary);
    })
    .catch(() => {
      /* transient — chips simply stay absent; next mount retries */
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export function isFolderRunning(path: string): boolean {
  return runningFolders.has(path);
}

export function isRefRunning(kind: string, id: string): boolean {
  return runningRefs.has(`${kind}:${id}`);
}

/**
 * Triggers a folder subtree run (mode "missing" by default — idempotent
 * against the server cache) and merges the returned envelopes.
 */
export function runFolder(path: string, mode: 'missing' | 'refresh' = 'missing'): Promise<void> {
  const key = `run:folder:${path}:${mode}`;
  let p = inflight.get(key);
  if (p) return p;
  runningFolders.add(path);
  notify();
  p = runResults([{ kind: 'folder', path }], mode)
    .then(res => mergeEnvelopes(res.meta.catalogFingerprint, res.results))
    .catch(() => { /* per-unit failures come back as envelopes; whole-call errors stay silent */ })
    .finally(() => {
      runningFolders.delete(path);
      inflight.delete(key);
      notify();
    });
  inflight.set(key, p);
  return p;
}

/** Triggers a single unit run (always refresh — an explicit user action). */
export function runSingle(target: ResultsRunTarget): Promise<void> {
  if (target.kind === 'folder') return runFolder(target.path, 'refresh');
  const refKey = `${target.kind}:${target.id}`;
  const key = `run:${refKey}`;
  let p = inflight.get(key);
  if (p) return p;
  runningRefs.add(refKey);
  notify();
  p = runResults([target], 'refresh')
    .then(res => mergeEnvelopes(res.meta.catalogFingerprint, res.results))
    .catch(() => { /* silent — see runFolder */ })
    .finally(() => {
      runningRefs.delete(refKey);
      inflight.delete(key);
      notify();
    });
  inflight.set(key, p);
  return p;
}
