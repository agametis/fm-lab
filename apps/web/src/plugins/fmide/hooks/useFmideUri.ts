import { API_BASE } from '../../../config/apiBase';
import { useState, useEffect } from 'react';
import { useFeaturesContext } from '../../../hooks/useFeatures';

export interface FmideUriResult {
  object_uuid: string;
  object_type: string;
  object_name: string;
  file_name: string;
  thingamajig_uri: string | null;
  fmp_url: string | null;
  supported: boolean;
  /** The fmIDE target script exists in this object's file. */
  script_available?: boolean;
  /** The fmIDE script passed signature verification ($fmide_version step). */
  script_valid?: boolean;
  fmide_version?: string | null;
}

/**
 * Fetches the fmIDE Thingamajig URI for a given object UUID.
 * Only fires when the fmide feature is enabled.
 */
export function useFmideUri(uuid: string | undefined) {
  const { isEnabled } = useFeaturesContext();
  const enabled = isEnabled('fmide');
  const [data, setData] = useState<FmideUriResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !uuid) {
      setData(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetch(`${API_BASE}/api/fmide/uri?uuid=${encodeURIComponent(uuid)}`)
      .then((res) => res.json())
      .then((json) => {
        if (!cancelled && json.success) {
          setData(json.data);
        }
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [uuid, enabled]);

  return { data, loading, enabled };
}

/**
 * Build the goto URL for a UUID (no fetch needed — just the redirect endpoint).
 */
export function buildGotoUrl(uuid: string): string {
  return `${API_BASE}/api/fmide/goto?uuid=${encodeURIComponent(uuid)}`;
}
