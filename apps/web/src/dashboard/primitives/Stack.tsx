import type { PrimitiveProps } from '../types';

export function Stack({ node, renderChildren }: PrimitiveProps) {
  const props = node.props ?? {};
  const gap = (props.gap as number) ?? 12;
  const span = props.span as number | undefined;
  const align = (props.align as string) ?? 'stretch';
  const style: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: `${gap}px`,
    alignItems: align,
    ...(span ? { gridColumn: `span ${span} / span ${span}` } : {}),
  };
  return <div className="dash-stack" style={style}>{renderChildren(node.children)}</div>;
}
