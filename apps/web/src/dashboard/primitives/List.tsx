import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { PrimitiveProps } from '../types';
import { substituteString } from '../tokens';
import { useRowSearch } from './_useRowSearch';
import {
  useEntrySearch,
  formatHitSample,
  withSearchArg,
  metaRow,
  type EntrySearchProps,
} from './_useEntrySearch';
import { dispatchAction, resolveAction } from '../actions';
import { translateCellValue } from './_cellTranslate';
import type { ActionSpec } from '../actions';
import { getInlineControl, type InlineControlComponent } from './inlineControls';

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
  /**
   * Name of a registered inline-control component (see inlineControls.ts).
   * Rendered right-aligned per row, receives the row as prop. Click events
   * inside the control stop propagation so they don't trigger the row's
   * onClick action. Currently registered: `docsInstall`.
   */
  inlineControl?: string;
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

export function List({ node, dataset, datasets, navigate }: PrimitiveProps) {
  const { t } = useTranslation(['common', 'detail', 'dashboard']);
  // Pipe substituted row strings through the dashboard cell-value translator
  // so canonical English labels emitted from SQL (e.g. health indicators)
  // render in the active UI language. Unknown strings pass through.
  const tx = (s: string) => String(translateCellValue(s, t));
  const rowTemplate = (node.props?.rowTemplate as RowTemplate) ?? { primary: '{{name}}' };
  const badgeOpts = rowTemplate.badgeOptions ?? {};
  const empty = node.props?.empty as { message?: string } | undefined;
  // Optionale Gruppierung: Section-Header immer dann, wenn sich der Wert des
  // groupBy-Felds gegenüber der Vorzeile ändert. Erwartet server-sortierte
  // Rows (Gruppen zusammenhängend); ein leerer Gruppenwert rendert ohne
  // Header (Konvention: Root-Gruppe zuerst).
  const groupBy = node.props?.groupBy as string | undefined;
  const rawRows = dataset?.data ?? [];

  // Suchzustand in der URL (Opt-in): der Param-Name wird vom Layout deklariert,
  // damit Reload, Zurück-Navigation und geteilte Links die Eingabe behalten.
  const searchParam = node.props?.searchParam as string | undefined;
  // Rubrikübergreifende Eintragssuche (Opt-in): Capability + Endpoint stehen im
  // Meta-Dataset, das Kästchen rendert nur, wenn das Set eine Eintragsebene hat.
  const entrySearchProps = node.props?.entrySearch as EntrySearchProps | undefined;
  const entryMeta = metaRow(datasets, entrySearchProps?.metaDataset);

  // Den Suchbegriff kennt `useRowSearch` erst weiter unten — die Annotation
  // braucht ihn aber vorher. Im URL-Modus liest die Eintragssuche ihn selbst
  // aus demselben Param; ohne URL-Param wird er eine Render-Runde später
  // nachgereicht (der Filter selbst bleibt synchron).
  const [localQueryEcho, setLocalQueryEcho] = useState('');
  const entrySearch = useEntrySearch(entrySearchProps, entryMeta, localQueryEcho, searchParam);

  // Annotation statt Ersetzung: die Zeilen bleiben die geladenen Rubrikzeilen,
  // sie bekommen nur zwei zusätzliche Felder. `hit_sample` ist ein normales
  // Feld — damit matcht die generische Zeilensuche die Rubrik allein wegen
  // ihrer Einträge, ohne eigene Filterlogik.
  const rows = useMemo(() => {
    if (!entrySearch.active || entrySearch.hits.size === 0) return rawRows;
    const annotated = rawRows.map(row => {
      const hit = entrySearch.hits.get(String(row.id ?? ''));
      if (!hit) return row;
      return {
        ...row,
        hit_sample: formatHitSample(hit),
        hit_count: hit.hit_count,
        // Sucheingabe reist mit in die Rubrik — die Eintragsliste dort ist
        // dann sofort passend gefiltert.
        _action_args: withSearchArg(row._action_args, entrySearch.term),
      };
    });
    // Breite Eingaben treffen viele Rubriken (`win` → 37 von 168). Rubriken mit
    // Eintragstreffern stehen deshalb nach Trefferzahl vorn; reine Namens-
    // treffer behalten darunter ihre ursprüngliche Reihenfolge.
    if (groupBy) return annotated;  // Gruppen müssen zusammenhängend bleiben
    return annotated
      .map((row, i) => ({ row, i, n: Number(row.hit_count ?? 0) }))
      .sort((a, b) => b.n - a.n || a.i - b.i)
      .map(x => x.row);
  }, [rawRows, entrySearch.active, entrySearch.hits, entrySearch.term, groupBy]);

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
    searchParam,
  });

  // Ohne URL-Param wird der Suchbegriff eine Render-Runde nach oben
  // gespiegelt, damit die Annotation (die vor useRowSearch läuft) ihn kennt.
  // Im URL-Modus liest die Eintragssuche direkt aus dem Param — dann ist der
  // Spiegel überflüssig, und der Filter bleibt in beiden Fällen synchron.
  useEffect(() => {
    if (searchParam) return;
    setLocalQueryEcho(search.query);
  }, [search.query, searchParam]);

  if (rows.length === 0) {
    return <div className="dash-list__empty">{empty?.message ?? t('common:noEntries')}</div>;
  }

  const hasQuery = search.query.trim() !== '';
  const filterToggleLabel = badgeOpts.filterLabel
    || (t('dashboard:list.badgeFilter', { defaultValue: 'verwendet' }) as string);
  const entryToggleLabel = entrySearchProps?.label
    || (t('dashboard:list.entrySearch', { defaultValue: 'auch Einträge durchsuchen' }) as string);

  // Lookup-Map row → badgeText (for the visible/filtered rows). Built off the
  // pre-filtered list so we don't lose entries when usedOnly is on.
  const badgeByRow = new Map(preFilteredRows.map(r => [r.row, r.badgeText]));

  return (
    <div className="dash-list-wrap">
      {(search.visible || showUsedToggle || entrySearch.available) && (
        <div className="dash-search-bar">
          <span className="dash-search-bar__count">
            {t('detail:autoTable.rowCount', { count: search.filtered.length })}
            {(hasQuery || usedOnly) && search.filtered.length !== rows.length && (
              <> · {t('detail:autoTable.filteredFrom', { count: rows.length })}</>
            )}
            {/* Dasselbe Eingabefeld filtert einmal rein lokal und einmal
                serverunterstützt. Ohne die Modusanzeige wirkt derselbe Begriff
                je nach Kästchen unerklärlich anders. */}
            {entrySearch.active && (
              <> · {t('dashboard:list.entrySearchMode', { defaultValue: 'inkl. Einträge' })}</>
            )}
            {entrySearch.loading && (
              <> · {t('dashboard:list.entrySearchLoading', { defaultValue: 'suche …' })}</>
            )}
          </span>
          {/* Sucheingabe und das Kästchen, das ihre Reichweite erweitert, bilden
              eine Gruppe — sonst verteilte die Leiste (space-between) beide
              gleichmäßig und der Used-Filter verlöre seinen Platz rechts über
              der Zählerspalte. */}
          {(search.visible || entrySearch.available) && (
            <div className="dash-search-bar__field">
              {search.visible && (
                <input
                  type="search"
                  className="dash-search-bar__input"
                  placeholder={search.placeholder}
                  value={search.query}
                  onChange={e => search.setQuery(e.target.value)}
                />
              )}
              {entrySearch.available && (
                <label className="dash-search-bar__toggle" title={entryToggleLabel}>
                  <input
                    type="checkbox"
                    checked={entrySearch.enabled}
                    onChange={e => entrySearch.setEnabled(e.target.checked)}
                  />
                  <span>{entryToggleLabel}</span>
                </label>
              )}
            </div>
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
          const InlineCtrl = getInlineControl(rowTemplate.inlineControl);
          const item = (
            <ListItem
              key={i}
              row={row}
              rowTemplate={rowTemplate}
              badgeOpts={badgeOpts}
              badgeText={badgeByRow.get(row) ?? ''}
              InlineCtrl={InlineCtrl}
              navigate={navigate}
              tx={tx}
            />
          );
          if (!groupBy) return item;
          const group = String(row[groupBy] ?? '');
          const prevGroup = i > 0 ? String(search.filtered[i - 1][groupBy] ?? '') : null;
          if (group && group !== prevGroup) {
            return (
              <Fragment key={`grp-${i}`}>
                <li className="dash-list__group-header" role="presentation">
                  {tx(group)}
                </li>
                {item}
              </Fragment>
            );
          }
          return item;
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

interface ListItemProps {
  row: Record<string, unknown>;
  rowTemplate: RowTemplate;
  badgeOpts: BadgeOptions;
  badgeText: string;
  InlineCtrl: InlineControlComponent | null;
  navigate: NavigateFunction;
  tx: (s: string) => string;
}

function ListItem({ row, rowTemplate, badgeOpts, badgeText, InlineCtrl, navigate, tx }: ListItemProps) {
  // Slot for an optional block below the row (e.g. progress bar from an
  // InlineControl). Lifted into per-item state so each row keeps its own.
  const [extra, setExtra] = useState<ReactNode | null>(null);

  const primary = tx(substituteString(rowTemplate.primary, row));
  const secondary = rowTemplate.secondary ? tx(substituteString(rowTemplate.secondary, row)) : '';
  const tertiary = rowTemplate.tertiary ? tx(substituteString(rowTemplate.tertiary, row)) : '';
  const quaternary = rowTemplate.quaternary ? tx(substituteString(rowTemplate.quaternary, row)) : '';
  const showBadge = badgeText && !(badgeOpts.hideZero && isZeroBadge(badgeText));
  const clickable = !!rowTemplate.onClick;

  const resolvedBadge = badgeOpts.onClick
    ? resolveAction(badgeOpts.onClick, row)
    : null;
  const badgeClickable = !!resolvedBadge && !!resolvedBadge.action;
  const onBadgeClick = badgeClickable
    ? (e: React.MouseEvent | React.KeyboardEvent) => {
        e.stopPropagation();
        dispatchAction(badgeOpts.onClick, row, { navigate });
      }
    : undefined;

  return (
    <li
      className={`dash-list__item${clickable ? ' dash-list__item--clickable' : ''}${extra ? ' dash-list__item--has-extra' : ''}`}
    >
      <div
        className="dash-list__item-row"
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
        {InlineCtrl && (
          <div
            className="dash-list__inline-control"
            onClick={e => e.stopPropagation()}
            onKeyDown={e => e.stopPropagation()}
          >
            <InlineCtrl row={row} setExtra={setExtra} />
          </div>
        )}
        {showBadge && (
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
        )}
      </div>
      {extra && <div className="dash-list__item-extra">{extra}</div>}
    </li>
  );
}
