const dashSqlite = require('./dash-sqlite');
const clarisDuckdb = require('./claris-duckdb');
const markdownFs = require('./markdown-fs');

/**
 * Adapter-Registry für Doc-Set-Indizes (IDocSetIndex).
 *
 * Jeder Adapter implementiert dieselbe Schnittstelle:
 *
 *   listCategories(ctx, { lang })               → Category[]
 *   listFunctions(ctx, { categoryId, lang })    → FunctionRef[]
 *   getEntry(ctx, { functionId, lang })         → DocEntry
 *   search(ctx, { q, lang })                    → { categories, functions }
 *   listLanguages()                             → string[]
 *   validate(ctx)                               → { ok, errors }
 *
 * Optional, deklariert über `capabilities.entrySearch`:
 *
 *   searchEntriesByCategory(ctx, { q, lang, sample })
 *                                               → [{ category_id, hit_count, sample }]
 *
 * `capabilities` ist ein einfaches Flag-Objekt am Adapter-Modul. Fehlt es,
 * gilt alles als nicht unterstützt.
 *
 * Adapter werden über das Manifest (`catalog[].index.adapter`) ausgewählt;
 * mehrere Doc-Sets können denselben Adapter teilen (z.B. fmide + fm-lab → markdown-fs).
 */

const ADAPTERS = {
  'dash-sqlite': dashSqlite,
  'claris-duckdb': clarisDuckdb,
  'markdown-fs': markdownFs,
};

/**
 * Gibt einen Adapter anhand der ID (aus catalog[].index.adapter) zurück.
 * Liefert `null`, wenn die ID unbekannt ist oder explizit `null` ist.
 */
function getAdapter(adapterId) {
  if (!adapterId) return null;
  return ADAPTERS[adapterId] || null;
}

/**
 * Resolved den passenden Adapter für ein Doc-Set anhand seines Catalog-Eintrags.
 * Bindet automatisch den Catalog/Installed-Kontext, damit der Adapter den
 * Verzeichnispfad kennt.
 */
function resolveForDocset(catalogEntry, installedEntry) {
  const adapterId = catalogEntry?.index?.adapter;
  const adapter = getAdapter(adapterId);
  if (!adapter) return null;
  return {
    id: adapterId,
    raw: adapter,
    capabilities: adapter.capabilities || {},
    // Optionale Fähigkeit — Adapter ohne Eintragsebene (markdown-fs) liefern
    // hier null statt einer Funktion, die leere Listen vortäuscht.
    searchEntriesByCategory: typeof adapter.searchEntriesByCategory === 'function'
      ? (ctx, opts = {}) => adapter.searchEntriesByCategory(ctx, { catalogEntry, installedEntry, ...opts })
      : null,
    listCategories: (ctx, opts = {}) => adapter.listCategories(ctx, { catalogEntry, installedEntry, ...opts }),
    listFunctions: (ctx, opts = {}) => adapter.listFunctions(ctx, { catalogEntry, installedEntry, ...opts }),
    getEntry: (ctx, opts = {}) => adapter.getEntry(ctx, { catalogEntry, installedEntry, ...opts }),
    search: (ctx, opts = {}) => adapter.search(ctx, { catalogEntry, installedEntry, ...opts }),
    listLanguages: () => adapter.listLanguages({ catalogEntry, installedEntry }),
    validate: (ctx) => adapter.validate(ctx, { catalogEntry, installedEntry }),
  };
}

module.exports = {
  ADAPTERS,
  getAdapter,
  resolveForDocset,
};
