import type { PrimitiveProps } from '../types';
import { substituteString } from '../tokens';
import { dispatchAction } from '../actions';
import type { ActionSpec } from '../actions';

interface TileSpec {
  title: string;
  subtitle?: string;
  icon?: string;
  badge?: string;
  onClick?: ActionSpec;
}

export function TileGrid({ node, dataset, navigate }: PrimitiveProps) {
  const tile = (node.props?.tile as TileSpec) ?? { title: '{{title}}' };
  const minTileWidth = (node.props?.minTileWidth as number) ?? 220;
  const empty = node.props?.empty as { message?: string } | undefined;
  const rows = dataset?.data ?? [];

  if (rows.length === 0) {
    return <div className="dash-tilegrid__empty">{empty?.message ?? 'Keine Einträge.'}</div>;
  }

  const style: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fill, minmax(${minTileWidth}px, 1fr))`,
    gap: '12px',
  };

  return (
    <div className="dash-tilegrid" style={style}>
      {rows.map((row, i) => {
        const title = substituteString(tile.title, row);
        const subtitle = tile.subtitle ? substituteString(tile.subtitle, row) : '';
        const badge = tile.badge ? substituteString(tile.badge, row) : '';
        const clickable = !!tile.onClick;
        return (
          <button
            key={i}
            type="button"
            className={`dash-tile${clickable ? ' dash-tile--clickable' : ''}`}
            onClick={clickable ? () => dispatchAction(tile.onClick, row, { navigate }) : undefined}
            disabled={!clickable}
          >
            <span className="dash-tile__title">{title}</span>
            {subtitle && <span className="dash-tile__subtitle">{subtitle}</span>}
            {badge && <span className="dash-tile__badge">{badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
