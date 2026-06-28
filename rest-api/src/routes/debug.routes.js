const express = require('express');
const router = express.Router({ caseSensitive: false });
const controller = require('../controllers/debug.controller');

/**
 * Debug-Session-Routen — Ingestion der Frontend-Interaktion in die korrelierte
 * Backend-Zeitachse. Gemountet unter /api durch routes/index.js.
 */

// POST /api/debug/session — gebündelte Frontend-Events einspeisen
router.post('/debug/session', controller.ingest);

// GET /api/debug/session/status — Logging-Status (aktiv? Zieldatei?)
router.get('/debug/session/status', controller.status);

module.exports = router;
