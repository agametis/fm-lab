import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PrimitiveProps } from '../types';
import { substituteString } from '../tokens';
import { useRowSearch } from './_useRowSearch';
import { dispatchAction, resolveAction } from '../actions';
import { translateCellValue } from './_cellTranslate';
import type { ActionSpec } from '../actions';

interface BadgeOptions {
  /**
   * Hide the badge pill when the substituted value is 0, "0", "", null,
   * undefined, NaN. Recommended for count-style pills (e.g. code_ref_count).
   * Default: false (preserves prior rendering for non-count badges).
   */
  hideZero?: boolean;
  /**
   * When true, render a toggle next to the search bar that filters the
   * list to rows with a non-zero/non-empty badge. Only rendered if AT LEAST
   * ONE row has a non-empty badge value (otherwise the toggle would be
   * meaningless).
   */
  filterable?: boolean;
  /**
   * Localized label for the toggle. Falls back to the i18n key
   * `dashboard:list.badgeFilter` (= "used"/"verwendet").
   */
  filterLabel?: string;
  /**
   * Eigene Click-Action für die Badge. Wird vor der Row-Action gehandelt
   * (stopPropagation). Token-Substitution gegen die Row analog zu `onClick`.
   * Beispiel: counter-pill → references-Ansicht via openObject/applyFilter.
   */
  onClick?: ActionSpec;
}

interface RowTemplate {
  primary: string;
  secondary?: string;
  tertiary?: string;
  quaternary?: string;
  badge?: string;
  badgeOptions?: BadgeOptions;
  onClick?: ActionSpec;
}

/**
 * Treat a substituted badge string as "no count" if it's empty, "0", "null",
 * "undefined", or otherwise a falsy numeric.
 */
function isZeroBadge(badgeText: string): boolean {
  const trimmed = badgeText.trim();
  if (!trimmed) return true;
  if (trimmed === '0' || trimmed === 'null' || trimmed === 'undefined' || trimmed === 'NaN') return true;
  // Numeric? Hide on exact zero.
  const asNum = Number(trimmed);
  if (Number.isFinite(asNum) && asNum === 0) return true;
  return false;
}

