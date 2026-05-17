import type { PrimitiveProps } from '../types';
import { substituteString } from '../tokens';
import { useRowSearch } from './_useRowSearch';
import { dispatchAction } from '../actions';
import type { ActionSpec } from '../actions';

interface RowTemplate {
  primary: string;
  secondary?: string;
  tertiary?: string;
  badge?: string;
  onClick?: ActionSpec;
}

export function List({ node, dataset, navigate }: PrimitiveProps) {
  const rowTemplate = (node.props?.rowTemplate as RowTemplate) ?? { primary: '{{name}}' };
  const empty = node.props?.empty as { message?: string } | undefined;
  const rows = dataset?.data ?? [];

  const search = useRowSearch(rows, {
    searchable: node.props?.searchable as boolean | 'auto' | undefined,
    autoThreshold: node.props?.searchAutoThreshold as number | undefined,
    placeholder: node.props?.searchPlaceholder as string | undefined,
  });

  if (rows.length === 0) {
    return <div className="dash-list__empty">{empty?.message ?? 'Keine Einträge.'}</div>;
  }

  const hasQuery = search.query.trim() !== '';

  return (
    <div className="dash-list-wrap">
      {search.visible && (
        <div className="dash-search-bar">
          <span className="dash-search-bar__count">
            {search.filtered.length.toLocaleString('de-DE')}{' '}
            {search.filtered.length === 1 ? 'Eintrag' : 'Einträge'}
            {hasQuery && search.filtered.length !== search.totalCount && (
              <> · gefiltert aus {search.totalCount.toLocaleString('de-DE')}</>
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
        const primary = substituteString(rowTemplate.primary, row);
        const secondary = rowTemplate.secondary
          ? substituteString(rowTemplate.secondary, row)
          : '';
        const tertiary = rowTemplate.tertiary
          ? substituteString(rowTemplate.tertiary, row)
          : '';
        const badgeText = rowTemplate.badge ? substituteString(rowTemplate.badge, row) : '';
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
          Keine Treffer für „{search.query}".
        </div>
      )}
    </div>
  );
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
