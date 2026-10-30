const fs = require('fs');
const path = require('path');

/**
 * Speicherformat für DuckDB-Dateien, die die REST-API NEU anlegt
 * ───────────────────────────────────────────────────────────────
 * Betroffen sind die Sidecar-DB `fm_annotations.duckdb` und der leere
 * Platzhalter-Katalog. Ohne Vorgabe schreibt eine Bindung 2.0 Storage 69, das
 * keine DuckDB-CLI 1.x öffnen kann — die Sidecar-DB liest aber auch die CLI
 * (`cluster_state.sh`). Die Vorgabe wirkt nur als Option von
 * `DuckDBInstance.create`; ein SET in der laufenden Sitzung käme für die beim
 * Öffnen angelegte Datei zu spät. Bestehende Dateien behalten ihr Format.
 *
 * Quelle (gemeinsam mit den Shell-Tools, dort `fmlab_duckdb_storage_version`
 * in tools/lib/duckdb_binding.sh): Umgebungsvariable
 * FMLAB_DUCKDB_STORAGE_VERSION, sonst ingestion/version_check.json →
 * tested_baseline.storage_compatibility_version, sonst v1.0.0 (Storage 64,
 * lesbar ab DuckDB 1.0).
 */

const VERSION_CHECK_PATH = path.resolve(__dirname, '../../../ingestion/version_check.json');
const FALLBACK = 'v1.0.0';

function readStorageCompatibilityVersion() {
  const fromEnv = String(process.env.FMLAB_DUCKDB_STORAGE_VERSION || '').trim();
  if (fromEnv) return fromEnv;
  try {
    const manifest = JSON.parse(fs.readFileSync(VERSION_CHECK_PATH, 'utf-8'));
    return manifest?.tested_baseline?.storage_compatibility_version || FALLBACK;
  } catch {
    return FALLBACK;
  }
}

const STORAGE_COMPATIBILITY_VERSION = readStorageCompatibilityVersion();

/** Optionen für DuckDBInstance.create, wenn die Datei neu entstehen kann. */
function storageOptions() {
  return { storage_compatibility_version: STORAGE_COMPATIBILITY_VERSION };
}

module.exports = {
  STORAGE_COMPATIBILITY_VERSION,
  readStorageCompatibilityVersion,
  storageOptions,
};
