import { API_BASE } from '../config/apiBase';
/**
 * Dashboard-API-Client.
 * Verwendet plain fetch wie der Rest des Frontends — kein react-query.
 */

const baseUrl = API_BASE;
const API = `${baseUrl}/api`;

export interface DashboardListItem {
  id: string;
  title: string;
  description: string | null;
  icon: string | null;
  tags: string[];
  category: string | null;
  /** Relative folder path (without the bundle id), null = root. Drives the grouped navigation. */
  folder: string | null;
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

/**
 * Declarative visibility guard on a layout node. Reads the first row of a dataset
 * and shows the node only when the condition holds (absent = always visible).
 * Used e.g. to hide the data cards on the home dashboard while the catalog is empty
 * (`db_empty` truthy) so only the "convert your XML" card remains.
 */
export interface VisibleWhen {
  /** Dataset id whose first row is tested. */
  dataset: string;
  /** Field on that row to read. */
  field: string;
  /** Show only when the field strictly equals this value. */
  equals?: unknown;
  /** Show only when the field does NOT strictly equal this value. */
  notEquals?: unknown;
  /** Show only when the field is truthy (`true`) / falsy (`false`). */
  truthy?: boolean;
}

export interface LayoutNode {
  type: string;
  /** Stable anchor for server-side i18n overrides (see dashboard-i18n.service). */
  id?: string;
  props?: Record<string, unknown>;
  data?: { dataset?: string } & Record<string, unknown>;
  children?: LayoutNode[];
  /** Optional declarative visibility guard (absent = always visible). */
  visibleWhen?: VisibleWhen;
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
