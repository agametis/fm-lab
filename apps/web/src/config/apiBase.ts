/**
 * Central resolution of the REST-API base URL.
 *
 * Precedence (highest first):
 *   1. User override persisted in `.fmlab/settings.json` (server-side), mirrored
 *      into `localStorage["fmlab.apiUrl"]` so it is available synchronously at
 *      startup — even when the build-time default server is unreachable.
 *   2. Build-time `VITE_API_URL` from `.env` (may be '' → same-origin proxy).
 *   3. Hard default `http://localhost:3003`.
 *
 * `API_BASE` is resolved once at module load (matching the existing per-module
 * `const baseUrl = …` pattern across the app). Changing the override therefore
 * requires a page reload to take effect — the settings UI reloads after saving.
 */

const STORAGE_KEY = 'fmlab.apiUrl';

/** Raw build-time value from `.env` (undefined → key absent, '' → proxy mode). */
const ENV_API_URL = import.meta.env.VITE_API_URL as string | undefined;

/** The effective `.env`-derived base (preserves the historic `?? default`). */
export const ENV_API_BASE = ENV_API_URL ?? 'http://localhost:3003';

/**
 * The `.env` value to surface as a placeholder in the settings field. When
 * `VITE_API_URL` is empty (proxy mode) we show the concrete fallback so the
 * user sees what the frontend actually talks to.
 */
export const ENV_API_URL_PLACEHOLDER = (ENV_API_URL && ENV_API_URL.trim())
  ? ENV_API_URL.trim()
  : 'http://localhost:3003';

/** The persisted override from localStorage, or null when unset. */
export function getApiUrlOverride(): string | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

/** Persist (or clear with null/'') the runtime override in localStorage. */
export function setApiUrlOverride(url: string | null): void {
  try {
    if (url && url.trim()) {
      localStorage.setItem(STORAGE_KEY, url.trim());
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // localStorage unavailable (private mode etc.) — override simply won't persist.
  }
}

/** The effective REST-API base URL used by every API call this session. */
export const API_BASE = getApiUrlOverride() ?? ENV_API_BASE;
