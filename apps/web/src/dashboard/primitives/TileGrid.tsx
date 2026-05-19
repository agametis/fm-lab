import { useTranslation } from 'react-i18next';
import type { PrimitiveProps } from '../types';
import { substituteString } from '../tokens';
import { useRowSearch } from './_useRowSearch';
import { dispatchAction } from '../actions';
import { translateCellValue } from './_cellTranslate';
import type { ActionSpec } from '../actions';

interface TileSpec {
  title: string;
  subtitle?: string;
  icon?: string;
  badge?: string;
  onClick?: ActionSpec;
}

export function TileGrid({ node, dataset, navigate }: PrimitiveProps) {
  const { t } = useTranslation(['common', 'detail', 'dashboard']);
  // Pipe substituted tile strings through the dashboard cell-value translator
  // so canonical English titles / descriptions / categories emitted from SQL
  // templates render in the active UI language. Unknown values pass through.
  const tx = (s: string) => String(translateCellValue(s, t));
  const tile = (node.props?.tile as TileSpec) ?? { title: '{{title}}' };
  const minTileWidth = (node.props?.minTileWidth as number) ?? 220;
  const empty = node.props?.empty as { message?: string } | undefined;
  const rows = dataset?.data ?? [];

  const search = useRowSearch(rows, {
    searchable: node.props?.searchable as boolean | 'auto' | undefined,
    autoThreshold: node.props?.searchAutoThreshold as number | undefined,
    placeholder: node.props?.searchPlaceholder as string | undefined,
  });

  if (rows.length === 0) {
    return <div className="dash-tilegrid__empty">{empty?.message ?? t('common:noEntries')}</div>;
  }

  const hasQuery = search.query.trim() !== '';

  const style: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fill, minmax(${minTileWidth}px, 1fr))`,
    gap: '12px',
  };

  return (
    <div className="dash-tilegrid-wrap">
      {search.visible && (
        <div className="dash-search-bar">
          <span className="dash-search-bar__count">
            {t('detail:autoTable.rowCount', { count: search.filtered.length })}
            {hasQuery && search.filtered.length !== search.totalCount && (
              <> · {t('detail:autoTable.filteredFrom', { count: search.totalCount })}</>
            )}
          </span>
          <input
            type="search"
            className="dash-search-bar__input"
            placeholder={search.placeholder}
            value={search.query}
            onChange={e => search.setQuery(e.target.value)}
          />
        </div>
      )}
      <div className="dash-tilegrid" style={style}>
        {search.filtered.map((row, i) => {
        const title = tx(substituteString(tile.title, row));
        const subtitle = tile.subtitle ? tx(substituteString(tile.subtitle, row)) : '';
        const badge = tile.badge ? tx(substituteString(tile.badge, row)) : '';
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
      {hasQuery && search.filtered.length === 0 && (
        <div className="dash-search-bar__empty">
          {t('detail:autoTable.noMatches', { query: search.query })}
        </div>
      )}
    </div>
  );
}
