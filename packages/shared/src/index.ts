/**
 * Shared Package Index
 * Re-exports all shared functionality for easy imports
 */

// Constants
export * from './constants.js';

// Languages (i18n single source of truth)
export * from './languages.js';

// Types (generated from OpenAPI)
export type * from '../generated/types.js';

// API Client
export { createApiClient } from '../generated/client.js';
export type { ApiClient } from '../generated/client.js';
