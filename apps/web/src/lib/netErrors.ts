/**
 * Geteilte Transport-Fehler-Klassifikation für fetch-basierte API-Aufrufer
 * (useInfiniteSearch, dashboardApi, …).
 */

/**
 * Erkennt Netzwerk-/Verbindungsfehler. Zwei Ausprägungen:
 *  1. `fetch` lehnt direkt ab (kein Proxy / Ziel down) → TypeError mit
 *     „Failed to fetch" (Chromium), „Load failed" (Safari/WebKit),
 *     „NetworkError…" (Firefox).
 *  2. Die Verbindung stirbt erst während des Body-Downloads → `res.json()`
 *     wirft denselben TypeError, obwohl `fetch()` längst resolved war.
 */
export function isConnectionError(err: unknown): boolean {
  if (err instanceof TypeError) {
    const m = err.message.toLowerCase();
    return (
      m.includes('failed to fetch') ||
      m.includes('load failed') ||
      m.includes('networkerror') ||
      m.includes('network request failed')
    );
  }
  return false;
}

/**
 * Erkennt einen per AbortController abgebrochenen fetch. Aborts sind kein
 * Fehlerzustand — Aufrufer kehren still zurück statt eine Fehlerbox zu zeigen.
 */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}
