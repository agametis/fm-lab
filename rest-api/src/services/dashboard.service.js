const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { LRUCache } = require('lru-cache');
const Joi = require('joi');
const environment = require('../config/environment');
const { createError } = require('../middleware/error-handler');
const db = require('../config/database');
const templateService = require('./template.service');
const { schemas: dashboardSchemas } = require('./dashboard-schemas');

/**
 * Dashboard Service
 *
 * Lädt Dashboard-Bundles (manifest.json + layout.json + data/*.sql + style.css + assets/*)
 * aus zwei Verzeichnissen:
 *   - templates/dashboards/         → System-Bundles (home, _generic, Navigation)
 *   - templates/dashboards-custom/  → Custom-/Plugin-Bundles
 *
 * Bei ID-Kollision hat das Custom-Verzeichnis Vorrang (Override-Pattern für lokale Erweiterungen).
 *
 * Dataset-Quellen (manifest.datasets[].source):
 *   bundle:<rel-path>       → SQL im selben Bundle (data/*.sql)
 *   custom:<template-name>  → bestehende sql-custom/<name>.sql
 *   report:<template-name>  → bestehende sql/<name>.sql
 *   builtin:<key>           → server-bereitgestellte Quelle (list_custom_queries, list_dashboards, files)
 *
 * PRD: project/prd_dashboards.md §3, §7.
 */

// Suchreihenfolge: Custom zuerst, damit lokale Bundles System-Bundles bei ID-Kollision überschreiben.
const DASHBOARDS_DIRS = [
  environment.templates.dashboardsCustomDir,
  environment.templates.dashboardsDir,
];

// Discovery-Cache: ID → { manifest, layout, dir, mtime }
const bundleCache = new LRUCache({
  max: 50,
  ttl: 1000 * 60 * 60, // 1h
  updateAgeOnGet: true,
});

function clearCache() {
  bundleCache.clear();
}

