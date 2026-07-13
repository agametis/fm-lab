const { LRUCache } = require('lru-cache');
const db = require('../config/database');
const environment = require('../config/environment');
const {
  REFERENCE_STEP_LANGUAGES,
  REFERENCE_FUNCTION_LANGUAGES,
  REFERENCE_LANG_TO_MIRROR_DIR,
} = require('../config/constants');

/**
 * Reference-Service
 *
 * Kapselt alle Zugriffe auf die per ATTACH eingebundene fm_spec.duckdb
 * (Alias `ref`). Bietet:
 *   - Sprach-Validierung pro Domain (Steps: 11, Functions: 9)
 *   - Bulk-Lookups (Steps/Functions/Categories) mit Pro-Sprache-LRU-Cache
 *   - Einzel-Lookups (Step/Function-Detail inkl. Parameter)
 *   - Universal-Lookup (Token → Step/Function via Reverse-Lookup-Tabellen)
 *   - DDR-Token-Anreicherung für Script-Step- und Funktions-Tokens
 *
 * HTML-Cache und Manifest-Status liegen im `help.service.js`.
 */

const metaCache = new LRUCache({
  max: 1000,
  ttl: environment.reference.cacheTtlMs,
});

// Vorgeladene Step-Map pro Sprache: stepMetaByLang.get('de').get(141) → {…}
const stepMetaByLang = new Map();

function clearCaches() {
  metaCache.clear();
  stepMetaByLang.clear();
  refTableExistsCache.clear();
}

function isStepLang(lang) {
  return REFERENCE_STEP_LANGUAGES.includes(lang);
}

function isFunctionLang(lang) {
  return REFERENCE_FUNCTION_LANGUAGES.includes(lang);
}

function resolveStepLang(lang) {
  const v = lang || environment.reference.defaultLang;
  if (!isStepLang(v)) {
    const err = new Error(`Unsupported language '${v}' for steps. Valid: ${REFERENCE_STEP_LANGUAGES.join(', ')}`);
    err.code = 'REF_LANG_INVALID';
    err.details = { domain: 'steps', valid: REFERENCE_STEP_LANGUAGES };
    throw err;
  }
  return v;
}

function resolveFunctionLang(lang) {
  const v = lang || environment.reference.defaultLang;
  if (!isFunctionLang(v)) {
    const err = new Error(`Unsupported language '${v}' for functions. Valid: ${REFERENCE_FUNCTION_LANGUAGES.join(', ')}`);
    err.code = 'REF_LANG_INVALID';
    err.details = { domain: 'functions', valid: REFERENCE_FUNCTION_LANGUAGES };
    throw err;
  }
  return v;
}

function assertAttached() {
  if (!db.isReferenceAttached()) {
    const err = new Error('Reference-DB not attached. Set REFERENCE_DUCKDB_PATH or copy fm_spec.duckdb into reference/.');
    err.code = 'REF_NOT_ATTACHED';
    throw err;
  }
}

/**
 * BigInt → Number normalisieren (für JSON-Serialisierung).
 */
function normalizeRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = typeof v === 'bigint' ? Number(v) : v;
  }
  return out;
}

function mirrorLangDir(lang) {
  return REFERENCE_LANG_TO_MIRROR_DIR[lang] || lang;
}

/**
 * Prüft, ob eine Tabelle im attachten `ref`-Katalog existiert. Wird genutzt,
 * um die generativen Tabellen (Referenz ≥ 1.2.0) gegen ältere Referenzen
 * abzusichern (Konsumenten-Schutz). Ergebnis wird pro Prozess
 * gecacht (Schema ändert sich nicht zur Laufzeit).
 */
const refTableExistsCache = new Map();
async function refTableExists(name) {
  if (refTableExistsCache.has(name)) return refTableExistsCache.get(name);
  const r = await db.executeQuery(
    `SELECT 1 FROM information_schema.tables
     WHERE table_catalog = 'ref' AND table_name = ? LIMIT 1`,
    [String(name)]
  );
  const exists = r.rows.length > 0;
  refTableExistsCache.set(name, exists);
  return exists;
}

/**
 * ============================================================================
 * Kategorien
 * ============================================================================
 */

async function getStepCategories(lang) {
  assertAttached();
  const language = resolveStepLang(lang);
  const cacheKey = `step-cat:${language}`;
  if (metaCache.has(cacheKey)) return metaCache.get(cacheKey);

  const r = await db.executeQuery(`
    SELECT c.category_id, c.url_slug, cl.name, cl.url
    FROM ref.script_steps_categories c
    JOIN ref.script_steps_categories_lang cl USING (category_id)
    WHERE cl.language = ?
    ORDER BY c.category_id
  `, [language]);

  const data = r.rows.map((row) => ({
    id: Number(row.category_id),
    slug: row.url_slug,
    name: row.name,
    url: row.url,
  }));
  metaCache.set(cacheKey, data);
  return data;
}

