const referenceService = require('../services/reference.service');
const helpService = require('../services/help.service');
const environment = require('../config/environment');
const { buildSuccess } = require('../utils/response-builder');
const { REFERENCE_CONTENT_LEVELS } = require('../config/constants');

/**
 * Reference-Controller
 *
 * Endpoints:
 *
 *   /api/reference/categories?lang=de
 *   /api/reference/steps?lang=de
 *   /api/reference/steps/:idOrSlug?lang=de&content=meta|summary|full
 *   /api/reference/steps/:idOrSlug/embed?lang=de
 *   /api/reference/functions?lang=de
 *   /api/reference/functions/:nameOrId?lang=de&content=meta|summary|full
 *   /api/reference/functions/:nameOrId/embed?lang=de
 *   /api/reference/lookup?token=…&lang=de&all=false
 *   /api/reference/help/:lang/:slug
 *   /api/reference/help/status
 *
 * Statische Assets werden NICHT hier, sondern in `routes/reference.routes.js`
 * per express.static gemountet.
 */

const ERROR_STATUS = {
  REF_NOT_ATTACHED:       503,
  REF_LANG_INVALID:       400,
  REF_STEP_NOT_FOUND:     404,
  REF_FUNCTION_NOT_FOUND: 404,
  REF_HELP_NOT_FOUND:     404,
  VALIDATION_ERROR:       400,
};

function sendErr(res, code, message, extra = {}) {
  const status = ERROR_STATUS[code] || 500;
  const payload = {
    success: false,
    error: { code, message, details: extra.details || {} },
  };
  if (extra.suggestions) payload.data = { suggestions: extra.suggestions };
  if (extra.hint) payload.error.hint = extra.hint;
  return res.status(status).json(payload);
}

function asyncWrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((err) => {
    if (err && err.code && ERROR_STATUS[err.code]) {
      return sendErr(res, err.code, err.message, { details: err.details });
    }
    next(err);
  });
}

function pickLang(req) {
  return req.query.lang || environment.reference.defaultLang;
}

/**
 * GET /api/reference/categories
 */
const getCategories = asyncWrap(async (req, res) => {
  const ctx = req.solutionContext;
  const lang = pickLang(req);
  const scriptSteps = await referenceService.getStepCategories(ctx, lang).catch((e) => {
    if (e.code === 'REF_LANG_INVALID') throw e;
    throw e;
  });
  // Function-Sprachen sind eine Untermenge — wenn lang nicht unterstützt wird,
  // fallen wir auf Default zurück und markieren das.
  let functions, fnLang;
  try {
    functions = await referenceService.getFunctionCategories(ctx, lang);
    fnLang = lang;
  } catch (e) {
    if (e.code === 'REF_LANG_INVALID') {
      fnLang = environment.reference.defaultLang;
      functions = await referenceService.getFunctionCategories(ctx, fnLang);
    } else {
      throw e;
    }
  }
  res.json(buildSuccess({
    scriptSteps,
    functions,
  }, {
    lang,
    functionLang: fnLang,
  }));
});

/**
 * GET /api/reference/steps
 */
const listSteps = asyncWrap(async (req, res) => {
  const ctx = req.solutionContext;
  const lang = referenceService.resolveStepLang(pickLang(req));
  const [steps, categories, buildMeta] = await Promise.all([
    referenceService.listSteps(ctx, lang),
    referenceService.getStepCategories(ctx, lang),
    referenceService.getBuildMeta(ctx),
  ]);
  res.json({
    success: true,
    data: {
      meta: {
        language: lang,
        count: steps.length,
        categories: categories.length,
        sourceVersion: buildMeta.sourceVersion,
      },
      categories,
      steps,
    },
  });
});

/**
 * GET /api/reference/meta — fm-spec Schema-Viewer Kopfbereich
 */
const getMeta = asyncWrap(async (req, res) => {
  const data = await referenceService.getReferenceMeta(req.solutionContext);
  res.json({
    success: true,
    data,
    meta: { grammarAvailable: data.grammarAvailable },
  });
});

/**
 * GET /reference/trigger-events?lang=de
 * Lokalisierte Script-Trigger-Event-Beschriftungen (event_name → event_label,
 * fm_spec ≥ 1.18.0). Graceful: ohne attachte/ältere Referenz-DB ein leeres
 * `labels`-Objekt — der Client fällt auf die kanonischen Namen zurück.
 */
const getTriggerEvents = asyncWrap(async (req, res) => {
  const data = await referenceService.getScriptTriggerEventLabels(
    req.solutionContext, req.query.lang,
  );
  res.json({ success: true, data });
});

/**
 * GET /api/reference/steps/:idOrSlug/langs — lokalisierte Step-Daten +
 * Parameter über alle Sprachen in einem Call.
 */
