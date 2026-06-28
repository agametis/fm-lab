const debugSession = require('../services/debug-session.service');

/**
 * Debug-Session-Middleware.
 *
 * Hängt `req.debug = { sessionId, reqId, active, startMs }` an jeden Request und
 * loggt Start + Abschluss (Status, Dauer) in die korrelierte Zeitachse — aber nur,
 * wenn der Request aktiv geloggt wird (master ODER Session-ID, siehe Service).
 *
 * Session-ID-Quelle (in dieser Reihenfolge):
 *   1. Header  X-Debug-Session   (Frontend ?debug=1 setzt diesen an alle /api-Calls)
 *   2. Query   ?debug_session=…  (Fallback für manuelle curl-Repros)
 *
 * reqId korreliert mehrere Log-Zeilen DESSELBEN Requests (request → overview →
 * mem → request-Ende). Monoton hochzählend reicht — ein Prozess, eine Verbindung.
 */

let reqCounter = 0;

function debugSessionMiddleware(req, res, next) {
  const sessionId =
    req.get('x-debug-session') ||
    (typeof req.query.debug_session === 'string' ? req.query.debug_session : null) ||
    null;

  const active = debugSession.isActive(sessionId);
  reqCounter += 1;
  const reqId = `r${reqCounter}`;
  const startMs = debugSession.nowMs();

  req.debug = { sessionId, reqId, active, startMs };

  if (active) {
    debugSession.write({
      sessionId,
      reqId,
      kind: 'request',
      phase: 'start',
      method: req.method,
      path: req.path,
      query: req.query,
    });

    res.on('finish', () => {
      debugSession.write({
        sessionId,
        reqId,
        kind: 'request',
        phase: 'finish',
        method: req.method,
        path: req.path,
        status: res.statusCode,
        dur_ms: debugSession.nowMs() - startMs,
      });
    });
  }

  next();
}

module.exports = debugSessionMiddleware;
