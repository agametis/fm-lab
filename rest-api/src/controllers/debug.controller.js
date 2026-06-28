const debugSession = require('../services/debug-session.service');

/**
 * Debug-Controller — Ingestion der Frontend-Interaktions-Events in die
 * korrelierte Backend-Zeitachse (POST /api/debug/session).
 *
 * Der Frontend-Recorder (apps/web/src/debug/session.ts) puffert Events bei
 * ?debug=1 und schickt sie gebündelt hierher. Sie landen mit derselben
 * Session-ID neben den Backend-Prozess-/Memory-Events in EINEM JSONL.
 */

/** POST /api/debug/session — { sessionId, events: [{ kind, ts, t_ms, data }] } */
function ingest(req, res) {
  const { sessionId, events } = req.body || {};

  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ success: false, error: { message: 'sessionId (string) required' } });
  }
  if (!Array.isArray(events)) {
    return res.status(400).json({ success: false, error: { message: 'events (array) required' } });
  }
  // Defensiver Deckel: ein verirrter Recorder soll das Log nicht fluten.
  const capped = events.slice(0, 500);
  const written = debugSession.writeFrontendBatch(sessionId, capped);

  return res.json({ success: true, data: { written, active: debugSession.isActive(sessionId) } });
}

/** GET /api/debug/session/status — ist Logging aktiv, wohin schreibt es? */
function status(req, res) {
  return res.json({
    success: true,
    data: {
      master: debugSession.config.master,
      file: debugSession.logFilePath,
      probeMemory: debugSession.config.probeMemory,
    },
  });
}

module.exports = { ingest, status };
