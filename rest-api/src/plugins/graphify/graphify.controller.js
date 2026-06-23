const service = require('./graphify.service');
const { buildSuccess } = require('../../utils/response-builder');

/**
 * graphify controller — handlers for /api/graphify/*
 *
 *   GET  /api/graphify/status   Last export + list of exported files (public)
 *   POST /api/graphify/export   Runs the export, streams progress as SSE
 *
 * Concurrency: a single run at a time. While one is active, POST answers 409.
 * SSE shape is identical to /api/xml/convert so the frontend reuse is trivial.
 */

let activeRun = null;

async function status(req, res, next) {
  try {
    const data = await service.getStatus();
    res.json(buildSuccess(data));
  } catch (err) {
    next(err);
  }
}

async function exportGraph(req, res, next) {
  if (activeRun || service.isRunning()) {
    return res.status(409).json({
      success: false,
      error: { code: 'ALREADY_RUNNING', message: 'A graph export is already running.' },
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

  send({ event: 'start', ts: new Date().toISOString() });

  const ac = new AbortController();
  activeRun = ac;
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
    const { exit_code } = await service.runExport({ onEvent: send, signal: ac.signal });

    if (aborted) {
      send({ event: 'aborted' });
      return;
    }
    // The kernel already emits its own `done`; this is a defensive wrap-up so the
    // client always sees a terminal event even if the kernel's done was lost.
    if (exit_code === 0) {
      send({ event: 'done', ok: true, exit_code: 0 });
    } else {
      send({ event: 'done', ok: false, exit_code });
    }
  } catch (err) {
    send({ event: 'error', message: err.message });
    send({ event: 'done', ok: false, exit_code: -1 });
  } finally {
    clearInterval(heartbeat);
    activeRun = null;
    try { res.end(); } catch { /* already closed */ }
  }
}

module.exports = { status, exportGraph };
