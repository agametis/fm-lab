import { useEffect, useState } from 'react';
import { fetchTemplateQuery } from '../api/templateApi';
import { getSelectedSolution } from '../lib/solutionStore';

/**
 * Effective change stamp of one object from `object_change_meta`: its own stamp
 * (`own`) or — for object types without a stamp of their own (script steps,
 * layout objects/parts, calculations, script triggers, menu items) — the stamp
 * of its container (`container`). `null` when neither exists.
 *
 * Times are the local time of the editing client without time zone
 * (`YYYY-MM-DD HH:MM:SS`), passed through as text.
 */
export type ObjectChangeMeta = {
  meta_source: 'own' | 'container';
  stamp_uuid: string;
  stamp_file: string;
  stamp_type: string;
  stamp_name: string | null;
  stamp_source_table: string | null;
  modified_at: string | null;
  modified_by: string | null;
  modified_account: string | null;
  modifications: number | null;
  author_key: string | null;
  /** Import classification: 'tool' | 'runtime' | null (= person). */
  author_kind: string | null;
  /** Display name of the person (curated alias, else the most frequent spelling). */
  author_display: string | null;
  /** Person key (curated alias target, else the author key) — filter of the changes dashboard. */
  person_key: string | null;
  author_is_technical: boolean | null;
  bulk_event_id: number | null;
  /** 'file' | 'solution' */
  bulk_scope: string | null;
  /** 'mass_action' | 'tool' | 'paste_import' */
  bulk_kind: string | null;
  bulk_start: string | null;
  bulk_end: string | null;
  bulk_files: number | null;
  bulk_objects: number | null;
};

/** Types that never carry a stamp — no request needed. */
const NO_STAMP_TYPES = new Set([
  'Variable', 'BuiltinFunction', 'PluginFunction', 'PluginComponent',
  'ScriptStepType', 'PasteIndexObject', 'File',
]);

const cache = new Map<string, ObjectChangeMeta | null>();

/** Drops cached stamps — e.g. after an author alias changed the display names. */
export function clearObjectChangeMetaCache(): void {
  cache.clear();
}

export function useObjectChangeMeta(
  uuid: string | null | undefined,
  file: string | null | undefined,
  objectType: string | null | undefined,
): ObjectChangeMeta | null {
  const skip = !uuid || (objectType != null && NO_STAMP_TYPES.has(objectType));
  const key = `${getSelectedSolution() ?? ''}::${uuid ?? ''}::${file ?? ''}`;
  const [state, setState] = useState<{ key: string; meta: ObjectChangeMeta | null }>(
    () => ({ key, meta: cache.get(key) ?? null }),
  );

  useEffect(() => {
    if (skip || !uuid) return;
    if (cache.has(key)) {
      setState({ key, meta: cache.get(key) ?? null });
      return;
    }
    let cancelled = false;
    const params: Record<string, string> = { uuid };
    if (file) params.file = file;
    fetchTemplateQuery('object_change_meta', params)
      .then((res) => {
        const row = ((res.data as unknown as ObjectChangeMeta[]) ?? [])[0] ?? null;
        cache.set(key, row);
        if (!cancelled) setState({ key, meta: row });
      })
      .catch(() => {
        // Catalog without change metadata (older schema) or API gap: the header
        // line simply stays hidden.
        if (!cancelled) setState({ key, meta: null });
      });
    return () => { cancelled = true; };
  }, [key, skip, uuid, file]);

  if (skip) return null;
  return state.key === key ? state.meta : null;
}