async function readJsonFile(filePath) {
  const raw = await fs.readFile(filePath, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in ${filePath}: ${err.message}`);
  }
}

async function tryStatMtime(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Findet das Verzeichnis eines Bundles. Sucht in DASHBOARDS_DIRS in der definierten
 * Reihenfolge (Custom zuerst) und gibt den ersten Treffer zurück (Override-Pattern).
 * Liefert null, wenn keine `manifest.json` gefunden wird.
 */
async function findBundleDir(id) {
  for (const base of DASHBOARDS_DIRS) {
    const candidate = path.join(base, id);
    try {
      const stat = await fs.stat(path.join(candidate, 'manifest.json'));
      if (stat.isFile()) return candidate;
    } catch {
      // weiterprobieren
    }
  }
  return null;
}

/**
 * Lädt ein einzelnes Bundle (manifest + layout). Validiert beides per Joi.
 * Bei Fehler: gibt null zurück und loggt — App soll nicht crashen.
 */
async function loadBundle(id) {
  const cacheKey = id;
  const dir = await findBundleDir(id);
  if (!dir) return null;
  const manifestPath = path.join(dir, 'manifest.json');
  const layoutPath = path.join(dir, 'layout.json');

  // mtime-Check für Cache-Invalidation
  const [manifestMtime, layoutMtime] = await Promise.all([
    tryStatMtime(manifestPath),
    tryStatMtime(layoutPath),
  ]);
  const combinedMtime = Math.max(manifestMtime, layoutMtime);

  if (environment.templates.cacheEnabled) {
    const cached = bundleCache.get(cacheKey);
    if (cached && cached.mtime === combinedMtime) {
      return cached;
    }
  }

  try {
    const [manifestRaw, layoutRaw] = await Promise.all([
      readJsonFile(manifestPath),
      readJsonFile(layoutPath).catch(err => {
        // Fehlendes layout.json ist tolerabel (z.B. wenn entry-Feld auf anderen Pfad zeigt)
        const entry = null;
        throw err;
      }),
    ]);

    // Manifest validieren
    const { error: manifestErr, value: manifest } = dashboardSchemas.manifest.validate(manifestRaw, {
      abortEarly: false,
      stripUnknown: false,
      convert: true,
    });
    if (manifestErr) {
      console.warn(`[dashboard:${id}] manifest.json invalid: ${manifestErr.message}`);
      return null;
    }

    // Layout validieren
    const { error: layoutErr, value: layout } = dashboardSchemas.layout.validate(layoutRaw, {
      abortEarly: false,
      stripUnknown: false,
      convert: true,
    });
    if (layoutErr) {
      console.warn(`[dashboard:${id}] layout.json invalid: ${layoutErr.message}`);
      return null;
    }

    // ID-Konsistenz: manifest.id muss Verzeichnisname entsprechen
    if (manifest.id !== id) {
      console.warn(`[dashboard:${id}] manifest.id="${manifest.id}" differs from directory name`);
      return null;
    }

    const bundle = {
      id,
      dir,
      manifest,
      layout,
      mtime: combinedMtime,
    };

    if (environment.templates.cacheEnabled) {
      bundleCache.set(cacheKey, bundle);
    }
    return bundle;
  } catch (err) {
    console.warn(`[dashboard:${id}] failed to load: ${err.message}`);
    return null;
  }
}

/**
 * Listet alle gefundenen Dashboard-Bundles aus allen DASHBOARDS_DIRS.
 * Custom-Verzeichnis hat Vorrang (gleicher Override wie loadBundle).
 * Fehlerhafte Bundles werden übersprungen.
 */
async function listBundles() {
  const seen = new Set();
  const dirs = [];

  for (const base of DASHBOARDS_DIRS) {
    let entries;
    try {
      entries = await fs.readdir(base, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      throw err;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      if (seen.has(e.name)) continue; // erste Quelle (Custom) gewinnt
      seen.add(e.name);
      dirs.push(e.name);
    }
  }

  const bundles = await Promise.all(dirs.map(loadBundle));
  return bundles.filter(b => b !== null);
}

/**
 * Holt ein Bundle anhand der ID. Wirft TEMPLATE_NOT_FOUND, wenn nicht vorhanden.
 */
async function getBundle(id) {
  // Pfad-Traversal verhindern
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw createError('VALIDATION_ERROR', `Invalid dashboard id: ${id}`);
  }
  const bundle = await loadBundle(id);
  if (!bundle) {
    throw createError('TEMPLATE_NOT_FOUND', `Dashboard '${id}' not found or invalid`, {
      dashboardId: id,
    });
  }
  return bundle;
}

// ---------------------------------------------------------------------------
// Dataset-Resolver: bundle: / custom: / report: / builtin:
// ---------------------------------------------------------------------------

function parseSourceUri(source) {
  const idx = source.indexOf(':');
  if (idx < 1) {
    throw new Error(`Invalid dataset source: ${source}`);
  }
  return {
    scheme: source.substring(0, idx),
    ref: source.substring(idx + 1),
  };
}

async function loadBundleSql(bundle, relPath) {
  // Absicherung gegen Traversal
  const normalized = path.normalize(relPath);
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
    throw new Error(`Invalid bundle SQL path: ${relPath}`);
  }
  const fullPath = path.join(bundle.dir, normalized);
  if (!fullPath.startsWith(bundle.dir + path.sep)) {
    throw new Error(`Bundle SQL path escapes bundle dir: ${relPath}`);
  }
  return fs.readFile(fullPath, 'utf-8');
}

// 1-Level BigInt-Konversion auf flachen Result-Rows. Timestamps/Date-Objekte aus
// DuckDB serialisiert Express selbst korrekt (toJSON → ISO), solange wir nicht
// rekursiv in jedes Objekt absteigen und dabei Object.entries() auf einem
// Date-Like-Objekt aufrufen (das liefert {} und zerstört den Wert).
function convertBigInts(value) {
  if (Array.isArray(value)) {
    return value.map(row => {
      if (row === null || typeof row !== 'object') return row;
      const out = {};
      for (const [k, v] of Object.entries(row)) {
        out[k] = typeof v === 'bigint' ? Number(v) : v;
      }
      return out;
    });
  }
  return typeof value === 'bigint' ? Number(value) : value;
}

async function runBundleQuery(bundle, relPath, params) {
  const sqlTemplate = await loadBundleSql(bundle, relPath);
  const sql = templateService.interpolateTemplate(sqlTemplate, params);
  const result = await db.executeQuery(sql);
  return {
    data: convertBigInts(result.rows),
    meta: { source: `bundle:${relPath}`, ...result.meta },
  };
}

async function runCustomTemplate(name, params) {
  const result = await templateService.executeTemplate(name, params, 'query');
  return { data: result.data, meta: { source: `custom:${name}`, ...result.meta } };
}

async function runReportTemplate(name, params) {
  const result = await templateService.executeTemplate(name, params, 'report');
  return { data: result.data, meta: { source: `report:${name}`, ...result.meta } };
}

// ---------------------------------------------------------------------------
// builtin: Datasets
// ---------------------------------------------------------------------------

async function builtinListCustomQueries(params = {}) {
  const templates = await templateService.listTemplates('query');
  const rows = templates.map(t => ({
    name: t.name,
    title: t.title || t.name,
    description: t.description || null,
    template_type: t.template_type,
    category: t.category || 'Allgemein',
    icon: t.icon || 'query',
    display: t.display || 'auto',
    click_action: t.click_action || null,
    click_args: t.click_args || null,
    tags: t.tags || [],
    params: Array.isArray(t.params) ? t.params.join(', ') : (t.params || ''),
  }));

  if (params.category) {
    return rows.filter(r => r.category === params.category);
  }
  // Sortierung: erst Kategorie, dann Titel
  rows.sort((a, b) => {
    const c = String(a.category).localeCompare(String(b.category), 'de');
    if (c !== 0) return c;
    return String(a.title).localeCompare(String(b.title), 'de');
  });
  return rows;
}

/**
 * builtin:query_meta — gibt eine einzelne Zeile mit Metadaten eines sql-custom-Templates
 * zurück. Benötigt Param `query`. Wird vom `_generic`-Bundle genutzt, um Titel,
 * Beschreibung und Klick-Action-Konfiguration an das Layout zu übergeben.
 */
async function builtinQueryMeta(params = {}) {
  const queryName = params.query;
  if (!queryName) {
    throw createError('VALIDATION_ERROR', 'builtin:query_meta requires param "query"');
  }
  // Wichtig: auch Bundle-eigene Templates aus dashboards*/<bundle>/queries/
  // auflösen — listTemplates('query') würde nur sql-custom/ scannen.
  const t = await templateService.getTemplateMeta(queryName, 'query');
  if (!t) {
    // Leere Zeile statt Fehler — Dashboard soll trotzdem rendern können
    return [{
      query: queryName,
      title: queryName,
      description: null,
      template_type: null,
      icon: null,
      category: null,
      display: 'auto',
      click_action: null,
      click_args: null,
    }];
  }
  return [{
    query: queryName,
    title: t.title || queryName,
    description: t.description || null,
    template_type: t.template_type || null,
    icon: t.icon || null,
    category: t.category || null,
    display: t.display || 'auto',
    click_action: t.click_action || null,
    click_args: t.click_args || null,
  }];
}

async function builtinListDashboards(params = {}) {
  const bundles = await listBundles();

  let excludeTags = [];
  if (params.excludeTags) {
    excludeTags = Array.isArray(params.excludeTags)
      ? params.excludeTags
      : String(params.excludeTags).split(',').map(s => s.trim()).filter(Boolean);
  }

  const rows = bundles
    .filter(b => {
      if (!excludeTags.length) return true;
      const tags = b.manifest.tags || [];
      return !tags.some(t => excludeTags.includes(t));
    })
    .map(b => ({
      id: b.manifest.id,
      title: b.manifest.title,
      description: b.manifest.description || null,
      icon: b.manifest.icon || null,
      tags: b.manifest.tags || [],
      category: b.manifest.category || null,
      author: b.manifest.author || null,
      version: b.manifest.version || null,
    }));

  rows.sort((a, b) => a.title.localeCompare(b.title, 'de'));
  return rows;
}

async function builtinFiles() {
  const sql = `
    SELECT
      File_Name,
      File_FullName,
      FileMaker_Version,
      Has_DDR_INFO,
      Import_Timestamp
    FROM FilesCatalog
    ORDER BY File_Name
  `;
  const result = await db.executeQuery(sql);
  return convertBigInts(result.rows);
}

/**
 * builtin:list_docs — listet alle installierten und sichtbaren Dokumentations-Bundles
 * aus dem v2-Manifest (`.fmlab/docs.json`). Backwards-compat alias zu
 * `docs_overview_installed`. Filtert auf catalog.visible == true UND installed.
 */
async function builtinListDocs() {
  const docsManifest = require('./docs-manifest');
  const rows = docsManifest.listVisibleInstalled();
  return rows.map(({ catalog, installed }) => {
    const langs = Array.isArray(installed?.languages) ? installed.languages : (catalog.languages || []);
    return {
      id: catalog.id,
      name: catalog.name || catalog.id,
      description: catalog.description || null,
      directory: installed?.directory || null,
      skill: catalog.skill || null,
      source_url: catalog.source_url || null,
      categories: installed?.stats?.categories ?? null,
      functions: installed?.stats?.functions ?? null,
      languages: langs,
      languages_count: langs.length,
      languages_display: langs.map(l => String(l).toUpperCase()).join(' · '),
      installed_at: installed?.installed_at || null,
      installed: true,
    };
  });
}

/**
 * builtin:docs_overview_installed — sichtbare, installierte Doc-Sets.
 * Identisch mit list_docs, aber semantisch klarer benannt für das neue
 * docs_overview-Dashboard.
 */
async function builtinDocsOverviewInstalled() {
  return builtinListDocs();
}

/**
 * builtin:docs_overview_available — sichtbare Doc-Sets aus dem Catalog,
 * die noch NICHT vollständig installiert sind. Für den "Verfügbar"-Block der
 * docs_overview-Sub-Dashboard mit Install-Button.
 *
 * Multi-Sprach-Sets bleiben hier solange sichtbar, wie noch nicht alle
 * Catalog-Sprachen installiert sind (siehe docs-manifest.listVisibleAvailable).
 * `installed_languages` listet die schon vorhandenen Sprachen, damit das
 * Frontend sie im Sprach-Picker als ausgegraut darstellen kann.
 */
async function builtinDocsOverviewAvailable() {
  const docsManifest = require('./docs-manifest');
  const rows = docsManifest.listVisibleAvailable();
  return rows.map(({ catalog, installed }) => {
    const langs = Array.isArray(catalog.languages) ? catalog.languages : [];
    const installedLangs = installed && Array.isArray(installed.languages)
      ? installed.languages
      : [];
    return {
      id: catalog.id,
      name: catalog.name || catalog.id,
      description: catalog.description || null,
      source_url: catalog.source_url || null,
      skill: catalog.skill || null,
      languages: langs,
      languages_count: langs.length,
      languages_display: langs.map(l => String(l).toUpperCase()).join(' · '),
      installed_languages: installedLangs,
      output_format: catalog.output_format || null,
      download_format: catalog.download_format || null,
      installed: installedLangs.length > 0, // true für Teil-Installs
    };
  });
}

/**
 * builtin:docset_info — single-row header for the docset detail dashboard.
 * Params: id (required), lang (optional).
 */
async function builtinDocsetInfo(params = {}) {
  const docsSource = require('./docs-source');
  const id = params.id;
  if (!id) throw createError('VALIDATION_ERROR', 'builtin:docset_info requires param "id"');
  const lang = params._lang || params.lang || 'en';
  const info = await docsSource.getDocsetInfo(id, lang);
  if (!info) return [];
  const langs = Array.isArray(info.languages) ? info.languages : [];
  return [{
    id: info.id,
    name: info.name || info.id,
    description: info.description || null,
    source_url: info.source_url || null,
    online_link_md: info.online_link_md || '',
    categories: typeof info.categories === 'number' ? info.categories : null,
    functions: typeof info.functions === 'number' ? info.functions : null,
    languages: langs,
    languages_count: langs.length,
    languages_display: langs.map(l => String(l).toUpperCase()).join(' · '),
  }];
}

/**
 * builtin:docset_categories — list of categories for a docset.
 * Params: id (required), lang (optional, default 'en').
 */
async function builtinDocsetCategories(params = {}) {
  const docsSource = require('./docs-source');
  const id = params.id;
  if (!id) throw createError('VALIDATION_ERROR', 'builtin:docset_categories requires param "id"');
  return docsSource.listDocsetCategories(id, params._lang || params.lang || 'en');
}

/**
 * builtin:docset_categories_with_counts — wie docset_categories, aber annotiert
 * jede Kategorie mit `code_ref_count` (Anzahl Code-Referenzen in der FM-Solution).
 * Bei references: false liefert das Set null pro Eintrag (keine Pill).
 */
async function builtinDocsetCategoriesWithCounts(params = {}) {
  const docsSource = require('./docs-source');
  const docsReferences = require('./docs-references');
  const id = params.id;
  if (!id) throw createError('VALIDATION_ERROR', 'builtin:docset_categories_with_counts requires param "id"');
  const lang = params._lang || params.lang || 'en';
  const cats = await docsSource.listDocsetCategories(id, lang);
  return docsReferences.annotateCategoriesWithCounts(id, cats);
}

/**
 * builtin:docset_category_info — single-row header for the category dashboard.
 * Params: docset (required), category (required), lang (optional).
 */
async function builtinDocsetCategoryInfo(params = {}) {
  const docsSource = require('./docs-source');
  const docset = params.docset;
  const category = params.category;
  if (!docset || !category) {
    throw createError('VALIDATION_ERROR', 'builtin:docset_category_info requires params "docset" and "category"');
  }
  const info = await docsSource.getDocsetCategoryInfo(docset, category, params._lang || params.lang || 'en');
  if (!info) return [];
  return [{
    docset,
    id: info.id,
    name: info.name,
    slug: info.slug,
    kind: info.kind || null,
    description: info.description || null,
    source_url: info.source_url || null,
    online_url: info.online_url || null,
    online_link_md: info.online_link_md || '',
    function_count: typeof info.function_count === 'number' ? info.function_count : null,
  }];
}

/**
 * builtin:docset_functions — list of functions/script-steps in a category.
 * Params: docset (required), category (required), lang (optional).
 */
async function builtinDocsetFunctions(params = {}) {
  const docsSource = require('./docs-source');
  const docset = params.docset;
  const category = params.category;
  if (!docset || !category) {
    throw createError('VALIDATION_ERROR', 'builtin:docset_functions requires params "docset" and "category"');
  }
  return docsSource.listDocsetFunctions(docset, category, params._lang || params.lang || 'en');
}

/**
 * builtin:docset_functions_with_counts — wie docset_functions, aber annotiert
 * jede Funktion mit `code_ref_count`. Bei references: false → null.
 */
async function builtinDocsetFunctionsWithCounts(params = {}) {
  const docsSource = require('./docs-source');
  const docsReferences = require('./docs-references');
  const docset = params.docset;
  const category = params.category;
  if (!docset || !category) {
    throw createError('VALIDATION_ERROR', 'builtin:docset_functions_with_counts requires params "docset" and "category"');
  }
  const lang = params._lang || params.lang || 'en';
  const fns = await docsSource.listDocsetFunctions(docset, category, lang);
  return docsReferences.annotateFunctionsWithCounts(docset, fns);
}

const BUILTIN_RESOLVERS = {
  list_custom_queries: builtinListCustomQueries,
  list_dashboards: builtinListDashboards,
  list_docs: builtinListDocs,
  docs_overview_installed: builtinDocsOverviewInstalled,
  docs_overview_available: builtinDocsOverviewAvailable,
  files: builtinFiles,
  query_meta: builtinQueryMeta,
  docset_info: builtinDocsetInfo,
  docset_categories: builtinDocsetCategories,
  docset_categories_with_counts: builtinDocsetCategoriesWithCounts,
  docset_category_info: builtinDocsetCategoryInfo,
  docset_functions: builtinDocsetFunctions,
  docset_functions_with_counts: builtinDocsetFunctionsWithCounts,
};

async function runBuiltin(key, params) {
  const resolver = BUILTIN_RESOLVERS[key];
  if (!resolver) {
    throw createError('VALIDATION_ERROR', `Unknown builtin dataset: ${key}`, { key });
  }
  const data = await resolver(params);
  return { data: convertBigInts(data), meta: { source: `builtin:${key}` } };
}

// ---------------------------------------------------------------------------
// Dataset-Ausführung mit Parameter-Merging
// ---------------------------------------------------------------------------

/**
 * Führt ein einzelnes Dataset aus.
 * - manifest.datasets[].params definieren Defaults pro Dataset
 * - requestParams (dashboard-weite Params aus der HTTP-Query) überschreiben
 */
async function executeDataset(bundle, datasetSpec, requestParams = {}) {
  const params = { ...(datasetSpec.params || {}), ...requestParams };
  // Token-Substitution in der Source-URI: erlaubt z.B. "custom:{{query}}" im Manifest,
  // damit das `_generic`-Bundle das eigentliche Template per Param wählt.
  const resolvedSource = String(datasetSpec.source).replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, key) => {
    return params[key] != null ? String(params[key]) : '';
  });
  const { scheme, ref } = parseSourceUri(resolvedSource);
  if (!ref || ref === '{{}}' || ref.trim() === '') {
    throw createError('VALIDATION_ERROR', `Dataset source '${datasetSpec.source}' has empty reference after substitution`);
  }

  switch (scheme) {
    case 'bundle':
      return runBundleQuery(bundle, ref, params);
    case 'custom':
      return runCustomTemplate(ref, params);
    case 'report':
      return runReportTemplate(ref, params);
    case 'builtin':
      return runBuiltin(ref, params);
    default:
      throw createError('VALIDATION_ERROR', `Unknown dataset scheme: ${scheme}`);
  }
}

/**
 * Führt alle Datasets eines Bundles parallel aus. Einzel-Fehler werden pro Dataset gekapselt.
 */
async function executeAllDatasets(bundle, requestParams = {}) {
  const specs = bundle.manifest.datasets || [];
  const results = await Promise.all(
    specs.map(async spec => {
      try {
        const { data, meta } = await executeDataset(bundle, spec, requestParams);
        return { id: spec.id, data, meta, error: null };
      } catch (err) {
        console.warn(`[dashboard:${bundle.id}] dataset '${spec.id}' failed: ${err.message}`);
        return { id: spec.id, data: [], meta: { source: spec.source }, error: err.message };
      }
    })
  );

  const datasets = {};
  for (const r of results) {
    datasets[r.id] = {
      data: r.data,
      meta: r.meta,
      ...(r.error ? { error: r.error } : {}),
    };
  }
  return datasets;
}

/**
 * Führt ein einzelnes Dataset aus (für Lazy-Reload).
 */
async function executeSingleDataset(bundle, datasetId, requestParams = {}) {
  const spec = (bundle.manifest.datasets || []).find(d => d.id === datasetId);
  if (!spec) {
    throw createError('TEMPLATE_NOT_FOUND', `Dataset '${datasetId}' not found in dashboard '${bundle.id}'`, {
      bundleId: bundle.id,
      datasetId,
    });
  }
  return executeDataset(bundle, spec, requestParams);
}

module.exports = {
  DASHBOARDS_DIRS,
  listBundles,
  getBundle,
  executeAllDatasets,
  executeSingleDataset,
  clearCache,
};
