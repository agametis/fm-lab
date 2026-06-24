import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchObjectDetails, type ObjectDetailsMeta } from '../api/detailsApi';

interface UseObjectDetailsResult {
  data: Array<Record<string, unknown>> | null;
  meta: ObjectDetailsMeta | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

// Session-scoped cache. Key = `details:${uuid}::${file ?? ''}` — Klon-
// Disambiguierung: geteilte UUIDs aus verschiedenen Dateien dürfen sich den
// Detail-Cache nicht teilen (sonst mischt der Detail-Inhalt zwei Klone).
const cache = new Map<string, { data: Array<Record<string, unknown>>; meta: ObjectDetailsMeta }>();

/**
 * Hook to fetch type-specific object details via /api/get-details.
 * The API automatically selects the correct template based on the object's type.
 * Results are cached per (UUID, File) for the session.
 *
 * `file` (Klon-Disambiguierung): optionaler File_Name; ohne ihn gilt Graceful
 * Downgrade (bare UUID, solange eindeutig; sonst 409 AMBIGUOUS_UUID).
 */
export const useObjectDetails = (
  uuid: string | undefined,
  file?: string | null,
): UseObjectDetailsResult => {
  const [data, setData] = useState<Array<Record<string, unknown>> | null>(null);
  const [meta, setMeta] = useState<ObjectDetailsMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isFetchingRef = useRef(false);

  const fetchData = useCallback(async () => {
    if (!uuid || isFetchingRef.current) return;

    const cacheKey = `details:${uuid}::${file ?? ''}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      setData(cached.data);
      setMeta(cached.meta);
      setLoading(false);
      setError(null);
      return;
    }

    isFetchingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const response = await fetchObjectDetails(uuid, file);
      const resultMeta = response.meta || {};
      cache.set(cacheKey, { data: response.data, meta: resultMeta });
      setData(response.data);
      setMeta(resultMeta);
    } catch (err) {
      console.error('Object details fetch failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to load details');
    } finally {
      isFetchingRef.current = false;
      setLoading(false);
    }
  }, [uuid, file]);

  useEffect(() => {
    if (uuid) {
      fetchData();
    } else {
      setData(null);
      setMeta(null);
      setLoading(false);
      setError(null);
    }
  }, [fetchData, uuid]);

  return { data, meta, loading, error, retry: fetchData };
};