const getStepLangs = asyncWrap(async (req, res) => {
  const ctx = req.solutionContext;
  const data = await referenceService.getStepAllLangs(ctx, req.params.idOrSlug);
  if (!data) {
    const suggestions = await referenceService.suggestStepSlugs(ctx, req.params.idOrSlug, 5);
    return sendErr(res, 'REF_STEP_NOT_FOUND',
      `No step with id/slug '${req.params.idOrSlug}'.`,
      { suggestions });
  }
  res.json({ success: true, data });
});

/**
 * GET /api/reference/steps/:idOrSlug/grammar — Grammatik-Details.
 * 404-frei bzgl. Grammatik: fehlt die Grammatik-Zeile → data:null,
 * meta.grammarAvailable=false.
 */
const getStepGrammar = asyncWrap(async (req, res) => {
  const data = await referenceService.getStepGrammar(req.solutionContext, req.params.idOrSlug);
  if (!data.available) {
    return res.json({ success: true, data: null, meta: { grammarAvailable: false } });
  }
  res.json({ success: true, data, meta: { grammarAvailable: true } });
});

/**
 * GET /api/reference/steps/:idOrSlug
 */
const getStep = asyncWrap(async (req, res) => {
  const ctx = req.solutionContext;
  const lang = referenceService.resolveStepLang(pickLang(req));
  const content = normalizeContent(req.query.content);
  if (content === null) {
    return sendErr(res, 'VALIDATION_ERROR',
      `Invalid content level. Allowed: ${REFERENCE_CONTENT_LEVELS.join(', ')}`);
  }
  const detail = await referenceService.getStepDetail(ctx, req.params.idOrSlug, lang);
  if (!detail) {
    const suggestions = await referenceService.suggestStepSlugs(ctx, req.params.idOrSlug, 5);
    return sendErr(res, 'REF_STEP_NOT_FOUND',
      `No step with id/slug '${req.params.idOrSlug}'.`,
      { suggestions });
  }
  // content=summary|full: HTML aus dem lokalen Mirror anhängen
  const buildMeta = await referenceService.getBuildMeta(ctx);
  const respMeta = { source: 'db', lang, sourceVersion: buildMeta.sourceVersion };
  if (content === 'summary' || content === 'full') {
    const mirrorLang = referenceService.mirrorLangDir(lang);
    const html = helpService.resolveHtml(mirrorLang, detail.urlSlug);
    if (html) {
      respMeta.source = html.source;
      respMeta.htmlPath = path_relative(html.path);
      if (content === 'full') {
        detail.embedHtml = helpService.extractEmbed(html);
      }
    } else {
      respMeta.source = 'db-only';
    }
  }
  res.json({ success: true, data: detail, meta: respMeta });
});

/**
 * GET /api/reference/steps/:idOrSlug/embed
 */
