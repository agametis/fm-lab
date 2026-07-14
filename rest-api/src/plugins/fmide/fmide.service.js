const fs = require('fs');
const path = require('path');
const db = require('../../config/database');
const { getLoadedPlugins } = require('../loader');
const { fmlabDir } = require('../settings-store');
const { createError } = require('../../middleware/error-handler');

/**
 * fmIDE Thingamajig URI Service
 *
 * Generates navigation URIs for FileMaker objects based on the ObjectCatalog.
 * The URIcorn transforms these into fmp:// URLs that open fmIDE in FileMaker.
 */

// Parameter mapping: ObjectCatalog Type -> fmIDE parameter name
const DIRECT_TYPE_MAP = {
  Script:              '$script_name',
  Layout:              '$layout_name',
  LayoutObject:        '$object_name',
  LayoutPart:          '$layout_part_name',
  BaseTable:           '$base_table_name',
  TableOccurrence:     '$t_o_name',
  CustomFunction:      '$custom_function_name',
  ValueList:           '$value_list_name',
  Account:             '$account_name',
  PrivilegeSet:        '$privilege_set_name',
  Theme:               '$theme_name',
  CustomMenu:          '$custom_menu_name',
  ExtendedPrivilege:   '$extended_privilege_name',
  ExternalDataSource:  '$external_data_source_name',
};

// Types that need additional context joins
const CONTEXT_TYPES = new Set(['ScriptStep', 'Field']);

// Types with indirect mapping (fallback to related object)
const INDIRECT_TYPES = new Set(['Relationship', 'ScriptTrigger']);

// All supported types
const SUPPORTED_TYPES = new Set([
  ...Object.keys(DIRECT_TYPE_MAP),
  ...CONTEXT_TYPES,
  ...INDIRECT_TYPES,
]);

/**
 * Simple percent-encoding for fmp:// URL parameter values.
 * Covers the characters commonly found in FileMaker object names.
 */
