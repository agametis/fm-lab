const xmlConvert = require('../services/xml-convert');
const hub = require('../services/xml-convert-hub');

/**
 * XML-Convert Controller — REST handlers for /api/xml/*
 *
 * Endpoints:
 *   GET  /api/xml/status          Verzeichnis-Listing + Status pro Datei (+ running/active_run)
 *   GET  /api/xml/last-run/log    Vollständiger Event-Stream der letzten Konvertierung
 *   POST /api/xml/convert         Startet den Job (202); streamt NICHT mehr selbst
 *   GET  /api/xml/convert/stream  SSE: Ring-Replay + Live-Tail des aktiven Laufs
 *   POST /api/xml/convert/cancel  Expliziter Abbruch (einziger Pfad zu child.kill)
 *
 * Feature E: Der Lauf ist vom Request entkoppelt (Broadcast-Hub). Wegnavigieren
 * killt den Import NICHT mehr; Wiedereintritt rendert über /convert/stream aus dem
 * Ring statt aus dem Default-State.
 */

function ok(res, data, meta = {}) {
  return res.json({ success: true, data, meta });
}

async function getStatus(req, res, next) {
  try {
    const data = await xmlConvert.getStatus();
    return ok(res, data);
  } catch (err) {
    return next(err);
  }
}

async function getLastRunLog(req, res, next) {
  try {
    const data = await xmlConvert.readLastRunLog();
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
 * POST /api/xml/convert — startet den Job und kehrt SOFORT mit 202 zurück
 * Der Lauf lebt im Hub weiter, unabhängig von dieser Anfrage;
 * Fortschritt/Log holt der Client über `GET /api/xml/convert/stream`. 409, wenn
 * bereits ein Lauf aktiv ist (Hub-State ODER externes Lock-File des CLI-Skripts).
 */
async function convert(req, res) {
  // "Nur geänderte Dateien" (Manifest-Skip) ist Default; `changedOnly:false`
  // erzwingt einen vollen Build. Legacy-Alias `incremental`.
  const changedOnly = (req.body?.changedOnly ?? req.body?.incremental) !== false;
  try {
    const { run_id } = hub.startRun({ changedOnly });
    return res.status(202).json({ success: true, data: { run_id, running: true, changedOnly } });
  } catch (err) {
    if (err && err.code === 'ALREADY_RUNNING') {
      return res.status(409).json({
        success: false,
        error: { code: 'ALREADY_RUNNING', message: err.message },
      });
    }
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL', message: err.message },
    });
  }
}

/**
 * GET /api/xml/convert/stream — SSE-Abonnement des aktiven Laufs. Subscribe → erst
 * Ring replayen (Client springt auf den aktuellen Stand
 * inkl. Phase/Progress), dann Live-Tail. Kein aktiver Lauf → letztes Snapshot /
 * `idle` + schließen. Mehrere gleichzeitige Subscriber (Tabs/Views) erlaubt.
 */
async function streamConvert(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const live = hub.subscribe(res);
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
    hub.unsubscribe(res);
  });
}

/**
 * POST /api/xml/convert/cancel — expliziter Abbruch des aktiven Laufs (der
 * EINZIGE Pfad, der child.kill auslöst). 409, wenn nichts läuft.
 */
async function cancelConvert(req, res) {
  const cancelled = hub.cancel();
  if (!cancelled) {
    return res.status(409).json({
      success: false,
      error: { code: 'NOT_RUNNING', message: 'No active conversion to cancel.' },
    });
  }
  return ok(res, { cancelled: true });
}

/**
 * POST /api/xml/reveal — öffnet das xml/-Verzeichnis im nativen Datei-Manager
 * (macOS: open, Linux: xdg-open). Nur im nativen Lauf möglich; im Container
 * (kein Host-Finder erreichbar) liefert der Service `REVEAL_UNSUPPORTED` → 409,
 * worauf das Frontend stattdessen den Host-Pfad zum Kopieren anzeigt.
 */
async function reveal(req, res, next) {
  try {
    const opened = await xmlConvert.revealXmlDir();
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
  getLastRunLog,
  convert,
  streamConvert,
  cancelConvert,
  reveal,
};
