import { API_BASE } from '../config/apiBase';

/**
 * Results-API-Client — the unified result layer (Result Envelope v1).
 * Read endpoints only ever read the server cache; POST /run is the explicit
 * trigger. Plain fetch like the rest of the frontend (X-Solution header is
 * attached by the global fetch patch).
 */

const API = `${API_BASE}/api`;

export type ResultRunStatus = 'ran' | 'failed' | 'skipped' | 'pending';
export type ResultState = 'ok' | 'warning' | 'error' | 'neutral';
/** Display state = runStatus × resultState collapsed for chips/filters. */
export type ResultDisplayState = ResultState | 'failed' | 'pending';

export interface ResultRef {
  kind: 'dashboard' | 'query' | 'test';
  id: string;
}

export interface ResultEnvelope {
  ref: ResultRef;
  rubric: string | null;
  title: string;
  runStatus: ResultRunStatus;
  resultState: ResultState | null;
  value: number | boolean | null;
  type?: string | null;
  unit: string | null;
  name: string | null;
  meaning: string | null;
  severity: string | null;
  source: string | null;
  error?: string;
  fingerprint: string | null;
  at: number | null;
  durationMs: number | null;
}

export interface ResultsSummary {
  meta: { solution: string | null; catalogFingerprint: string | null };
  results: Record<string, ResultEnvelope>;
}

export interface ResultsRunResponse {
  meta: {
    solution: string | null;
    catalogFingerprint: string | null;
    durationMs: number;
    requested: number;
    executed: number;
    skippedCached: number;
  };
  results: ResultEnvelope[];
}

export type ResultsRunTarget =
  | { kind: 'dashboard' | 'query'; id: string }
  | { kind: 'folder'; path: string; kinds?: Array<'dashboard' | 'query'> };

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, init);
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

export async function getResultsSummary(kinds?: string[]): Promise<ResultsSummary> {
  const qs = kinds && kinds.length ? `?kinds=${encodeURIComponent(kinds.join(','))}` : '';
  return getJson<ResultsSummary>(`/results/summary${qs}`);
}

export async function runResults(
  targets: ResultsRunTarget[],
  mode: 'missing' | 'refresh' = 'missing',
): Promise<ResultsRunResponse> {
  return getJson<ResultsRunResponse>('/results/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targets, mode }),
  });
}

/** Collapses the two-axis model into the single display state for chips/filters. */
export function displayState(e: ResultEnvelope): ResultDisplayState {
  if (e.runStatus === 'ran' && e.resultState) return e.resultState;
  if (e.runStatus === 'failed') return 'failed';
  return 'pending';
}
