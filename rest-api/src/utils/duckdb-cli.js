const { execFile } = require('child_process');
const path = require('path');

/**
 * DuckDB-CLI des XML-Imports — für die Versionszeile unter Einstellungen
 * ──────────────────────────────────────────────────────────────────────
 * Die REST-API liest die Kataloge mit ihrer eigenen, gebündelten DuckDB
 * (`@duckdb/node-api`, siehe apiDuckdbVersion in storage-version.js); geschrieben
 * werden sie von der DuckDB-CLI des Converters. Beide können auseinanderlaufen,
 * etwa in einem Dev Container, dessen Image älter ist als die per `npm install`
 * aktualisierte Bindung. /api/version meldet deshalb beide.
 *
 * Gesucht wird exakt wie im Converter: `fmlab_find_duckdb` aus
 * tools/lib/duckdb_binding.sh, mit der Umgebung dieses Prozesses — also die CLI,
 * die auch der Import-Button startet. Ein Converter-Lauf aus einem Terminal kann
 * über einen anderen PATH eine andere CLI finden.
 *
 * Die Probe startet eine Shell; /api/version ist zugleich Health-Check und wird
 * im Sekundentakt abgefragt. Das Ergebnis wird daher 60 s gecacht, parallele
 * Aufrufe teilen sich eine laufende Probe. Wirft nie: ohne CLI → null, eine CLI
 * ohne lesbare Version → { path, version: null }.
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');
const HELPER = path.join(REPO_ROOT, 'tools/lib/duckdb_binding.sh');
const CACHE_MS = 60 * 1000;
const TIMEOUT_MS = 3000;

// $1 = Helfer-Skript. Ausgabe: Zeile 1 Pfad der CLI, Zeile 2 erste Zeile von --version.
const PROBE = '. "$1" && b=$(fmlab_find_duckdb) && printf "%s\\n" "$b" && "$b" --version 2>/dev/null | head -1';

/** Probe-Ausgabe → { path, version } („v2.0.0“) bzw. null ohne CLI. */
function parseProbe(stdout) {
  const [cliPath = '', versionLine = ''] = String(stdout || '').split('\n').map((s) => s.trim());
  if (!cliPath) return null;
  const m = /(\d+\.\d+\.\d+)/.exec(versionLine);
  return { path: cliPath, version: m ? `v${m[1]}` : null };
}

function runProbe() {
  return new Promise((resolve) => {
    execFile(
      'bash',
      ['-c', PROBE, 'duckdb-cli-probe', HELPER],
      {
        timeout: TIMEOUT_MS,
        env: { ...process.env, PROJECT_ROOT: REPO_ROOT, DUCKDB_AGENT_MODE: '0' },
      },
      // Exit ≠ 0 ohne Ausgabe = keine CLI (fmlab_find_duckdb) → parseProbe liefert null.
      (_err, stdout) => resolve(parseProbe(stdout)),
    );
  });
}

let cached = null; // { at, value }
let inFlight = null;

async function duckdbCliInfo() {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  if (!inFlight) {
    inFlight = runProbe()
      .then((value) => {
        cached = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** Nur für Tests. */
function resetDuckdbCliCache() {
  cached = null;
  inFlight = null;
}

module.exports = {
  duckdbCliInfo,
  parseProbe,
  resetDuckdbCliCache,
};
