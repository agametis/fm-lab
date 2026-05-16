const Joi = require('joi');

/**
 * Joi-Schemas für Dashboard-Bundles.
 * PRD: project/prd_dashboards.md §3.1 (manifest), §3.2 (layout).
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
}).unknown(true);

// Layout: Baumstruktur mit type/props/children/data — rekursiv
const layoutNodeSchema = Joi.object({
  type: Joi.string().min(1).required(),
  props: Joi.object().unknown(true).default({}),
  data: Joi.object({
    dataset: Joi.string().optional(),
  }).unknown(true).optional(),
  children: Joi.array().items(Joi.link('#node')).optional(),
}).id('node');

const layoutSchema = Joi.object({
  schemaVersion: Joi.number().integer().min(1).default(1),
  root: layoutNodeSchema.required(),
}).unknown(true);

module.exports = {
  schemas: {
    manifest: manifestSchema,
    layout: layoutSchema,
    datasetSpec,
  },
};