export function List({ node, dataset, navigate }: PrimitiveProps) {
  const { t } = useTranslation(['common', 'detail', 'dashboard']);
  // Pipe substituted row strings through the dashboard cell-value translator
  // so canonical English labels emitted from SQL (e.g. health indicators)
  // render in the active UI language. Unknown strings pass through.
  const tx = (s: string) => String(translateCellValue(s, t));
  const rowTemplate = (node.props?.rowTemplate as RowTemplate) ?? { primary: '{{name}}' };
  const badgeOpts = rowTemplate.badgeOptions ?? {};
  const empty = node.props?.empty as { message?: string } | undefined;
  const rows = dataset?.data ?? [];

  // Pre-compute badge text per row once, so the filter and the render pass
  // see consistent values without re-running substitution.
  const rowsWithBadge = useMemo(() => {
    return rows.map(row => ({
      row,
      badgeText: rowTemplate.badge ? tx(substituteString(rowTemplate.badge, row)) : '',
    }));
    // tx + substituteString are pure for given row; deps on the template fields are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, rowTemplate.badge]);

  // Used-filter toggle state. Only meaningful for filterable badges.
  const [usedOnly, setUsedOnly] = useState(false);
  const anyUsed = rowsWithBadge.some(r => !isZeroBadge(r.badgeText));
  const anyUnused = rowsWithBadge.some(r => isZeroBadge(r.badgeText));
  const showUsedToggle = !!badgeOpts.filterable && anyUsed && anyUnused;

  // Apply usedOnly BEFORE search so the result count reflects both filters.
  const preFilteredRows = useMemo(() => {
    if (!showUsedToggle || !usedOnly) return rowsWithBadge;
    return rowsWithBadge.filter(r => !isZeroBadge(r.badgeText));
  }, [rowsWithBadge, showUsedToggle, usedOnly]);

  const visibleRows = preFilteredRows.map(r => r.row);

  const search = useRowSearch(visibleRows, {
    searchable: node.props?.searchable as boolean | 'auto' | undefined,
    autoThreshold: node.props?.searchAutoThreshold as number | undefined,
    placeholder: node.props?.searchPlaceholder as string | undefined,
  });

  if (rows.length === 0) {
    return <div className="dash-list__empty">{empty?.message ?? t('common:noEntries')}</div>;
  }

  const hasQuery = search.query.trim() !== '';
  const filterToggleLabel = badgeOpts.filterLabel
    || (t('dashboard:list.badgeFilter', { defaultValue: 'verwendet' }) as string);

  // Lookup-Map row → badgeText (for the visible/filtered rows). Built off the
  // pre-filtered list so we don't lose entries when usedOnly is on.
  const badgeByRow = new Map(preFilteredRows.map(r => [r.row, r.badgeText]));

  return (
    <div className="dash-list-wrap">
      {(search.visible || showUsedToggle) && (
        <div className="dash-search-bar">
          <span className="dash-search-bar__count">
            {t('detail:autoTable.rowCount', { count: search.filtered.length })}
            {(hasQuery || usedOnly) && search.filtered.length !== rows.length && (
              <> · {t('detail:autoTable.filteredFrom', { count: rows.length })}</>
            )}
          </span>
          {search.visible && (
            <input
              type="search"
              className="dash-search-bar__input"
              placeholder={search.placeholder}
              value={search.query}
              onChange={e => search.setQuery(e.target.value)}
            />
          )}
          {showUsedToggle && (
            <label className="dash-search-bar__toggle" title={filterToggleLabel}>
              <input
                type="checkbox"
                checked={usedOnly}
                onChange={e => setUsedOnly(e.target.checked)}
              />
              <span>{filterToggleLabel}</span>
            </label>
          )}
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
        const quaternary = rowTemplate.quaternary
          ? tx(substituteString(rowTemplate.quaternary, row))
          : '';
        const badgeText = badgeByRow.get(row) ?? '';
        const showBadge = badgeText && !(badgeOpts.hideZero && isZeroBadge(badgeText));
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
              {quaternary && <span className="dash-list__quaternary">{quaternary}</span>}
            </div>
            {showBadge && (() => {
              // Badge-Action wird gegen die aktuelle Row resolved (Token-
              // Substitution). Wenn der ResolveAction nach Substitution `null`
              // liefert (z.B. weil action-Token leer war), bleibt die Pill
              // ein reiner Anzeige-Pill ohne Click.
              const resolvedBadge = badgeOpts.onClick
                ? resolveAction(badgeOpts.onClick, row as Record<string, unknown>)
                : null;
              const badgeClickable = !!resolvedBadge && !!resolvedBadge.action;
              const onBadgeClick = badgeClickable
                ? (e: React.MouseEvent | React.KeyboardEvent) => {
                    e.stopPropagation();
                    dispatchAction(badgeOpts.onClick, row, { navigate });
                  }
                : undefined;
              return (
                <span
                  className={`dash-badge dash-badge--${slugify(badgeText)}${badgeClickable ? ' dash-badge--clickable' : ''}`}
                  onClick={onBadgeClick}
                  role={badgeClickable ? 'button' : undefined}
                  tabIndex={badgeClickable ? 0 : undefined}
                  onKeyDown={
                    badgeClickable
                      ? e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onBadgeClick!(e);
                          }
                        }
                      : undefined
                  }
                >
                  {badgeText}
                </span>
              );
            })()}
          </li>
        );
      })}
      </ul>
      {(hasQuery || usedOnly) && search.filtered.length === 0 && (
        <div className="dash-search-bar__empty">
          {hasQuery
            ? t('detail:autoTable.noMatches', { query: search.query })
            : t('dashboard:list.noFilteredEntries', { defaultValue: 'Keine Einträge mit Treffern.' })}
        </div>
      )}
    </div>
  );
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
