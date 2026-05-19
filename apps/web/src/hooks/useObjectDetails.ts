import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchObjectDetails, type ObjectDetailsMeta } from '../api/detailsApi';

interface UseObjectDetailsResult {
  data: Array<Record<string, unknown>> | null;
  meta: ObjectDetailsMeta | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

// Session-scoped cache (keyed by uuid)
const cache = new Map<string, { data: Array<Record<string, unknown>>; meta: ObjectDetailsMeta }>();

/**
 * Hook to fetch type-specific object details via /api/get-details.
 * The API automatically selects the correct template based on the object's type.
 * Results are cached per UUID for the session.
 */
export const useObjectDetails = (uuid: string | undefined): UseObjectDetailsResult => {
  const [data, setData] = useState<Array<Record<string, unknown>> | null>(null);
  const [meta, setMeta] = useState<ObjectDetailsMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isFetchingRef = useRef(false);

  const fetchData = useCallback(async () => {
    if (!uuid || isFetchingRef.current) return;

    const cacheKey = `details:${uuid}`;
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
      const response = await fetchObjectDetails(uuid);
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
  }, [uuid]);

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
