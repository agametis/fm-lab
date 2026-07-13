const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const settingsStore = require('../plugins/settings-store');

/**
 * Docs-Manifest-Helper
 *
 * Liest und schreibt `.fmlab/docs.json` (v2-Schema, siehe
 * project/prd_docs_redesign.md §4 und project/schemas/docs.schema.json):
 *
 *   - `catalog[]`   — vom Maintainer gepflegt, alle bekannten Doc-Sets
 *   - `installed[]` — vom Installer gepflegt, was wirklich unter docs/ liegt
 *
 * Defaulting: Catalog-Einträge ohne `visible` / `references` werden auf
 * `true` gesetzt, fehlende `index`-Blöcke auf `{ type: 'none', ... }`. Das
 * macht das Manifest tolerant gegenüber manuellen Ergänzungen.
 */

const CURRENT_SCHEMA_VERSION = 2;

function manifestPath() {
  const repoRoot = settingsStore.resolveRepoRoot();
  return path.join(repoRoot, '.fmlab', 'docs.json');
}

// Runtime install-state overlay. Split out of docs.json so the maintainer-curated
// catalog[] can ship as a tracked file while installed[] — mutated on every install —
// stays gitignored and never causes a `git pull` conflict. Written by
// tools/register_docs.py; read here and merged over docs.json.
function installedOverlayPath() {
  const repoRoot = settingsStore.resolveRepoRoot();
  return path.join(repoRoot, '.fmlab', 'docs.installed.json');
}

// Installed[] from the overlay, or null if the overlay is absent (→ caller falls back
// to a legacy single-file docs.json that still carries installed[]).
function readInstalledOverlay() {
  const file = installedOverlayPath();
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return Array.isArray(raw.installed) ? raw.installed : [];
  } catch (err) {
    console.warn(`[docs-manifest] failed to read ${file}: ${err.message}`);
    return [];
  }
}

function applyCatalogDefaults(entry) {
  const out = { ...entry };
  if (out.visible === undefined) out.visible = true;
  if (out.references === undefined) out.references = true;
  if (!out.index || typeof out.index !== 'object') {
    out.index = { type: 'none', source: 'none', path: null, adapter: null };
  } else {
    out.index = {
      type: out.index.type || 'none',
      source: out.index.source || 'none',
      path: out.index.path ?? null,
      adapter: out.index.adapter ?? null,
    };
  }
  if (!Array.isArray(out.languages)) out.languages = [];
  return out;
}

function readManifestSync() {
  const file = manifestPath();
  if (!fs.existsSync(file)) {
    return { $schema_version: CURRENT_SCHEMA_VERSION, catalog: [], installed: [] };
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    console.warn(`[docs-manifest] failed to read ${file}: ${err.message}`);
    return { $schema_version: CURRENT_SCHEMA_VERSION, catalog: [], installed: [] };
  }
  // installed[] = baseline from docs.json (pre-installed skill-less sets shipped with the
  // repo, e.g. fm-lab) MERGED with the runtime overlay (sets the user installed via
  // install-*-docs). The overlay wins on id collisions. When no overlay exists yet the
  // baseline stands alone — this is also the backward-compatible path for a legacy
  // single-file manifest whose installed[] carried everything.
  const base = Array.isArray(raw.installed) ? raw.installed : [];
  const overlay = readInstalledOverlay(); // array or null
  let installed;
  if (overlay === null) {
    installed = base;
  } else {
    const overlayIds = new Set(overlay.map(e => e && e.id));
    installed = [...base.filter(e => e && !overlayIds.has(e.id)), ...overlay];
  }
  return {
    $schema_version: CURRENT_SCHEMA_VERSION,
    catalog: (Array.isArray(raw.catalog) ? raw.catalog : []).map(applyCatalogDefaults),
    installed,
  };
}

async function readManifest() {
  return readManifestSync();
}

async function writeManifest(manifest) {
  const file = manifestPath();
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const data = JSON.stringify(manifest, null, 2) + '\n';
  await fsp.writeFile(tmp, data, 'utf-8');
  await fsp.rename(tmp, file);
}

function getCatalogEntry(id) {
  return readManifestSync().catalog.find(c => c.id === id) || null;
}

function getInstalledEntry(id) {
  return readManifestSync().installed.find(i => i.id === id) || null;
}

function isInstalled(id) {
  return getInstalledEntry(id) !== null;
}

function listVisibleInstalled() {
  const manifest = readManifestSync();
  const installedIds = new Set(manifest.installed.map(i => i.id));
  return manifest.catalog
    .filter(c => c.visible && installedIds.has(c.id))
    .map(c => ({ catalog: c, installed: manifest.installed.find(i => i.id === c.id) }));
}

function listVisibleAvailable() {
  const manifest = readManifestSync();
  const installedById = new Map(manifest.installed.map(i => [i.id, i]));
  return manifest.catalog
    .filter(c => {
      if (!c.visible) return false;
      const inst = installedById.get(c.id);
      if (!inst) return true; // not installed at all → show
      // Multi-language doc-sets stay in "Available" as long as at least one
      // catalog language is not yet installed. This lets the user pick the
      // missing languages without losing access to the install UI after the
      // first language was installed (e.g. claris-help with only EN so far).
      const catalogLangs = Array.isArray(c.languages) ? c.languages : [];
      if (catalogLangs.length <= 1) return false;
      const installedLangs = new Set(Array.isArray(inst.languages) ? inst.languages : []);
      return catalogLangs.some(l => !installedLangs.has(l));
    })
    .map(c => {
      const inst = installedById.get(c.id);
      return {
        catalog: c,
        installed: inst || null,
      };
    });
}

module.exports = {
  CURRENT_SCHEMA_VERSION,
  manifestPath,
  readManifest,
  readManifestSync,
  writeManifest,
  getCatalogEntry,
  getInstalledEntry,
  isInstalled,
  listVisibleInstalled,
  listVisibleAvailable,
  applyCatalogDefaults,
};
