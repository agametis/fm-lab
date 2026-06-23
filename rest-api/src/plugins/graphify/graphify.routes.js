const express = require('express');
const router = express.Router({ caseSensitive: false });
const controller = require('./graphify.controller');

/**
 * graphify Plugin Routes — mounted at /api/graphify by the plugin loader.
 *
 * `/status` is listed in plugin.json `public_routes`, so the settings panel can
 * show the last export even while the plugin is disabled. `/export` is guarded:
 * it only runs when the plugin is enabled.
 */

// GET  /api/graphify/status  — last export + exported file list
router.get('/status', controller.status);

// POST /api/graphify/export  — run the export, stream SSE progress
router.post('/export', controller.exportGraph);

module.exports = router;
