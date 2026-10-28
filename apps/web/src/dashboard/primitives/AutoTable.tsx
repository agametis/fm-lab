import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import type { PrimitiveProps } from '../types';
import { formatKpiValue, formatTableCell } from './_format';
import { Pager } from './_Pager';
import { parseFacets } from './_chipFacets';
import { dispatchAction } from '../actions';
import type { ActionSpec } from '../actions';

/** Delay before a typed server-side search term goes into the URL. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * AutoTable — Tabelle, die ihre Spalten automatisch aus dem Dataset ableitet.
 *
 * Default: scrollbare Liste mit sticky Header, sortierbar per Click auf Header,
 * optional mit Suchfeld zum Filtern. Paginierung ist Opt-in via `paginate: true`
 * oder `pageSize > 0`.
 *
 * Props:
 *   metaDataset      Optionaler Name eines Meta-Datasets (z.B. `query_meta`),
 *                    aus dem `click_action` und `click_args` gelesen werden.
 *   clickAction      String — Name der Action (z.B. "openObject"). Fallback,
 *                    wenn metaDataset fehlt.
 *   clickArgs        String im Format "k=v&k2=v2" mit Token-Subst. gegen Row.
 *   rowAction        Optionales ZWEITES Klickziel pro Zeile — rendert einen
 *                    kleinen Pfeil-Button am Zeilenende. Gleiche Grammatik wie
 *                    clickAction; aus dem Meta-Dataset (`row_action`) oder Props.
 *   rowActionArgs    Args-String des Zweitziels (wie clickArgs).
 *   rowActionLabel   Tooltip/aria-label des Buttons. Fallback: generischer
 *                    i18n-Text `detail:autoTable.rowAction`.
 *   exclude          Array<string> mit Spaltennamen, die nicht angezeigt werden.
 *                    Spalten mit `_`-Präfix werden immer übersprungen.
 *   paginate         Boolean (Default false). Aktiviert Paginierung.
 *   pageSize         Number — Anzahl Zeilen pro Seite. Implizit aktiviert
 *                    Paginierung wenn > 0 gesetzt. Default bei paginate=true: 50.
 *   sortable         Boolean (Default true). Click auf Header sortiert.
 *   searchable       Boolean (Default true). Suchfeld einblenden.
 *   maxHeight        CSS-Wert für scrollbaren Bereich (Default "70vh"). Nur
 *                    wirksam wenn paginate=false.
 *   density          'compact' | 'comfortable' (Default).
 *   chipFilter       Spaltenname für die Chip-Leiste. Fallback, wenn das
 *                    Meta-Dataset kein `chip_filter` liefert.
 *   chipParam        URL-Parameter, den ein Chip-Klick setzt. Fallback zu
 *                    `chip_param` aus dem Meta-Dataset.
 *   pageParam / searchParam / sortParam / sortColumns
 *                    Server paging — fallbacks to `page_param`, `search_param`,
 *                    `sort_param`, `sort_columns` of the meta dataset.
 *
 * Ergebnis-Konventionsspalten (optional, von der Query selbst berechnet):
 *   `_chip_facets`   JSON `{wert: anzahl}` — echte Facettenverteilung der
 *                    Grundgesamtheit VOR dem LIMIT. Ohne diese Spalte werden
 *                    die Chips wie bisher über die geladenen Zeilen gezählt.
 *   `_row_total`     Zeilenzahl des Ergebnisses vor dem LIMIT. Liegt sie über
 *                    den geladenen Zeilen, benennt der Kopf den Ausschnitt.
 *   `_page`, `_page_size`
 *                    Effective page (after clamping) and page size of a
 *                    server-paged query.
 *
 * Server paging (opt-in via `page_param`): the SQL pages, sorts and searches
 * over the whole result. As long as everything fits on one page and neither a
 * sort nor a search term sits in the URL, the table stays in CLIENT mode —
 * local, natural sorting and instant search over the loaded rows, as without
 * paging. Otherwise it switches to SERVER mode: the page, sort column,
 * direction and search term live in the URL, the SQL applies them, and the
 * table shows the rows as delivered. When a chip widens a one-page result into
 * several pages, the local sort and search move into the URL once, so the view
 * does not jump. A query declared `page_size: all` has no pager; its
 * `_row_total` only names the cut-off of the safety cap.
 */
