const fs = require('fs');

/**
 * Storage-Versions-Diagnose (gemischte DuckDB-Versionen)
 * ──────────────────────────────────────────────────────
 * Die REST-API liest die Kataloge über ihre EIGENE, in `@duckdb/node-api`
 * gebündelte DuckDB — unabhängig von der DuckDB-CLI, mit der der Converter die
 * Datei geschrieben hat. Das Storage-Format ist nur rückwärts lesbar: eine von
 * einer neueren CLI angelegte Datei (z. B. DuckDB 2.0 → Storage-Version 69)
 * kann eine ältere Bindung (1.5.x liest 64–68, 2.0 liest 64–69) nicht öffnen.
 * DuckDB quittiert das beim Öffnen mit „Trying to read a database file with
 * [storage] version number …", was bisher als roher IO-Fehler bzw. als
 * Startabbruch der API endete.
 *
 * Der Klassifikator veredelt genau diesen Fehler zu STORAGE_VERSION_MISMATCH:
 * Storage-Version und Schreiber-Version stammen aus dem Datei-Header, der
 * lesbare Bereich aus der DuckDB-Meldung, die Bindungs-Version aus der Node-API.
 * Die Meldung trägt das stabile, englische Präfix `STORAGE_VERSION:` (gleicher
 * Kontrakt wie SCHEMA_DRIFT), damit das Frontend sie sprachunabhängig erkennt.
 */

// DuckDB emittiert die Meldung locale-unabhängig auf Englisch. Formen:
//   1.x: „… with version number 69, but we can only read versions between 64 and 68."
//   2.0: „… with storage version number 70, but we can only read storage versions between 64 and 69."
//   alt: „… with version number 39, but we can only read version 64."
const STORAGE_MISMATCH_RE =
  /Trying to read a database file with (?:storage )?version number (\d+), but we can only read (?:storage )?versions? (?:between (\d+) and (\d+)|(\d+))/i;

// Layout des Haupt-Headers (Block 0): 8 Byte Prüfsumme, 4 Byte Magic „DUCK",
// 8 Byte Storage-Version (LE), 4 × 8 Byte Flags, 32 Byte Schreiber-Version
// (z. B. „v1.5.6", NUL-terminiert).
const MAGIC_OFFSET = 8;
const VERSION_OFFSET = 12;
const CREATOR_OFFSET = 52;
const CREATOR_LENGTH = 32;

// Ab DuckDB 2.0 trägt der Haupt-Header bei neuen Formaten (≥ 69) den Platzhalter
// 999; die echte Storage-Version steht dann im aktiven der beiden Datenbank-Header
// (Block 1 bei 4096, Block 2 bei 8192; aktiv = höhere Iteration bei +8) im Feld
// +56. DuckDB 1.5 und 2.0 lesen sie dort ebenso. Bei Dateien mit echter Version
// im Haupt-Header bedeutet dasselbe Feld etwas anderes (Serialisierungsstufe) —
// es wird nur hinter dem Platzhalter ausgewertet.
const EXTENDED_VERSION_MARKER = 999;
const DB_HEADER_OFFSETS = [4096, 8192];
const DB_HEADER_ITERATION = 8;
const DB_HEADER_STORAGE_VERSION = 56;
const HEADER_BYTES = DB_HEADER_OFFSETS[1] + DB_HEADER_STORAGE_VERSION + 8;

/**
 * Storage-Version hinter dem 999-Platzhalter: Feld +56 des aktiven
 * Datenbank-Headers. null, wenn die Datei zu kurz ist.
 */
function readExtendedStorageVersion(buf, read) {
  let best = null;
  for (const base of DB_HEADER_OFFSETS) {
    if (read < base + DB_HEADER_STORAGE_VERSION + 8) continue;
    const iteration = buf.readBigUInt64LE(base + DB_HEADER_ITERATION);
    if (!best || iteration > best.iteration) {
      best = { iteration, version: Number(buf.readBigUInt64LE(base + DB_HEADER_STORAGE_VERSION)) };
    }
  }
  return best ? best.version : null;
}

/**
 * Storage-Version und Schreiber-Version aus dem Datei-Header lesen. Den
 * 999-Platzhalter neuer Formate (DuckDB 2.0+) löst die Funktion auf die echte
 * Version aus dem Datenbank-Header auf.
 * Nie werfen: fehlende/fremde Datei → null.
 *
 * @param {string} dbPath
 * @returns {{ storageVersion: number|null, createdBy: string|null }|null}
 */
function readStorageHeader(dbPath) {
  let fd = null;
  try {
    fd = fs.openSync(dbPath, 'r');
    const buf = Buffer.alloc(HEADER_BYTES);
    const read = fs.readSync(fd, buf, 0, HEADER_BYTES, 0);
    if (read < CREATOR_OFFSET + CREATOR_LENGTH) return null;
    if (buf.toString('latin1', MAGIC_OFFSET, MAGIC_OFFSET + 4) !== 'DUCK') return null;
    let storageVersion = Number(buf.readBigUInt64LE(VERSION_OFFSET));
    if (storageVersion === EXTENDED_VERSION_MARKER) {
      storageVersion = readExtendedStorageVersion(buf, read);
    }
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
