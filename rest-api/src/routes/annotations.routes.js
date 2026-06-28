const express = require('express');
const router = express.Router({ caseSensitive: false });
const controller = require('../controllers/annotations.controller');
const { validate } = require('../middleware/validator');

/**
 * Annotations Routes — User-Annotationen (Noise-Filter & semantische Anreicherung).
 * Schreibt in die Sidecar-DB (db/fm_annotations.duckdb), getrennt vom READ_ONLY-
 * Analyse-Stack. Gemountet unter /api durch routes/index.js.
 */

// PUT /api/annotations/community — Community-Name/Notiz setzen (UPSERT)
router.put('/annotations/community', validate('annotationCommunity', 'body'), controller.putCommunity);

// PUT /api/annotations/node/visibility — Node-Sichtbarkeit markieren
router.put('/annotations/node/visibility', validate('annotationNodeVisibility', 'body'), controller.putNodeVisibility);

// GET /api/annotations/hidden — Recovery-Liste der ausgeblendeten Knoten
router.get('/annotations/hidden', controller.getHidden);

module.exports = router;
