import { API_BASE } from '../config/apiBase';

/**
 * Plugin-Spec API client (`/api/plugin-spec/*`).
 *
 * Read-only access to the plug-in platform map (reference/plugin_spec.duckdb,
 * derived from the vendor docs mirror). Plain fetch like the rest of the
 * frontend. Consumers must degrade silently: 503 = map not installed,
 * 404 = function unknown — both mean "no platform statement", never an error.
 */

const API = `${API_BASE}/api`;

type Envelope<T> = { success: boolean; data: T; error?: { message?: string } };

export interface PluginFunctionPlatform {
  platform: string;
  supported: boolean;
  qualifier: string | null;
}

export interface PluginFunctionSpec {
  plugin_id: string;
  plugin_name: string;
  function_name: string;
  alias: string | null;
  alias_kind: string | null;
  component: string | null;
  since_version: string | null;
  status: 'active' | 'deprecated' | 'removed';
  status_note: string | null;
  /** Documented successor from the deprecation note (may name a component). */
  replacement: string | null;
  /** Plugin release that removed the function (status 'removed' only). */
  removed_in: string | null;
  doc_version: string | null;
  platforms: PluginFunctionPlatform[];
}

/** Returns null when no statement exists (map missing or function unknown). */
export async function fetchPluginFunctionSpec(
  prefix: string,
  name: string,
): Promise<PluginFunctionSpec | null> {
  const url = `${API}/plugin-spec/functions/${encodeURIComponent(prefix)}/${encodeURIComponent(name)}`;
  try {
    const r = await fetch(url);
    if (r.status === 404 || r.status === 503) return null;
    const json: Envelope<PluginFunctionSpec> = await r.json();
    if (!r.ok || !json.success) return null;
    return json.data;
  } catch {
    return null;
  }
}
