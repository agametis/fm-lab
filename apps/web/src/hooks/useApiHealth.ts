import { useEffect, useState } from 'react';

export type ApiHealth = 'checking' | 'online' | 'offline';

/**
 * Live health probe for a REST-API base URL.
 *
 * Pings `${targetUrl}/api/version` shortly after `targetUrl` changes (debounced)
 * and then on a fixed interval, so the settings UI can show a live 🟢/🔴 dot for
 * exactly the URL currently in the input field. Each probe is aborted after a
 * short timeout; any network/HTTP error counts as offline.
 */
export function useApiHealth(targetUrl: string, intervalMs = 5000): ApiHealth {
  const [status, setStatus] = useState<ApiHealth>('checking');

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const base = (targetUrl || '').replace(/\/+$/, '');

    const ping = async () => {
      if (cancelled) return;
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 3000);
      try {
        const res = await fetch(`${base}/api/version`, { signal: ctrl.signal });
        if (!cancelled) setStatus(res.ok ? 'online' : 'offline');
      } catch {
        if (!cancelled) setStatus('offline');
      } finally {
        clearTimeout(to);
        if (!cancelled) timer = setTimeout(ping, intervalMs);
      }
    };

    setStatus('checking');
    // Debounce so typing into the URL field doesn't spam requests.
    const start = setTimeout(ping, 400);

    return () => {
      cancelled = true;
      clearTimeout(start);
      if (timer) clearTimeout(timer);
    };
  }, [targetUrl, intervalMs]);

  return status;
}
