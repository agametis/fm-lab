import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'fm-lab-theme';

function readDomTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  const value = document.documentElement.getAttribute('data-theme');
  return value === 'dark' ? 'dark' : 'light';
}

function readSavedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'dark' || value === 'light' ? value : null;
  } catch {
    return null;
  }
}

function writeSavedTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Persistenz nicht möglich (z.B. Inkognito) — kein Fehler, In-Memory bleibt erhalten.
  }
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => readDomTheme());

  const setTheme = useCallback((next: Theme) => {
    applyTheme(next);
    writeSavedTheme(next);
    setThemeState(next);
  }, []);

  const toggle = useCallback(() => {
    setTheme(readDomTheme() === 'dark' ? 'light' : 'dark');
  }, [setTheme]);

  // Cross-Tab-Sync
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY) return;
      const next: Theme = e.newValue === 'dark' ? 'dark' : 'light';
      applyTheme(next);
      setThemeState(next);
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Same-Tab-Sync: jede useTheme-Instanz hält EIGENEN State; der storage-Event
  // feuert aber nur in ANDEREN Tabs. Ohne diesen Beobachter bemerkt z.B. der
  // Graph-Explorer (eigene useTheme-Instanz) einen Toggle über die ThemeToggle
  // nicht → sein theme-State bleibt stale, die an [theme] hängenden Cytoscape-
  // Stylesheet-Rebuilds feuern nicht, und die Kantenfarben aktualisieren sich
  // erst beim Reload. Ein MutationObserver auf data-theme (die Quelle der
  // Wahrheit, von applyTheme gesetzt) re-synchronisiert ALLE Instanzen sofort.
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(() => setThemeState(readDomTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  // OS-prefers-color-scheme nur folgen, solange der User nicht manuell gewählt hat
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    function onChange(e: MediaQueryListEvent) {
      if (readSavedTheme() !== null) return; // manuelle Wahl gilt
      const next: Theme = e.matches ? 'dark' : 'light';
      applyTheme(next);
      setThemeState(next);
    }
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    // Safari ältere Versionen
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, []);

  return { theme, setTheme, toggle };
}
