import { useEffect, useMemo, useState } from 'react';
import { getDashboard } from '../api/dashboardApi';
import { useApiLang } from './useApiLang';

/**
 * Findings-Kontext für die RefOriginPill: löst `?ref_src=<dashboard-id>` und
 * `?ref_msgid=<token>` gegen das lokalisierte Dashboard-Manifest auf.
 *
 * Der Server wendet die Sprach-Overlays an (`GET /api/dashboards/:id?lang=…`
 * → dashboard-i18n.service), der Client wählt nur den Katalog-Eintrag
 * `manifest.messages[msgid]` und interpoliert `{name}`-Platzhalter aus den
 * `ref_arg_<name>`-URL-Params. UI-Sprachwechsel → neuer Fetch → neue Sprache.
 *
 * Caching: In-Memory pro `${id}::${lang}` mit 5min TTL (analog useRefOrigin).
 */

export interface RefContextState {
  status: 'idle' | 'loading' | 'resolved' | 'error';
  /** Localized dashboard title (source line). */
  title: string | null;
  /** Localized, interpolated message — null when msgid is absent/unknown. */
  message: string | null;
}

const IDLE: RefContextState = { status: 'idle', title: null, message: null };

interface CacheEntry {
  ts: number;
  title: string;
  messages: Record<string, string>;
}

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

function interpolate(template: string, args: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(args, name) ? args[name] : whole,
  );
}

export function useRefContext(
  dashboardId: string | null,
  msgId: string | null,
  args: Record<string, string>,
): RefContextState {
  const lang = useApiLang();
  const [entry, setEntry] = useState<CacheEntry | null>(null);
  const [status, setStatus] = useState<RefContextState['status']>('idle');

  useEffect(() => {
    if (!dashboardId) {
      setEntry(null);
      setStatus('idle');
      return;
    }
    const key = `${dashboardId}::${lang}`;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.ts <= TTL_MS) {
      setEntry(cached);
      setStatus('resolved');
      return;
    }
    let stale = false;
    setStatus('loading');
    getDashboard(dashboardId, lang)
      .then(env => {
        if (stale) return;
        const fresh: CacheEntry = {
          ts: Date.now(),
          title: env.manifest.title,
          messages: env.manifest.messages ?? {},
        };
        cache.set(key, fresh);
        setEntry(fresh);
        setStatus('resolved');
      })
      .catch(() => {
        if (stale) return;
        setEntry(null);
        setStatus('error');
      });
    return () => { stale = true; };
  }, [dashboardId, lang]);

  return useMemo(() => {
    if (!dashboardId || status === 'idle') return IDLE;
    if (status !== 'resolved' || !entry) return { status, title: null, message: null };
    const template = msgId ? entry.messages[msgId] : undefined;
    return {
      status,
      title: entry.title,
      message: template ? interpolate(template, args) : null,
    };
  }, [dashboardId, msgId, args, entry, status]);
}
