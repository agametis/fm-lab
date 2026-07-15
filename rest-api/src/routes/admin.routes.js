const express = require('express');
const router = express.Router({ caseSensitive: false });
const adminController = require('../controllers/admin.controller');

/**
 * Admin Routes
 * Endpoints for runtime administration of the API process.
 */

// POST /api/admin/reload - Re-open DuckDB connection from disk
// (optional body {"solution": "<id>"} — targets exactly that pool entry)
router.post('/admin/reload', adminController.reload);

// GET /api/admin/pool - Connection-pool diagnostics (stage M tuning)
router.get('/admin/pool', adminController.poolStatus);

// POST /api/admin/solution/activate - Set the active solution (server default)
router.post('/admin/solution/activate', adminController.activateSolution);

// POST /api/admin/solution/rename - Bundle rename {"from","to"} (id/folder;
// the manifest UUID keeps the identity; own endpoint by design, not a PATCH field)
router.post('/admin/solution/rename', adminController.renameSolutionBundle);

// GET /api/solutions - List solution bundles (manifest scan)
router.get('/solutions', adminController.listSolutions);

// POST /api/solutions - Create an empty solution bundle
router.post('/solutions', adminController.createSolution);

// PATCH /api/solutions/:id - Update the user-owned manifest block (rename etc.)
router.patch('/solutions/:id', adminController.updateSolution);

// DELETE /api/solutions/:id - Remove a bundle (incl. XML sources; never the active one)
router.delete('/solutions/:id', adminController.deleteSolution);

module.exports = router;
