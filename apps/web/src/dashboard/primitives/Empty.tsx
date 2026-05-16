import type { PrimitiveProps } from '../types';

export function Empty({ node }: PrimitiveProps) {
  const message = (node.props?.message as string) ?? 'Keine Daten.';
  return <div className="dash-empty">{message}</div>;
}
