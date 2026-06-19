const xmlConvert = require('../services/xml-convert');
const { performReload } = require('../services/system-reload');

/**
 * XML-Convert Controller — REST handlers for /api/xml/*
 *
 * Endpoints (siehe project/prd_frontend_xml_convert.md §5):
 *   GET  /api/xml/status         Verzeichnis-Listing + Status pro Datei
 *   GET  /api/xml/last-run/log   Vollständiger Event-Stream der letzten Konvertierung
 *   POST /api/xml/convert        Startet die Konvertierung, streamt SSE
 *
 * Concurrency: Nur ein Lauf gleichzeitig. Während ein Lauf aktiv ist, antwortet
 * POST mit 409. Geprüft wird sowohl der eigene Service-State als auch das
 * Lock-File (das auch das CLI-Skill setzt).
 */

function ok(res, data, meta = {}) {
  return res.json({ success: true, data, meta });
}

let activeRunController = null;

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
 * POST /api/xml/convert — startet die Konvertierung und streamt NDJSON-Events
 * als SSE an den Client. Identisches Pattern zu POST /api/docs/install/:id.
 *
 * Nach exit_code === 0 wird intern `performReload()` aufgerufen, damit
 * Adapter-Caches und in-process Maps die frische DB sehen.
 */
async function convert(req, res, next) {
  // Concurrency-Schutz: weder ein laufender In-Process-Run noch ein extern
  // gehaltenes Lock-File darf umgangen werden.
  if (activeRunController || xmlConvert.isRunning()) {
    return res.status(409).json({
      success: false,
      error: {
        code: 'ALREADY_RUNNING',
        message: 'A conversion is already running.',
      },
    });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const send = (evt) => {
    try {
      res.write(`data: ${JSON.stringify(evt)}\n\n`);
    } catch {
      /* client closed connection */
    }
  };

  // "Nur geänderte Dateien" (Manifest-Skip) ist Default; ein explizites
  // `changedOnly:false` im Body erzwingt einen vollen (Turbo-)Build aller Dateien.
  // Legacy-Alias `incremental` wird weiterhin akzeptiert. Robust gegen fehlenden
  // oder nicht-Boolean-Body.
  const changedOnly = (req.body?.changedOnly ?? req.body?.incremental) !== false;

  send({ event: 'start', ts: new Date().toISOString(), changedOnly });

  const ac = new AbortController();
  activeRunController = ac;
  let aborted = false;
  res.on('close', () => {
    if (res.writableEnded) return;
    aborted = true;
    ac.abort();
  });

  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { /* socket gone */ }
  }, 15000);

  try {
    const { exit_code } = await xmlConvert.runConverter({
      onEvent: send,
      signal: ac.signal,
      changedOnly,
    });

    if (aborted) {
      send({ event: 'aborted' });
      return;
    }

    if (exit_code === 0) {
      try {
        const result = await performReload();
        send({ event: 'reload', ok: true, tables: result.tables });
      } catch (err) {
        send({ event: 'reload', ok: false, error: err.message });
      }
      // Done-Event sendet das Skript bereits selbst (emit_done). Hier nur ein
      // explizites Wrap-up, falls das Skript-eigene done aus irgendeinem
      // Grund nicht durchkam — der Client erwartet ein finales `done`.
      send({ event: 'done', ok: true, exit_code: 0 });
    } else {
      send({ event: 'done', ok: false, exit_code });
    }
  } catch (err) {
    if (err && err.code === 'SCRIPT_NOT_FOUND') {
      send({ event: 'error', message: err.message });
      send({ event: 'done', ok: false, exit_code: -1 });
    } else {
      send({ event: 'error', message: err.message });
      send({ event: 'done', ok: false, exit_code: -1 });
    }
  } finally {
    clearInterval(heartbeat);
    activeRunController = null;
    try { res.end(); } catch { /* already closed */ }
  }
}

module.exports = {
  getStatus,
  getLastRunLog,
  convert,
};
