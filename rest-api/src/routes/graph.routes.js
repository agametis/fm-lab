const express = require('express');
const router = express.Router({ caseSensitive: false });
const controller = require('../controllers/graph.controller');
const { validate } = require('../middleware/validator');

/**
 * Graph Explorer Routes (P2 — Subgraph-Backend, LE-6 Core).
 * Gemountet unter /api durch routes/index.js.
 * Plan plan_graphify_style_visualisierung.md §6.1 / §13.3.
 */

// GET /api/graph/subgraph?focus=…&depth=…&direction=…&mode=…&types=…&roles=…&include_builtins=…&node_limit=…&hub_degree=…
router.get('/graph/subgraph', validate('graphSubgraph'), controller.getSubgraph);

// GET /api/graph/neighbors?focus=…&direction=…&mode=…  — 1-Hop-Expansion
router.get('/graph/neighbors', validate('graphNeighbors'), controller.getNeighbors);

// GET /api/graph/search?q=…&type=…&file=…&limit=…  — Fokus-Autocomplete
router.get('/graph/search', validate('graphSearch'), controller.search);

module.exports = router;
