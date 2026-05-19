import { useEffect, useRef, useState } from 'react';
import { fetchTemplateQuery } from '../api/templateApi';

export type LayoutObject = {
  object_uuid: string;
  object_id: number;
  object_type: string;
  object_name: string | null;
  text_content: string | null;
  abs_top: number;
  abs_left: number;
  abs_bottom: number;
  abs_right: number;
  nesting_level: number;
  z_order: number | null;
  parent_object_id: number | null;
  part_type: string | null;
  hide_text: string | null;
  tooltip_text: string | null;
  label_calc_text: string | null;
  has_conditional_fmt: boolean;
  field_uuid: string | null;
  field_name: string | null;
  script_uuid: string | null;
  script_name: string | null;
};

export type LayoutPart = {
  part_type: string;
  part_kind: number;
  part_size: number;
  part_absolute: number;
  object_count: number;
  layout_name: string;
  layout_uuid: string;
  layout_to_name: string | null;
  file_name: string;
};

export type LayoutData = {
  objects: LayoutObject[];
  parts: LayoutPart[];
  layoutName: string;
  layoutToName: string | null;
  fileName: string;
};

type Result = {
  data: LayoutData | null;
  loading: boolean;
  error: string | null;
};

const cache = new Map<string, LayoutData>();

/**
 * Lädt Layout-Objekte und Layout-Parts parallel über die beiden Custom-SQL-Templates
 * `display_layout_objects_data` und `display_layout_parts_data`. Cached pro Layout-UUID.
 */
export function useLayoutData(uuid: string | undefined): Result {
  const [data, setData] = useState<LayoutData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastUuidRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!uuid) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    const cached = cache.get(uuid);
    if (cached) {
      setData(cached);
      setError(null);
      setLoading(false);
      lastUuidRef.current = uuid;
      return;
    }

    let cancelled = false;
    lastUuidRef.current = uuid;
    setLoading(true);
    setError(null);

    Promise.all([
      fetchTemplateQuery('display_layout_objects_data', { uuid }),
      fetchTemplateQuery('display_layout_parts_data', { uuid }),
    ])
      .then(([objectsRes, partsRes]) => {
        if (cancelled) return;
        const objects = (objectsRes.data as unknown as LayoutObject[]) ?? [];
        const parts = (partsRes.data as unknown as LayoutPart[]) ?? [];
        const first = parts[0];
        const layoutData: LayoutData = {
          objects,
          parts,
          layoutName: first?.layout_name ?? '',
          layoutToName: first?.layout_to_name ?? null,
          fileName: first?.file_name ?? '',
        };
        cache.set(uuid, layoutData);
        setData(layoutData);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load layout');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [uuid]);

  return { data, loading, error };
}