async function getFunctionCategories(lang) {
  assertAttached();
  const language = resolveFunctionLang(lang);
  const cacheKey = `fn-cat:${language}`;
  if (metaCache.has(cacheKey)) return metaCache.get(cacheKey);

  const r = await db.executeQuery(`
    SELECT c.category_id, c.url_slug, cl.name, cl.url
    FROM ref.function_categories c
    JOIN ref.function_categories_lang cl USING (category_id)
    WHERE cl.language = ?
    ORDER BY c.category_id
  `, [language]);

  const data = r.rows.map((row) => ({
    id: Number(row.category_id),
    slug: row.url_slug,
    name: row.name,
    url: row.url,
  }));
  metaCache.set(cacheKey, data);
  return data;
}

/**
 * ============================================================================
 * Steps — Bulk + Detail
 * ============================================================================
 */

async function listSteps(lang) {
  assertAttached();
  const language = resolveStepLang(lang);
  const cacheKey = `steps-list:${language}`;
  if (metaCache.has(cacheKey)) return metaCache.get(cacheKey);

  // hasGrammar: EXISTS-Prüfung auf step_xml_map — nur wenn die generative
  // Tabelle vorhanden ist (Referenz ≥ 1.2.0). Bei älterer Referenz degradiert
  // das Feld auf `false`, ohne die Liste zu brechen.
  const grammarTable = await refTableExists('step_xml_map');
  const grammarSelect = grammarTable
    ? `EXISTS (SELECT 1 FROM ref.step_xml_map m WHERE m.step_id = s.step_id)`
    : `FALSE`;

  const r = await db.executeQuery(`
    SELECT s.step_id, s.url_slug, s.canonical_name, s.category_id,
           s.origin_version,
           ${grammarSelect} AS has_grammar,
           sl.display_name, sl.description, sl.url
    FROM ref.script_steps s
    LEFT JOIN ref.script_steps_lang sl
      ON sl.step_id = s.step_id AND sl.language = ?
    ORDER BY s.step_id
  `, [language]);

  const steps = r.rows.map((row) => ({
    stepId:      Number(row.step_id),
    name:        row.canonical_name,
    urlSlug:     row.url_slug,
    displayName: row.display_name || row.canonical_name,
    description: row.description,
    categoryId:  Number(row.category_id),
    originVersion: row.origin_version || null,
    hasGrammar:  Boolean(row.has_grammar),
    helpUrl:     row.url,
    localHelpUrl: buildLocalHelpUrl('steps', language, row.url_slug),
  }));
  metaCache.set(cacheKey, steps);
  return steps;
}

/**
 * Vorgeladene Step-Map (stepId → meta) für eine Sprache. Wird vom
 * Token-Anreicherer in get-details verwendet, um nicht pro Line eine
 * DB-Query zu fahren.
 */
async function getStepMetaMap(lang) {
  const language = resolveStepLang(lang);
  if (stepMetaByLang.has(language)) return stepMetaByLang.get(language);
  const steps = await listSteps(language);
  const map = new Map(steps.map((s) => [s.stepId, s]));
  stepMetaByLang.set(language, map);
  return map;
}

async function findStepBySlugOrId(idOrSlug) {
  assertAttached();
  const isNumeric = /^\d+$/.test(String(idOrSlug));
  let row;
  if (isNumeric) {
    const r = await db.executeQuery(
      `SELECT step_id, url_slug, canonical_name, category_id, origin_version FROM ref.script_steps WHERE step_id = ?`,
      [parseInt(idOrSlug, 10)]
    );
    row = r.rows[0];
  } else {
    const r = await db.executeQuery(
      `SELECT step_id, url_slug, canonical_name, category_id, origin_version FROM ref.script_steps WHERE url_slug = ? OR canonical_name = ?`,
      [String(idOrSlug), String(idOrSlug)]
    );
    row = r.rows[0];
  }
  return row ? normalizeRow(row) : null;
}

async function getStepDetail(idOrSlug, lang) {
  assertAttached();
  const language = resolveStepLang(lang);
  const base = await findStepBySlugOrId(idOrSlug);
  if (!base) return null;

  const r = await db.executeQuery(`
    SELECT sl.display_name, sl.description, sl.parameter, sl.url
    FROM ref.script_steps_lang sl
    WHERE sl.step_id = ? AND sl.language = ?
  `, [base.step_id, language]);
  const lang_row = r.rows[0] || {};

  const catRows = await db.executeQuery(`
    SELECT c.category_id, c.url_slug, c.category_name_en,
           cl.name AS lang_name
    FROM ref.script_steps_categories c
    LEFT JOIN ref.script_steps_categories_lang cl
      ON cl.category_id = c.category_id AND cl.language = ?
    WHERE c.category_id = ?
  `, [language, base.category_id]);
  const catRow = catRows.rows[0] || {};

  const paramsRes = await db.executeQuery(`
    SELECT param_index, name, description
    FROM ref.script_step_parameters_lang
    WHERE step_id = ? AND language = ?
    ORDER BY param_index
  `, [base.step_id, language]);

  const parameters = paramsRes.rows.map((p) => ({
    index: Number(p.param_index),
    name: p.name,
    description: p.description,
  }));

  return {
    stepId:      base.step_id,
    name:        base.canonical_name,
    urlSlug:     base.url_slug,
    canonicalName: base.canonical_name,
    displayName: lang_row.display_name || base.canonical_name,
    description: lang_row.description || null,
    parameterText: lang_row.parameter || null,
    parameters,
    categoryId:  base.category_id,
    category: catRow.category_id != null ? {
      id:     Number(catRow.category_id),
      slug:   catRow.url_slug,
      nameEn: catRow.category_name_en,
      name:   catRow.lang_name || catRow.category_name_en,
    } : null,
    helpUrl:      lang_row.url || null,
    localHelpUrl: buildLocalHelpUrl('steps', language, base.url_slug),
  };
}

