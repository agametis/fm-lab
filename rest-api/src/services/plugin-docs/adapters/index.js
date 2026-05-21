const dashSqlite = require('./dash-sqlite');
const clarisDuckdb = require('./claris-duckdb');
const markdownFs = require('./markdown-fs');

/**
 * Adapter-Registry für Doc-Set-Indizes (IDocSetIndex).
 *
 * Jeder Adapter implementiert dieselbe Schnittstelle (siehe project/prd_docs_redesign.md §7.5):
 *
 *   listCategories({ lang })                    → Category[]
 *   listFunctions({ categoryId, lang })         → FunctionRef[]
 *   getEntry({ functionId, lang })              → DocEntry
 *   search({ q, lang })                         → { categories, functions }
 *   listLanguages()                             → string[]
 *   validate()                                  → { ok, errors }
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
    listCategories: (opts = {}) => adapter.listCategories({ catalogEntry, installedEntry, ...opts }),
    listFunctions: (opts = {}) => adapter.listFunctions({ catalogEntry, installedEntry, ...opts }),
    getEntry: (opts = {}) => adapter.getEntry({ catalogEntry, installedEntry, ...opts }),
    search: (opts = {}) => adapter.search({ catalogEntry, installedEntry, ...opts }),
    listLanguages: () => adapter.listLanguages({ catalogEntry, installedEntry }),
    validate: () => adapter.validate({ catalogEntry, installedEntry }),
  };
}

module.exports = {
  ADAPTERS,
  getAdapter,
  resolveForDocset,
};
