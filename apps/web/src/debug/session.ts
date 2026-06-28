import { API_BASE } from '../config/apiBase';

/**
 * Frontend-Debug-Session-Recorder.
 *
 * Bei `?debug=1` in der URL wird eine Session-ID erzeugt (persistiert in
 * sessionStorage, überlebt In-App-Navigation/Reload im selben Tab) und an JEDEN
 * API-Call als Header `X-Debug-Session` gehängt. Lokale Interaktions-Events
 * (Atlas-Zustandswechsel, Query-Start/-Ende/-Fehler) werden gepuffert und
 * gebündelt an `POST /api/debug/session` geschickt — dort landen sie mit
 * derselben Session-ID in EINER Zeitachse neben Backend-Prozessen + DuckDB-
 * Memory-Deltas. So wird die Kette Klick → Query → Memory-Peak → OOM lesbar.
 *
 * Komplett no-op ohne ?debug=1 (kein Header, keine Posts, kein Overhead).
 */

/**
 * Build-Gate (Publishing). Das GESAMTE Recorder-Verhalten hängt an dieser einen
 * build-time-Konstante. Vite ersetzt `import.meta.env.VITE_DEBUG_SESSION` durch
 * ein Literal:
 *  - Public-/Prod-Build (Flag nicht gesetzt — `.env` ist gitignored + vom Publish
 *    ausgeschlossen): `DEBUG_BUILD` ist konstant `false`. esbuild propagiert die
 *    Konstante und eliminiert JEDEN damit gegateten Zweig vollständig aus dem
 *    Bundle — kein Header, kein `fetch`/`sendBeacon`, keine Strings, kein Listener.
 *  - Dev-Build (`VITE_DEBUG_SESSION=1` im lokalen `.env`): `true` → der Recorder ist
 *    vorhanden und wird zur Laufzeit über `?debug=1` scharf geschaltet.
 * Wichtig: Es muss eine direkte `const x = <literal>` sein (nicht das Ergebnis eines
 * Funktionsaufrufs), damit esbuild über die Modulgrenzen hinweg dead-code-eliminiert.
 */
const DEBUG_BUILD = import.meta.env.VITE_DEBUG_SESSION === '1';

const STORAGE_KEY = 'fmlab.debugSession';
const FLUSH_INTERVAL_MS = 1000;
const MAX_BUFFER = 200;

type DebugEvent = {
  kind: string;
  ts: string;       // ISO Wall-Clock
  t_ms: number;     // performance.now() — monoton, für Delta ohne Clock-Skew
  data: Record<string, unknown>;
};

/** URL-Trigger (`?debug=1`) — nur relevant, wenn der Build Debug überhaupt zulässt. */
function readFlag(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('debug') === '1';
  } catch {
    return false;
  }
}

function makeId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return `fe-${crypto.randomUUID()}`;
    }
  } catch {
    /* fällt unten durch */
  }
  return `fe-${Date.now().toString(36)}-${Math.floor(performance.now()).toString(36)}`;
}

// Einmalig beim Modul-Load: aktiv? (nur wenn der Build Debug erlaubt UND ?debug=1).
// `DEBUG_BUILD && …` → im Public-Build foldet esbuild zu `false`, readFlag/makeId
// werden unreferenziert und fallen samt sessionStorage-Pfad aus dem Bundle.
const enabled = DEBUG_BUILD && readFlag();
let sessionId: string | null = null;
if (enabled) {
  try {
    sessionId = sessionStorage.getItem(STORAGE_KEY);
    if (!sessionId) {
      sessionId = makeId();
      sessionStorage.setItem(STORAGE_KEY, sessionId);
    }
  } catch {
    sessionId = makeId(); // sessionStorage nicht verfügbar → in-memory
  }
}

let buffer: DebugEvent[] = [];
let timer: ReturnType<typeof setInterval> | null = null;

export function isDebugSessionActive(): boolean {
  return enabled && sessionId !== null;
}

export function getDebugSessionId(): string | null {
  return isDebugSessionActive() ? sessionId : null;
}

/** Header-Objekt zum Spreaden in jeden fetch — leer, wenn inaktiv / im Public-Build. */
export function debugHeaders(): Record<string, string> {
  if (!DEBUG_BUILD) return {};
  return isDebugSessionActive() ? { 'X-Debug-Session': sessionId as string } : {};
}

function flush(useBeacon = false): void {
  if (!DEBUG_BUILD) return;
  if (!isDebugSessionActive() || buffer.length === 0) return;
  const events = buffer;
  buffer = [];
  const url = `${API_BASE}/api/debug/session`;
  const body = JSON.stringify({ sessionId, events });

  // beforeunload/hidden → sendBeacon (überlebt Navigation); sonst normaler fetch.
  if (useBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
    try {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
      return;
    } catch {
      /* fällt auf fetch zurück */
    }
  }
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: useBeacon,
  }).catch(() => {
    /* Debug-Posts dürfen nie die App stören — Fehler schlucken */
  });
}

/** Ein Interaktions-Event aufzeichnen. No-op ohne aktive Debug-Session / im Public-Build. */
export function recordDebug(kind: string, data: Record<string, unknown> = {}): void {
  if (!DEBUG_BUILD) return;
  if (!isDebugSessionActive()) return;
  buffer.push({ kind, ts: new Date().toISOString(), t_ms: Math.round(performance.now()), data });
  if (buffer.length >= MAX_BUFFER) flush();
  if (timer === null) {
    timer = setInterval(() => flush(), FLUSH_INTERVAL_MS);
  }
}

// Beim Verlassen/Verstecken letzte Events per Beacon rausschicken. Der ganze Block
// hängt an DEBUG_BUILD → im Public-Build entfernt (kein Listener, kein console.info).
if (DEBUG_BUILD && enabled && typeof window !== 'undefined') {
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
  });
  window.addEventListener('pagehide', () => flush(true));
  // eslint-disable-next-line no-console
  console.info(`[debug-session] active — sessionId=${sessionId} → ${API_BASE}/api/debug/session`);
}
