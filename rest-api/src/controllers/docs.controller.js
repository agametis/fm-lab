const fs = require('fs');
const path = require('path');
const docsManifest = require('../services/docs-manifest');
const docsSource = require('../services/docs-source');
const docsInstall = require('../services/docs-install');
const { performReload } = require('../services/system-reload');
const settingsStore = require('../plugins/settings-store');

/**
 * Docs Controller — REST handlers for /api/docs/*
 *
 * Endpoints:
 *   GET  /api/docs                                  Übersicht (catalog + installed)
 *   GET  /api/docs/:id/status                       Detailstatus + Index-Health
 *   GET  /api/docs/:id/categories?lang=             Kategorien (mit Code-Ref-Counter)
 *   GET  /api/docs/:id/categories/:cat?lang=        Funktionen einer Kategorie
 *   GET  /api/docs/:id/categories/:cat/:fn?lang=    Volltext-Eintrag einer Funktion
 *   GET  /api/docs/:id/search?q=                    Per-Set-Suche
 *   GET  /api/docs/:id/search?q=&group=category     Treffer je Rubrik (Aggregation)
 *
 * Counter-Pills (Code-Referenzen) sind in den Aggregations-Datasets implementiert
 * (siehe dashboard.service.js Builtins `docset_categories_with_counts` /
 * `docset_functions_with_counts`).
 */

function ok(res, data, meta = {}) {
  return res.json({ success: true, data, meta });
}

function notFound(res, message) {
  return res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message },
  });
}

function validationError(res, message) {
  return res.status(400).json({
    success: false,
    error: { code: 'VALIDATION_ERROR', message },
  });
}

function publicCatalogShape(cat) {
  return {
    id: cat.id,
    name: cat.name,
    description: cat.description,
    source_url: cat.source_url,
    skill: cat.skill,
    languages: cat.languages || [],
    visible: cat.visible,
    references: cat.references,
    output_format: cat.output_format,
    download_format: cat.download_format,
    index_page: cat.index_page,
    start_page: cat.start_page ?? null,
    index: cat.index,
  };
}

function publicInstalledShape(inst) {
  return {
    id: inst.id,
    directory: inst.directory,
    version: inst.version,
    installed_at: inst.installed_at,
    languages: inst.languages || [],
    stats: inst.stats || {},
  };
}

/**
 * GET /api/docs — komplette Übersicht (catalog + installed).
 */
