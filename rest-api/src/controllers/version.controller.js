const fs = require('fs');
const path = require('path');
const { buildSuccess } = require('../utils/response-builder');
const { resolveRepoRoot } = require('../plugins/settings-store');

/**
 * Version-Manifest Controller
 *
 * Liefert das zentrale, modul-granulare Versions-Manifest (version.json aus dem
 * Repo-Root). Quelle der Wahrheit ist die vom Generator
 * (tools/build-version-manifest.mjs) erzeugte Datei; dieser Endpoint liest sie
 * nur read-only aus.
 *
 * HINWEIS: bewusst NICHT unter /api/version — dort sitzt der bestehende
 * Health-/Feature-Endpoint (system.controller.version), den das Frontend für
 * Plugin-Feature-Flags und die Erreichbarkeitsprüfung nutzt. Das Manifest
 * bekommt daher den eigenen Pfad /api/version-manifest.
 */

/** version.json liegt im Repo-Root (eine Ebene über rest-api/). */
function manifestPath() {
  return path.join(resolveRepoRoot(), 'version.json');
}

/**
 * GET /api/version-manifest — das gesamte version.json.
 */
async function manifest(req, res, next) {
  try {
    const file = manifestPath();
    if (!fs.existsSync(file)) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'VERSION_MANIFEST_NOT_FOUND',
          message:
            'version.json nicht gefunden. Die Datei gehört zum Lieferumfang — Checkout/Installation prüfen. (Maintainer-Setup: node tools/build-version-manifest.mjs regeneriert sie.)',
        },
      });
    }
    // Frisch lesen (kleine Datei) — so wird ein Re-Generate/Pull ohne Server-
    // Neustart sofort sichtbar.
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    res.json(buildSuccess(data));
  } catch (error) {
    next(error);
  }
}

module.exports = {
  manifest,
};
