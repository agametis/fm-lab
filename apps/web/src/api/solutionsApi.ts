import { API_BASE } from '../config/apiBase';

/**
 * Multi-solution API (Phase 1): list / activate / create / delete solution
 * bundles. Plain fetch on purpose — these admin endpoints are not part of the
 * generated OpenAPI client surface.
 */

export interface SolutionInfo {
  id: string;
  uuid: string | null;
  display_name: string;
  description: string;
  maintainer: string;
  created_at: string | null;
  size_mb: number | null;
  file_count: number | null;
  objects: number | null;
  last_import_at: string | null;
  last_run_duration_ms: number | null;
  db_schema_version: string | null;
  metrics_generated_at: string | null;
  is_active: boolean;
  /** Live-Import-Status (per-Solution-Lock + Hub) — sichtbar auch für CLI-Läufe. */
  import_running: boolean;
  import_source: string | null;
  import_started_at: string | null;
}

async function unwrap<T>(res: Response): Promise<T> {
  const json = await res.json();
  if (!json.success) {
    throw new Error(json.error?.message || `Request failed (HTTP ${res.status})`);
  }
  return json.data as T;
}

export async function fetchSolutions(): Promise<SolutionInfo[]> {
  const res = await fetch(`${API_BASE}/api/solutions`);
  const data = await unwrap<{ solutions: SolutionInfo[] }>(res);
  return data.solutions;
}

export async function activateSolution(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/admin/solution/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  await unwrap(res);
}

export async function createSolution(id: string, displayName?: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/solutions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, display_name: displayName || id }),
  });
  await unwrap(res);
}

export async function renameSolution(id: string, displayName: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/solutions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ display_name: displayName }),
  });
  await unwrap(res);
}

/**
 * Bundle-Rename (Ordnername/ID; die Manifest-UUID bleibt die Identität) —
 * getrennt vom Anzeigename-PATCH (renameSolution), eigener Admin-Endpoint.
 * Liefert `was_active`: dann hat der Server Pointer + Reload bereits
 * nachgezogen und der Client sollte die Seite neu laden.
 */
export async function renameSolutionBundle(
  from: string,
  to: string,
): Promise<{ from: string; to: string; was_active: boolean }> {
  const res = await fetch(`${API_BASE}/api/admin/solution/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to }),
  });
  return unwrap(res);
}

export async function deleteSolution(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/solutions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  await unwrap(res);
}
