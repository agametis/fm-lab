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
  return {
    $schema_version: CURRENT_SCHEMA_VERSION,
    catalog: (Array.isArray(raw.catalog) ? raw.catalog : []).map(applyCatalogDefaults),
    installed: Array.isArray(raw.installed) ? raw.installed : [],
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
  const installedIds = new Set(manifest.installed.map(i => i.id));
  return manifest.catalog
    .filter(c => c.visible && !installedIds.has(c.id))
    .map(c => ({ catalog: c }));
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
