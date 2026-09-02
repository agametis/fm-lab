const express = require('express');
const router = express.Router({ caseSensitive: false });
const objectController = require('../controllers/object.controller');
const { validate } = require('../middleware/validator');

/**
 * Object Routes
 * Routes for object-related endpoints
 */

// GET /api/get - Get object by UUID
router.get('/get', validate('get'), objectController.get);

// GET /api/get-details - Get object details by UUID (type-specific template dispatch)
router.get('/get-details', validate('getDetails'), objectController.getDetails);

// GET /api/get-calc - Standalone calculation by hash (tokens format)
router.get('/get-calc', validate('getCalc'), objectController.getCalc);

// GET /api/conditional-formatting - CF rules of a layout object (parsed format + raw CSS)
router.get('/conditional-formatting', validate('conditionalFormatting'), objectController.conditionalFormatting);

// GET /api/list/categories - Pseudo-Token-Filter-Pillen Datenbasis
// MUSS vor /list stehen, sonst kollidiert das Subpfad-Routing mit /list?type=...
router.get('/list/categories', validate('listCategories'), objectController.listCategories);

// GET /api/list - List objects by type
router.get('/list', validate('list'), objectController.list);

// GET /api/list-with-folders - Hierarchical list (Scripts/Layouts/CFs) with nesting_level
router.get('/list-with-folders', validate('listWithFolders'), objectController.listWithFolders);

// GET /api/count - Count objects
router.get('/count', validate('count'), objectController.count);

// GET /api/search/count - Count search results (must be before /search)
router.get('/search/count', validate('searchCount'), objectController.searchCount);

// GET /api/search - Search objects by name
router.get('/search', validate('search'), objectController.search);

// GET /api/references - Get object references
router.get('/references', validate('references'), objectController.references);

// GET /api/back-references - Cross-Reference Highlight Lookup
router.get('/back-references', validate('backReferences'), objectController.backReferences);

module.exports = router;
