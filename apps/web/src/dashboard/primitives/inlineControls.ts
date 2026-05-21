import type { ComponentType, ReactNode } from 'react';

/**
 * Inline-Controls für List-Zeilen
 *
 * Layout-JSON kann pro `rowTemplate` ein `inlineControl: "<name>"` setzen.
 * Die zugehörige Komponente wird rechtsbündig (vor einer optionalen Badge)
 * gerendert und bekommt die Row als Prop.
 *
 * Im Gegensatz zur Action-Whitelist (actions.ts) sind Inline-Controls
 * stateful (Streaming, Progress, Errors) und kapseln ihre eigene Logik.
 *
 * Über das optionale `setExtra`-Callback kann eine Komponente einen Knoten
 * unterhalb der Row rendern (z.B. einen Progress-Balken über volle Breite).
 * Das Callback wird in einem useEffect aufgerufen, um React-Render-Cycles
 * zu respektieren.
 */
export interface InlineControlProps {
  row: Record<string, unknown>;
  /**
   * Render-Slot für einen Block unterhalb der Listenzeile. Übergebe einen
   * ReactNode (oder null, um den Slot zu räumen). Wird vom List-Item-Wrapper
   * bereitgestellt.
   */
  setExtra?: (node: ReactNode | null) => void;
}

export type InlineControlComponent = ComponentType<InlineControlProps>;

const registry = new Map<string, InlineControlComponent>();

export function registerInlineControl(name: string, component: InlineControlComponent): void {
  registry.set(name, component);
}

export function getInlineControl(name: string | undefined): InlineControlComponent | null {
  if (!name) return null;
  return registry.get(name) ?? null;
}
