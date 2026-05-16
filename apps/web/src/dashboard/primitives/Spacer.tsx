import type { PrimitiveProps } from '../types';

export function Spacer({ node }: PrimitiveProps) {
  const size = (node.props?.size as number) ?? 16;
  return <div style={{ height: size, flexShrink: 0 }} />;
}
