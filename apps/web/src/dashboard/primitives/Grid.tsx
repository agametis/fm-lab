import type { PrimitiveProps } from '../types';

export function Grid({ node, renderChildren }: PrimitiveProps) {
  const columns = (node.props?.columns as number) ?? 12;
  const gap = (node.props?.gap as number) ?? 16;
  const style: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
    gap: `${gap}px`,
  };
  return <div className="dash-grid" style={style}>{renderChildren(node.children)}</div>;
}
