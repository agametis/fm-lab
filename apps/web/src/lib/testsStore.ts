import type { TestRunResult } from '../api/testsApi';

/**
 * Client-side state for the Tests tab.
 *
 * Two deliberately separate layers:
 *
 * 1. SETTINGS (localStorage, per solution) — the user's persistent working
 *    view: disabled tests, chosen profile per test, active platform targets.
 *    Display-only: API responses and the fm-test skill are never affected.
 *
 * 2. RESULT CACHE (sessionStorage + in-memory) — run results keyed by
 *    (solution, objectUuid, fileName, testId, profileId, catalogFingerprint).
 *    The fingerprint is mtime+size of the solution's read copy; a new XML
 *    import replaces the copy atomically, so stale entries simply never match
 *    again and are pruned. Entries with a foreign fingerprint are DROPPED,
 *    not shown as "outdated" — results against an old catalog are potentially
 *    wrong, not weaker.
 *
 * A tiny external-store subscription lets DetailView render the tab badge
 * without mounting the panel (useSyncExternalStore).
 */

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface TestsSettings {
  /** Test ids hidden from the tab (still visible via the section footer). */
  disabledTests: string[];
  /** Chosen shipped-profile id per test id; absent = all members. */
  profileByTest: Record<string, string>;
  /** Active platform-test ids (consolidated platform section). */
  platforms: string[];
}

const SETTINGS_PREFIX = 'fmlab.tests.settings.';
const SECTIONS_PREFIX = 'fmlab.tests.sections.';

function emptySettings(): TestsSettings {
  return { disabledTests: [], profileByTest: {}, platforms: [] };
}

export function loadTestsSettings(solutionId: string | null): TestsSettings {
  if (!solutionId) return emptySettings();
  try {
    const raw = window.localStorage.getItem(`${SETTINGS_PREFIX}${solutionId}`);
    if (!raw) return emptySettings();
    const parsed = JSON.parse(raw) as Partial<TestsSettings>;
    return {
      disabledTests: Array.isArray(parsed.disabledTests) ? parsed.disabledTests.filter(v => typeof v === 'string') : [],
      profileByTest: parsed.profileByTest && typeof parsed.profileByTest === 'object' ? parsed.profileByTest : {},
      platforms: Array.isArray(parsed.platforms) ? parsed.platforms.filter(v => typeof v === 'string') : [],
    };
  } catch {
    return emptySettings();
  }
}

export function saveTestsSettings(solutionId: string | null, settings: TestsSettings): void {
  if (!solutionId) return;
  try {
    window.localStorage.setItem(`${SETTINGS_PREFIX}${solutionId}`, JSON.stringify(settings));
  } catch {
    /* quota/private mode — settings degrade to session-only React state */
  }
}

/** Collapsed/expanded section state, per solution + object type. */
export function loadSectionState(solutionId: string | null, objectType: string): Record<string, boolean> {
  if (!solutionId) return {};
  try {
    const raw = window.localStorage.getItem(`${SECTIONS_PREFIX}${solutionId}.${objectType}`);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export function saveSectionState(solutionId: string | null, objectType: string, state: Record<string, boolean>): void {
  if (!solutionId) return;
  try {
    window.localStorage.setItem(`${SECTIONS_PREFIX}${solutionId}.${objectType}`, JSON.stringify(state));
  } catch {
    /* non-fatal */
  }
}

// ---------------------------------------------------------------------------
// Result cache
// ---------------------------------------------------------------------------

export interface CachedRun {
  result: TestRunResult;
  /** Run completion time (epoch ms) for the "results from …" line. */
  at: number;
}

interface CacheEntry extends CachedRun {
  solution: string;
  objectUuid: string;
  fileName: string;
  testId: string;
  profileId: string;
  fingerprint: string;
}

const CACHE_KEY = 'fmlab.tests.cache.v1';
const MAX_ENTRIES = 120;

let entries: CacheEntry[] | null = null;
let version = 0;
const listeners = new Set<() => void>();

function notify(): void {
  version += 1;
  for (const l of listeners) l();
}

export function subscribeTestsStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getTestsStoreVersion(): number {
  return version;
}

function loadEntries(): CacheEntry[] {
  if (entries) return entries;
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    entries = raw ? (JSON.parse(raw) as CacheEntry[]) : [];
    if (!Array.isArray(entries)) entries = [];
  } catch {
    entries = [];
  }
  return entries;
}

function persistEntries(): void {
  try {
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(entries ?? []));
  } catch {
    /* quota exceeded — degrade silently to in-memory only */
  }
}