/**
 * ============================================================================
 * Functions — Bulk + Detail
 * ============================================================================
 */

async function listFunctions(lang) {
  assertAttached();
  const language = resolveFunctionLang(lang);
  const cacheKey = `functions-list:${language}`;
  if (metaCache.has(cacheKey)) return metaCache.get(cacheKey);

  const r = await db.executeQuery(`
    SELECT f.function_id, f.opcode, f.canonical_name, f.return_type,
           f.origin_version, f.is_get_function, f.url_slug, f.category_id,
           fl.display_name, fl.signature, fl.purpose, fl.url
    FROM ref.functions f
    LEFT JOIN ref.functions_lang fl
      ON fl.function_id = f.function_id AND fl.language = ?
    ORDER BY f.function_id
  `, [language]);

  const fns = r.rows.map((row) => ({
    functionId:    Number(row.function_id),
    name:          row.canonical_name,
    opcode:        row.opcode,
    returnType:    row.return_type,
    originVersion: row.origin_version,
    isGetFunction: Number(row.is_get_function) === 1,
    urlSlug:       row.url_slug,
    displayName:   row.display_name || row.canonical_name,
    signature:     row.signature,
    purpose:       row.purpose,
    categoryId:    Number(row.category_id),
    helpUrl:       row.url,
    localHelpUrl:  buildLocalHelpUrl('functions', language, row.url_slug),
  }));
  metaCache.set(cacheKey, fns);
  return fns;
}

async function findFunctionByNameOrId(nameOrId) {
  assertAttached();
  const isNumeric = /^\d+$/.test(String(nameOrId));
  let row;
  if (isNumeric) {
    const r = await db.executeQuery(
      `SELECT function_id, canonical_name, opcode, category_id, return_type, origin_version, is_get_function, url_slug
       FROM ref.functions WHERE function_id = ?`,
      [parseInt(nameOrId, 10)]
    );
    row = r.rows[0];
  } else {
    const r = await db.executeQuery(
      `SELECT function_id, canonical_name, opcode, category_id, return_type, origin_version, is_get_function, url_slug
       FROM ref.functions
       WHERE canonical_name = ? OR url_slug = ?`,
      [String(nameOrId), String(nameOrId)]
    );
    row = r.rows[0];
  }
  return row ? normalizeRow(row) : null;
}

async function getFunctionDetail(nameOrId, lang) {
  assertAttached();
  const language = resolveFunctionLang(lang);
  const base = await findFunctionByNameOrId(nameOrId);
  if (!base) return null;

  const r = await db.executeQuery(`
    SELECT display_name, signature, description, purpose, notes,
           example_1, return_type_display, url
    FROM ref.functions_lang
    WHERE function_id = ? AND language = ?
  `, [base.function_id, language]);
  const lang_row = r.rows[0] || {};

  const catRes = await db.executeQuery(`
    SELECT c.category_id, c.url_slug, c.category_name,
           cl.name AS lang_name
    FROM ref.function_categories c
    LEFT JOIN ref.function_categories_lang cl
      ON cl.category_id = c.category_id AND cl.language = ?
    WHERE c.category_id = ?
  `, [language, base.category_id]);
  const catRow = catRes.rows[0] || {};

  const paramsRes = await db.executeQuery(`
    SELECT p.position, p.is_optional, p.is_variadic, pl.name, pl.description
    FROM ref.function_parameters p
    LEFT JOIN ref.function_parameters_lang pl
      ON pl.function_id = p.function_id AND pl.position = p.position AND pl.language = ?
    WHERE p.function_id = ?
    ORDER BY p.position
  `, [language, base.function_id]);

  const parameters = paramsRes.rows.map((p) => ({
    position:    Number(p.position),
    name:        p.name,
    description: p.description,
    optional:    Number(p.is_optional) === 1,
    variadic:    Number(p.is_variadic) === 1,
  }));

  return {
    functionId:    base.function_id,
    name:          base.canonical_name,
    canonicalName: base.canonical_name,
    opcode:        base.opcode,
    returnType:    base.return_type,
    returnTypeDisplay: lang_row.return_type_display || null,
    originVersion: base.origin_version,
    isGetFunction: Number(base.is_get_function) === 1,
    urlSlug:       base.url_slug,
    displayName:   lang_row.display_name || base.canonical_name,
    signature:     lang_row.signature || null,
    description:   lang_row.description || null,
    purpose:       lang_row.purpose || null,
    notes:         lang_row.notes || null,
    example1:      lang_row.example_1 || null,
    categoryId:    base.category_id,
    category: catRow.category_id != null ? {
      id:     Number(catRow.category_id),
      slug:   catRow.url_slug,
      nameEn: catRow.category_name,
      name:   catRow.lang_name || catRow.category_name,
    } : null,
    parameters,
    helpUrl:      lang_row.url || null,
    localHelpUrl: buildLocalHelpUrl('functions', language, base.url_slug),
  };
}

