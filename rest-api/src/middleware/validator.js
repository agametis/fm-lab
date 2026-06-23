const Joi = require('joi');
const { createError } = require('./error-handler');
const { OBJECT_TYPES, OUTPUT_FORMATS, REFERENCE_DIRECTIONS, LINK_TYPES, PSEUDO_TOKEN_TYPES } = require('../config/constants');
const environment = require('../config/environment');

/**
 * Request Validation Middleware using Joi
 */

/**
 * Validation schemas for different endpoints
 */
const schemas = {
  // GET /api/get
  get: Joi.object({
    uuid: Joi.string().required(),
    format: Joi.string().lowercase().valid(...Object.values(OUTPUT_FORMATS)).default('json'),
    meta: Joi.boolean().default(false),
    debug: Joi.boolean().default(false),
  }),

  // GET /api/list
  // PRD prd_pseudo_object_types_filter.md §7.2 — neue Pseudo-Token-Parameter:
  //   ?with_usage / ?with_category / ?category=A,B,C / ?sort=usage|name|category
  // (snake_case konsistent mit link_type/group_by; index.js normalisiert
  // Query-Keys automatisch zu lowercase, deshalb keine camelCase-Form möglich.)
  // Diese sind nur für Pseudo-Token-Typen + PluginComponent (nur Usage/Sort) sinnvoll;
  // bei anderen Typen werden sie ignoriert (kein Fehler).
  list: Joi.object({
    type: Joi.string().lowercase().valid(...OBJECT_TYPES.map(t => t.toLowerCase())).required(),
    file: Joi.string().optional(),
    limit: Joi.number().integer().min(0).max(environment.api.maxLimit).default(environment.api.defaultLimit),
    with_usage: Joi.boolean().default(false),
    with_category: Joi.boolean().default(false),
    // Komma-getrennte Liste; Joi-String, splitting im Service. URL-Beispiel:
    // ?category=Get%20Functions,Text%20Functions
    category: Joi.string().optional(),
    sort: Joi.string().lowercase().valid('usage', 'name', 'category').optional(),
    format: Joi.string().lowercase().valid(...Object.values(OUTPUT_FORMATS)).default('json'),
    meta: Joi.boolean().default(false),
    debug: Joi.boolean().default(false),
  }),

  // GET /api/list/categories - Filter-Pillen-Daten für einen Pseudo-Token-Typ.
  // PRD §7.2 — Liefert { category, token_count, total_usage } pro Kategorie.
  // Nur für PSEUDO_TOKEN_TYPES gültig; PluginComponent → HTTP 400.
  listCategories: Joi.object({
    type: Joi.string()
      .lowercase()
      .valid(...PSEUDO_TOKEN_TYPES.map(t => t.toLowerCase()))
      .required(),
    file: Joi.string().optional(),
    format: Joi.string().lowercase().valid(...Object.values(OUTPUT_FORMATS)).default('json'),
    meta: Joi.boolean().default(false),
    debug: Joi.boolean().default(false),
  }),

  // GET /api/list-with-folders - Hierarchische Liste (Scripts/Layouts/CFs) mit nesting_level.
  // Kein limit: Tree muss komplett geliefert werden, sonst bricht die Folder-Stack-Konsistenz.
  listWithFolders: Joi.object({
    type: Joi.string()
      .lowercase()
      .valid('script', 'layout', 'customfunction')
      .required(),
    file: Joi.string().optional(),
    format: Joi.string().lowercase().valid(...Object.values(OUTPUT_FORMATS)).default('json'),
    meta: Joi.boolean().default(false),
    debug: Joi.boolean().default(false),
  }),

  // GET /api/count
  count: Joi.object({
    type: Joi.string().lowercase().valid(...OBJECT_TYPES.map(t => t.toLowerCase())).optional(),
    file: Joi.string().optional(),
    group_by: Joi.string().optional(), // e.g., "type,file"
    format: Joi.string().lowercase().valid(...Object.values(OUTPUT_FORMATS)).default('json'),
    meta: Joi.boolean().default(false),
    debug: Joi.boolean().default(false),
  }),

  // GET /api/search
  search: Joi.object({
    name: Joi.string().required(),
    type: Joi.string().lowercase().valid(...OBJECT_TYPES.map(t => t.toLowerCase())).optional(),
    file: Joi.string().optional(),
    limit: Joi.number().integer().min(0).max(environment.api.maxLimit).default(environment.api.defaultLimit),
    offset: Joi.number().integer().min(0).default(0),
    format: Joi.string().lowercase().valid(...Object.values(OUTPUT_FORMATS)).default('json'),
    meta: Joi.boolean().default(false),
    debug: Joi.boolean().default(false),
  }),

  // GET /api/search/count
  searchCount: Joi.object({
    name: Joi.string().required(),
    type: Joi.string().lowercase().valid(...OBJECT_TYPES.map(t => t.toLowerCase())).optional(),
    file: Joi.string().optional(),
    format: Joi.string().lowercase().valid(...Object.values(OUTPUT_FORMATS)).default('json'),
    meta: Joi.boolean().default(false),
    debug: Joi.boolean().default(false),
  }),

  // GET /api/references
  references: Joi.object({
    uuid: Joi.string().required(),
    direction: Joi.string().lowercase().valid(...Object.values(REFERENCE_DIRECTIONS)).default('all'),
    link_type: Joi.string().lowercase().valid(...Object.values(LINK_TYPES)).default('operational'),
    limit: Joi.number().integer().min(0).max(environment.api.maxLimit).default(environment.api.defaultLimit),
    format: Joi.string().lowercase().valid(...Object.values(OUTPUT_FORMATS)).default('json'),
    meta: Joi.boolean().default(false),
    debug: Joi.boolean().default(false),
  }),

  // GET /api/back-references - Cross-Reference Highlight Lookup
  // PRD prd_cross_references_hilite.md §6.3
  backReferences: Joi.object({
    destination: Joi.string().required(),
    origin: Joi.string().required(),
    mode: Joi.string().lowercase().valid('uuid', 'name', 'auto').default('auto'),
    format: Joi.string().lowercase().valid(...Object.values(OUTPUT_FORMATS)).default('json'),
    meta: Joi.boolean().default(false),
    debug: Joi.boolean().default(false),
  }),

  // GET /api/info
  info: Joi.object({
    file: Joi.string().optional(),
    format: Joi.string().lowercase().valid(...Object.values(OUTPUT_FORMATS)).default('json'),
  }),

  // GET /api/get-details - Object type-specific detail view
  getDetails: Joi.object({
    uuid: Joi.string().required(),
    format: Joi.string().lowercase().valid(...Object.values(OUTPUT_FORMATS)).default('json'),
    meta: Joi.boolean().default(false),
    debug: Joi.boolean().default(false),
    // PRD §5.1 — optionale Token-Anreicherung mit Reference-DB pro Sprache
    enrich: Joi.string().optional(),
  }),

  // GET /api/get-calc - Standalone calculation by hash (token format only)
  getCalc: Joi.object({
    hash: Joi.string().required(),
    format: Joi.string().lowercase().valid('tokens', 'json').default('tokens'),
    meta: Joi.boolean().default(false),
    debug: Joi.boolean().default(false),
    // PRD §5.2 — optionale Calc-Token-Anreicherung über function_name_lookup
    enrich: Joi.string().optional(),
  }),

  // GET/POST /api/query - Execute custom SQL template
  query: Joi.object({
    template: Joi.string().required(),
    params: Joi.alternatives().try(
      Joi.object().unknown(true), // Object with any properties
      Joi.string() // JSON string (for GET requests)
    ).optional(),
    format: Joi.string().lowercase().valid(...Object.values(OUTPUT_FORMATS)).default('json'),
    meta: Joi.boolean().default(false),
    debug: Joi.boolean().default(false),
    // Mermaid-specific parameters
    theme: Joi.string().valid('default', 'dark', 'forest', 'neutral').optional(),
    direction: Joi.string().valid('TD', 'LR', 'BT', 'RL').optional(),
    title: Joi.string().max(200).optional(),
  }).unknown(true), // Allow additional parameters for template variables

  // GET /api/relationship-graph/:fileName - Beziehungsdiagramm einer Datei
  relationshipGraph: Joi.object({
    format: Joi.string().lowercase().valid(...Object.values(OUTPUT_FORMATS)).default('json'),
    meta: Joi.boolean().default(false),
    debug: Joi.boolean().default(false),
  }),

  // GET /api/graph/subgraph - Fokus-zentrierter k-Hop-Subgraph (Graph Explorer, P2)
  // Plan plan_graphify_style_visualisierung.md §6.1 / §13.3.
  // types/roles sind optionale Komma-Listen (CSV); Split + NULL-Handling im SQL.
  graphSubgraph: Joi.object({
    focus: Joi.string().required(),
    depth: Joi.number().integer().min(1).max(4).default(1),
    direction: Joi.string().lowercase().valid('out', 'in', 'both').default('both'),
    mode: Joi.string().lowercase().valid('logical', 'raw').default('logical'),
    types: Joi.string().optional(),
    roles: Joi.string().optional(),
    include_builtins: Joi.boolean().default(false),
    node_limit: Joi.number().integer().min(1).max(environment.api.maxLimit).default(1000),
    hub_degree: Joi.number().integer().min(1).default(100),
    format: Joi.string().lowercase().valid(...Object.values(OUTPUT_FORMATS)).default('json'),
    meta: Joi.boolean().default(false),
    debug: Joi.boolean().default(false),
  }),

  // GET /api/graph/neighbors - 1-Hop-Expansion (Lazy-Expand). Wie subgraph, ohne depth.
  graphNeighbors: Joi.object({
    focus: Joi.string().required(),
    direction: Joi.string().lowercase().valid('out', 'in', 'both').default('both'),
    mode: Joi.string().lowercase().valid('logical', 'raw').default('logical'),
    types: Joi.string().optional(),
    roles: Joi.string().optional(),
    include_builtins: Joi.boolean().default(false),
    node_limit: Joi.number().integer().min(1).max(environment.api.maxLimit).default(1000),
    hub_degree: Joi.number().integer().min(1).default(100),
    format: Joi.string().lowercase().valid(...Object.values(OUTPUT_FORMATS)).default('json'),
    meta: Joi.boolean().default(false),
    debug: Joi.boolean().default(false),
  }),

  // GET /api/graph/search - Fokus-Autocomplete über ObjectCatalog
  graphSearch: Joi.object({
    q: Joi.string().min(1).required(),
    type: Joi.string().optional(),
    file: Joi.string().optional(),
    limit: Joi.number().integer().min(1).max(100).default(20),
    format: Joi.string().lowercase().valid(...Object.values(OUTPUT_FORMATS)).default('json'),
    meta: Joi.boolean().default(false),
    debug: Joi.boolean().default(false),
  }),

  // GET/POST /api/report - Execute report template
  report: Joi.object({
    template: Joi.string().required(),
    params: Joi.alternatives().try(
      Joi.object().unknown(true), // Object with any properties
      Joi.string() // JSON string (for GET requests)
    ).optional(),
    format: Joi.string().lowercase().valid(...Object.values(OUTPUT_FORMATS)).default('html'), // Default to HTML for reports
    meta: Joi.boolean().default(false),
    debug: Joi.boolean().default(false),
    // Mermaid-specific parameters
    theme: Joi.string().valid('default', 'dark', 'forest', 'neutral').optional(),
    direction: Joi.string().valid('TD', 'LR', 'BT', 'RL').optional(),
    title: Joi.string().max(200).optional(),
  }).unknown(true), // Allow additional parameters for template variables
};

