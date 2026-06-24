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
 *
 * `file` (Klon-Disambiguierung): File_Name des Objekts. Da die fmp-URL die Datei
 * als erstes Pfadsegment trägt, würde ein bare-UUID-Deeplink bei geteilten Klon-
 * UUIDs in die falsche Datei zeigen. Mit `file` löst der Backend-`buildUri` das
 * Paar (UUID, File_Name) eindeutig auf (sonst Graceful Downgrade / 409).
 */
export function useFmideUri(uuid: string | undefined, file?: string | null) {
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

    const q = new URLSearchParams({ uuid });
    if (file) q.set('file', file);
    fetch(`${API_BASE}/api/fmide/uri?${q.toString()}`)
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
  }, [uuid, enabled, file]);

  return { data, loading, enabled };
}

/**
 * Build the goto URL for a UUID (no fetch needed — just the redirect endpoint).
 * `file` disambiguates geteilte Klon-UUIDs (siehe useFmideUri).
 */
export function buildGotoUrl(uuid: string, file?: string | null): string {
  const q = new URLSearchParams({ uuid });
  if (file) q.set('file', file);
  return `${API_BASE}/api/fmide/goto?${q.toString()}`;
}
