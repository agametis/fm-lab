const fs = require('fs');

/**
 * Storage-Versions-Diagnose (gemischte DuckDB-Versionen)
 * ──────────────────────────────────────────────────────
 * Die REST-API liest die Kataloge über ihre EIGENE, in `@duckdb/node-api`
 * gebündelte DuckDB — unabhängig von der DuckDB-CLI, mit der der Converter die
 * Datei geschrieben hat. Das Storage-Format ist nur rückwärts lesbar: eine von
 * einer neueren CLI angelegte Datei (z. B. DuckDB 2.0 → Storage-Version 69)
 * kann eine ältere Bindung (1.5.x liest 64–68) nicht öffnen. DuckDB quittiert
 * das beim Öffnen mit „Trying to read a database file with version number …",
 * was bisher als roher IO-Fehler bzw. als Startabbruch der API endete.
 *
 * Der Klassifikator veredelt genau diesen Fehler zu STORAGE_VERSION_MISMATCH:
 * Storage-Version und Schreiber-Version stammen aus dem Datei-Header, der
 * lesbare Bereich aus der DuckDB-Meldung, die Bindungs-Version aus der Node-API.
 * Die Meldung trägt das stabile, englische Präfix `STORAGE_VERSION:` (gleicher
 * Kontrakt wie SCHEMA_DRIFT), damit das Frontend sie sprachunabhängig erkennt.
 */

// DuckDB emittiert die Meldung locale-unabhängig auf Englisch. Zwei Formen:
//   „… with version number 69, but we can only read versions between 64 and 68."
//   „… with version number 39, but we can only read version 64."   (ältere Builds)
const STORAGE_MISMATCH_RE =
  /Trying to read a database file with version number (\d+), but we can only read versions? (?:between (\d+) and (\d+)|(\d+))/i;

// Layout des Haupt-Headers (Block 0): 8 Byte Prüfsumme, 4 Byte Magic „DUCK",
// 8 Byte Storage-Version (LE), 4 × 8 Byte Flags, 32 Byte Schreiber-Version
// (z. B. „v1.5.6", NUL-terminiert).
const MAGIC_OFFSET = 8;
const VERSION_OFFSET = 12;
const CREATOR_OFFSET = 52;
const CREATOR_LENGTH = 32;
const HEADER_BYTES = CREATOR_OFFSET + CREATOR_LENGTH;

/**
 * Storage-Version und Schreiber-Version aus dem Datei-Header lesen.
 * Nie werfen: fehlende/fremde Datei → null.
 *
 * @param {string} dbPath
 * @returns {{ storageVersion: number, createdBy: string|null }|null}
 */
function readStorageHeader(dbPath) {
  let fd = null;
  try {
    fd = fs.openSync(dbPath, 'r');
    const buf = Buffer.alloc(HEADER_BYTES);
    const read = fs.readSync(fd, buf, 0, HEADER_BYTES, 0);
    if (read < HEADER_BYTES) return null;
    if (buf.toString('latin1', MAGIC_OFFSET, MAGIC_OFFSET + 4) !== 'DUCK') return null;
    const storageVersion = Number(buf.readBigUInt64LE(VERSION_OFFSET));
    const raw = buf.toString('latin1', CREATOR_OFFSET, CREATOR_OFFSET + CREATOR_LENGTH);
    const createdBy = raw.split('\0')[0].trim();
    return {
      storageVersion,
      // Nur druckbare Versionskennungen übernehmen — alte Header lassen das Feld leer.
      createdBy: /^[\x20-\x7e]+$/.test(createdBy) ? createdBy : null,
    };
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* schon zu */ }
    }
  }
}

/** DuckDB-Version der gebündelten Node-Bindung, z. B. „v1.5.6". */
function apiDuckdbVersion() {
  try {
    return require('@duckdb/node-api').version();
  } catch {
    return null;
  }
}

/** Versionslinie Major.Minor, z. B. „v1.5.6" → „1.5"; null, wenn nicht lesbar. */
function duckdbLine(version) {
  const m = /(\d+)\.(\d+)/.exec(version || '');
  return m ? `${m[1]}.${m[2]}` : null;
}

/**
 * Prüft einen Fehler beim Öffnen einer Katalog-DB auf Storage-Versions-Mismatch.
 *
 * @param {Error}  err - der von DuckDBInstance.create geworfene Fehler
 * @param {Object} ctx - { solution, dbPath }
 * @returns {Error|null} - ein STORAGE_VERSION_MISMATCH-Fehler (mit .code/.details),
 *                         sonst null (Aufrufer wirft den Originalfehler weiter).
 */
function classifyStorageVersion(err, { solution = null, dbPath = null } = {}) {
  const message = err && err.message;
  if (!message) return null;
  const m = message.match(STORAGE_MISMATCH_RE);
  if (!m) return null;

  const fileVersion = Number(m[1]);
  const readableMin = Number(m[2] || m[4]);
  const readableMax = Number(m[3] || m[4]);
  const direction = fileVersion > readableMax ? 'newer' : 'older';
  const header = dbPath ? readStorageHeader(dbPath) : null;
  const createdBy = header && header.createdBy;
  const apiVersion = apiDuckdbVersion();
  const range = readableMin === readableMax ? `${readableMin}` : `${readableMin}-${readableMax}`;

  // Nur Schritte, die der Anwender selbst ausführen kann — die Bindung der
  // REST-API kommt mit dem fm-lab-Release, nie per Handeingriff in rest-api/.
  const apiLine = duckdbLine(apiVersion);
  const fileLine = duckdbLine(createdBy);
  const fix = direction === 'newer'
    ? `Re-import the XML with DuckDB CLI ${apiLine ? `${apiLine}.x` : 'in the version'} supported by this fm-lab release, ` +
      `or update fm-lab to a release that supports DuckDB ${fileLine || 'of the CLI'}.`
    : 'Re-import the XML with the current DuckDB CLI.';

  const mismatch = new Error(
    `STORAGE_VERSION: the catalog of solution "${solution || 'unknown'}" uses DuckDB storage version ` +
    `${fileVersion}${createdBy ? ` (written by DuckDB ${createdBy})` : ''}, but this REST API runs DuckDB ` +
    `${apiVersion || 'unknown'}, which reads storage versions ${range}. ${fix}`
  );
  mismatch.code = 'STORAGE_VERSION_MISMATCH';
  mismatch.details = {
    solution,
    db_path: dbPath,
    direction,
    file_storage_version: fileVersion,
    file_created_by: createdBy || null,
    api_duckdb_version: apiVersion,
    readable_min: readableMin,
    readable_max: readableMax,
  };
  return mismatch;
}

module.exports = {
  classifyStorageVersion,
  readStorageHeader,
  apiDuckdbVersion,
};