/**
 * ============================================================================
 * Universal Reverse-Lookup (Token → Step/Function)
 * ============================================================================
 */

async function lookupToken(token, lang, { all = false } = {}) {
  assertAttached();

  // Sprach-Filterung pro Domain — Function-Sprachen sind eine Untermenge der
  // Step-Sprachen; wir liefern für ungültige Function-Sprachen nur Steps.
  const stepLang = isStepLang(lang) ? lang : null;
  const fnLang   = isFunctionLang(lang) ? lang : (lang ? null : environment.reference.defaultLang);

  const primaryFilter = all ? '' : 'AND l.is_primary = 1';

  const stepRes = await db.executeQuery(`
    SELECT l.step_id, l.match_source, l.is_primary,
           s.canonical_name, s.url_slug,
           sl.display_name, sl.url
    FROM ref.script_step_name_lookup l
    JOIN ref.script_steps s USING (step_id)
    LEFT JOIN ref.script_steps_lang sl
      ON sl.step_id = l.step_id AND sl.language = ?
    WHERE l.lookup_name = ? ${primaryFilter}
    ORDER BY l.is_primary DESC, l.step_id
  `, [stepLang || environment.reference.defaultLang, token]);

  const fnRes = await db.executeQuery(`
    SELECT l.function_id, l.match_source, l.chunk_role, l.is_primary,
           f.canonical_name, f.url_slug, f.is_get_function,
           fl.display_name, fl.url, fl.purpose, fl.signature
    FROM ref.function_name_lookup l
    JOIN ref.functions f USING (function_id)
    LEFT JOIN ref.functions_lang fl
      ON fl.function_id = l.function_id AND fl.language = ?
    WHERE l.lookup_name = ? ${primaryFilter}
    ORDER BY l.is_primary DESC, l.function_id
  `, [fnLang || environment.reference.defaultLang, token]);

  const matches = [];
  for (const r of stepRes.rows) {
    matches.push({
      kind: 'script_step',
      stepId: Number(r.step_id),
      canonical: r.canonical_name,
      urlSlug: r.url_slug,
      matchSource: r.match_source,
      isPrimary: Number(r.is_primary) === 1,
      displayName: r.display_name || r.canonical_name,
      helpUrl: r.url || null,
      localHelpUrl: buildLocalHelpUrl('steps', stepLang || environment.reference.defaultLang, r.url_slug),
    });
  }
  for (const r of fnRes.rows) {
    // chunk_role='getparameter' → in canonical='Get' + subParameter aufspalten.
    // In der Reference-DB ist canonical_name bereits der reine Parameter-Name
    // (z.B. `FileName`, `AccountName`) — kein "Get"-Präfix. Bei Get-Funktionen
    // bilden wir das vollständige Token `Get(canonical_name)` für die UI ab.
    let canonical = r.canonical_name;
    let subParameter = null;
    if (r.chunk_role === 'getparameter' && Number(r.is_get_function) === 1) {
      subParameter = canonical;
      canonical = 'Get';
    }
    matches.push({
      kind: 'function',
      functionId: Number(r.function_id),
      canonical,
      subParameter,
      chunkRole: r.chunk_role,
      matchSource: r.match_source,
      isPrimary: Number(r.is_primary) === 1,
      urlSlug: r.url_slug,
      displayName: r.display_name || r.canonical_name,
      signature: r.signature || null,
      purpose: r.purpose || null,
      helpUrl: r.url || null,
      localHelpUrl: buildLocalHelpUrl('functions', fnLang || environment.reference.defaultLang, r.url_slug),
    });
  }
  return matches;
}

/**
 * ============================================================================
 * Calc-Token-Anreicherung (function_name_lookup)
 * ============================================================================
 *
 * Reichert Tokens vom Type `function` (aus tokens.formatter.js) in-place an —
 * Bulk-Lookup pro eindeutigen Token-Content über `function_name_lookup`. Get-
 * Funktionen mit chunkRole='getparameter' werden auf {canonical='Get',
 * subParameter=<param>} aufgespalten — analog `lookupToken`.
 *
 * Für die Sprache `en` existiert kein `functions_lang`-Eintrag; wir liefern
 * dann `displayName = canonical_name` und purpose/signature `null`.
 */
