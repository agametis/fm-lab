/**
 * Client-side solution selection (stage M, per-tab).
 *
 * localStorage allein ist BROWSER-weit — Tab B würde die Auswahl von Tab A
 * überschreiben, beide Tabs zeigten danach dieselbe Lösung. Deshalb zweistufig:
 *
 *   - sessionStorage  = die Identität DIESES Tabs. Wird beim ersten Lesen
 *     gestempelt (der Tab „adoptiert" seinen Startwert) und ist ab da immun
 *     gegen Wechsel in anderen Tabs. Der Sentinel '' bedeutet „bewusst dem
 *     Server-Default folgen".
 *   - localStorage    = nur noch die SAAT für künftig neu geöffnete Tabs
 *     (sie erben bequem die zuletzt gewählte Lösung).
 *
 * Lese-Priorität: URL-Param `solution` (Deep-Link, stempelt den Tab) >
 * sessionStorage > localStorage (einmalig adoptiert). Die Auswahl wandert als
 * `X-Solution`-Header mit jedem Request (lib/solutionFetch.ts + api/client.ts).
 */

const STORAGE_KEY = 'fmlab.solution';      // localStorage: Saat für neue Tabs
const SESSION_KEY = 'fmlab.solution.tab';  // sessionStorage: Identität dieses Tabs
const URL_PARAM = 'solution';

function stampTab(value: string): void {
  try {
    window.sessionStorage.setItem(SESSION_KEY, value);
  } catch {
    /* storage unavailable (private mode) — Tab bleibt un-gestempelt */
  }
}

export function getSelectedSolution(): string | null {
  try {
    // 1. Deep-Link übersteuert und wird Tab-Identität (der Param geht beim
    //    Navigieren verloren — ohne Stempel fiele der Tab danach zurück).
    const fromUrl = new URLSearchParams(window.location.search).get(URL_PARAM);
    if (fromUrl) {
      stampTab(fromUrl);
      return fromUrl;
    }
    // 2. Tab-Identität ('' = bewusst Server-Default).
    const fromTab = window.sessionStorage.getItem(SESSION_KEY);
    if (fromTab !== null) return fromTab === '' ? null : fromTab;
    // 3. Erster Zugriff dieses Tabs: Saat adoptieren und stempeln — auch die
    //    leere Saat, damit ein späterer Wechsel in einem ANDEREN Tab diesen
    //    Tab nicht mehr umzieht.
    const seed = window.localStorage.getItem(STORAGE_KEY);
    stampTab(seed ?? '');
    return seed;
  } catch {
    return null;
  }
}

export function setSelectedSolution(id: string | null): void {
  try {
    if (id) {
      stampTab(id);
      window.localStorage.setItem(STORAGE_KEY, id);
    } else {
      // Zurücksetzen (Stale-Reset / bewusst Server-Default): Tab entscheidet
      // sich für den Default; die Saat wird entfernt (eine ungültige Lösung
      // darf keine neuen Tabs mehr impfen).
      stampTab('');
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* storage unavailable (private mode) — selection stays session-only */
  }
}
