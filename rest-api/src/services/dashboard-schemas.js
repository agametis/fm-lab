const Joi = require('joi');
const { schemas: testsSchemas } = require('./tests-schemas');

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
        // Sticky params survive openDashboard self-navigation in the frontend
        // (mode/lens params like a classification set), unlike click-scoped
        // filter params which each click replaces.
        sticky: Joi.boolean().default(false),
      })
    )
    .default([]),
  // Message-token catalog for findings context deep links: a target view
  // resolves `ref_msgid` → template ({name} placeholders interpolated from
  // `ref_arg_<name>` URL params). Localized via "messages.<key>" manifest
  // overrides in locales/<lang>.json.
  messages: Joi.object().pattern(Joi.string(), Joi.string()).optional(),
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
        // null = no public URL exists for this source (e.g. a user feature
        // request) — same convention as meta.url above.
        url: Joi.string().uri().allow(null).required(),
      })).default([]),
    }).unknown(true).optional(),
  }).unknown(true).optional(),
  // Analysis-Tests-Metadaten (optional, additiv): macht das Bundle als Member
  // eines Analysis Tests referenzierbar (objectTypes, outputTypes, scope,
  // defaultResult). Schema lebt in tests-schemas.js (Single Source).
  analysis: testsSchemas.analysis.optional(),
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
// `locales` ist die Anzeige-Datenschicht (lang → lokalisierter Titel) — explizit
// deklariert wie im Tests-Schema, nicht nur via .unknown(true) toleriert.
const folderManifestSchema = Joi.object({
  title: Joi.string().min(1).optional(),
  icon: Joi.string().optional(),
  description: Joi.string().allow('').optional(),
  order: Joi.number().integer().optional(),
  locales: Joi.object().pattern(Joi.string(), Joi.string()).optional(),
}).unknown(true);

module.exports = {
  schemas: {
    manifest: manifestSchema,
    layout: layoutSchema,
    datasetSpec,
    folderManifest: folderManifestSchema,
  },
};