async function enrichFunctionTokens(tokens, lang) {
  if (!Array.isArray(tokens) || tokens.length === 0) return tokens;
  assertAttached();

  // Sprache mit Soft-Fallback: für ungültige Function-Sprache (z.B. 'en' oder
  // 'zh-Hans') laden wir die DB ohne functions_lang JOIN und liefern canonical
  // als Display.
  const requestedLang = lang || environment.reference.defaultLang;
  const useLang = isFunctionLang(requestedLang) ? requestedLang : null;

  // Eindeutige Token-Contents sammeln
  const names = new Set();
  for (const t of tokens) {
    if (t && t.type === 'function' && typeof t.content === 'string' && t.content.length > 0) {
      names.add(t.content);
    }
  }
  if (names.size === 0) return tokens;

  const nameList = Array.from(names);
  const placeholders = nameList.map(() => '?').join(',');

  // Pro Bulk-Query holen wir alle is_primary=1-Matches in einem Rutsch.
  // Hinweis: in `lookup_name IN (…)` können prinzipiell mehrere Treffer pro
  // Name landen (z.B. canonical_en + display_de). Wir nehmen den ersten via
  // arg_max-artiger Reduktion clientseitig — primärer Treffer gewinnt.
  //
  // Bridge-JOIN für Get-Sub-Parameter: Einige Get-Funktionen sind in der
  // Reference-DB als "Waisen" angelegt (z.B. function_id=369 für
  // "HostAnwendungVersion" — kein url_slug, keine URL). Über die signature
  // (z.B. "Hole ( HostAnwendungVersion )") finden wir oft die "reiche"
  // Geschwister-function_id mit gefülltem url_slug. Greift nur bei
  // is_get_function=1 AND url_slug IS NULL.
  const sql = `
    SELECT l.lookup_name,
           l.function_id,
           l.match_source,
           l.chunk_role,
           l.is_primary,
           f.canonical_name,
           f.url_slug,
           f.is_get_function,
           f.return_type,
           ${useLang
             ? `fl.display_name, fl.signature, fl.purpose, fl.description, fl.url,
                bridge_f.url_slug AS bridge_url_slug,
                bridge_fl.url AS bridge_url,
                bridge_fl.purpose AS bridge_purpose,
                bridge_fl.description AS bridge_description`
             : `NULL AS display_name, NULL AS signature, NULL AS purpose, NULL AS description, NULL AS url,
                NULL AS bridge_url_slug, NULL AS bridge_url,
                NULL AS bridge_purpose, NULL AS bridge_description`}
    FROM ref.function_name_lookup l
    JOIN ref.functions f USING (function_id)
    ${useLang
      ? `LEFT JOIN ref.functions_lang fl ON fl.function_id = l.function_id AND fl.language = ?
         LEFT JOIN ref.function_name_lookup bridge_l
           ON f.is_get_function = 1
           AND f.url_slug IS NULL
           AND fl.signature IS NOT NULL
           AND bridge_l.lookup_name = fl.signature
           AND bridge_l.chunk_role = 'getfunction'
           AND bridge_l.function_id != l.function_id
         LEFT JOIN ref.functions bridge_f
           ON bridge_f.function_id = bridge_l.function_id
           AND bridge_f.url_slug IS NOT NULL
         LEFT JOIN ref.functions_lang bridge_fl
           ON bridge_fl.function_id = bridge_l.function_id
           AND bridge_fl.language = ?`
      : ''}
    WHERE l.lookup_name IN (${placeholders})
      AND l.is_primary = 1
  `;
  const params = useLang ? [useLang, useLang, ...nameList] : nameList;
  const r = await db.executeQuery(sql, params);

  const mirrorLang = useLang ? mirrorLangDir(useLang) : null;

  // Pro Token-Content den ersten Treffer behalten (Sortierung ist stabil genug,
  // weil is_primary=1 in der Quelle ohnehin eindeutig pro (lookup_name, function_id))
  const matchByName = new Map();
  for (const row of r.rows) {
    if (matchByName.has(row.lookup_name)) continue;
    matchByName.set(row.lookup_name, row);
  }

  for (const t of tokens) {
    if (!t || t.type !== 'function') continue;
    const row = matchByName.get(t.content);
    if (!row) continue;

    let canonical = row.canonical_name;
    let subParameter = null;
    if (row.chunk_role === 'getparameter' && Number(row.is_get_function) === 1) {
      subParameter = canonical;
      canonical = 'Get';
    }

    t.functionId       = Number(row.function_id);
    t.functionCanonical = canonical;
    if (subParameter)  t.functionSubParameter = subParameter;
    t.functionDisplayName = row.display_name || row.canonical_name;
    t.functionSignature   = row.signature || null;
    // Purpose-Kaskade: bei Get-Waisen ist `purpose` oft NULL und der Kurztext
    // steckt unter `description`; ggf. liefert die Bridge-Funktion (function_id
    // mit gefülltem url_slug) den schöner formulierten purpose. Reihenfolge:
    //   1. eigener purpose  (normalfall)
    //   2. bridge purpose   (Waisen mit Geschwister-Eintrag)
    //   3. eigene description (Waisen ohne Bridge — Kurztext steht hier)
    //   4. bridge description
    t.functionPurpose     = row.purpose
      || row.bridge_purpose
      || row.description
      || row.bridge_description
      || null;
    t.functionReturnType  = row.return_type || null;
    t.functionChunkRole   = row.chunk_role;
    t.functionMatchSource = row.match_source;

    // Help-URL-Auflösung mit dreistufiger Kaskade für Get-Funktionen, die
    // wegen DB-Waisen (function_id ohne url_slug) sonst keinen Link bekämen:
    //   1. Direkter url_slug der gematchten function_id  → spezifische Sub-Hilfe
    //   2. Bridge-url_slug (über fl.signature aufgelöst) → spezifische Sub-Hilfe
    //   3. Fallback get-functions                        → Übersichts-Seite
    // Nur Stufe 1+2 setzen functionUrlSlug; Stufe 3 setzt nur die URLs (sonst
    // täuscht functionUrlSlug eine spezifische Funktion vor, die es nicht gibt).
    let resolvedSlug = row.url_slug || null;
    let resolvedUrl  = row.url || null;
    let usedBridge = false;
    let usedFallback = false;

    if (!resolvedSlug && row.bridge_url_slug) {
      resolvedSlug = row.bridge_url_slug;
      resolvedUrl  = row.bridge_url || resolvedUrl;
      usedBridge = true;
    }

    t.functionUrlSlug = resolvedSlug;
    t.functionHelpUrl = resolvedUrl;

    if (resolvedSlug && mirrorLang) {
      const helpService = require('./help.service');
      if (helpService.hasMirrorForLang(mirrorLang)) {
        t.functionLocalHelpUrl = `/api/reference/help/${encodeURIComponent(useLang)}/${encodeURIComponent(resolvedSlug)}`;
      }
    }

    // Stufe 3: Fallback auf get-functions Übersichtsseite, wenn weder eigene
    // noch Bridge-Slug existiert UND es eine Get-Funktion ist. Damit zumindest
    // ein Link sichtbar wird (Funktionsliste mit Anker pro Sub-Parameter).
    if (!resolvedSlug && Number(row.is_get_function) === 1) {
      const helpService = require('./help.service');
      const fallbackSlug = 'get-functions';
      if (mirrorLang && helpService.hasMirrorForLang(mirrorLang)) {
        const inv = helpService.getSlugInventory(mirrorLang);
        if (inv && inv.has(fallbackSlug)) {
          t.functionLocalHelpUrl = `/api/reference/help/${encodeURIComponent(useLang)}/${encodeURIComponent(fallbackSlug)}`;
          usedFallback = true;
        }
      }
      if (useLang) {
        t.functionHelpUrl = `https://help.claris.com/${encodeURIComponent(useLang)}/pro-help/content/${fallbackSlug}.html`;
        usedFallback = true;
      }
    }

    if (usedBridge)   t.functionHelpResolution = 'bridge';
    if (usedFallback) t.functionHelpResolution = 'fallback-get-functions';
  }
  return tokens;
}

