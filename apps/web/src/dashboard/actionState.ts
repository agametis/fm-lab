import type { ActionSpec } from './actions';
import { substituteDeep } from './tokens';

/**
 * Prüft, ob eine Action gegen die aktuellen URL-SearchParams "aktiv" ist —
 * d.h. ob die Filter, die die Action setzen würde, bereits aktiv sind. Wird
 * verwendet, um KPIs und Tabellen-Zeilen visuell als „aktiver Filter" zu
 * markieren.
 *
 * Match-Regel:
 * - Action muss `args.params` als Objekt liefern. Andere Args (uuid, type, …)
 *   werden ignoriert — sie steuern Navigation, nicht Filter-State.
 * - Token-Substitution gegen die übergebene `row` wird angewendet (für
 *   `{{api_family}}`-artige Templates).
 * - Reset-Werte (`""` oder `"Alle"`) gelten als aktiv, wenn der URL-Param
 *   fehlt oder ebenfalls leer/„Alle" ist. Damit wird die führende Alle-Zeile
 *   einer Filtertabelle automatisch als aktiv markiert, solange kein
 *   konkreter Filter gesetzt ist.
 * - Alle Params der Action müssen matchen — sonst nicht aktiv.
 */
export function isActionActive(
  spec: ActionSpec | undefined,
  row: Record<string, unknown> | undefined,
  searchParams: URLSearchParams,
): boolean {
  const params = spec?.args?.params as Record<string, unknown> | undefined;
  if (!params) return false;

  const resolved = substituteDeep(params, row) as Record<string, unknown> | undefined;
  if (!resolved) return false;

  const entries = Object.entries(resolved);
  if (entries.length === 0) return false;

  return entries.every(([key, value]) => {
    const urlValue = searchParams.get(key) ?? '';
    const targetValue = value == null ? '' : String(value);
    const isResetValue = targetValue === '' || targetValue === 'Alle';
    const isResetUrl = urlValue === '' || urlValue === 'Alle';
    if (isResetValue) return isResetUrl;
    return urlValue === targetValue;
  });
}
