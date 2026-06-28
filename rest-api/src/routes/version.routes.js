const express = require('express');
const router = express.Router({ caseSensitive: false });
const versionController = require('../controllers/version.controller');

/**
 * Version-Manifest Routes
 *
 * GET /api/version-manifest — liefert das zentrale version.json (modul-granular).
 * Getrennt vom Health-Endpoint /api/version (system.routes), der Plugin-Feature-
 * Flags und Erreichbarkeit bedient.
 */
router.get('/version-manifest', versionController.manifest);

module.exports = router;
