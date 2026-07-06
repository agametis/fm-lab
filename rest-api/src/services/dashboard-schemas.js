const Joi = require('joi');

/**
 * Joi-Schemas für Dashboard-Bundles.
 */

// Dataset-Spec im Manifest
const datasetSpec = Joi.object({
  id: Joi.string().min(1).required(),
  source: Joi.string()
    .pattern(/^(bundle|custom|report|builtin):.+$/)
    .required(),
  params: Joi.object().unknown(true).optional(),
  description: Joi.string().optional(),
});

const manifestSchema = Joi.object({
  id: Joi.string().pattern(/^[a-zA-Z0-9_-]+$/).required(),
  version: Joi.string().optional(),
  title: Joi.string().min(1).required(),
  description: Joi.string().allow('').optional(),
  author: Joi.string().optional(),
  icon: Joi.string().optional(),
  category: Joi.string().optional(),
  tags: Joi.array().items(Joi.string()).default([]),
  entry: Joi.string().default('layout.json'),
  datasets: Joi.array().items(datasetSpec).default([]),
  params: Joi.array()
    .items(
      Joi.object({
        name: Joi.string().required(),
        type: Joi.string().valid('string', 'number', 'boolean').default('string'),
        required: Joi.boolean().default(false),
        default: Joi.any().optional(),
        description: Joi.string().optional(),
      })
    )
    .default([]),
  permissions: Joi.object({
    read_only: Joi.boolean().default(true),
    allow_navigation: Joi.boolean().default(true),
  }).default({ read_only: true, allow_navigation: true }),
  // Rule metadata block (static-code-analysis bundles). All optional and additive —
  // dashboards without a `rule` block validate unchanged. `meta` carries the rule's
  // provenance: canonical name, author, source (fm-lab | PMD), reference URL, date,
  // and prior-art cross-references (e.g. the analogous PMD rule).
  rule: Joi.object({
    severity: Joi.string().valid('info', 'warning', 'error', 'critical').optional(),
    category: Joi.string().optional(),
    rationale: Joi.string().allow('').optional(),
    remediation: Joi.string().allow('').optional(),
    meta: Joi.object({
      name: Joi.string().optional(),
      author: Joi.string().optional(),
      source: Joi.string().optional(),
      url: Joi.string().uri().allow(null).optional(),
      description: Joi.string().allow('').optional(),
      created: Joi.string().optional(),
      references: Joi.array().items(Joi.object({
        project: Joi.string().required(),
        rule: Joi.string().required(),
        url: Joi.string().uri().required(),
      })).default([]),
    }).unknown(true).optional(),
  }).unknown(true).optional(),
}).unknown(true);

// Declarative visibility guard on a node: reads the first row of a dataset and
// shows the node only when the condition holds (absent = always visible). Mirrors
// the frontend VisibleWhen type (apps/web/src/api/dashboardApi.ts).
const visibleWhenSchema = Joi.object({
  dataset: Joi.string().min(1).required(),
  field: Joi.string().min(1).required(),
  equals: Joi.any().optional(),
  notEquals: Joi.any().optional(),
  truthy: Joi.boolean().optional(),
});

// Layout: Baumstruktur mit type/props/children/data — rekursiv
const layoutNodeSchema = Joi.object({
  type: Joi.string().min(1).required(),
  // Stable anchor for server-side i18n overrides (see dashboard-i18n.service).
  id: Joi.string().pattern(/^[a-zA-Z0-9_-]+$/).optional(),
  props: Joi.object().unknown(true).default({}),
  data: Joi.object({
    dataset: Joi.string().optional(),
  }).unknown(true).optional(),
  visibleWhen: visibleWhenSchema.optional(),
  children: Joi.array().items(Joi.link('#node')).optional(),
}).id('node');

const layoutSchema = Joi.object({
  schemaVersion: Joi.number().integer().min(1).default(1),
  root: layoutNodeSchema.required(),
}).unknown(true);

// folder.json — optionale Metadaten eines Kategorie-Ordners (Navigation/Library).
// Alle Felder optional; ein Ordner ohne folder.json bleibt voll funktionsfähig.
const folderManifestSchema = Joi.object({
  title: Joi.string().min(1).optional(),
  icon: Joi.string().optional(),
  description: Joi.string().allow('').optional(),
  order: Joi.number().integer().optional(),
}).unknown(true);

module.exports = {
  schemas: {
    manifest: manifestSchema,
    layout: layoutSchema,
    datasetSpec,
    folderManifest: folderManifestSchema,
  },
};
