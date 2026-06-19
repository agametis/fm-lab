import { API_BASE } from '../config/apiBase';
// Plugin-Doku-API mit Modul-Cache. Liefert HTML-Inhalte pro
// (source, function, level) — bei Hover lazy fetchen, beim "Mehr Details"
// auf level=long upgraden.

const baseUrl = API_BASE;

export type PluginLevel = 'short' | 'long' | 'both';

export interface PluginDoc {
  source: string;
  function: string;
  found: boolean;
  metadata?: {
    name: string;
    component?: string;
    /** Synthetische PluginComponent-UUID für Cross-Navigation (PRD pseudo_object_types §5). */
    componentUuid?: string | null;
    version?: string;
    signature?: string;
    result?: string;
    url?: string;
    platforms?: Record<string, boolean>;
  };
  short?: { format: 'html'; content: string };
  long?: { format: 'html'; content: string };
}

const cache = new Map<string, Promise<PluginDoc>>();
const MAX_CACHE = 200;

function cacheKey(source: string, fn: string, level: PluginLevel): string {
  return `${source}::${fn}::${level}`;
}

export async function fetchPluginDoc(
  source: string,
  fn: string,
  level: PluginLevel = 'short',
): Promise<PluginDoc> {
  const key = cacheKey(source, fn, level);
  const hit = cache.get(key);
  if (hit) return hit;

  const promise = (async () => {
    const params = new URLSearchParams({ level });
    const response = await fetch(
      `${baseUrl}/api/plugin-docs/${encodeURIComponent(source)}/${encodeURIComponent(fn)}?${params}`,
    );
    if (!response.ok) {
      throw new Error(`Plugin-Doku-Request fehlgeschlagen: ${response.status}`);
    }
    const json = await response.json();
    return json.data as PluginDoc;
  })().catch(err => {
    // Errors NICHT cachen — Auto-Recovery
    cache.delete(key);
    throw err;
  });

  cache.set(key, promise);

  // LRU-light: bei Überlauf ältesten Eintrag droppen
  if (cache.size > MAX_CACHE) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }

  return promise;
}
