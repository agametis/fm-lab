import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * Cross-primitive selection channel for one rendered dashboard.
 *
 * Motivation: a lens table (e.g. the profiles of an Analysis Test) and the
 * list it narrows (the test's members) are two sibling `Table` nodes. A column
 * per lens value would widen the already wide list; instead the lens row is
 * clicked and every matching row of the other table is tinted.
 *
 * Deliberately view-only and ephemeral: no URL param, no dataset refetch, and
 * the state dies with the renderer (page change resets it). Channels are named
 * (`selectionKey`) so several independent lenses can coexist on one page.
 */
interface SelectionState {
  /** channel → currently selected value (null = nothing selected). */
  selection: Record<string, string | null>;
  /** Selecting the already-selected value clears it (click again = off). */
  toggle: (key: string, value: string) => void;
}

const SelectionContext = createContext<SelectionState>({
  selection: {},
  toggle: () => { /* no provider (e.g. isolated primitive test) — selection is a no-op */ },
});

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<Record<string, string | null>>({});
  const toggle = useCallback((key: string, value: string) => {
    setSelection(cur => ({ ...cur, [key]: cur[key] === value ? null : value }));
  }, []);
  const value = useMemo(() => ({ selection, toggle }), [selection, toggle]);
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useSelection(): SelectionState {
  return useContext(SelectionContext);
}
