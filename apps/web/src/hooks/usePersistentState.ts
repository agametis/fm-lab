import { useCallback, useState } from 'react';

/**
 * localStorage-gestützter State für **Browser-lokale View-Präferenzen** (Vorbilder:
 * Theme in useTheme.ts, Sprache, GraphExplorer-Panel-Breiten `fmlab.explorer.*`).
 *
 * Anders als URL-State (`useSearchParams`) ist das KEIN Navigations-Zustand: es
 * gehört nicht in Deep-Links und soll „Zurück"/Reload überleben. Genau deshalb
 * eignet es sich für Toggles wie „Ausgeblendete: dimmen | ausblenden", die als
 * URL-Param bei Browser-Back verloren gingen.
 *
 * Der `allowed`-Whitelist-Check härtet gegen manipulierte/veraltete Werte im
 * Storage ab (fällt dann auf `fallback`). Schreiben/Lesen ist try/catch-gekapselt
 * (Privat-Modus etc.) — schlägt es fehl, bleibt der Wert in-memory erhalten.
 */
export function usePersistentState<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[],
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
    } catch {
      return fallback;
    }
  });

  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, next);
      } catch {
        /* Persistenz nicht möglich (z. B. Inkognito) — In-Memory bleibt erhalten. */
      }
    },
    [key],
  );

  return [value, set];
}
