import type { PrimitiveProps } from '../types';

/**
 * Fallback für unbekannte Primitive-Types. Verhindert, dass ein Tippfehler
 * im Layout-JSON das ganze Dashboard kippt.
 */
export function UnknownPrimitive({ node }: PrimitiveProps) {
  return (
    <div className="dash-unknown">
      Unbekanntes Primitive: <code>{node.type}</code>
    </div>
  );
}
