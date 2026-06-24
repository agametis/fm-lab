import { createContext, useContext } from 'react';

/**
 * React-Context für die Datei (`File_Name`) des aktuell geöffneten Objekts.
 *
 * Klon-Disambiguierung: Geklonte/modulare FileMaker-Dateien teilen sich dieselbe
 * Object_UUID. Die Objekt-Identität ist deshalb das Paar (UUID, File_Name). Beim
 * Navigieren reist `?file=` als Begleiter der UUID mit; tief verschachtelte
 * Detail-Komponenten und Token-Spans brauchen aber den File-Kontext des aktuell
 * geöffneten Objekts, ohne ihn durch jede Ebene durchzureichen.
 *
 * Vermeidet Prop-Drilling analog zu {@link HighlightRefContext}:
 *   DetailView → TypeDetail → ObjectDetail → (Script|Field|CustomFunction…)Detail
 *   → …Viewer → CalcTokenSpan.
 *
 * Konsumenten:
 *   - Content-Hooks (`useObjectDetails`/`useLayoutData`) skopieren ihren Fetch
 *     und Cache auf (UUID, File).
 *   - `CalcTokenSpan` reicht den File-Kontext bei datei-lokalen Zielen
 *     (CustomFunction-Tokens) als `?file=` weiter.
 *
 * `null` = kein File-Kontext (Graceful Downgrade auf bare UUID).
 */
export const CurrentFileContext = createContext<string | null>(null);

export function useCurrentFile(): string | null {
  return useContext(CurrentFileContext);
}
