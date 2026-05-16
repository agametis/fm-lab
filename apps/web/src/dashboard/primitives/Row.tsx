import type { PrimitiveProps } from '../types';

export function Row({ node, renderChildren }: PrimitiveProps) {
  const props = node.props ?? {};
  const gap = (props.gap as number) ?? 12;
  const span = props.span as number | undefined;
  const align = (props.align as string) ?? 'center';
  const style: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'row',
    gap: `${gap}px`,
    alignItems: align,
    flexWrap: 'wrap',
    ...(span ? { gridColumn: `span ${span} / span ${span}` } : {}),
  };
  return <div className="dash-row" style={style}>{renderChildren(node.children)}</div>;
}
