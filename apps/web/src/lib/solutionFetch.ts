import { API_BASE } from '../config/apiBase';
import { getSelectedSolution, setSelectedSolution } from './solutionStore';

/**
 * Global fetch instrumentation for the per-tab solution context (stage M).
 *
 * Installed ONCE in main.tsx. Two responsibilities, one choke point — so every
 * current and future call site participates (generated client, plain fetch in
 * hooks/views) and multiuser routing cannot silently drift:
 *
 * 1. Every request to the FM-Lab API carries the tab's solution selection as
 *    `X-Solution` header (unless the caller set one explicitly).
 * 2. Stale-selection recovery: the server answers 404/SOLUTION_NOT_FOUND for a
 *    selection that no longer exists (solution deleted/renamed elsewhere).
 *    Then the selection is cleared, a `solution` URL param is stripped and the
 *    app reloads once against the server default — instead of every view
 *    erroring out. A session flag prevents reload loops.
 *
 * EventSource cannot carry headers — SSE endpoints take `?solution=` instead
 * (the XML import page already passes it explicitly).
 */

const RESET_FLAG = 'fmlab.solution.resetAt';

function isApiUrl(url: string): boolean {
  return url.startsWith(`${API_BASE}/api`) || url.startsWith('/api');
}

function stripSolutionParamAndReload(): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('solution');
    window.history.replaceState(null, '', url.toString());
  } catch {
    /* URL API unavailable — plain reload below still recovers */
  }
  window.location.reload();
}

function recentlyReset(): boolean {
  try {
    const at = Number(window.sessionStorage.getItem(RESET_FLAG) || 0);
    return Date.now() - at < 5000;
  } catch {
    return false;
  }
}

function markReset(): void {
  try {
    window.sessionStorage.setItem(RESET_FLAG, String(Date.now()));
  } catch {
    /* private mode — loop guard degrades to none */
  }
}

/**
 * Stale Auswahl zurücksetzen (einmalig, loop-geschützt) — geteilt zwischen dem
 * globalen Wrapper und der onResponse-Middleware des generierten Clients.
 */
export function handleStaleSolutionSelection(selected: string): void {
  if (recentlyReset()) return;
  console.warn(
    `[solution] selection '${selected}' no longer exists — resetting to server default`,
  );
  markReset();
  setSelectedSolution(null);
  stripSolutionParamAndReload();
}

let installed = false;

export function installSolutionFetch(): void {
  if (installed) return;
  installed = true;
  const original = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!isApiUrl(url)) return original(input, init);

    let request = new Request(input, init);
    const selected = getSelectedSolution();
    if (selected && !request.headers.has('X-Solution')) {
      const headers = new Headers(request.headers);
      headers.set('X-Solution', selected);
      request = new Request(request, { headers });
    }

    const response = await original(request);

    // Stale-selection recovery — only when OUR selection is the rejected one
    // (admin calls may legitimately 404 for other ids).
    if (response.status === 404 && selected) {
      try {
        const body = await response.clone().json();
        if (
          body?.error?.code === 'SOLUTION_NOT_FOUND' &&
          typeof body.error.message === 'string' &&
          body.error.message.includes(selected)
        ) {
          handleStaleSolutionSelection(selected);
        }
      } catch {
        /* non-JSON 404 — not ours */
      }
    }

    return response;
  };
}
