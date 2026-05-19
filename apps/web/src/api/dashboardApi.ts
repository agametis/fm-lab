/**
 * Dashboard-API-Client (PRD: prd_dashboards.md §7.2).
 * Verwendet plain fetch wie der Rest des Frontends — kein react-query.
 */

const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3003';
const API = `${baseUrl}/api`;

export interface DashboardListItem {
  id: string;
  title: string;
  description: string | null;
  icon: string | null;
  tags: string[];
  category: string | null;
  author: string | null;
  version: string | null;
}

export interface DashboardDatasetSpec {
  id: string;
  source: string;
  params?: Record<string, unknown>;
  description?: string;
}

export interface DashboardManifest {
  id: string;
  version?: string;
  title: string;
  description?: string;
  author?: string;
  icon?: string;
  category?: string;
  tags: string[];
  entry: string;
  datasets: DashboardDatasetSpec[];
  params: Array<{
    name: string;
    type: 'string' | 'number' | 'boolean';
    required: boolean;
    default?: unknown;
    description?: string;
  }>;
  permissions: { read_only: boolean; allow_navigation: boolean };
}

export interface LayoutNode {
  type: string;
  props?: Record<string, unknown>;
  data?: { dataset?: string } & Record<string, unknown>;
  children?: LayoutNode[];
}

export interface DashboardLayout {
  schemaVersion: number;
  root: LayoutNode;
}

export interface DashboardEnvelope {
  manifest: DashboardManifest;
  layout: DashboardLayout;
}

export interface DatasetResult {
  data: Array<Record<string, unknown>>;
  meta: { source: string; [k: string]: unknown };
  error?: string;
}

export type DashboardDataResponse = Record<string, DatasetResult>;

function buildQuery(params: Record<string, unknown> | undefined): string {
  if (!params) return '';
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error?.message ?? '';
    } catch {
      /* ignore */
    }
    throw new Error(`HTTP ${res.status} ${detail || res.statusText}`);
  }
  const body = await res.json();
  if (body?.success === false) {
    throw new Error(body?.error?.message || 'Unknown API error');
  }
  return body.data as T;
}

export async function listDashboards(lang?: string): Promise<DashboardListItem[]> {
  return getJson<DashboardListItem[]>(`/dashboards${buildQuery(lang ? { lang } : undefined)}`);
}

export async function getDashboard(id: string, lang?: string): Promise<DashboardEnvelope> {
  return getJson<DashboardEnvelope>(
    `/dashboards/${encodeURIComponent(id)}${buildQuery(lang ? { lang } : undefined)}`,
  );
}

export async function getDashboardData(
  id: string,
  params?: Record<string, unknown>,
  lang?: string,
): Promise<DashboardDataResponse> {
  const merged = lang ? { ...(params || {}), lang } : params;
  const wrapper = await getJson<{ datasets: DashboardDataResponse }>(
    `/dashboards/${encodeURIComponent(id)}/data${buildQuery(merged)}`
  );
  return wrapper.datasets;
}

export async function getDashboardDataset(
  id: string,
  dataset: string,
  params?: Record<string, unknown>,
  lang?: string,
): Promise<DatasetResult> {
  const merged = lang ? { ...(params || {}), lang } : params;
  return getJson<DatasetResult>(
    `/dashboards/${encodeURIComponent(id)}/data/${encodeURIComponent(dataset)}${buildQuery(merged)}`
  );
}
