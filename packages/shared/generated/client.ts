/**
 * Auto-generated API Client
 * DO NOT EDIT - Generated from openapi.yaml
 */

import createClient from 'openapi-fetch';
import type { paths } from './types.js';

export type ApiClient = ReturnType<typeof createApiClient>;

/**
 * Error thrown by the client. Carries the structured API error body so callers
 * can branch on `code` (e.g. `AMBIGUOUS_UUID`) and read `details`
 * (e.g. `matched_files` for the clone-disambiguation picker) instead of only a
 * flat message string.
 */
export class ApiError extends Error {
  code?: string;
  details?: Record<string, unknown>;
  constructor(message: string, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

function buildApiError(error: unknown): ApiError {
  const e = error as { error?: { message?: string; code?: string; details?: Record<string, unknown> } };
  return new ApiError(e?.error?.message || 'Request failed', e?.error?.code, e?.error?.details);
}

/**
 * Create a type-safe API client instance
 *
 * @example
 * const api = createApiClient({ baseUrl: 'http://localhost:3003' });
 * const { data } = await api.GET('/get', { params: { query: { uuid: 'ABC-123' } } });
 */
export function createApiClient(options: { baseUrl: string }) {
  const client = createClient<paths>({ baseUrl: options.baseUrl });

  return {
    /**
     * Raw fetch client (for advanced usage)
     */
    client,

    /**
     * Get object by UUID
     */
    async get(params: paths['/get']['get']['parameters']['query']) {
      const { data, error } = await client.GET('/get', {
        params: { query: params }
      });
      if (error) throw buildApiError(error);
      return data;
    },

    /**
     * List objects by type
     */
    async list(params: paths['/list']['get']['parameters']['query']) {
      const { data, error } = await client.GET('/list', {
        params: { query: params }
      });
      if (error) throw buildApiError(error);
      return data;
    },

    /**
     * Search objects by name
     */
    async search(params: paths['/search']['get']['parameters']['query']) {
      const { data, error } = await client.GET('/search', {
        params: { query: params }
      });
      if (error) throw buildApiError(error);
      return data;
    },

    /**
     * Count search results by name pattern
     */
    async searchCount(params: paths['/search/count']['get']['parameters']['query']) {
      const { data, error } = await client.GET('/search/count', {
        params: { query: params }
      });
      if (error) throw buildApiError(error);
      return data;
    },

    /**
     * Count objects
     */
    async count(params: paths['/count']['get']['parameters']['query']) {
      const { data, error } = await client.GET('/count', {
        params: { query: params }
      });
      if (error) throw buildApiError(error);
      return data;
    },

    /**
     * Get object references
     */
    async references(params: paths['/references']['get']['parameters']['query']) {
      const { data, error } = await client.GET('/references', {
        params: { query: params }
      });
      if (error) throw buildApiError(error);
      return data;
    },

    /**
     * Execute custom SQL template (GET)
     */
    async query(params: paths['/query']['get']['parameters']['query']) {
      const { data, error } = await client.GET('/query', {
        params: { query: params }
      });
      if (error) throw buildApiError(error);
      return data;
    },

    /**
     * Execute custom SQL template (POST)
     */
    async queryPost(body: paths['/query']['post']['requestBody']['content']['application/json']) {
      const { data, error } = await client.POST('/query', { body });
      if (error) throw buildApiError(error);
      return data;
    },

    /**
     * Execute report template (GET)
     */
    async report(params: paths['/report']['get']['parameters']['query']) {
      const { data, error } = await client.GET('/report', {
        params: { query: params }
      });
      if (error) throw buildApiError(error);
      return data;
    },

    /**
     * Execute report template (POST)
     */
    async reportPost(body: paths['/report']['post']['requestBody']['content']['application/json']) {
      const { data, error } = await client.POST('/report', { body });
      if (error) throw buildApiError(error);
      return data;
    },

    /**
     * Get API version and health
     */
    async version() {
      const { data, error } = await client.GET('/version');
      if (error) throw buildApiError(error);
      return data;
    },

    /**
     * Get solution information
     */
    async info(params?: paths['/info']['get']['parameters']['query']) {
      const { data, error } = await client.GET('/info', {
        params: { query: params || {} }
      });
      if (error) throw buildApiError(error);
      return data;
    },
  };
}
