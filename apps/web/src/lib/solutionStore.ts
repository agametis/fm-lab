/**
 * Client-side solution selection (multiuser preparation).
 *
 * Phase 1 has ONE global active solution on the server; the picker switches it
 * via POST /api/admin/solution/activate. Nevertheless the selection is kept in
 * localStorage + URL param from day one and sent as `X-Solution` header with
 * every generated-client request — the server accepts and IGNORES the header
 * in phase 1. Stage M turns this into the per-tab selection without any
 * further frontend rework.
 */

const STORAGE_KEY = 'fmlab.solution';
const URL_PARAM = 'solution';

export function getSelectedSolution(): string | null {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get(URL_PARAM);
    if (fromUrl) return fromUrl;
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setSelectedSolution(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable (private mode) — selection stays session-only */
  }
}