/**
 * Validate request query parameters or body
 * @param {string} schemaName - Name of the schema to use
 * @param {string} source - 'query' or 'body' or 'both' (default: 'query')
 * @returns {Function} Express middleware
 */
function validate(schemaName, source = 'query') {
  return (req, res, next) => {
    const schema = schemas[schemaName];

    if (!schema) {
      return next(createError('INTERNAL_ERROR', `Unknown validation schema: ${schemaName}`));
    }

    // Determine what to validate
    let dataToValidate;
    if (source === 'both') {
      // Merge query and body (body takes precedence)
      dataToValidate = { ...req.query, ...req.body };
    } else if (source === 'body') {
      dataToValidate = req.body;
    } else {
      dataToValidate = req.query;
    }

    const { error, value } = schema.validate(dataToValidate, {
      abortEarly: false,
      stripUnknown: true,
      presence: 'optional', // Allow defaults to be applied for missing fields
      convert: true, // Enable type coercion and transformations (like .lowercase())
    });

    if (error) {
      const details = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));

      return next(createError('VALIDATION_ERROR', 'Request validation failed', { errors: details }));
    }

    // Replace query or body with validated and defaulted values
    if (source === 'both' || source === 'query') {
      Object.defineProperty(req, 'query', {
        value: value,
        writable: true,
        enumerable: true,
        configurable: true
      });
    }
    if (source === 'both' || source === 'body') {
      Object.defineProperty(req, 'body', {
        value: value,
        writable: true,
        enumerable: true,
        configurable: true
      });
    }
    next();
  };
}

module.exports = {
  validate,
  schemas,
};
