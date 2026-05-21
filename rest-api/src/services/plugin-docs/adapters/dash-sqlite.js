const fs = require('fs');
const path = require('path');
const settingsStore = require('../../../plugins/settings-store');
const mbsSource = require('../mbs-source');

/**
 * dash-sqlite Adapter — IDocSetIndex implementation
 *
 * Liest aus der Dash-DocSet-Konvention (SQLite-Tabelle `searchIndex` mit
 * `name`, `type`, `path`). Wird heute von MBS verwendet (`docs/mbs/docSet.dsidx`).
 *
 * Delegiert die Detail-Funktionen an den bestehenden `mbs-source.js`, der
 * bereits einen LRU-Cache, HTML-Extraktion und Index-Schema-Kenntnis hat.
 * Für andere Dash-DocSets (z.B. zukünftige 360Works-Plugins) kann derselbe
 * Adapter wiederverwendet werden, sobald die Path-Resolution generalisiert ist.
 */

function repoRoot() {
  return settingsStore.resolveRepoRoot();
}

function docsetDir({ installedEntry }) {
  if (!installedEntry?.directory) return null;
  return path.resolve(repoRoot(), installedEntry.directory);
}

function indexFile({ catalogEntry, installedEntry }) {
  const dir = docsetDir({ installedEntry });
  if (!dir) return null;
  const rel = catalogEntry?.index?.path || 'docSet.dsidx';
  return path.join(dir, rel);
}

async function listCategories({ catalogEntry, installedEntry } = {}) {
  // Heute nur für mbs verdrahtet — die Path-Resolution im mbs-source ist
  // konfigurationsbasiert. Solange wir nur ein dash-sqlite-Set haben (mbs),
  // ist Delegation der pragmatischste Weg.
  if (catalogEntry?.id !== 'mbs') return [];
  if (!mbsSource.isAvailable()) return [];
  const rows = mbsSource.listCategories({ withFunctionCounts: true });
  return rows.map(r => ({
    id: r.name,
    name: r.name,
    slug: r.name,
    function_count: r.functionCount || 0,
  }));
}

async function listFunctions({ catalogEntry, installedEntry, categoryId } = {}) {
  if (catalogEntry?.id !== 'mbs') return [];
  if (!mbsSource.isAvailable()) return [];
  const { results } = mbsSource.listFunctionsInCategory(categoryId, { limit: 1000 });
  return results.map(r => ({
    id: r.name,
    name: r.name,
    canonical: `MBS::${r.name}`,
    path: r.path,
  }));
}

async function getEntry({ catalogEntry, installedEntry, functionId } = {}) {
  if (catalogEntry?.id !== 'mbs') return null;
  if (!mbsSource.isAvailable()) return null;
  let doc;
  try {
    doc = mbsSource.getFunctionDoc(functionId);
  } catch (err) {
    if (err.code === 'PLUGIN_FUNCTION_NOT_FOUND') return null;
    throw err;
  }
  return {
    id: functionId,
    title: functionId,
    content_html: doc.long?.content || doc.short?.content || '',
    metadata: doc.metadata || {},
    online_url: doc.metadata?.url || null,
    format: 'html',
  };
}

async function search({ catalogEntry, q, limit = 50 } = {}) {
  if (catalogEntry?.id !== 'mbs') return { categories: [], functions: [] };
  if (!mbsSource.isAvailable()) return { categories: [], functions: [] };
  const { results } = mbsSource.searchFunctions(q, { limit });
  const functions = results.map(r => ({ id: r.name, name: r.name, match: r.match }));

  // Kategorien-Suche per LIKE — der mbs-source bietet das nicht selbst.
  const allCats = mbsSource.listCategories({ withFunctionCounts: false });
  const ql = String(q || '').toLowerCase();
  const categories = allCats
    .filter(c => c.name.toLowerCase().includes(ql))
    .map(c => ({ id: c.name, name: c.name }));

  return { categories, functions };
}

async function listLanguages({ installedEntry } = {}) {
  return Array.isArray(installedEntry?.languages) ? installedEntry.languages : ['en'];
}

async function validate({ catalogEntry, installedEntry } = {}) {
  const errors = [];
  const idx = indexFile({ catalogEntry, installedEntry });
  if (!idx) {
    errors.push('No installed directory configured.');
    return { ok: false, errors };
  }
  if (!fs.existsSync(idx)) {
    errors.push(`Index file missing: ${idx}`);
    return { ok: false, errors };
  }
  return { ok: true, errors: [] };
}

module.exports = {
  listCategories,
  listFunctions,
  getEntry,
  search,
  listLanguages,
  validate,
};
