/**
 * Reactive holder for the CONTEXT solution's display name — used to label the
 * leading breadcrumb crumb (formerly the static "Start"/Home label) with the
 * solution's name across every sub-page.
 *
 * Stage M: the context is the per-tab selection (solutionStore) when set,
 * else the server default (is_active) — the breadcrumb must show what THIS
 * tab is looking at, never another user's server default.
 *
 * Loads once via GET /api/solutions (deduped) and notifies subscribers; a null
 * value means "no distinct name" → callers fall back to the localized Home label.
 * Mirrors the hero-tile rule (dashboard.controller.js): the `default` solution
 * without a custom display_name has no distinct name and stays on the fallback.
 */

import { useSyncExternalStore } from 'react';
import { fetchSolutions } from '../api/solutionsApi';
import { getSelectedSolution } from './solutionStore';

const DEFAULT_SOLUTION_ID = 'default';

let activeName: string | null = null;
let loaded = false;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function load() {
  if (loaded || inflight) return;
  inflight = fetchSolutions()
    .then((list) => {
      const selectedId = getSelectedSolution();
      const context = (selectedId && list.find((s) => s.id === selectedId))
        || list.find((s) => s.is_active);
      if (context && context.display_name && context.display_name !== context.id) {
        activeName = context.display_name; // custom display name → use it
      } else if (context && context.id !== DEFAULT_SOLUTION_ID) {
        activeName = context.id; // named non-default bundle without a display name
      } else {
        activeName = null; // default without display name → keep Home fallback
      }
      loaded = true;
      emit();
    })
    .catch(() => {
      // API offline / pre-migration server → stay on the fallback label.
      loaded = true;
    })
    .finally(() => {
      inflight = null;
    });
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  load();
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Active solution display name, or `null` when there is no distinct name to
 * show (default solution without a custom display name, or API unreachable).
 */
export function useActiveSolutionName(): string | null {
  return useSyncExternalStore(subscribe, () => activeName);
}