function encodeParam(value) {
  if (!value) return '';
  return value
    .replace(/%/g, '%25')
    .replace(/ /g, '%20')
    .replace(/&/g, '%26')
    .replace(/=/g, '%3D')
    .replace(/\+/g, '%2B')
    .replace(/\//g, '%2F')
    .replace(/\?/g, '%3F')
    .replace(/#/g, '%23');
}

/**
 * Get the current fmIDE config from the loaded plugin manifest.
 */
function getConfig() {
  const plugins = getLoadedPlugins();
  const manifest = plugins.fmide;
  return manifest?.config || {
    fmp_protocol: 'fmp',
    server_address: '$',
    script_name: 'fmIDE',
  };
}

/**
 * Update config values in memory (not persistent).
 */
function updateConfig(newValues) {
  const plugins = getLoadedPlugins();
  const manifest = plugins.fmide;
  if (!manifest) return null;
  Object.assign(manifest.config, newValues);
  return manifest.config;
}

// ---------------------------------------------------------------------------
// Per-file fmIDE script status
//
// The fmp:// URLs call a script *by name* (default "fmIDE") in the target file.
// If that script is missing, the link is dead — so we detect, per file, whether
// the fmIDE script exists and (additionally) verify it by its signature: a
// `Variable setzen [ $fmide_version ; … ]` step in the script header. The result
// gates the UI (🦄 actions) so they only appear where fmIDE can actually run.
// ---------------------------------------------------------------------------

let fileStatusCache = null;
let scanSqlCache = null;

function statusFilePath() {
  return path.join(fmlabDir(), 'plugins', 'fmide', 'script_status.json');
}

/** The scan SQL, read once from the plugin's sql/ template directory. */
function scanSql() {
  if (scanSqlCache == null) {
    scanSqlCache = fs.readFileSync(path.join(__dirname, 'sql', 'scan_status.sql'), 'utf-8');
  }
  return scanSqlCache;
}

/** Coerce a config value (boolean or "true"/"false" string) to a boolean. */
function asBool(value, dflt) {
  if (value === undefined || value === null || value === '') return dflt;
  if (typeof value === 'boolean') return value;
  return String(value).toLowerCase() === 'true';
}

/** Strip surrounding double-quotes from a FileMaker string literal (e.g. "0.39"). */
function unquote(value) {
  if (value == null) return null;
  const s = String(value).trim();
  const m = s.match(/^"(.*)"$/s);
  return m ? m[1] : s;
}

/**
 * Compute the per-file fmIDE script status from the catalog.
 * Returns { [File_Name]: { script_present, script_valid, fmide_version } }.
 */
async function computeFileStatuses(ctx) {
  const { script_name } = getConfig();
  const result = await db.executeQuery(ctx, scanSql(), [script_name]);
  const map = {};
  for (const row of result.rows) {
    map[row.file_name] = {
      script_present: Boolean(row.script_present),
      script_valid: Boolean(row.script_valid),
      fmide_version: unquote(row.version_raw),
    };
  }
  return map;
}

/**
 * Recompute the per-file status, cache it in memory and persist it to
 * `.fmlab/plugins/fmide/script_status.json` (best-effort, for inspectability).
 * Safe to call when the DB is unavailable — returns {} and leaves no cache.
 */
async function refreshFileStatuses(ctx) {
  try {
    const map = await computeFileStatuses(ctx);
    fileStatusCache = map;
    try {
      const file = statusFilePath();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const payload = { script_name: getConfig().script_name, files: map };
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
      fs.renameSync(tmp, file);
    } catch (err) {
      console.warn(`fmide: could not persist script_status.json: ${err.message}`);
    }
    const present = Object.values(map).filter((s) => s.script_present).length;
    console.log(`  fmIDE: script "${getConfig().script_name}" present in ${present}/${Object.keys(map).length} file(s)`);
    return map;
  } catch (err) {
    console.warn(`fmide: script-status computation skipped: ${err.message}`);
    return fileStatusCache || {};
  }
}

/**
 * Load a previously persisted scan from `.fmlab/plugins/fmide/script_status.json`
 * into the cache, WITHOUT querying the DB. Used at startup so the panel reflects
 * the last scan without re-scanning on every boot. Returns the map or null.
 */
function loadPersistedStatuses() {
  try {
    const payload = readJsonSafe(statusFilePath());
    if (payload && payload.files && typeof payload.files === 'object') {
      fileStatusCache = payload.files;
      return fileStatusCache;
    }
  } catch (err) {
    console.warn(`fmide: could not load persisted script_status.json: ${err.message}`);
  }
  return null;
}

/** Whether a scan has ever been run (cached in memory or persisted to disk). */
function hasScanData() {
  return fileStatusCache != null || fs.existsSync(statusFilePath());
}

/**
 * Get the cached per-file status map. Does NOT auto-scan — the scan runs on
 * plugin activation and on explicit "Rescan" (see fmide.actions.js). Falls back
 * to the persisted file, then to an empty map.
 */
async function getFileStatuses() {
  if (fileStatusCache) return fileStatusCache;
  return loadPersistedStatuses() || {};
}

function readJsonSafe(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    console.warn(`fmide: failed to read ${file}: ${err.message}`);
    return null;
  }
}

/** Status for a single file (never throws; defaults to "absent"). */
async function getFileStatus(fileName) {
  const map = await getFileStatuses();
  return map[fileName] || { script_present: false, script_valid: false, fmide_version: null };
}

/**
 * Build the Thingamajig URI for a given object.
 * Returns { thingamajig_uri, fmp_url, supported, script_available, … } or null.
 */
async function buildUri(ctx, uuid, configOverrides, file) {
  const config = { ...getConfig(), ...configOverrides };

  // Fetch the object from ObjectCatalog (clone-aware). Bei geteilter UUID (Klon)
  // grenzt `file` auf die richtige Datei ein; ohne `file` gilt Graceful Downgrade
  // (eindeutig → ok, mehrdeutig → AMBIGUOUS_UUID statt willkürlichem rows[0],
  // sonst zeigte der fmp://-Deeplink in die falsche Klon-Datei).
  const objResult = await db.executeQuery(
    ctx,
    file
      ? 'SELECT Object_UUID, Object_Type, Object_Name, File_Name FROM ObjectCatalog WHERE Object_UUID = ? AND File_Name = ?'
      : 'SELECT Object_UUID, Object_Type, Object_Name, File_Name FROM ObjectCatalog WHERE Object_UUID = ?',
    file ? [uuid, file] : [uuid]
  );

  if (objResult.rows.length === 0) {
    return null;
  }

  if (!file && objResult.rows.length > 1) {
    const matched_files = [...new Set(objResult.rows.map((r) => r.File_Name))].sort();
    throw createError(
      'AMBIGUOUS_UUID',
      `UUID '${uuid}' exists in ${matched_files.length} files (cloned/modular solution); ` +
        `add ?file=<File_Name> to disambiguate`,
      { uuid, matched_files }
    );
  }

  const obj = objResult.rows[0];
  const objectType = obj.Object_Type;

  if (!SUPPORTED_TYPES.has(objectType)) {
    return {
      object_uuid: obj.Object_UUID,
      object_type: objectType,
      object_name: obj.Object_Name,
      file_name: obj.File_Name,
      thingamajig_uri: null,
      fmp_url: null,
      supported: false,
    };
  }

  let thingamajigUri = null;

  // --- Direct mapping (simple parameter) ---
  if (DIRECT_TYPE_MAP[objectType]) {
    const param = DIRECT_TYPE_MAP[objectType];
    thingamajigUri = `${obj.File_Name}&${param}=${encodeParam(obj.Object_Name)}`;
  }

  // --- Context types (need JOINs) ---
  else if (objectType === 'ScriptStep') {
    // Navigate to parent script + step number
    const stepResult = await db.executeQuery(ctx, `
      SELECT
        oc_script.Object_Name AS Script_Name,
        oc_script.File_Name AS Script_File,
        s.Step_Index
      FROM ObjectLinks ol
      JOIN ObjectCatalog oc_script ON ol.Target_UUID = oc_script.Object_UUID
      JOIN StepsForScripts s ON s.Step_UUID = ?
      WHERE ol.Source_UUID = ?
        AND ol.Link_Role = 'parent_script'
      LIMIT 1
    `, [uuid, uuid]);

    if (stepResult.rows.length > 0) {
      const row = stepResult.rows[0];
      const fileName = row.Script_File || obj.File_Name;
      thingamajigUri = `${fileName}&$script_name=${encodeParam(row.Script_Name)}`
        + `&$script_step_number=${row.Step_Index}`;
    }
  }

  else if (objectType === 'Field') {
    // Field needs base_table_name as context
    const tableResult = await db.executeQuery(ctx, `
      SELECT oc_table.Object_Name AS Table_Name
      FROM ObjectLinks ol
      JOIN ObjectCatalog oc_table ON ol.Target_UUID = oc_table.Object_UUID
      WHERE ol.Source_UUID = ?
        AND ol.Link_Role = 'parent_table'
      LIMIT 1
    `, [uuid]);

    if (tableResult.rows.length > 0) {
      thingamajigUri = `${obj.File_Name}&$base_table_name=${encodeParam(tableResult.rows[0].Table_Name)}`
        + `&$field_name=${encodeParam(obj.Object_Name)}`;
    } else {
      // Fallback: field without resolved table
      thingamajigUri = `${obj.File_Name}&$field_name=${encodeParam(obj.Object_Name)}`;
    }
  }

  // --- Indirect mapping (fallback to related object) ---
  else if (objectType === 'Relationship') {
    // Navigate to left TableOccurrence
    const toResult = await db.executeQuery(ctx, `
      SELECT oc_to.Object_Name AS TO_Name, oc_to.File_Name AS TO_File
      FROM ObjectLinks ol
      JOIN ObjectCatalog oc_to ON ol.Target_UUID = oc_to.Object_UUID
      WHERE ol.Source_UUID = ?
        AND ol.Link_Role = 'left_table'
      LIMIT 1
    `, [uuid]);

    if (toResult.rows.length > 0) {
      const row = toResult.rows[0];
      thingamajigUri = `${row.TO_File || obj.File_Name}&$t_o_name=${encodeParam(row.TO_Name)}`;
    }
  }

  else if (objectType === 'ScriptTrigger') {
    // Navigate to the triggered script
    const triggerResult = await db.executeQuery(ctx, `
      SELECT oc_script.Object_Name AS Script_Name, oc_script.File_Name AS Script_File
      FROM ObjectLinks ol
      JOIN ObjectCatalog oc_script ON ol.Target_UUID = oc_script.Object_UUID
      WHERE ol.Source_UUID = ?
        AND ol.Link_Role = 'trigger_script'
      LIMIT 1
    `, [uuid]);

    if (triggerResult.rows.length > 0) {
      const row = triggerResult.rows[0];
      thingamajigUri = `${row.Script_File || obj.File_Name}&$script_name=${encodeParam(row.Script_Name)}`;
    }
  }

  // Build full fmp:// URL
  let fmpUrl = null;
  if (thingamajigUri) {
    fmpUrl = `${config.fmp_protocol}://${config.server_address}/${thingamajigUri.replace('&', `?script=${config.script_name}&`)}`;
  }

  // Per-file gate: is the fmIDE target script actually present in this file?
  const fileStatus = await getFileStatus(obj.File_Name);
  // When the "only show when installed" option is off, never gate on presence.
  const onlyIfInstalled = asBool(config.only_if_installed, true);

  return {
    object_uuid: obj.Object_UUID,
    object_type: objectType,
    object_name: obj.Object_Name,
    file_name: obj.File_Name,
    thingamajig_uri: thingamajigUri,
    fmp_url: fmpUrl,
    supported: thingamajigUri !== null,
    // `script_available` gates the UI. With `only_if_installed` (default), the
    // fmIDE script must exist in the file for the link to make sense; otherwise
    // the action is always offered. `script_valid`/`fmide_version` are the extra
    // signature-verification signals (informational).
    script_available: onlyIfInstalled ? fileStatus.script_present : true,
    script_present: fileStatus.script_present,
    script_valid: fileStatus.script_valid,
    fmide_version: fileStatus.fmide_version,
  };
}

/**
 * Batch: generate URIs for multiple UUIDs.
 */
async function buildUris(ctx, uuids, configOverrides) {
  const results = [];
  for (const uuid of uuids) {
    const result = await buildUri(ctx, uuid, configOverrides);
    if (result) results.push(result);
  }
  return results;
}

module.exports = {
  buildUri,
  buildUris,
  getConfig,
  updateConfig,
  SUPPORTED_TYPES,
  encodeParam,
  computeFileStatuses,
  refreshFileStatuses,
  loadPersistedStatuses,
  hasScanData,
  getFileStatuses,
  getFileStatus,
};
