import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { api } from '../api/client';

/**
 * Plugin feature descriptor as returned by /api/version → features.
 */
export interface PluginFeatureUi {
  frontend_module?: string;
  supported_object_types?: string[];
}

export interface PluginFeature {
  enabled: boolean;
  version: string;
  description: string;
  routes_prefix: string;
  config: Record<string, string>;
  ui?: PluginFeatureUi | null;
}

export interface FeaturesState {
  features: Record<string, PluginFeature>;
  loading: boolean;
  isEnabled: (name: string) => boolean;
  getConfig: (name: string) => Record<string, string> | null;
  getUi: (name: string) => PluginFeatureUi | null;
  /** Re-fetch /api/version so plugin enabled/config changes apply without a reload. */
  refresh: () => Promise<void>;
}

const OVERRIDE_PREFIX = 'feature_override_';

function resolveEnabled(name: string, serverEnabled: boolean): boolean {
  try {
    const override = localStorage.getItem(`${OVERRIDE_PREFIX}${name}`);
    if (override === 'force_on') return true;
    if (override === 'force_off') return false;
  } catch {
    // localStorage unavailable
  }
  return serverEnabled;
}

/**
 * Hook that fetches /api/version once and caches the `features` map.
 * Supports localStorage overrides per plugin.
 */
export function useFeatures(): FeaturesState {
  const [features, setFeatures] = useState<Record<string, PluginFeature>>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await api.version() as { data?: { features?: Record<string, PluginFeature> } };
      setFeatures(res.data?.features ?? {});
    } catch {
      setFeatures({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    (api.version() as Promise<{ data?: { features?: Record<string, PluginFeature> } }>).then((res) => {
      if (cancelled) return;
      setFeatures(res.data?.features ?? {});
    }).catch(() => {
      if (!cancelled) setFeatures({});
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, []);

  const isEnabled = useCallback(
    (name: string) => {
      const feature = features[name];
      if (!feature) return resolveEnabled(name, false);
      return resolveEnabled(name, feature.enabled);
    },
    [features],
  );

  const getConfig = useCallback(
    (name: string) => features[name]?.config ?? null,
    [features],
  );

  const getUi = useCallback(
    (name: string) => features[name]?.ui ?? null,
    [features],
  );

  return { features, loading, isEnabled, getConfig, getUi, refresh };
}

/**
 * Context for feature flags — provided at app root.
 */
export const FeaturesContext = createContext<FeaturesState>({
  features: {},
  loading: true,
  isEnabled: () => false,
  getConfig: () => null,
  getUi: () => null,
  refresh: async () => {},
});

export const useFeaturesContext = () => useContext(FeaturesContext);
