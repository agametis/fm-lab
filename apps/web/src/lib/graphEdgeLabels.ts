import type { EdgeLabeler } from '../hooks/useSubgraph';

/**
 * Display labelling for grouped graph edges.
 *
 * Trigger mirrors (`triggers_script`) carry their whole meaning in the subrole
 * (event vs. `button_action`); the bare role label hid it. The rules here make
 * the subrole the label, adaptively:
 *   - one subrole            → its (localized) label
 *   - several, short enough  → joined with " · "
 *   - several, over budget   → compact `triggers_script ×N` (full list stays
 *                              available via the edge tooltip / inspect panel)
 * Placement labelling: a `displays_field` edge whose SOURCE is a LayoutObject
 * is the placement relation ("this object represents that field") — labelled
 * as such to keep it distinct from the layout-level aggregate.
 */

/** Character budget before the multi-event label collapses to `role ×N`. */
export const EDGE_LABEL_MAX_CHARS = 40;

export type EdgeLabelStrings = {
  /** Localized label for the `button_action` subrole. */
  buttonAction: string;
  /** Localized label for the placement edge (LayoutObject →displays_field→ Field). */
  represents: string;
};

/** Localized display label for one triggers_script subrole. */
export function triggerSubroleLabel(
  subrole: string,
  formatEvent: (action: string) => string,
  strings: EdgeLabelStrings,
): string {
  return subrole === 'button_action' ? strings.buttonAction : formatEvent(subrole);
}

export function makeEdgeLabeler(
  formatEvent: (action: string) => string,
  strings: EdgeLabelStrings,
): EdgeLabeler {
  return (role, subroles, sourceType) => {
    if (role === 'triggers_script') {
      if (subroles.length === 0) return role; // Alt-Katalog: Subrole NULL
      const parts = subroles.map((s) => triggerSubroleLabel(s, formatEvent, strings));
      const joined = parts.join(' · ');
      if (parts.length === 1 || joined.length <= EDGE_LABEL_MAX_CHARS) return joined;
      return `${role} ×${parts.length}`;
    }
    if (role === 'displays_field' && sourceType === 'LayoutObject') {
      return strings.represents;
    }
    return role;
  };
}

/**
 * Tooltip lines for a hovered edge: the technical role first, then the full
 * (localized) subrole list — the compact `×N` label stays honest because the
 * complete list is always one hover away. Returns plain strings; the caller
 * escapes them for HTML.
 */
export function edgeTooltipLines(
  role: string,
  subroles: string[],
  formatEvent: (action: string) => string,
  strings: EdgeLabelStrings,
): string[] {
  const lines = [role];
  if (role === 'triggers_script') {
    for (const s of subroles) lines.push(triggerSubroleLabel(s, formatEvent, strings));
  } else {
    for (const s of subroles) lines.push(s);
  }
  return lines;
}