export function AutoTable({ node, dataset, datasets, navigate }: PrimitiveProps) {
  const { t, i18n } = useTranslation(['common', 'detail']);
  const lang = i18n.language;
  const props = node.props ?? {};
  const metaDatasetId = props.metaDataset as string | undefined;
  const density = (props.density as string) ?? 'comfortable';
  const exclude = new Set<string>((props.exclude as string[]) ?? []);
  const sortable = (props.sortable as boolean) ?? true;
  const searchable = (props.searchable as boolean) ?? true;
  const maxHeight = (props.maxHeight as string) ?? '70vh';

  // Paginierung ist Opt-in: explizit via `paginate: true` ODER `pageSize > 0`.
  const explicitPageSize = props.pageSize as number | undefined;
  const paginateProp = (props.paginate as boolean) ?? false;
  const paginate = paginateProp || (typeof explicitPageSize === 'number' && explicitPageSize > 0);
  const pageSize = paginate
    ? Math.max(5, Math.min(500, explicitPageSize ?? 50))
    : 0;

  const rows = dataset?.data ?? [];
  const meta = metaDatasetId ? datasets[metaDatasetId]?.data?.[0] : undefined;

  // Optionale Chip-Leiste über einer Ergebnis-Spalte. Der Feldname kommt aus
  // dem Meta-Dataset (`chip_filter`, aus dem SQL-Frontmatter
  // `-- @chip_filter: <spalte>`) oder direkt aus den Props. Die
  // Facetten-Buckets werden bewusst in der SQL geformt (ein Chip pro Wert), was
  // die Grammatik hier auf einen einzelnen Feldnamen reduziert.
  const chipFilterField =
    (meta?.chip_filter as string | null | undefined) ??
    (props.chipFilter as string | undefined) ??
    null;

  // Opt-in auf Server-Schaltung: mit `chip_param` schreibt ein Klick den
  // gleichnamigen URL-Parameter, der Dashboard-Host re-quert und das SQL
  // filtert über die GANZE Grundgesamtheit. Ohne das Feld bleibt es beim
  // bisherigen Verhalten — Klick partitioniert nur die geladenen Zeilen.
  // Beides ist gewollt: Ranking-Queries (Top-N) wollen ausdrücklich die
  // Verteilung *in der geladenen Spitzengruppe* zeigen.
  const chipParam =
    (meta?.chip_param as string | null | undefined) ??
    (props.chipParam as string | undefined) ??
    null;

  const clickAction =
    (meta?.click_action as string | null | undefined) ??
    (props.clickAction as string | undefined) ??
    null;
  const clickArgs =
    (meta?.click_args as string | null | undefined) ??
    (props.clickArgs as string | undefined) ??
    null;

  // Optionales zweites Klickziel pro Zeile (kleiner Pfeil-Button am
  // Zeilenende) — gleiche Action-Grammatik wie click_action/click_args.
  // Kommt aus dem SQL-Frontmatter (`@row_action` …) oder den Props.
  const rowAction =
    (meta?.row_action as string | null | undefined) ??
    (props.rowAction as string | undefined) ??
    null;
  const rowActionArgs =
    (meta?.row_action_args as string | null | undefined) ??
    (props.rowActionArgs as string | undefined) ??
    null;
  const rowActionLabel =
    (meta?.row_action_label as string | null | undefined) ??
    (props.rowActionLabel as string | undefined) ??
    null;

  // Server paging — declared by the query (meta dataset) or the layout (props).
  const pageParam =
    (meta?.page_param as string | null | undefined) ?? (props.pageParam as string | undefined) ?? null;
  const searchParam =
    (meta?.search_param as string | null | undefined) ?? (props.searchParam as string | undefined) ?? null;
  const sortParam =
    (meta?.sort_param as string | null | undefined) ?? (props.sortParam as string | undefined) ?? null;
  const dirParam = sortParam ? (sortParam === 'sort' ? 'dir' : `${sortParam}_dir`) : null;
  const sortColumnsRaw = (meta?.sort_columns as unknown) ?? props.sortColumns;
  const serverSortColumns = useMemo(
    () => (Array.isArray(sortColumnsRaw) && sortColumnsRaw.length > 0
      ? new Set(sortColumnsRaw.map(String))
      : null),
    [sortColumnsRaw],
  );
  // `page_size: all` — no pager; the SQL still caps and reports `_row_total`.
  const pagingOff = meta?.paging_off === true;

  const columns = useMemo(() => {
    if (rows.length === 0) return [];
    const keys = Object.keys(rows[0]);
    return keys
      .filter(k => !k.startsWith('_'))
      .filter(k => !exclude.has(k))
      .filter(k => k.toLowerCase() !== 'uuid')
      .map(k => ({
        field: k,
        label: humanize(k),
        format: guessFormat(k, rows[0][k]),
      }));
  }, [rows, exclude]);

  const [searchParams, setSearchParams] = useSearchParams();
  // The input value in both modes; in server mode it reaches the URL debounced.
  const [search, setSearch] = useState(() => (searchParam ? (searchParams.get(searchParam) ?? '') : ''));
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0);
  const [localChipValue, setLocalChipValue] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Last search term this table wrote into the URL — such URL changes must not
  // be synced back into the input (the user may have typed on meanwhile).
  const writtenQuery = useRef<string | null>(null);

  // Echte Facetten und Gesamtzahl aus den Konventionsspalten der ersten Zeile.
  // Beide stehen redundant in jeder Zeile — Preis dafür, im Ein-Statement-SQL
  // zu bleiben. Fehlen sie, greift überall die alte Rückfallebene.
  const facets = useMemo(() => parseFacets(rows[0]?._chip_facets), [rows]);
  const rowTotal = useMemo(() => toFiniteNumber(rows[0]?._row_total), [rows]);
  const serverPage = useMemo(() => toFiniteNumber(rows[0]?._page), [rows]);
  const serverPageSize = useMemo(() => toFiniteNumber(rows[0]?._page_size), [rows]);

  // Client or server mode (see the component doc above).
  const urlSort = sortParam ? searchParams.get(sortParam) : null;
  const urlDir = dirParam ? searchParams.get(dirParam) : null;
  const urlQuery = searchParam ? (searchParams.get(searchParam) ?? '') : '';
  const serverCapable = !!pageParam && !pagingOff;
  const multiPage = rowTotal !== null && serverPageSize !== null && rowTotal > serverPageSize;
  const serverMode = serverCapable && (multiPage || !!urlSort || urlQuery.trim() !== '');
  const serverPageCount = serverMode && serverPageSize
    ? Math.max(1, Math.ceil((rowTotal ?? 0) / serverPageSize))
    : 1;
  const currentServerPage = Math.max(1, serverPage ?? 1);

  const isServerSortable = (field: string) =>
    sortable && !!sortParam && !!dirParam && (!serverSortColumns || serverSortColumns.has(field));

  // Entering server mode (e.g. a chip widened the result to several pages):
  // the local sort and search move into the URL once, so the view keeps them.
  const wasServerMode = useRef(serverMode);
  useEffect(() => {
    const entering = serverMode && !wasServerMode.current;
    wasServerMode.current = serverMode;
    if (!entering) return;
    const carrySort = !!sortField && !urlSort && isServerSortable(sortField);
    const term = search.trim();
    const carryQuery = !!searchParam && term !== '' && urlQuery.trim() === '';
    if (!carrySort && !carryQuery) return;
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (carrySort && sortParam && dirParam && sortField) {
        next.set(sortParam, sortField);
        next.set(dirParam, sortDir);
      }
      if (carryQuery && searchParam) next.set(searchParam, term);
      if (pageParam) next.delete(pageParam);
      return next;
    }, { replace: true });
    if (carryQuery) writtenQuery.current = term;
    // Only the mode transition triggers the hand-over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverMode]);

  // Server mode: the typed term reaches the URL after a short pause and starts
  // on page 1; a term set from outside (deep link, back navigation) fills the input.
  useEffect(() => {
    if (!serverMode || !searchParam) return;
    const term = search.trim();
    if (term === urlQuery.trim()) return;
    const handle = setTimeout(() => {
      writtenQuery.current = term;
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        if (term) next.set(searchParam, term);
        else next.delete(searchParam);
        if (pageParam) next.delete(pageParam);
        return next;
      }, { replace: true });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [search, serverMode, searchParam, urlQuery, pageParam, setSearchParams]);
  useEffect(() => {
    if (urlQuery.trim() === (writtenQuery.current ?? '').trim()) return;
    writtenQuery.current = null;
    if (serverMode && search.trim() !== urlQuery.trim()) setSearch(urlQuery);
    // Reacts to URL changes only; typing is handled by the effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQuery]);

  function goToServerPage(next: number) {
    if (!pageParam) return;
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      if (next <= 1) params.delete(pageParam);
      else params.set(pageParam, String(next));
      return params;
    }, { replace: true });
    scrollRef.current?.scrollTo({ top: 0 });
    scrollRef.current?.scrollIntoView({ block: 'nearest' });
  }

  // Der aktive Chip kommt bei Server-Schaltung aus der URL, nicht aus lokalem
  // State — sonst divergieren Anzeige und tatsächlicher Server-Filter nach
  // einem Reload oder über einen Deep-Link.
  const chipValue = chipParam ? searchParams.get(chipParam) : localChipValue;

  // Chip-Optionen: ein Chip je Feld-Wert, nach Häufigkeit (desc) sortiert.
  // Counts aus `_chip_facets` (Grundgesamtheit) — sonst wie bisher über die
  // geladenen Zeilen gezählt. Greift VOR der Volltextsuche.
  const chipOptions = useMemo(() => {
    if (!chipFilterField) return [] as { value: string; count: number | null }[];
    const counts = new Map<string, number | null>();
    if (facets) {
      for (const [value, count] of Object.entries(facets)) counts.set(value, count);
    } else {
      for (const row of rows) {
        const v = row[chipFilterField];
        if (v == null) continue;
        const key = String(v);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    // An active server chip stays selectable when a search leaves no rows (and
    // so no facets), so it can be cleared; its count is unknown then.
    if (chipParam && chipValue != null && !counts.has(chipValue)) counts.set(chipValue, null);
    return Array.from(counts.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.value.localeCompare(b.value, lang));
  }, [rows, facets, chipFilterField, lang, chipParam, chipValue]);

  // Zahl auf dem „Alle"-Chip: die Summe der Facetten ist auch dann die
  // Grundgesamtheit, wenn serverseitig gerade ein Chip aktiv ist (`_row_total`
  // zählt dann nur noch dessen Treffer).
  const chipAllCount = useMemo(() => {
    if (facets) return Object.values(facets).reduce((a, b) => a + b, 0);
    // Unknown for a server chip without rows (no row carries the facets).
    if (chipParam && rows.length === 0) return null;
    return rowTotal ?? rows.length;
  }, [facets, rowTotal, rows, chipParam]);

  const chipFiltered = useMemo(() => {
    // Bei Server-Schaltung hat das SQL bereits gefiltert — nochmal client-seitig
    // zu filtern würde nur den Facettenwert gegen den Parameterwert prüfen.
    // In server mode a client-only chip would partition just the current page,
    // so it is not applied (and its bar not shown).
    if (chipParam || serverMode || !chipFilterField || chipValue === null) return rows;
    return rows.filter(row => String(row[chipFilterField] ?? '') === chipValue);
  }, [rows, chipParam, serverMode, chipFilterField, chipValue]);
  const showChips = !!chipFilterField && chipOptions.length > 0 && (!serverMode || !!chipParam);

  function selectChip(value: string | null) {
    if (chipParam) {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        // URL kanonisch halten: „Alle" löscht den Parameter.
        if (value === null) next.delete(chipParam);
        else next.set(chipParam, value);
        // A new chip starts on page 1.
        if (pageParam) next.delete(pageParam);
        return next;
      }, { replace: true });
    } else {
      setLocalChipValue(value);
    }
    setPage(0);
  }

  // Filter (server mode: the SQL has searched already)
  const filtered = useMemo(() => {
    if (serverMode || !search.trim()) return chipFiltered;
    const needle = search.trim().toLowerCase();
    return chipFiltered.filter(row =>
      columns.some(c => {
        const v = row[c.field];
        if (v === null || v === undefined) return false;
        return String(v).toLowerCase().includes(needle);
      }),
    );
  }, [chipFiltered, search, columns, serverMode]);

  // Sortierung (server mode: the SQL has sorted already)
  const sorted = useMemo(() => {
    if (serverMode || !sortField) return filtered;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => compareValues(a[sortField], b[sortField], lang) * dir);
  }, [filtered, sortField, sortDir, lang, serverMode]);

  const total = sorted.length;
  // Der Kopf benennt den Ausschnitt nur, wenn das LIMIT wirklich gegriffen hat.
  const truncated = rowTotal !== null && rowTotal > rows.length;
  // Client-side pagination (layout opt-in) only applies outside server mode.
  const clientPaginate = paginate && !serverMode;
  const pageCount = clientPaginate ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const safePage = Math.min(page, pageCount - 1);
  const visible = clientPaginate
    ? sorted.slice(safePage * pageSize, safePage * pageSize + pageSize)
    : sorted;

  const clickable = !!clickAction;
  const clickSpec: ActionSpec | undefined = clickAction
    ? { action: clickAction, argsString: clickArgs ?? '' }
    : undefined;
  const rowSpec: ActionSpec | undefined = rowAction
    ? { action: rowAction, argsString: rowActionArgs ?? '' }
    : undefined;
  const rowActionTitle = rowActionLabel ?? (t('detail:autoTable.rowAction') as string);

  const headerSortable = (field: string) => (serverMode ? isServerSortable(field) : sortable);

  function handleHeaderClick(field: string) {
    if (serverMode) {
      if (!isServerSortable(field) || !sortParam || !dirParam) return;
      const nextDir = urlSort === field && urlDir !== 'desc' ? 'desc' : 'asc';
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.set(sortParam, field);
        next.set(dirParam, nextDir);
        if (pageParam) next.delete(pageParam);
        return next;
      }, { replace: true });
      return;
    }
    if (!sortable) return;
    if (sortField === field) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
    setPage(0);
  }

  // A server-side search or a server chip can leave zero rows; the field and
  // the chip bar must stay so either can be corrected.
  const serverQueryActive = serverMode && urlQuery.trim() !== '';
  if (rows.length === 0 && !serverQueryActive && !(chipParam && chipValue != null)) {
    return <div className="dash-table__empty">{t('common:noEntries')}</div>;
  }

  const fmtNumber = (n: number) => formatKpiValue(n, 'number', lang);
  const serverFrom = (currentServerPage - 1) * (serverPageSize ?? 0) + 1;
  const countLabel = serverMode
    ? serverPageCount > 1
      ? `${t('detail:autoTable.rowCountTruncated', {
          shown: `${fmtNumber(serverFrom)}–${fmtNumber(serverFrom + rows.length - 1)}`,
          total: fmtNumber(rowTotal ?? rows.length),
        })} · ${t('detail:autoTable.page', { current: currentServerPage, total: serverPageCount })}`
      : t('detail:autoTable.rowCount', { count: rowTotal ?? rows.length })
    : truncated
      ? t('detail:autoTable.rowCountTruncated', {
          shown: fmtNumber(total),
          total: fmtNumber(rowTotal as number),
        })
      : t('detail:autoTable.rowCount', { count: total });

  const wrapStyle = clientPaginate ? undefined : { maxHeight };
  const wrapClass = clientPaginate
    ? `dash-autotable__scroll dash-table-wrap dash-table--${density}`
    : `dash-autotable__scroll dash-autotable__scroll--bounded dash-table-wrap dash-table--${density}`;

  return (
    <div className="dash-autotable">
      {showChips && (
        <div className="dash-chip-bar" role="group" aria-label={t('common:all') as string}>
          <button
            type="button"
            className={`dash-chip${chipValue === null ? ' dash-chip--active' : ''}`}
            onClick={() => selectChip(null)}
            aria-pressed={chipValue === null}
          >
            {t('common:all') as string}
            {chipAllCount != null && (
              <span className="dash-chip__count">
                {formatKpiValue(chipAllCount, 'number', lang)}
              </span>
            )}
          </button>
          {chipOptions.map(opt => (
            <button
              key={opt.value}
              type="button"
              className={`dash-chip${chipValue === opt.value ? ' dash-chip--active' : ''}`}
              onClick={() => selectChip(opt.value)}
              aria-pressed={chipValue === opt.value}
            >
              {opt.value}
              {opt.count != null && (
                <span className="dash-chip__count">
                  {formatKpiValue(opt.count, 'number', lang)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      <div className="dash-autotable__head">
        <span className="dash-autotable__count">
          {countLabel}
          {!serverMode && search.trim() && total !== chipFiltered.length && (
            <> · {t('detail:autoTable.filteredFrom', { count: chipFiltered.length })}</>
          )}
          {clientPaginate && pageCount > 1 && (
            <> · {t('detail:autoTable.page', { current: safePage + 1, total: pageCount })}</>
          )}
        </span>
        {serverMode && (
          <Pager page={currentServerPage} pageCount={serverPageCount} onGo={goToServerPage} position="top" />
        )}
        {searchable && (
          <input
            type="search"
            className="dash-autotable__search"
            placeholder={t('common:searchPlaceholder') as string}
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        )}
      </div>
      <div className={wrapClass} style={wrapStyle} ref={scrollRef}>
        <table className="dash-table">
          <thead>
            <tr>
              {columns.map(c => {
                const activeField = serverMode ? urlSort : sortField;
                const activeDir = serverMode ? (urlDir === 'desc' ? 'desc' : 'asc') : sortDir;
                const indicator = activeField === c.field ? (activeDir === 'asc' ? ' ▲' : ' ▼') : '';
                const canSort = headerSortable(c.field);
                return (
                  <th
                    key={c.field}
                    className={canSort ? 'dash-autotable__th--sortable' : undefined}
                    onClick={canSort ? () => handleHeaderClick(c.field) : undefined}
                  >
                    {c.label}{indicator}
                  </th>
                );
              })}
              {rowSpec && <th className="dash-autotable__th--rowaction" aria-label={rowActionTitle} />}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => {
              const offset = clientPaginate ? safePage * pageSize : serverMode ? serverFrom - 1 : 0;
              const key = `${offset + i}-${String(row.uuid ?? '')}`;
              return (
                <tr
                  key={key}
                  className={clickable ? 'dash-table__row--clickable' : undefined}
                  onClick={clickable ? () => dispatchAction(clickSpec, row, { navigate }) : undefined}
                >
                  {columns.map(c => (
                    <td key={c.field}>{formatTableCell(row[c.field], c.format, lang)}</td>
                  ))}
                  {rowSpec && (
                    <td className="dash-autotable__rowaction-cell">
                      <button
                        type="button"
                        className="dash-autotable__rowaction"
                        title={rowActionTitle}
                        aria-label={rowActionTitle}
                        onClick={e => {
                          // Nicht auch noch den Zeilen-Klick (Primärziel) feuern.
                          e.stopPropagation();
                          dispatchAction(rowSpec, row, { navigate });
                        }}
                      >
                        →
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={Math.max(1, columns.length + (rowSpec ? 1 : 0))} className="dash-autotable__noresult">
                  {t('detail:autoTable.noMatches', { query: search })}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {serverMode && (
        <Pager page={currentServerPage} pageCount={serverPageCount} onGo={goToServerPage} position="bottom" />
      )}
      {clientPaginate && pageCount > 1 && (
        <div className="dash-autotable__pager">
          <button
            type="button"
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={safePage === 0}
          >
            {t('detail:autoTable.prev')}
          </button>
          <span>{safePage + 1} / {pageCount}</span>
          <button
            type="button"
            onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
            disabled={safePage >= pageCount - 1}
          >
            {t('detail:autoTable.next')}
          </button>
        </div>
      )}
    </div>
  );
}

/** Zahl aus DuckDB — je nach Transport number, BigInt oder String. */
function toFiniteNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function humanize(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function guessFormat(key: string, value: unknown): string | undefined {
  const k = key.toLowerCase();
  if (k.endsWith('_count') || k === 'count') return 'number';
  if (k.endsWith('_at') || k.endsWith('_date') || k === 'timestamp') return 'date';
  if (typeof value === 'number') return 'number';
  return undefined;
}

function compareValues(a: unknown, b: unknown, lang: string): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  // BigInt from DuckDB counts
  if (typeof a === 'bigint' && typeof b === 'bigint') {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return String(a).localeCompare(String(b), lang, { numeric: true, sensitivity: 'base' });
}
