import { useTranslation } from 'react-i18next';
import type { PrimitiveProps } from '../types';
import { substituteString } from '../tokens';
import { useRowSearch } from './_useRowSearch';
import { dispatchAction } from '../actions';
import { translateCellValue } from './_cellTranslate';
import type { ActionSpec } from '../actions';

interface RowTemplate {
  primary: string;
  secondary?: string;
  tertiary?: string;
  badge?: string;
  onClick?: ActionSpec;
}

export function List({ node, dataset, navigate }: PrimitiveProps) {
  const { t } = useTranslation(['common', 'detail', 'dashboard']);
  // Pipe substituted row strings through the dashboard cell-value translator
  // so canonical English labels emitted from SQL (e.g. health indicators)
  // render in the active UI language. Unknown strings pass through.
  const tx = (s: string) => String(translateCellValue(s, t));
  const rowTemplate = (node.props?.rowTemplate as RowTemplate) ?? { primary: '{{name}}' };
  const empty = node.props?.empty as { message?: string } | undefined;
  const rows = dataset?.data ?? [];

  const search = useRowSearch(rows, {
    searchable: node.props?.searchable as boolean | 'auto' | undefined,
    autoThreshold: node.props?.searchAutoThreshold as number | undefined,
    placeholder: node.props?.searchPlaceholder as string | undefined,
  });

  if (rows.length === 0) {
    return <div className="dash-list__empty">{empty?.message ?? t('common:noEntries')}</div>;
  }

  const hasQuery = search.query.trim() !== '';

  return (
    <div className="dash-list-wrap">
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
      <ul className="dash-list">
        {search.filtered.map((row, i) => {
        const primary = tx(substituteString(rowTemplate.primary, row));
        const secondary = rowTemplate.secondary
          ? tx(substituteString(rowTemplate.secondary, row))
          : '';
        const tertiary = rowTemplate.tertiary
          ? tx(substituteString(rowTemplate.tertiary, row))
          : '';
        const badgeText = rowTemplate.badge ? tx(substituteString(rowTemplate.badge, row)) : '';
        const clickable = !!rowTemplate.onClick;

        return (
          <li
            key={i}
            className={`dash-list__item${clickable ? ' dash-list__item--clickable' : ''}`}
            onClick={clickable ? () => dispatchAction(rowTemplate.onClick, row, { navigate }) : undefined}
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            onKeyDown={
              clickable
                ? e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      dispatchAction(rowTemplate.onClick, row, { navigate });
                    }
                  }
                : undefined
            }
          >
            <div className="dash-list__main">
              <span className="dash-list__primary">{primary}</span>
              {secondary && <span className="dash-list__secondary">{secondary}</span>}
              {tertiary && <span className="dash-list__tertiary">{tertiary}</span>}
            </div>
            {badgeText && (
              <span className={`dash-badge dash-badge--${slugify(badgeText)}`}>{badgeText}</span>
            )}
          </li>
        );
      })}
      </ul>
      {hasQuery && search.filtered.length === 0 && (
        <div className="dash-search-bar__empty">
          {t('detail:autoTable.noMatches', { query: search.query })}
        </div>
      )}
    </div>
  );
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