async function listDocs(req, res, next) {
  try {
    const manifest = await docsManifest.readManifest();
    return ok(res, {
      $schema_version: manifest.$schema_version,
      catalog: manifest.catalog.map(publicCatalogShape),
      installed: manifest.installed.map(publicInstalledShape),
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/docs/:id/status — Detailstatus mit Index-Validierung.
 */
async function getStatus(req, res, next) {
  try {
    const { id } = req.params;
    const catalog = docsManifest.getCatalogEntry(id);
    if (!catalog) return notFound(res, `Unknown doc-set: ${id}`);
    const installed = docsManifest.getInstalledEntry(id);
    const index = installed ? await docsSource.validateDocset(req.solutionContext, id) : { ok: false, errors: ['Not installed.'] };
    return ok(res, {
      id,
      catalog: publicCatalogShape(catalog),
      installed: installed ? publicInstalledShape(installed) : null,
      is_installed: !!installed,
      index,
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/docs/:id/categories?lang=
 */
async function listCategories(req, res, next) {
  try {
    const { id } = req.params;
    const lang = req.query.lang || 'en';
    const catalog = docsManifest.getCatalogEntry(id);
    if (!catalog) return notFound(res, `Unknown doc-set: ${id}`);
    const data = await docsSource.listDocsetCategories(req.solutionContext, id, lang);
    return ok(res, data, { id, lang, references: catalog.references });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/docs/:id/categories/:cat?lang= — Funktionen einer Kategorie + Header-Info.
 */
async function getCategory(req, res, next) {
  try {
    const { id, cat } = req.params;
    const lang = req.query.lang || 'en';
    const catalog = docsManifest.getCatalogEntry(id);
    if (!catalog) return notFound(res, `Unknown doc-set: ${id}`);
    const info = await docsSource.getDocsetCategoryInfo(req.solutionContext, id, cat, lang);
    if (!info) return notFound(res, `Category '${cat}' not found in '${id}'`);
    const functions = await docsSource.listDocsetFunctions(req.solutionContext, id, cat, lang);
    return ok(res, { info, functions }, { id, lang, references: catalog.references });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/docs/:id/categories/:cat/:fn?lang= — Volltext-Eintrag.
 */
async function getEntry(req, res, next) {
  try {
    const { id, cat, fn } = req.params;
    const lang = req.query.lang || 'en';
    const catalog = docsManifest.getCatalogEntry(id);
    if (!catalog) return notFound(res, `Unknown doc-set: ${id}`);
    const entry = await docsSource.getDocsetEntry(req.solutionContext, id, cat, fn, lang);
    if (!entry) return notFound(res, `Entry '${fn}' not found in '${id}/${cat}'`);
    return ok(res, entry, { id, category: cat, lang });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/docs/:id/search?q=...&lang=
 *
 * Zwei Modi:
 *   ohne `group`        → Zeilen-Suche (Kategorien + Einträge, gedeckelt)
 *   `group=category`    → rubrikübergreifende Eintragssuche, konsolidiert auf
 *                         Rubrikebene und UNGEDECKELT aggregiert. Liefert
 *                         `[{ category_id, hit_count, sample }]`; `sample`
 *                         begrenzt nur den Beleg je Rubrik (Default 5).
 *
 * Der Aggregations-Modus antwortet auf leere oder zu kurze Eingaben mit einer
 * leeren Liste statt mit 400 — die Mindestlänge ist eine Ergebnisregel, kein
 * Aufrufer-Fehler (der Client fragt bei kurzer Eingabe gar nicht erst).
 */
async function search(req, res, next) {
  try {
    const { id } = req.params;
    const q = String(req.query.q || '').trim();
    const lang = req.query.lang || 'en';
    const group = String(req.query.group || '').trim();
    const catalog = docsManifest.getCatalogEntry(id);
    if (!catalog) return notFound(res, `Unknown doc-set: ${id}`);

    if (group === 'category') {
      const result = await docsSource.searchDocsetEntriesByCategory(
        req.solutionContext, id, q, { lang, sample: req.query.sample }
      );
      return ok(res, result, {
        id, q, lang,
        group: 'category',
        min_chars: docsSource.ENTRY_SEARCH_MIN_CHARS,
      });
    }
    if (group) return validationError(res, `Unsupported group mode: ${group}`);

    if (!q) return validationError(res, 'Query parameter "q" is required.');
    const result = await docsSource.searchDocset(req.solutionContext, id, q, lang);
    return ok(res, result, { id, q, lang });
  } catch (err) {
    return next(err);
  }
}

/**
 * Übersetzt die kontrollierten Fehler-Codes aus docs-install.js auf
 * passende HTTP-Antworten. Wird sowohl von /check als auch /install genutzt.
 */
function mapInstallError(res, err) {
  switch (err.code) {
    case 'INVALID_ID':
    case 'NO_SKILL':
    case 'INVALID_SKILL':
      return validationError(res, err.message);
    case 'UNKNOWN_ID':
    case 'SCRIPT_NOT_FOUND':
      return notFound(res, err.message);
    default:
      return null;
  }
}

/**
 * GET /api/docs/:id/check — ruft den Installer im --check-Modus auf und gibt
 * `{ installed, local_version, remote_version, update_available }` zurück.
 * Synchron (kein Stream), Skript muss < ~10 s liefern.
 */
async function check(req, res, next) {
  try {
    const { id } = req.params;
    try {
      docsInstall.assertAllowedId(id);
      docsInstall.ensureScriptExists(id);
    } catch (err) {
      const mapped = mapInstallError(res, err);
      if (mapped) return mapped;
      throw err;
    }
    const { exit_code, check: checkEvt, events } = await docsInstall.checkDocset(id);
    if (!checkEvt) {
      return res.status(502).json({
        success: false,
        error: {
          code: 'CHECK_NO_RESULT',
          message: `Installer produced no check-event (exit ${exit_code})`,
          events,
        },
      });
    }
    return ok(res, checkEvt, { id, exit_code });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/docs/install/:id — startet den Installer im --install-Modus und
 * streamt NDJSON-Events als Server-Sent-Events an den Client.
 *
 * Nach erfolgreichem Exit (Code 0) wird intern `performReload()` aufgerufen,
 * damit Adapter-Caches und in-process Maps die neue Installation sehen.
 */
async function install(req, res, next) {
  const { id } = req.params;

  try {
    docsInstall.assertAllowedId(id);
    docsInstall.ensureScriptExists(id);
  } catch (err) {
    const mapped = mapInstallError(res, err);
    if (mapped) return mapped;
    return next(err);
  }

  // Optional per-set extraArgs (e.g. claris-help: --langs=de,fr,it / --all)
  // Strictly whitelisted in docs-install.sanitizeExtraArgs — unknown args are
  // dropped, never forwarded blindly to the spawned script.
  const extraArgs = docsInstall.sanitizeExtraArgs(id, req.body?.extraArgs);

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

  send({ event: 'start', id, ts: new Date().toISOString() });

  const ac = new AbortController();
  let aborted = false;
  // IMPORTANT: bind to res.on('close'), not req.on('close').
  // For POST requests with a body, req.on('close') fires as soon as the
  // request body has been fully received — that's milliseconds after the
  // spawn, not when the client actually disconnects. res.on('close') only
  // fires when the response stream is torn down (real client disconnect or
  // our own res.end()), which is the actual abort signal we care about.
  res.on('close', () => {
    if (res.writableEnded) return; // normal end, not an abort
    aborted = true;
    ac.abort();
  });

  // Heartbeat — manche Proxies cutten idle SSE-Verbindungen nach ~30 s.
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { /* socket gone */ }
  }, 15000);

  try {
    const exitCode = await docsInstall.runInstaller({
      id,
      mode: 'install',
      extraArgs,
      onEvent: send,
      signal: ac.signal,
    });

    if (aborted) {
      send({ event: 'aborted' });
      return;
    }

    if (exitCode === 0) {
      try {
        const result = await performReload();
        send({ event: 'reload', ok: true, tables: result.tables });
      } catch (err) {
        send({ event: 'reload', ok: false, error: err.message });
      }
      send({ event: 'done', ok: true, exit_code: 0 });
    } else {
      send({ event: 'done', ok: false, exit_code: exitCode });
    }
  } catch (err) {
    send({ event: 'error', message: err.message });
    send({ event: 'done', ok: false, exit_code: -1 });
  } finally {
    clearInterval(heartbeat);
    try { res.end(); } catch { /* already closed */ }
  }
}

/**
 * GET /api/docs/:id/_asset/*path
 *
 * Liefert statische Dateien (Bilder, Attachments) aus dem installierten
 * Doc-Set-Verzeichnis. Wird von der Markdown→HTML-Pipeline genutzt, um
 * relative Asset-Referenzen aufzulösen (`![alt](images/foo.png)` wird zu
 * `/api/docs/fmide/_asset/images/foo.png`).
 *
 * Sicherheit:
 *   - Doc-Set-ID muss im Catalog stehen (sonst 404)
 *   - Asset muss innerhalb des Doc-Set-Verzeichnisses bleiben — wir resolve()n
 *     den absoluten Pfad und prüfen, dass er mit dem Doc-Set-Root beginnt
 *   - Symlinks werden via fs.realpath aufgelöst und ebenfalls gegen den
 *     Doc-Set-Root verifiziert (verhindert escape via symlink)
 *   - Markdown-Dateien werden NICHT als Asset ausgeliefert (das ist Inhalt,
 *     nicht Asset — kommt über /categories/:cat/:fn)
 */
async function getAsset(req, res, next) {
  try {
    const { id } = req.params;
    const catalog = docsManifest.getCatalogEntry(id);
    if (!catalog) return notFound(res, `Unknown doc-set: ${id}`);
    const installed = docsManifest.getInstalledEntry(id);
    if (!installed?.directory) return notFound(res, `Doc-set "${id}" is not installed.`);

    // Express 5 / path-to-regexp v6+: benanntes Wildcard liefert ein Array
    // mit den Segmenten. Wir bauen daraus den relativen Pfad zusammen.
    const raw = req.params.assetPath;
    const segments = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const subPath = segments.join('/').trim();
    if (!subPath) return notFound(res, 'Empty asset path.');

    // .md-Inhalte gehen NICHT über den Asset-Endpoint — die haben eine eigene
    // Route. Verhindert versehentliches Ausliefern von rohem Markdown ohne
    // Sanitization / Rendering.
    if (/\.md$/i.test(subPath)) {
      return notFound(res, 'Markdown content is not served as an asset.');
    }

    const repoRoot = settingsStore.resolveRepoRoot();
    const docsetRoot = path.resolve(repoRoot, installed.directory);
    const requested = path.resolve(docsetRoot, subPath);

    // Path-Traversal-Check: resolved-Path muss unter docsetRoot bleiben.
    const rootWithSep = docsetRoot.endsWith(path.sep) ? docsetRoot : docsetRoot + path.sep;
    if (requested !== docsetRoot && !requested.startsWith(rootWithSep)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Asset path escapes doc-set root.' },
      });
    }

    // Symlink-Resolution + erneute Verifizierung.
    let resolved;
    try {
      resolved = fs.realpathSync(requested);
    } catch {
      return notFound(res, `Asset not found: ${subPath}`);
    }
    if (resolved !== docsetRoot && !resolved.startsWith(rootWithSep)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Asset symlink escapes doc-set root.' },
      });
    }

    let stat;
    try {
      stat = fs.statSync(resolved);
    } catch {
      return notFound(res, `Asset not found: ${subPath}`);
    }
    if (!stat.isFile()) {
      return notFound(res, `Asset is not a regular file: ${subPath}`);
    }

    // Sinnvoller Cache: Doc-Set-Assets ändern sich nur bei Re-Install.
    res.set('Cache-Control', 'public, max-age=3600');
    return res.sendFile(resolved);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listDocs,
  getStatus,
  listCategories,
  getCategory,
  getEntry,
  search,
  check,
  install,
  getAsset,
};