function sameTarget(e: CacheEntry, solution: string, objectUuid: string, fileName: string): boolean {
  return e.solution === solution && e.objectUuid === objectUuid && e.fileName === fileName;
}

/**
 * All cached runs for one object under the CURRENT fingerprint, keyed by
 * `${testId}|${profileId}`. Entries of the same solution with a different
 * fingerprint are pruned on the way (the catalog changed underneath them).
 */
export function getCachedRuns(
  solution: string,
  objectUuid: string,
  fileName: string,
  fingerprint: string,
): Record<string, CachedRun> {
  // Prune silently — this runs during render (useMemo), so no notify() here;
  // the next putCachedRun broadcasts anyway and the badge reads live entries.
  const list = loadEntries();
  const before = list.length;
  entries = list.filter(e => e.solution !== solution || e.fingerprint === fingerprint);
  if (entries.length !== before) persistEntries();
  const out: Record<string, CachedRun> = {};
  for (const e of entries) {
    if (sameTarget(e, solution, objectUuid, fileName) && e.fingerprint === fingerprint) {
      out[`${e.testId}|${e.profileId}`] = { result: e.result, at: e.at };
    }
  }
  return out;
}

export function putCachedRun(
  solution: string,
  objectUuid: string,
  fileName: string,
  testId: string,
  profileId: string,
  fingerprint: string,
  result: TestRunResult,
): void {
  const list = loadEntries();
  entries = list.filter(e => !(sameTarget(e, solution, objectUuid, fileName) && e.testId === testId && e.profileId === profileId));
  entries.push({ solution, objectUuid, fileName, testId, profileId, fingerprint, result, at: Date.now() });
  if (entries.length > MAX_ENTRIES) {
    entries.sort((a, b) => a.at - b.at);
    entries = entries.slice(entries.length - MAX_ENTRIES);
  }
  persistEntries();
  notify();
}

/**
 * Worst cached result state for an object — feeds the tab badge in
 * DetailView. Fingerprint-agnostic by design: stale entries are pruned the
 * moment the panel loads with a fresh fingerprint.
 */
/**
 * OS binding of an object from cached platform-os-binding runs: the union of
 * the per-OS boolean flags of every OS-SPECIFIC finding naming this object
 * (a binding counts only when confined to at most TWO operating systems —
 * broad "everything except X" restrictions never feed the badge), across all
 * cached scopes (an object- or solution-scope run feeds the same badge).
 * Returns a stable comma-joined key ('macos,windows') so
 * useSyncExternalStore snapshots stay referentially comparable; null when no
 * cached run names the object. Cache-driven like the tab badge: the chip
 * appears once the OS-binding test ran at least once.
 */
const OS_BINDING_KEYS = ['macos', 'windows', 'linux', 'ios'] as const;
export function getObjectOsBinding(objectUuid: string): string | null {
  const list = loadEntries();
  const bound = new Set<string>();
  for (const e of list) {
    if (e.testId !== 'platform-os-binding') continue;
    for (const m of e.result.results || []) {
      for (const f of m.findings?.rows || []) {
        if (f.nav_uuid == null || String(f.nav_uuid) !== objectUuid) continue;
        const supported = OS_BINDING_KEYS.filter(
          k => (f as Record<string, unknown>)[k] === true,
        );
        if (supported.length > 2) continue; // not OS-specific
        for (const k of supported) bound.add(k);
      }
    }
  }
  if (bound.size === 0) return null;
  return OS_BINDING_KEYS.filter(k => bound.has(k)).join(',');
}

export function getObjectBadge(objectUuid: string): 'error' | 'warning' | null {
  const list = loadEntries();
  let worst: 'error' | 'warning' | null = null;
  for (const e of list) {
    if (e.objectUuid !== objectUuid) continue;
    const s = e.result.summary;
    if (!s) continue;
    if (s.error > 0) return 'error';
    if (s.warning > 0) worst = 'warning';
  }
  return worst;
}
