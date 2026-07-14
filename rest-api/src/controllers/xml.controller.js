const xmlConvert = require('../services/xml-convert');
const hub = require('../services/xml-convert-hub');
const solutions = require('../config/solutions');

/**
 * XML-Convert Controller — REST handlers for /api/xml/*
 *
 * Endpoints:
 *   GET  /api/xml/status          Verzeichnis-Listing + Status pro Datei (+ running/active_run)
 *   GET  /api/xml/runs            Alle laufenden Importe (Hub-Registry ∪ Lock-Scan)
 *   GET  /api/xml/last-run/log    Vollständiger Event-Stream der letzten Konvertierung
 *   POST /api/xml/convert         Startet den Job (202); streamt NICHT mehr selbst
 *   GET  /api/xml/convert/stream  SSE: Ring-Replay + Live-Tail des aktiven Laufs
 *   POST /api/xml/convert/cancel  Expliziter Abbruch (einziger Pfad zu child.kill)
 *   POST /api/xml/reveal          xml/-Ordner im nativen Datei-Manager öffnen
 *
 * Solution-Kontext: GENAU diese Endpoints werten einen
 * expliziten Solution-Kontext aus — `?solution=<id>` bzw. Body `{"solution"}`,
 * dahinter der X-Solution-Header, sonst der Server-Default. Alle übrigen
 * API-Endpoints bleiben beim Server-Default (kein vorgezogener Voll-Multiuser).
 *
 * Feature E: Der Lauf ist vom Request entkoppelt (Broadcast-Hub). Wegnavigieren
 * killt den Import NICHT mehr; Wiedereintritt rendert über /convert/stream aus dem
 * Ring statt aus dem Default-State.
 */

function ok(res, data, meta = {}) {
  return res.json({ success: true, data, meta });
}

/**
 * Kontext-Lösung eines XML-Requests auflösen. Expliziter Parameter
 * (query/body) > X-Solution-Header > Server-Default. Ungültige/unbekannte
 * IDs → 404 (Antwort wird hier direkt geschrieben, Rückgabe null).
 */
function resolveSolution(req, res) {
  const explicit = (req.query && req.query.solution)
    || (req.body && req.body.solution)
    || (req.solutionContext && req.solutionContext.requested)
    || null;
  if (!explicit) return req.solutionContext ? req.solutionContext.solution : solutions.getActiveSolutionId();
  const id = String(explicit);
  if (!solutions.isValidId(id) || !solutions.solutionExists(id)) {
    res.status(404).json({
      success: false,
      error: { code: 'SOLUTION_NOT_FOUND', message: `Unknown solution: ${id}` },
    });
    return null;
  }
  return id;
}

async function getStatus(req, res, next) {
  try {
    const solution = resolveSolution(req, res);
    if (solution == null) return undefined;
    const data = await xmlConvert.getStatus(req.solutionContext, solution);
    return ok(res, data);
  } catch (err) {
    return next(err);
  }
}

/** GET /api/xml/runs — alle laufenden Importe (Registry ∪ Lock-Scan). */
async function getRuns(req, res, next) {
  try {
    return ok(res, { runs: hub.listRuns() });
  } catch (err) {
    return next(err);
  }
}