const getStepEmbed = asyncWrap(async (req, res) => {
  const ctx = req.solutionContext;
  const lang = referenceService.resolveStepLang(pickLang(req));
  const base = await referenceService.findStepBySlugOrId(ctx, req.params.idOrSlug);
  if (!base) {
    const suggestions = await referenceService.suggestStepSlugs(ctx, req.params.idOrSlug, 5);
    return sendErr(res, 'REF_STEP_NOT_FOUND',
      `No step with id/slug '${req.params.idOrSlug}'.`,
      { suggestions });
  }
  const mirrorLang = referenceService.mirrorLangDir(lang);
  const html = helpService.resolveHtml(mirrorLang, base.url_slug);
  if (!html) {
    return sendErr(res, 'REF_HELP_NOT_FOUND',
      `No local help HTML for step '${base.url_slug}' (lang '${lang}').`);
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Help-Source', html.source);
  return res.send(helpService.extractEmbed(html));
});

/**
 * GET /api/reference/functions
 */
const listFunctions = asyncWrap(async (req, res) => {
  const ctx = req.solutionContext;
  const lang = referenceService.resolveFunctionLang(pickLang(req));
  const [functions, categories, buildMeta] = await Promise.all([
    referenceService.listFunctions(ctx, lang),
    referenceService.getFunctionCategories(ctx, lang),
    referenceService.getBuildMeta(ctx),
  ]);
  res.json({
    success: true,
    data: {
      meta: {
        language: lang,
        count: functions.length,
        categories: categories.length,
        sourceVersion: buildMeta.sourceVersion,
      },
      categories,
      functions,
    },
  });
});

/**
 * GET /api/reference/functions/:nameOrId
 */
const getFunction = asyncWrap(async (req, res) => {
  const ctx = req.solutionContext;
  const lang = referenceService.resolveFunctionLang(pickLang(req));
  const content = normalizeContent(req.query.content);
  if (content === null) {
    return sendErr(res, 'VALIDATION_ERROR',
      `Invalid content level. Allowed: ${REFERENCE_CONTENT_LEVELS.join(', ')}`);
  }
  const detail = await referenceService.getFunctionDetail(ctx, req.params.nameOrId, lang);
  if (!detail) {
    const suggestions = await referenceService.suggestFunctionNames(ctx, req.params.nameOrId, 5);
    return sendErr(res, 'REF_FUNCTION_NOT_FOUND',
      `No function with name/id '${req.params.nameOrId}'.`,
      { suggestions });
  }
  const buildMeta = await referenceService.getBuildMeta(ctx);
  const respMeta = { source: 'db', lang, sourceVersion: buildMeta.sourceVersion };
  if (content === 'summary' || content === 'full') {
    const mirrorLang = referenceService.mirrorLangDir(lang);
    const html = helpService.resolveHtml(mirrorLang, detail.urlSlug);
    if (html) {
      respMeta.source = html.source;
      respMeta.htmlPath = path_relative(html.path);
      if (content === 'full') {
        detail.embedHtml = helpService.extractEmbed(html);
      }
    } else {
      respMeta.source = 'db-only';
    }
  }
  res.json({ success: true, data: detail, meta: respMeta });
});

/**
 * GET /api/reference/functions/:nameOrId/embed
 */
const getFunctionEmbed = asyncWrap(async (req, res) => {
  const ctx = req.solutionContext;
  const lang = referenceService.resolveFunctionLang(pickLang(req));
  const base = await referenceService.findFunctionByNameOrId(ctx, req.params.nameOrId);
  if (!base) {
    const suggestions = await referenceService.suggestFunctionNames(ctx, req.params.nameOrId, 5);
    return sendErr(res, 'REF_FUNCTION_NOT_FOUND',
      `No function with name/id '${req.params.nameOrId}'.`,
      { suggestions });
  }
  const mirrorLang = referenceService.mirrorLangDir(lang);
  const html = helpService.resolveHtml(mirrorLang, base.url_slug);
  if (!html) {
    return sendErr(res, 'REF_HELP_NOT_FOUND',
      `No local help HTML for function '${base.url_slug}' (lang '${lang}').`);
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Help-Source', html.source);
  return res.send(helpService.extractEmbed(html));
});

/**
 * GET /api/reference/lookup
 */
const lookup = asyncWrap(async (req, res) => {
  const token = String(req.query.token || '').trim();
  if (!token) {
    return sendErr(res, 'VALIDATION_ERROR',
      'Query-Parameter `token` fehlt oder ist leer.');
  }
  const lang = pickLang(req);
  const all = String(req.query.all || '').toLowerCase() === 'true';
  const matches = await referenceService.lookupToken(req.solutionContext, token, lang, { all });
  res.json({
    success: true,
    data: { token, lang, all, matches },
  });
});

/**
 * GET /api/reference/help/status
 */
function helpStatus(req, res) {
  return res.json(buildSuccess(helpService.getStatus()));
}

/**
 * GET /api/reference/help/:lang/:slug
 *
 * Liefert die rohe HTML-Datei aus dem Mirror. Cache-Header für CDN-/Browser-Cache.
 * Slug kann optional mit oder ohne `.html`-Suffix kommen.
 */
function helpHtml(req, res) {
  const lang = String(req.params.lang || '');
  let slug = String(req.params.slug || '');
  // .html-Suffix akzeptieren, aber nicht zwingend
  if (slug.toLowerCase().endsWith('.html')) slug = slug.slice(0, -5);

  // DB-Sprachcode (zh-Hans) → Mirror-Code (zh)
  const mirrorLang = referenceService.mirrorLangDir(lang);
  const entry = helpService.resolveHtml(mirrorLang, slug);
  if (!entry) {
    return sendErr(res, 'REF_HELP_NOT_FOUND',
      `No local help HTML for slug '${slug}' (lang '${lang}').`);
  }
  // Optimierung: Navigation/Feedback/Legal entfernen, Cross-Links auf API-Pfade
  // mappen, Asset-Pfade auf _static umschreiben, Sprachschalter einblenden
  // (siehe help.service.js).
  const optimized = helpService.optimizeHelpHtml(entry.html, mirrorLang, slug);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('X-Help-Source', entry.source);
  return res.send(optimized);
}

/**
 * ============================================================================
 * Helpers
 * ============================================================================
 */
function normalizeContent(raw) {
  const v = String(raw || 'meta').toLowerCase();
  if (!REFERENCE_CONTENT_LEVELS.includes(v)) return null;
  return v;
}

function path_relative(absPath) {
  // Pfad relativ zum htmlRoot — nützlich fürs Debugging in der Meta-Antwort.
  const root = helpService.htmlRoot();
  if (absPath.startsWith(root)) {
    return absPath.slice(root.length).replace(/^[\\/]/, '');
  }
  return absPath;
}

module.exports = {
  getCategories,
  getMeta,
  getTriggerEvents,
  listSteps,
  getStepLangs,
  getStepGrammar,
  getStep,
  getStepEmbed,
  listFunctions,
  getFunction,
  getFunctionEmbed,
  lookup,
  helpStatus,
  helpHtml,
};
