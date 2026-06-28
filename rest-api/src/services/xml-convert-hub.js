const xmlConvert = require('./xml-convert');
const { performReload } = require('./system-reload');

/**
 * XML-Convert Broadcast-Hub.
 *
 * Entkoppelt den Konvertierungs-Lauf von der startenden HTTP-Anfrage: `POST
 * /api/xml/convert` startet den Job (202) und kehrt SOFORT zurück; der Lauf lebt
 * im Hub weiter, auch wenn der Client wegnavigiert (kein SIGTERM mehr durch
 * `res.on('close')`). Mehrere Clients abonnieren denselben Lauf über `GET
 * /api/xml/convert/stream` (Ring-Replay → Live-Tail), sodass ein Wiedereintritt
 * sofort den aktuellen Stand sieht statt des Default-States. Abbrechen geht nur
 * noch explizit über `cancel()` (POST /api/xml/convert/cancel).
 *
 * Der Hub besitzt den vollen Lebenszyklus: Lauf → (exit 0) performReload → finales
 * `done`. Persistenz bleibt in runConverter (transiente import_progress-/chunk_*-
 * Events landen im Live-`ring`, werden aber NICHT in last_xml_run.json persistiert).
 */

const RING_CAP = 2000;

let activeRun = null;     // { run_id, started_at, changed_only, ring, subscribers, controller, … }
let lastSnapshot = null;  // letzte Terminal-Events (für Subscriber ohne aktiven Lauf)

function isActive() {
  return activeRun != null;
}

/** Flaches { run_id, started_at, phase, pct, processed, total } für getStatus(). */
function getActiveRunMeta() {
  if (!activeRun) return null;
  const p = activeRun.lastProgress || {};
  return {
    run_id: activeRun.run_id,
    started_at: activeRun.started_at,
    phase: typeof p.phase === 'string' ? p.phase : null,
    pct: typeof p.pct === 'number' ? p.pct : null,
    processed: activeRun.processed,
    total: activeRun.total,
  };
}

function safeWrite(res, evt) {
  try { res.write(`data: ${JSON.stringify(evt)}\n\n`); } catch { /* dead socket */ }
}

function broadcast(evt) {
  if (!activeRun) return;
  // (i) Ring (inkl. transienter Events — für feinen Catch-up), gekappt.
  activeRun.ring.push(evt);
  if (activeRun.ring.length > RING_CAP) {
    activeRun.ring.splice(0, activeRun.ring.length - RING_CAP);
  }
  // Flaches phase/pct + Zähler aus den bekannten Events ableiten (active_run).
  if (evt.event === 'progress') activeRun.lastProgress = evt;
  if (evt.event === 'file_start' && typeof evt.total === 'number') activeRun.total = evt.total;
  if (evt.event === 'file') {
    if (typeof evt.total === 'number') activeRun.total = evt.total;
    if (typeof evt.index === 'number' && evt.ok !== false) {
      activeRun.processed = Math.max(activeRun.processed, evt.index);
    }
  }
  if (evt.event === 'import_progress') {
    if (typeof evt.processed === 'number') activeRun.processed = evt.processed;
    if (typeof evt.total === 'number') activeRun.total = evt.total;
  }
  // (ii) Fan-out an alle Subscriber.
  for (const res of activeRun.subscribers) safeWrite(res, evt);
}

function finishRun() {
  if (!activeRun) return;
  // Snapshot der letzten Events für Subscriber, die NACH dem Lauf eintreffen.
  lastSnapshot = activeRun.ring.slice(-80);
  // Live-Subscriber sauber schließen (das `done` haben sie bereits erhalten).
  for (const res of activeRun.subscribers) {
    try { res.end(); } catch { /* already closed */ }
  }
  activeRun = null;
}

/**
 * Startet einen Lauf, entkoppelt von der Anfrage. Wirft `ALREADY_RUNNING`, wenn
 * bereits ein Lauf (Hub oder externes Lock) aktiv ist. Gibt `{ run_id }` zurück.
 */
function startRun({ changedOnly = true } = {}) {
  if (activeRun || xmlConvert.isRunning()) {
    const err = new Error('A conversion is already running.');
    err.code = 'ALREADY_RUNNING';
    throw err;
  }

  const controller = new AbortController();
  const started_at = new Date().toISOString();
  activeRun = {
    run_id: started_at,
    started_at,
    changed_only: changedOnly,
    ring: [],
    subscribers: new Set(),
    controller,
    lastProgress: null,
    processed: 0,
    total: 0,
  };

  // Lebenszyklus im Hub — NICHT an die startende Anfrage gebunden.
  (async () => {
    try {
      broadcast({ event: 'start', ts: started_at, changedOnly });
      const { exit_code } = await xmlConvert.runConverter({
        onEvent: broadcast,
        signal: controller.signal,
        changedOnly,
      });

      if (controller.signal.aborted) {
        broadcast({ event: 'aborted' });
      } else if (exit_code === 0) {
        // Im --quiet-Modus triggert das Skript den Reload NICHT selbst (überlässt
        // ihn dem API-Caller) → hier performReload (R3-Restore + User-Remap).
        try {
          const result = await performReload();
          broadcast({ event: 'reload', ok: true, tables: result.tables });
        } catch (err) {
          broadcast({ event: 'reload', ok: false, error: err.message });
        }
        broadcast({ event: 'done', ok: true, exit_code: 0 });
      } else {
        broadcast({ event: 'done', ok: false, exit_code });
      }
    } catch (err) {
      broadcast({ event: 'error', message: err.message });
      broadcast({ event: 'done', ok: false, exit_code: -1 });
    } finally {
      finishRun();
    }
  })();

  return { run_id: started_at };
}

/**
 * Subscribe eines SSE-Response. Aktiver Lauf → Ring replayen (Catch-up auf den
 * aktuellen Stand) + zum Live-Tail registrieren (true). Kein aktiver Lauf →
 * letztes Terminal-Snapshot bzw. `idle` senden (false → Controller schließt).
 */
function subscribe(res) {
  if (!activeRun) {
    if (lastSnapshot && lastSnapshot.length > 0) {
      for (const evt of lastSnapshot) safeWrite(res, evt);
    } else {
      safeWrite(res, { event: 'idle' });
    }
    return false;
  }
  for (const evt of activeRun.ring) safeWrite(res, evt);
  activeRun.subscribers.add(res);
  return true;
}

function unsubscribe(res) {
  if (activeRun) activeRun.subscribers.delete(res);
}

/** Expliziter Abbruch (der EINZIGE Pfad zu child.kill). True, wenn ein Lauf lief. */
function cancel() {
  if (!activeRun) return false;
  activeRun.controller.abort();
  return true;
}

module.exports = {
  isActive,
  getActiveRunMeta,
  startRun,
  subscribe,
  unsubscribe,
  cancel,
};