async function getLastRunLog(req, res, next) {
  try {
    const solution = resolveSolution(req, res);
    if (solution == null) return undefined;
    const data = await xmlConvert.readLastRunLog(solution);
    if (!data) {
      return res.json({
        success: true,
        data: { run_id: null, events: [] },
      });
    }
    return ok(res, data);
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/xml/convert — startet den Job für die Kontext-Lösung und kehrt
 * SOFORT mit 202 zurück. Der Lauf lebt im Hub weiter, unabhängig von dieser
 * Anfrage; Fortschritt/Log holt der Client über `GET /api/xml/convert/stream`.
 * 409, wenn für DIESE Lösung bereits ein Lauf aktiv ist (Hub-State ODER
 * externes Lock-File des CLI-Skripts); 429 am globalen Concurrency-Deckel.
 */
async function convert(req, res) {
  // "Nur geänderte Dateien" (Manifest-Skip) ist Default; `changedOnly:false`
  // erzwingt einen vollen Build. Legacy-Alias `incremental`.
  const changedOnly = (req.body?.changedOnly ?? req.body?.incremental) !== false;
  const solution = resolveSolution(req, res);
  if (solution == null) return undefined;
  try {
    const { run_id } = hub.startRun({ changedOnly, solution });
    return res.status(202).json({ success: true, data: { run_id, running: true, changedOnly, solution } });
  } catch (err) {
    if (err && err.code === 'ALREADY_RUNNING') {
      return res.status(409).json({
        success: false,
        error: { code: 'ALREADY_RUNNING', message: err.message },
      });
    }
    if (err && err.code === 'MAX_CONVERTS') {
      return res.status(429).json({
        success: false,
        error: { code: 'MAX_CONVERTS', message: err.message, running: err.running || [] },
      });
    }
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL', message: err.message },
    });
  }
}

/**
 * GET /api/xml/convert/stream — SSE-Abonnement des aktiven Laufs der
 * Kontext-Lösung (`?solution=<id>`, sonst Server-Default). Subscribe → erst
 * Ring replayen (Client springt auf den aktuellen Stand inkl. Phase/Progress),
 * dann Live-Tail. Kein aktiver Lauf → letztes Snapshot / `idle` + schließen.
 * Mehrere gleichzeitige Subscriber (Tabs/Views) erlaubt.
 */
async function streamConvert(req, res) {
  const solution = resolveSolution(req, res);
  if (solution == null) return;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const live = hub.subscribe(res, solution);
  if (!live) {
    try { res.end(); } catch { /* already closed */ }
    return;
  }

  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { /* socket gone */ }
  }, 15000);

  // Wegnavigieren beendet NUR das Forwarding zu DIESEM Socket — der Lauf läuft im
  // Hub weiter (kein ac.abort/child.kill mehr).
  res.on('close', () => {
    clearInterval(heartbeat);
    hub.unsubscribe(res, solution);
  });
}

/**
 * POST /api/xml/convert/cancel — expliziter Abbruch des aktiven Laufs der
 * Kontext-Lösung (der EINZIGE Pfad, der child.kill auslöst). 409, wenn für
 * diese Lösung nichts läuft.
 */
async function cancelConvert(req, res) {
  const solution = resolveSolution(req, res);
  if (solution == null) return undefined;
  const cancelled = hub.cancel(solution);
  if (!cancelled) {
    return res.status(409).json({
      success: false,
      error: { code: 'NOT_RUNNING', message: 'No active conversion to cancel.' },
    });
  }
  return ok(res, { cancelled: true, solution });
}

/**
 * POST /api/xml/reveal — öffnet das xml/-Verzeichnis der Kontext-Lösung im
 * nativen Datei-Manager (macOS: open, Linux: xdg-open). Nur im nativen Lauf
 * möglich; im Container (kein Host-Finder erreichbar) liefert der Service
 * `REVEAL_UNSUPPORTED` → 409, worauf das Frontend stattdessen den Host-Pfad
 * zum Kopieren anzeigt.
 */
async function reveal(req, res, next) {
  try {
    const solution = resolveSolution(req, res);
    if (solution == null) return undefined;
    const opened = await xmlConvert.revealXmlDir(solution);
    return ok(res, { opened });
  } catch (err) {
    if (err && err.code === 'REVEAL_UNSUPPORTED') {
      return res.status(409).json({
        success: false,
        error: { code: 'REVEAL_UNSUPPORTED', message: err.message },
      });
    }
    return next(err);
  }
}

module.exports = {
  getStatus,
  getRuns,
  getLastRunLog,
  convert,
  streamConvert,
  cancelConvert,
  reveal,
};
