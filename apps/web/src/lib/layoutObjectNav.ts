import type { LayoutObject } from '../hooks/useLayoutData';

/**
 * Cross-Nav-Zielauflösung für Layout-Objekte (gehoistetes Ziel).
 *
 * Zentral für Canvas (Modifier-Klick / Alt+Enter) und LayoutObject-Detail
 * (Chip-Reihenfolge der Ziel-Leiste). Die Auflösungsregeln:
 *   - Feld-Objekte  → verknüpftes Feld (`displays_field`)
 *   - Buttons       → verknüpftes Script (`triggers_script`);
 *                     ohne Script → Ziel-Layout (`navigates_to_layout`,
 *                     Go-to-Layout-Buttons)
 *   - Portal        → Portal-TableOccurrence (`portal_context`)
 *   - sonst         → das LayoutObject selbst (kein gehoistetes Ziel)
 */
export const FIELD_NAV_TYPES = new Set([
  'Edit Box', 'Drop-down List', 'Drop-down Calendar', 'Pop-up Menu',
  'Radio Button Set', 'Checkbox Set', 'Concealed Edit Box', 'Container',
]);
export const SCRIPT_NAV_TYPES = new Set(['Button', 'Grouped Button', 'Popover Button']);

export function resolveCrossNavTarget(o: LayoutObject): string {
  if (FIELD_NAV_TYPES.has(o.object_type) && o.field_uuid) return o.field_uuid;
  if (SCRIPT_NAV_TYPES.has(o.object_type)) {
    if (o.script_uuid) return o.script_uuid;
    if (o.nav_layout_uuid) return o.nav_layout_uuid;
  }
  if (o.object_type === 'Portal' && o.portal_to_uuid) return o.portal_to_uuid;
  return o.object_uuid;
}

/** true, wenn das Objekt ein vom LayoutObject verschiedenes Cross-Nav-Ziel hat. */
export function hasCrossNavTarget(o: LayoutObject): boolean {
  return resolveCrossNavTarget(o) !== o.object_uuid;
}
