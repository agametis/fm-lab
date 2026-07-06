import { useState } from 'react';
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

type ViewMode = 'tiles' | 'list';

/**
 * Entry-count meta — built to support the upcoming Folder/Subfolder feature
 * with two states:
 *   - flat hierarchy (no subfolders):     "(total)"
 *   - nested hierarchy (with subfolders): "direct (total)"
 * Until folders exist, `nested` is always false → "(total)".
 */
export function formatEntryCount(direct: number, total: number, nested: boolean): string {
  return nested ? `${direct} (${total})` : `(${total})`;
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
  // Opt-in toolbar with a tiles⇄list toggle + entry-count meta.
  const viewToggle = node.props?.viewToggle as boolean | undefined;
  const rows = dataset?.data ?? [];

  const [viewMode, setViewMode] = useState<ViewMode>('tiles');

  const search = useRowSearch(rows, {
    searchable: node.props?.searchable as boolean | 'auto' | undefined,
    autoThreshold: node.props?.searchAutoThreshold as number | undefined,
    placeholder: node.props?.searchPlaceholder as string | undefined,
  });

  if (rows.length === 0) {
    return <div className="dash-tilegrid__empty">{empty?.message ?? t('common:noEntries')}</div>;
  }

  const hasQuery = search.query.trim() !== '';
  const mode: ViewMode = viewToggle ? viewMode : 'tiles';

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fill, minmax(${minTileWidth}px, 1fr))`,
    gap: '12px',
  };

  // Shared per-row cell projection (used by both the tile grid and the list).
  const buildCell = (row: Record<string, unknown>) => ({
    title: tx(substituteString(tile.title, row)),
    subtitle: tile.subtitle ? tx(substituteString(tile.subtitle, row)) : '',
    badge: tile.badge ? tx(substituteString(tile.badge, row)) : '',
    clickable: !!tile.onClick,
  });

  // Renders one block of rows as either tiles or a list. Reused per folder group.
  const renderRows = (subset: Record<string, unknown>[]) =>
    mode === 'list' ? (
      <ul className="dash-navlist">
        {subset.map((row, i) => {
          const c = buildCell(row);
          return (
            <li key={i}>
              <button
                type="button"
                className={`dash-navlist__item${c.clickable ? ' dash-navlist__item--clickable' : ''}`}
                onClick={c.clickable ? () => dispatchAction(tile.onClick, row, { navigate }) : undefined}
                disabled={!c.clickable}
              >
                <span className="dash-navlist__title">{c.title}</span>
                {c.subtitle && <span className="dash-navlist__subtitle">{c.subtitle}</span>}
                {c.badge && <span className="dash-navlist__badge">{c.badge}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    ) : (
      <div className="dash-tilegrid" style={gridStyle}>
        {subset.map((row, i) => {
          const c = buildCell(row);
          return (
            <button
              key={i}
              type="button"
              className={`dash-tile${c.clickable ? ' dash-tile--clickable' : ''}`}
              onClick={c.clickable ? () => dispatchAction(tile.onClick, row, { navigate }) : undefined}
              disabled={!c.clickable}
            >
              <span className="dash-tile__title">{c.title}</span>
              {c.subtitle && <span className="dash-tile__subtitle">{c.subtitle}</span>}
              {c.badge && <span className="dash-tile__badge">{c.badge}</span>}
            </button>
          );
        })}
      </div>
    );

  // Optional folder grouping: when `groupBy` names a row field (e.g. "folder"),
  // rows are partitioned into sections with a header. Root rows (empty/null group
  // value) render first under a localized "General" header; folders follow, sorted.
  const groupByField = node.props?.groupBy as string | undefined;
  const groups: { key: string; label: string; rows: Record<string, unknown>[] }[] = [];
  if (groupByField) {
    const byKey = new Map<string, Record<string, unknown>[]>();
    for (const row of search.filtered) {
      const raw = row[groupByField];
      const key = raw == null ? '' : String(raw);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(row);
    }
    // Humanized fallback when no server-provided localized label is available.
    const folderLabelFallback = (key: string) =>
      key
        .split('/')
        .map((seg) => tx(seg.replace(/[-_]/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase())))
        .join(' / ');
    const keys = [...byKey.keys()].sort((a, b) => {
      if (a === '') return -1;
      if (b === '') return 1;
      return a.localeCompare(b);
    });
    for (const key of keys) {
      const rows = byKey.get(key)!;
      // Prefer the localized folder label the server attaches per row (`folder_label`);
      // all rows in a group share the same folder, so the first row is authoritative.
      const serverLabel = key !== '' ? (rows[0]?.folder_label as string | undefined) : undefined;
      groups.push({
        key,
        label:
          key === ''
            ? (t('common:general', { defaultValue: 'General' }) as string)
            : serverLabel || folderLabelFallback(key),
        rows,
      });
    }
  }
  const rootCount = groupByField
    ? (groups.find((g) => g.key === '')?.rows.length ?? 0)
    : search.filtered.length;
  const nestedCount = groupByField ? groups.some((g) => g.key !== '') : false;

  return (
    <div className="dash-tilegrid-wrap">
      {viewToggle && (
        <div className="dash-viewbar">
          <div className="dash-viewbar__toggle" role="group" aria-label={t('dashboard:view.label') as string}>
            <button
              type="button"
              className={`dash-viewbar__btn${mode === 'tiles' ? ' active' : ''}`}
              aria-pressed={mode === 'tiles'}
              title={t('dashboard:view.tiles') as string}
              aria-label={t('dashboard:view.tiles') as string}
              onClick={() => setViewMode('tiles')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" />
                <rect x="14" y="14" width="7" height="7" rx="1.5" />
              </svg>
            </button>
            <button
              type="button"
              className={`dash-viewbar__btn${mode === 'list' ? ' active' : ''}`}
              aria-pressed={mode === 'list'}
              title={t('dashboard:view.list') as string}
              aria-label={t('dashboard:view.list') as string}
              onClick={() => setViewMode('list')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <line x1="8" y1="6" x2="20" y2="6" />
                <line x1="8" y1="12" x2="20" y2="12" />
                <line x1="8" y1="18" x2="20" y2="18" />
                <circle cx="4" cy="6" r="1.1" fill="currentColor" stroke="none" />
                <circle cx="4" cy="12" r="1.1" fill="currentColor" stroke="none" />
                <circle cx="4" cy="18" r="1.1" fill="currentColor" stroke="none" />
              </svg>
            </button>
          </div>
          {/* Entry-count meta (2-state, folder-ready) */}
          <span className="dash-viewbar__count">
            {formatEntryCount(rootCount, rows.length, nestedCount)}
          </span>
        </div>
      )}

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

      {groupByField ? (
        <div className="dash-tilegroups">
          {groups.map((g) => (
            <section key={g.key || '__root__'} className="dash-tilegroup">
              <h3 className="dash-tilegroup__title">
                {g.label}
                <span className="dash-tilegroup__count">{formatEntryCount(g.rows.length, g.rows.length, false)}</span>
              </h3>
              {renderRows(g.rows)}
            </section>
          ))}
        </div>
      ) : (
        renderRows(search.filtered)
      )}

      {hasQuery && search.filtered.length === 0 && (
        <div className="dash-search-bar__empty">
          {t('detail:autoTable.noMatches', { query: search.query })}
        </div>
      )}
    </div>
  );
}
