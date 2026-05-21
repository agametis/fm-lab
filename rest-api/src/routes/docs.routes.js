const express = require('express');
const router = express.Router({ caseSensitive: false });
const docsController = require('../controllers/docs.controller');

/**
 * Docs Routes — siehe project/prd_docs_redesign.md §7.1
 *
 * Diese Routen sind die kanonische Schnittstelle für das neue Frontend.
 * Die alten /api/plugin-docs/... Routen bleiben als Backwards-Kompatibilität
 * erhalten.
 */

router.get('/docs',                                docsController.listDocs);
router.get('/docs/:id/status',                     docsController.getStatus);
router.get('/docs/:id/check',                      docsController.check);
router.post('/docs/install/:id',                   docsController.install);
router.get('/docs/:id/search',                     docsController.search);
router.get('/docs/:id/categories',                 docsController.listCategories);
router.get('/docs/:id/categories/:cat',            docsController.getCategory);
router.get('/docs/:id/categories/:cat/:fn',        docsController.getEntry);
// Static-Asset-Serving für Bilder/Attachments innerhalb eines Doc-Sets.
// In Express 5 muss der Catch-all-Wildcard benannt sein (path-to-regexp v6+).
router.get('/docs/:id/_asset/*assetPath',          docsController.getAsset);

module.exports = router;