/**
 * ============================================================================
 * Levenshtein-Distanz für 404-Suggestions
 * ============================================================================
 */

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length, n = b.length;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

async function suggestStepSlugs(needle, limit = 5) {
  assertAttached();
  const r = await db.executeQuery(`SELECT url_slug, canonical_name FROM ref.script_steps`);
  return rankSuggestions(needle, r.rows.flatMap((x) => [x.url_slug, x.canonical_name]), limit);
}

async function suggestFunctionNames(needle, limit = 5) {
  assertAttached();
  const r = await db.executeQuery(`SELECT canonical_name, url_slug FROM ref.functions`);
  return rankSuggestions(needle, r.rows.flatMap((x) => [x.canonical_name, x.url_slug].filter(Boolean)), limit);
}

function rankSuggestions(needle, candidates, limit) {
  const lower = String(needle || '').toLowerCase();
  const scored = candidates
    .filter((s) => s && s.length > 0)
    .map((s) => ({ s, d: levenshtein(lower, s.toLowerCase()) }))
    .sort((a, b) => a.d - b.d);
  const out = [];
  const seen = new Set();
  for (const x of scored) {
    if (seen.has(x.s)) continue;
    seen.add(x.s);
    out.push(x.s);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * ============================================================================
 * Local-Help-URL-Builder
 * ============================================================================
 *
 * Liefert /api/reference/help/<lang>/<slug>, wenn der lokale Mirror für diese
 * Sprache verfügbar ist. Sonst null. Status liegt im help.service.
 */
function buildLocalHelpUrl(domain, lang, slug) {
  if (!slug) return null;
  const helpService = require('./help.service');
  const mirrorDir = mirrorLangDir(lang);
  if (!helpService.hasMirrorForLang(mirrorDir)) return null;
  return `/api/reference/help/${encodeURIComponent(lang)}/${encodeURIComponent(slug)}`;
}

/**
 * ============================================================================
 * Build-Metadaten (für Response-Header / -Envelope)
 * ============================================================================
 */
async function getBuildMeta() {
  assertAttached();
  if (metaCache.has('build-meta')) return metaCache.get('build-meta');
  // Quelle für Versions-Info: functions.source_version (FileMaker v21)
  const r = await db.executeQuery(`SELECT DISTINCT source_version FROM ref.functions LIMIT 1`);
  const meta = {
    sourceVersion: r.rows[0]?.source_version || null,
  };
  metaCache.set('build-meta', meta);
  return meta;
}

/**
 * ============================================================================
 * fm-spec Schema-Viewer
 * ============================================================================
 */

/**
 * Kopfbereich in einem Call: reference_meta + Zähler + Locale-Matrix.
 * Degradiert definiert, wenn generative Tabellen fehlen (grammarSteps = 0).
 */
async function getReferenceMeta() {
  assertAttached();
  const cacheKey = 'fmspec-meta';
  if (metaCache.has(cacheKey)) return metaCache.get(cacheKey);

  // reference_meta ist eine key/value-Tabelle → zu einem Objekt pivotieren.
  const metaRows = await db.executeQuery(`SELECT key, value FROM ref.reference_meta`);
  const referenceMeta = {};
  for (const row of metaRows.rows) referenceMeta[row.key] = row.value;

  const grammarTable = await refTableExists('step_xml_map');

  const [stepCount, fnCount, stepLoc, fnLoc, grammar] = await Promise.all([
    db.executeQuery(`SELECT COUNT(*) AS n FROM ref.script_steps`),
    db.executeQuery(`SELECT COUNT(*) AS n FROM ref.functions`),
    db.executeQuery(`SELECT COUNT(DISTINCT language) AS n FROM ref.script_steps_lang`),
    db.executeQuery(`SELECT COUNT(DISTINCT language) AS n FROM ref.functions_lang`),
    grammarTable
      ? db.executeQuery(`SELECT COUNT(*) AS n FROM ref.step_xml_map`)
      : Promise.resolve({ rows: [{ n: 0 }] }),
  ]);

  // Locale-Matrix (deckt Tab 4.3 mit ab). Pro Sprache: Step-/Functions-/
  // Parameter-Abdeckung. Union der Sprachen aus beiden Domänen.
  const [stepsByLang, fnsByLang, paramsByLang] = await Promise.all([
    db.executeQuery(`SELECT language, COUNT(*) AS n FROM ref.script_steps_lang GROUP BY language`),
    db.executeQuery(`SELECT language, COUNT(*) AS n FROM ref.functions_lang GROUP BY language`),
    db.executeQuery(`SELECT language, COUNT(*) AS n FROM ref.script_step_parameters_lang GROUP BY language`),
  ]);

  const localeMap = new Map();
  const ensure = (code) => {
    if (!localeMap.has(code)) {
      localeMap.set(code, { code, steps: 0, functions: 0, stepParameters: 0 });
    }
    return localeMap.get(code);
  };
  for (const row of stepsByLang.rows) ensure(row.language).steps = Number(row.n);
  for (const row of fnsByLang.rows) ensure(row.language).functions = Number(row.n);
  for (const row of paramsByLang.rows) ensure(row.language).stepParameters = Number(row.n);
  const locales = Array.from(localeMap.values()).sort((a, b) => a.code.localeCompare(b.code));

  const data = {
    referenceMeta: {
      schema_version:    referenceMeta.schema_version || null,
      filemaker_coverage: referenceMeta.filemaker_coverage || null,
      built_at:          referenceMeta.built_at || null,
      source_commit:     referenceMeta.source_commit || null,
    },
    counts: {
      scriptSteps:     Number(stepCount.rows[0].n),
      functions:       Number(fnCount.rows[0].n),
      stepLocales:     Number(stepLoc.rows[0].n),
      functionLocales: Number(fnLoc.rows[0].n),
      grammarSteps:    Number(grammar.rows[0].n),
    },
    locales,
    grammarAvailable: grammarTable,
  };
  metaCache.set(cacheKey, data);
  return data;
}

/**
 * Lokalisierte Step-Daten + Parameter über ALLE Sprachen
 * in einem Call (vermeidet n Requests je Sprache).
 */
async function getStepAllLangs(idOrSlug) {
  assertAttached();
  const base = await findStepBySlugOrId(idOrSlug);
  if (!base) return null;

  const [langRes, paramRes] = await Promise.all([
    db.executeQuery(`
      SELECT language, display_name, description, parameter, url
      FROM ref.script_steps_lang
      WHERE step_id = ?
      ORDER BY language
    `, [base.step_id]),
    db.executeQuery(`
      SELECT language, param_index, name, description
      FROM ref.script_step_parameters_lang
      WHERE step_id = ?
      ORDER BY language, param_index
    `, [base.step_id]),
  ]);

  const paramsByLang = new Map();
  for (const p of paramRes.rows) {
    if (!paramsByLang.has(p.language)) paramsByLang.set(p.language, []);
    paramsByLang.get(p.language).push({
      index: Number(p.param_index),
      name: p.name,
      description: p.description,
    });
  }

  const langs = langRes.rows.map((row) => ({
    language:     row.language,
    displayName:  row.display_name || base.canonical_name,
    description:  row.description || null,
    parameterText: row.parameter || null,
    helpUrl:      row.url || null,
    localHelpUrl: buildLocalHelpUrl('steps', row.language, base.url_slug),
    parameters:   paramsByLang.get(row.language) || [],
  }));

  return {
    stepId:        base.step_id,
    canonicalName: base.canonical_name,
    urlSlug:       base.url_slug,
    categoryId:    base.category_id,
    originVersion: base.origin_version || null,
    langs,
  };
}

/**
 * Grammatik-Details (Abschnitte 3+4 des Detail-Views).
 * 404-frei bezüglich Grammatik: existiert keine step_xml_map-Zeile (oder fehlt
 * die Tabelle bei Referenz < 1.2.0) → `{ available:false, xmlMap:null, … }`.
 * Ein unbekannter Step wirft dagegen REF_STEP_NOT_FOUND (Controller → 404).
 */
async function getStepGrammar(idOrSlug) {
  assertAttached();
  const base = await findStepBySlugOrId(idOrSlug);
  if (!base) {
    const err = new Error(`No step with id/slug '${idOrSlug}'.`);
    err.code = 'REF_STEP_NOT_FOUND';
    throw err;
  }

  const empty = {
    stepId: base.step_id,
    canonicalName: base.canonical_name,
    available: false,
    xmlMap: null,
    options: [],
    constraints: [],
  };

  if (!(await refTableExists('step_xml_map'))) return empty;

  // SELECT * — the deployed consumer variant strips curation columns (notes)
  // and adds payload columns (saxml_example); tolerate both shapes.
  const mapRes = await db.executeQuery(`
    SELECT * FROM ref.step_xml_map WHERE step_id = ?
  `, [base.step_id]);
  if (mapRes.rows.length === 0) return empty;
  const m = mapRes.rows[0];

  const [optRes, valRes, conRes] = await Promise.all([
    db.executeQuery(`
      SELECT option_key, option_type, required, display_location,
             display_label_en, true_text, false_text, omit_when_false,
             inverted_label, xml_path, sort_order, evidence, verified_version
      FROM ref.step_options
      WHERE step_id = ?
      ORDER BY sort_order, option_key
    `, [base.step_id]),
    // SELECT * keeps this tolerant across reference schema versions
    // (per-value `evidence` exists only in newer reference builds)
    db.executeQuery(`
      SELECT *
      FROM ref.step_option_values
      WHERE step_id = ?
      ORDER BY option_key, xml_value
    `, [base.step_id]),
    db.executeQuery(`
      SELECT constraint_kind, detail, evidence, verified_version
      FROM ref.step_constraints
      WHERE step_id = ?
      ORDER BY constraint_kind
    `, [base.step_id]),
  ]);

  const valuesByKey = new Map();
  for (const v of valRes.rows) {
    if (!valuesByKey.has(v.option_key)) valuesByKey.set(v.option_key, []);
    valuesByKey.get(v.option_key).push({
      xmlValue: v.xml_value,
      displayTextEn: v.display_text_en,
      evidence: v.evidence ?? null,
    });
  }

  const options = optRes.rows.map((o) => ({
    optionKey:      o.option_key,
    optionType:     o.option_type,
    required:       Boolean(o.required),
    displayLocation: o.display_location,
    displayLabelEn: o.display_label_en,
    trueText:       o.true_text,
    falseText:      o.false_text,
    omitWhenFalse:  Boolean(o.omit_when_false),
    invertedLabel:  Boolean(o.inverted_label),
    xmlPath:        o.xml_path,
    sortOrder:      o.sort_order != null ? Number(o.sort_order) : null,
    evidence:       o.evidence,
    verifiedVersion: o.verified_version,
    values:         valuesByKey.get(o.option_key) || [],
  }));

  const constraints = conRes.rows.map((c) => ({
    constraintKind:  c.constraint_kind,
    detail:          c.detail,
    evidence:        c.evidence,
    verifiedVersion: c.verified_version,
  }));

  return {
    stepId: base.step_id,
    canonicalName: base.canonical_name,
    available: true,
    xmlMap: {
      snippetTemplate:  m.snippet_template,
      saxmlParamTypes:  m.saxml_param_types,
      saxmlExample:     m.saxml_example ?? null,
      elementOrder:     m.element_order,
      evidence:         m.evidence,
      verifiedVersion:  m.verified_version,
      notes:            m.notes ?? null,
    },
    options,
    constraints,
  };
}

module.exports = {
  clearCaches,
  // Sprachen
  resolveStepLang,
  resolveFunctionLang,
  isStepLang,
  isFunctionLang,
  // Kategorien
  getStepCategories,
  getFunctionCategories,
  // Steps
  listSteps,
  getStepDetail,
  getStepMetaMap,
  findStepBySlugOrId,
  suggestStepSlugs,
  // Functions
  listFunctions,
  getFunctionDetail,
  findFunctionByNameOrId,
  suggestFunctionNames,
  // Reverse-Lookup
  lookupToken,
  enrichFunctionTokens,
  // Help-URL
  buildLocalHelpUrl,
  mirrorLangDir,
  // Build-Info
  getBuildMeta,
  // fm-spec Schema-Viewer
  getReferenceMeta,
  getStepAllLangs,
  getStepGrammar,
};
