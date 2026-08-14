const Joi = require('joi');

/**
 * Joi schemas & controlled vocabularies for Analysis Tests.
 *
 * A "Test" is a declared collection of dashboards and/or custom queries with
 * its own metadata (object types, outputs, description, keywords, test type)
 * and a compact result model (one default result per member).
 *
 * Vocabularies live HERE (single source); frontend and skill read them via
 * the API — never duplicate the lists elsewhere.
 */

// Test categories. Extending this list is a deliberate schema edit.
const TEST_TYPES = [
  'exploration',
  'code-quality',
  'error-check',
  'security',
  'inventory',
  'performance',
  'platform',
];

// Output vocabulary of members and tests (filterability + consistency mapping).
const OUTPUT_TYPES = [
  'count',
  'boolean',
  'findings-table',
  'inventory-table',
  'graph',
  'text',
];

// Logical scopes. On SQL level they collapse to two params: the existing
// `file` filter and the `scope_uuids` CSV list (S-Block) — object/object-list/
// cluster are normalised at the run boundary (tests.service / fm-test skill).
const SCOPES = ['solution', 'file', 'object', 'object-list', 'cluster'];

const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

// One named core value per member: { type, name, meaning } + runtime `value`.
// Dashboard members address a dataset/column; query members derive the value
// via `aggregate` ('row_count' | 'first_row:<column>').
const defaultResultSchema = Joi.object({
  dataset: Joi.string().min(1).optional(),
  column: Joi.string().min(1).optional(),
  aggregate: Joi.string().pattern(/^(row_count|first_row:.+)$/).optional(),
  type: Joi.string().valid('number', 'boolean', 'text').required(),
  name: Joi.string().min(1).required(),
  meaning: Joi.string().allow('').optional(),
  // Consolidation hint for the results layer (Result Envelope v1): sums are
  // only ever built within one unit. Missing + name == "finding_count" is
  // treated as "findings"; anything else without a unit never enters a sum.
  unit: Joi.string().min(1).optional(),
});

// `analysis` block of a dashboard manifest (declared in dashboard-schemas.js).
// A dashboard without this block is not test-capable (consistency rule M2).
const analysisSchema = Joi.object({
  objectTypes: Joi.array().items(Joi.string()).default([]),
  outputTypes: Joi.array().items(Joi.string().valid(...OUTPUT_TYPES)).default([]),
  scope: Joi.object({
    supported: Joi.array().items(Joi.string().valid(...SCOPES)).default(['solution', 'file']),
    anchor: Joi.string().default('nav_uuid'),
    // Per-dataset scope mode: 'native' (S-Block in the SQL), 'post-filter'
    // (engine wrapper, findings-shaped datasets only — never for defaultResult)
    // or 'static' (scope-independent: the dataset carries no catalog evidence
    // rows — e.g. an options list read from a reference DB — and is exempt
    // from the M5 scope checks; never for defaultResult either).
    mode: Joi.object().pattern(Joi.string(), Joi.string().valid('native', 'post-filter', 'static')).default({}),
  }).default({ supported: ['solution', 'file'], anchor: 'nav_uuid', mode: {} }),
  defaultResult: defaultResultSchema.optional(),
}).unknown(true);

const memberSchema = Joi.object({
  kind: Joi.string().valid('dashboard', 'query').required(),
  ref: Joi.string().pattern(ID_PATTERN).required(),
  // Optional mapping context-param → member-param; default: identity.
  paramMap: Joi.object().pattern(Joi.string(), Joi.string()).optional(),
});

// Named member subset shipped with the bundle. A profile can only
// narrow the member list, never extend it (checked as M7 in tests.service).
// A missing `members` field means "all members" — the canonical way to
// declare a full-run profile without duplicating the member list.
const profileSchema = Joi.object({
  id: Joi.string().pattern(ID_PATTERN).required(),
  title: Joi.string().min(1).required(),
  description: Joi.string().allow('').optional(),
  members: Joi.array().items(Joi.string().pattern(ID_PATTERN)).min(1).optional(),
});

// Translations of a test's own display texts, inline in test.json:
//
//   "locales": { "de": { "title": "…", "profiles.quick.title": "…" } }
//
// One entry per language, each a flat map of override PATH → translated text.
// Valid paths are `title`, `description` and `profiles.<profileId>.<title|
// description>`; everything else is ignored at resolution time and reported as
// an M8 warning. An empty string means "keep the English original" — the same
// no-op semantics the dashboard locale files use for untranslated keys.
//
// Inline (not a `locales/<lang>.json` sidecar as with dashboards) because a
// test bundle is ONE self-contained file — that is what the exchange format
// of the later package phase ships around.
const testLocaleSchema = Joi.object().pattern(
  Joi.string(),
  Joi.object().pattern(Joi.string(), Joi.string().allow('')),
);

// templates/tests{,-custom}/<id>/test.json
const testDefinitionSchema = Joi.object({
  id: Joi.string().pattern(ID_PATTERN).required(),
  version: Joi.string().optional(),
  title: Joi.string().min(1).required(),
  description: Joi.string().allow('').optional(),
  keywords: Joi.array().items(Joi.string()).default([]),
  testType: Joi.string().valid(...TEST_TYPES).required(),
  objectTypes: Joi.array().items(Joi.string()).default([]),
  scopes: Joi.array().items(Joi.string().valid(...SCOPES)).default(['solution', 'file']),
  outputs: Joi.array().items(Joi.string().valid(...OUTPUT_TYPES)).default([]),
  members: Joi.array().items(memberSchema).min(1).required(),
  profiles: Joi.array().items(profileSchema).optional(),
  locales: testLocaleSchema.optional(),
}).unknown(true);

// folder.json of a test category folder — same shape as the dashboard variant
// (title/icon/description/order + locales display layer).
const testFolderSchema = Joi.object({
  title: Joi.string().min(1).optional(),
  icon: Joi.string().optional(),
  description: Joi.string().allow('').optional(),
  order: Joi.number().integer().optional(),
  locales: Joi.object().pattern(Joi.string(), Joi.string()).optional(),
}).unknown(true);

module.exports = {
  TEST_TYPES,
  OUTPUT_TYPES,
  SCOPES,
  ID_PATTERN,
  schemas: {
    testDefinition: testDefinitionSchema,
    testFolder: testFolderSchema,
    analysis: analysisSchema,
    defaultResult: defaultResultSchema,
    member: memberSchema,
    profile: profileSchema,
    testLocale: testLocaleSchema,
  },
};
