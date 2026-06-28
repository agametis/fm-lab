const fs = require('fs');
const path = require('path');
const environment = require('../config/environment');

/**
 * Debug-Session-Service — eine korrelierte Zeitachse aus Frontend-Interaktion,
 * Backend-Prozessen und DuckDB-Memory-Deltas in EINEM JSONL.
 *
 * Motivation: der Graph-Atlas OOMt sporadisch ("could not allocate … 1.8 GiB/
 * 1.8 GiB used"), obwohl eine EINZELNE Overview-Query nur ~0.6–1 GB Peak hat.
 * Die Ursache ist Nebenläufigkeit/Buffer-Retention über die lange READ_ONLY-
 * Verbindung — also gerade NICHT in einer Query isoliert sichtbar. Dieses Log
 * verschränkt Klick → Query → Memory-Delta → Fehler, sodass der auslösende
 * Request-Mix rekonstruierbar wird.
 *
 * Zwei Schalter (kombiniert, siehe environment.debugSession):
 *   - master  (DEBUG_SESSION=1): loggt JEDEN Request.
 *   - focused (?debug=1 → Header X-Debug-Session): loggt die markierte Session,
 *     auch ohne master.
 * Ein Request wird geloggt, wenn `master` ODER eine Session-ID anliegt.
 *
 * Format: append-only JSONL, eine Zeile = ein Event:
 *   { ts, t_ms, source, kind, sessionId?, reqId?, ... }
 *     ts     — ISO-Timestamp (Wall-Clock)
 *     t_ms   — monotone ms seit Prozessstart (für Delta-Rechnung ohne Clock-Skew)
 *     source — 'backend' | 'frontend'
 *     kind   — Event-Typ (z.B. 'request', 'overview', 'mem', 'fe')
 */

const cfg = environment.debugSession;
const logFilePath = path.resolve(__dirname, '../../', cfg.file);

let stream = null;
let streamReady = false;

function ensureStream() {
  if (streamReady) return stream;
  streamReady = true;
  try {
    fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
    stream = fs.createWriteStream(logFilePath, { flags: 'a' });
  } catch (err) {
    // Logging darf den Server nie kippen — bei FS-Fehler still deaktivieren.
    // eslint-disable-next-line no-console
    console.warn(`[debug-session] disabled (cannot open ${logFilePath}): ${err.message}`);
    stream = null;
  }
  return stream;
}

/** Monotone ms seit Prozessstart — robust gegen Wall-Clock-Sprünge. */
function nowMs() {
  const [s, ns] = process.hrtime();
  return Math.round(s * 1000 + ns / 1e6);
}

/**
 * Soll für diese Session-ID geloggt werden?
 * master → immer; sonst nur wenn eine (focused) Session-ID anliegt.
 */
function isActive(sessionId) {
  return cfg.master || Boolean(sessionId);
}

/**
 * Eine Event-Zeile schreiben. No-op, wenn inaktiv oder Stream nicht verfügbar.
 * Niemals werfen — Logging ist Beifang, kein kritischer Pfad.
 */
function write(event) {
  if (!isActive(event && event.sessionId)) return;
  const s = ensureStream();
  if (!s) return;
  try {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      t_ms: nowMs(),
      source: 'backend',
      ...event,
    });
    s.write(line + '\n');
  } catch {
    /* zirkuläre Payload o.ä. — Zeile verwerfen, Server läuft weiter */
  }
}

/**
 * Frontend-Events (gebündelt via POST /api/debug/session) in dieselbe Zeitachse
 * schreiben. Jedes Event behält seinen Frontend-Timestamp (fe_ts) und bekommt
 * den Backend-Empfangs-Timestamp obendrauf (für Laufzeit-Abschätzung).
 */
function writeFrontendBatch(sessionId, events) {
  if (!isActive(sessionId)) return 0;
  const s = ensureStream();
  if (!s) return 0;
  let n = 0;
  for (const ev of events || []) {
    try {
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        t_ms: nowMs(),
        source: 'frontend',
        sessionId,
        kind: ev.kind || 'fe',
        fe_ts: ev.ts ?? null,
        fe_t_ms: ev.t_ms ?? null,
        ...ev.data,
      });
      s.write(line + '\n');
      n += 1;
    } catch {
      /* einzelnes Event verwerfen */
    }
  }
  return n;
}

module.exports = {
  isActive,
  write,
  writeFrontendBatch,
  nowMs,
  logFilePath,
  config: cfg,
};
