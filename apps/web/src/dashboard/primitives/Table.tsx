import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { PrimitiveProps } from '../types';
import { formatTableCell, formatKpiValue } from './_format';
import { translateCellValue } from './_cellTranslate';
import { badgeToneClass, type BadgeTone } from './_badgeTone';
import { useRowSearch } from './_useRowSearch';
import { Pager } from './_Pager';
import { parseFacets } from './_chipFacets';
import { dispatchAction } from '../actions';
import { isActionActive } from '../actionState';
import { useSelection } from '../selectionContext';
import type { ActionSpec } from '../actions';
import { useXmlConvertFileStates, type XmlConvertFileState } from './useXmlConvertFileStates';

// Live-Status → Icon für die `liveStatusField`-Spalte (Datei-Status-Tabelle der
// XML-Konvertierung). Voller Lebenszyklus 🟡 → 🔥 → 🟢 → ✴️ → ✅, plus ⏭️ (Skip)
// und ⚠️ (Fehler).
const LIVE_STATE_ICON: Record<XmlConvertFileState, string> = {
  planned:   '🟡',
  skipped:   '⏭️',
  chunking:  '🔥',
  chunked:   '🟢',
  importing: '✴️',
  imported:  '✅',
  failed:    '⚠️',
};

/** Delay before a typed server-side search term goes into the URL. */
const SEARCH_DEBOUNCE_MS = 300;

interface ColumnSpec {
  field: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  // Formats: everything _format.ts knows (number, count, badge, filesize,
  // date:*) plus 'copy' — renders the cell as a subtle copy-to-clipboard
  // button whose tooltip reveals the raw value (for long identifiers like
  // UUIDs that would waste column width as plain text).
  format?: string;
  // Semantic colour per badge value, overriding the value-derived class
  // (see _badgeTone.ts). Only meaningful with `format: 'badge'`.
  badgeTone?: BadgeTone;
  // Keep the cell on one line (timestamps, names) — the remaining columns
  // absorb the width and wrap instead.
  nowrap?: boolean;
  // Server sort: the output column the SQL sorts by (default: `field`);
  // `sortable: false` keeps a column header unclickable.
  sortKey?: string;
  sortable?: boolean;
}

interface ChipFilterGroup {
  label: string;
  values: string[];
}

interface ChipFilterSpec {
  field: string;
  allLabel?: string;
  // Gruppierung mehrerer Feld-Werte unter einem gemeinsamen Chip (z.B.
  // "If / Else If" → values ["If", "Else If"]). Ein Wert in mehreren
  // Gruppen würde mehrfach erscheinen — vermeiden. Werte, die in keiner
  // Gruppe stehen, erhalten weiterhin einen eigenen Chip.
  groups?: ChipFilterGroup[];
  // Server chips: a click writes the value into this URL param, the SQL filters
  // the whole result, and the counts come from the convention column
  // `_chip_facets` ({value: count} over the result before the chip). Works in
  // client and server mode alike; `groups` apply to client chips only.
  param?: string;
}

interface ChipOption {
  // Stabile ID des Chips. Bei Gruppen: "group:<label>", sonst der Wert selbst.
  id: string;
  label: string;
  // null = unknown: a server chip without rows carries no facets.
  count: number | null;
  // Welche Feld-Werte filtert dieser Chip? Bei Einzel-Chip: [value], bei Gruppe: alle Mitglieder.
  values: string[];
}

export function Table({ node, dataset, navigate }: PrimitiveProps) {
  const { t, i18n } = useTranslation(['common', 'detail', 'dashboard']);
  const lang = i18n.language;
  const props = node.props ?? {};
  const columns = (props.columns as ColumnSpec[]) ?? [];
  const rowKey = (props.rowKey as string) ?? undefined;
  const density = (props.density as string) ?? 'comfortable';
  const onRowClick = props.onRowClick as ActionSpec | undefined;
  const empty = props.empty as { message?: string } | undefined;
  // Selection lens (see selectionContext): `selectField` makes this table the
  // SOURCE — a row click toggles its value on the named channel; `highlightField`
  // makes it a TARGET — rows whose (comma-separated) field contains the selected
  // value get tinted. A table may be both. Costs no column width, unlike a
  // per-lens column on an already wide list.
  const selectionKey = props.selectionKey as string | undefined;
  const selectField = props.selectField as string | undefined;
  const highlightField = props.highlightField as string | undefined;
  const { selection, toggle } = useSelection();
  const selectedValue = selectionKey ? (selection[selectionKey] ?? null) : null;
  // Server-side paging (opt-in via `pageParam`): the SQL sorts and pages, and
  // reports the window in convention columns of its rows — `_row_total` (rows
  // before paging), `_page` (effective 1-based page after clamping) and
  // `_page_size`. The pager writes `pageParam` into the URL (page 1 drops it).
  // Client-side sorting and search would only reorder or filter the loaded
  // page, so a paged table does not sort and searches only through
  // `searchParam` (a URL param the SQL filters on; the table then does not
  // filter the returned rows again). Without `pageParam`, a
  // `_row_total` above the loaded rows only names the cut-off of a
  // LIMIT-capped result, as in AutoTable.
  const pageParam = props.pageParam as string | undefined;
  const searchParam = props.searchParam as string | undefined;
  // Sortierung ist Opt-in. Default false, damit Bestands-Dashboards mit
  // bewusster Reihenfolge (z.B. die führende "Alle"-Zeile in api_families)
  // ihre Sortierung nicht verlieren, sobald sie einen Sort-State bekämen.
  const sortableProp = (props.sortable as boolean) ?? false;
  // Server sort (opt-in via `sortParam`): a header click writes the column into
  // the URL and the SQL sorts the whole result; the direction travels in
  // `dirParam` (default `dir`, or `<sortParam>_dir` for any other name).
  const sortParam = props.sortParam as string | undefined;
  const dirParam = (props.dirParam as string | undefined)
    ?? (sortParam ? (sortParam === 'sort' ? 'dir' : `${sortParam}_dir`) : undefined);
  // `clientMode` (opt-in): while the whole result fits on one page and neither
  // a sort nor a search term sits in the URL, the table sorts and searches the
  // loaded rows locally — natural order, no request. Opt-in because a dashboard
  // may share its search param with other datasets (the change lists filter
  // their KPIs and charts by the same term), which a local search would not reach.
  const clientModeOptIn = (props.clientMode as boolean) ?? false;
  const chipFilter = props.chipFilter as ChipFilterSpec | undefined;
  // Opt-in: Live-Markierung der XML-Konvertierung. `liveHighlightField` (z.B.
  // "filename") wird gegen die `file_start`/`file`-Dateinamen abgeglichen und
  // markiert pro Zeile den Status: orange = gerade in Arbeit (im Parallel-Modus
  // mehrere gleichzeitig), grün = in diesem Lauf fertig, rot = fehlgeschlagen.
  // `liveStatusField` (z.B. "emoji") benennt zusätzlich die Spalte, deren Inhalt
  // während eines Laufs vom Live-Status überschrieben wird (Checkmark-Reset +
  // Pro-Datei-Checkmark). Nur die xml_convert-Datei-Status-Tabelle setzt das.
  const liveHighlightField = props.liveHighlightField as string | undefined;
  const liveStatusField = props.liveStatusField as string | undefined;
  // Opt-in Summary-Zusätze in der Zähler-Zeile über der Tabelle (nur die
  // xml_convert-Datei-Status-Tabelle nutzt das): `summaryNewField`/`summaryNewValue`
  // zählen die Zeilen mit einem bestimmten Feld-Wert (z.B. status="new") → "· N neu";
  // `summarySizeField` summiert ein Byte-Feld (z.B. size) → "· Gesamtgröße X".
  const summaryNewField = props.summaryNewField as string | undefined;
  const summaryNewValue = props.summaryNewValue as string | undefined;
  const summarySizeField = props.summarySizeField as string | undefined;
  // `summaryFlagField`/`summaryFlagValue` zählen Zeilen mit einem Feld-Wert und
  // rendern bei ≥ 1 Treffer ein hervorgehobenes Warn-Label (`summaryFlagLabelKey`,
  // i18n-Key, erhält { count, total }; Suffix `_partial` wenn nicht alle Zeilen
  // betroffen sind) plus optionalen Hinweistext (`summaryFlagHintKey`). Erster
  // Nutzer: „DDR-Info fehlt" auf der XML-Import-Seite (ddr_info === false).
  // null/undefined-Werte zählen nie als Treffer.
  const summaryFlagField = props.summaryFlagField as string | undefined;
  const summaryFlagValue = props.summaryFlagValue as unknown;
  const summaryFlagLabelKey = props.summaryFlagLabelKey as string | undefined;
  const summaryFlagHintKey = props.summaryFlagHintKey as string | undefined;
  // Opt-in: Zähler-/Status-Zeile immer rendern, auch wenn das Suchfeld (noch)
  // ausgeblendet ist (z.B. wenige Dateien). Ohne diese Prop erscheint die Zeile
  // wie bisher nur zusammen mit dem Suchfeld.
  const alwaysShowCount = (props.alwaysShowCount as boolean) ?? false;
  const liveStates = useXmlConvertFileStates(!!liveHighlightField);
  // Breite des Zeilen-Fortschrittsbalkens: der Balken spannt die ganze Zeile,
  // hängt aber als absolut positioniertes Overlay in der ERSTEN Zelle — ein
  // Hintergrund auf der <tr> ist keine Option, weil WebKit (Safari) den
  // Zeilenhintergrund pro Zelle neu anlegt und ein Verlauf dort in ebenso viele
  // Fragmente zerfällt, wie die Tabelle Spalten hat (siehe dashboard.css,
  // .dash-table__row--filling). Die Zeilenbreite ist die Tabellenbreite, also
  // messen wir die einmal und halten sie per ResizeObserver aktuell — nur
  // während eines laufenden Imports.
  const tableRef = useRef<HTMLTableElement>(null);
  const [tableWidth, setTableWidth] = useState(0);
  const measureTable = !!liveHighlightField && liveStates.active;
  useEffect(() => {
    if (!measureTable) return;
    const el = tableRef.current;
    if (!el) return;
    const measure = () => setTableWidth(el.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measureTable]);
  const rows = dataset?.data ?? [];
  const [searchParams, setSearchParams] = useSearchParams();

  const firstRow = rows[0] as Record<string, unknown> | undefined;
  const rowTotal = toCount(firstRow?._row_total);
  const paged = !!pageParam && rowTotal != null;
  const pageSize = paged ? (toCount(firstRow?._page_size) ?? rows.length) : 0;
  const page = paged ? Math.max(1, toCount(firstRow?._page) ?? 1) : 1;
  const pageCount = paged && pageSize > 0 ? Math.max(1, Math.ceil((rowTotal as number) / pageSize)) : 1;
  const truncated = rowTotal != null && rowTotal > rows.length;

  // The scroll position stays where it is (as in AutoTable): the next click on
  // the same pager goes on paging instead of hunting for a moved button.
  const goToPage = (next: number) => {
    if (!pageParam) return;
    setSearchParams(prev => {
      const n = new URLSearchParams(prev);
      if (next <= 1) n.delete(pageParam);
      else n.set(pageParam, String(next));
      return n;
    }, { replace: true });
  };

  // Client or server mode. Without `clientMode` a paged table always works on
  // the server, as before. With it, a one-page result without a sort or search
  // term in the URL stays local; anything else goes to the server.
  const urlSort = sortParam ? searchParams.get(sortParam) : null;
  const urlDir = dirParam ? searchParams.get(dirParam) : null;
  const urlQuery = searchParam ? (searchParams.get(searchParam) ?? '') : '';
  const multiPage = paged && pageCount > 1;
  const localMode = clientModeOptIn && !!pageParam && !multiPage && !urlSort && urlQuery.trim() === '';
  const serverSide = !!pageParam && !localMode;
  const serverSort = serverSide && !!sortParam && !!dirParam;
  const sortable = serverSide ? sortableProp && serverSort : sortableProp;
  // Server chips (`chipFilter.param`) filter in the SQL and count the whole
  // result; a client-side chip would count and filter just the loaded page, so
  // it is off in server mode.
  const chipParam = chipFilter?.param;
  const chipsActive = !!chipFilter && (!serverSide || !!chipParam);
  const facets = useMemo(
    () => (chipParam ? parseFacets(firstRow?._chip_facets) : null),
    [chipParam, firstRow],
  );

  // Chip-Filter: Werte des konfigurierten Felds plus Counts, sortiert nach
  // Häufigkeit. Wird VOR der Volltextsuche angewendet, damit Counts und
  // Suchresultate konsistent bleiben. `chipValue` hält die Chip-ID (nicht den
  // Roh-Wert), damit Gruppen-Chips eindeutig adressierbar sind; ein Server-Chip
  // steht in der URL, damit Reload und Deep-Link denselben Filter zeigen.
  const [localChipValue, setLocalChipValue] = useState<string | null>(null);
  const chipValue = chipParam ? searchParams.get(chipParam) : localChipValue;
  const chipOptions = useMemo<ChipOption[]>(() => {
    if (!chipFilter || !chipsActive) return [];

    // 1) Roh-Counts pro Wert — bei Server-Chips aus den Facetten der ganzen Menge.
    const counts = new Map<string, number>();
    if (facets) {
      for (const [value, count] of Object.entries(facets)) counts.set(value, count);
    } else {
      for (const row of rows) {
        const v = row[chipFilter.field];
        if (v == null) continue;
        const key = String(v);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }

    // 2) Gruppen vorne anstellen, alle gruppierten Werte aus counts entfernen.
    const grouped = new Set<string>();
    const groupChips: ChipOption[] = (chipParam ? [] : chipFilter.groups ?? []).map(g => {
      const sum = g.values.reduce((acc, v) => {
        grouped.add(v);
        return acc + (counts.get(v) ?? 0);
      }, 0);
      return { id: `group:${g.label}`, label: g.label, count: sum, values: g.values };
    }).filter(c => c.count > 0);

    // 3) Einzelne Chips für nicht-gruppierte Werte.
    const singleChips: ChipOption[] = Array.from(counts.entries())
      .filter(([value]) => !grouped.has(value))
      .map(([value, count]) => ({ id: value, label: value, count, values: [value] }));
    // An active server chip stays selectable when a search leaves no rows (and
    // so no facets), so it can be cleared; its count is unknown then.
    if (chipParam && chipValue != null && !counts.has(chipValue)) {
      singleChips.push({ id: chipValue, label: chipValue, count: null, values: [chipValue] });
    }

    // 4) Sortierung: alle Chips gemeinsam nach Count (desc), bei Tie alphabetisch.
    return [...groupChips, ...singleChips].sort(
      (a, b) => (b.count ?? 0) - (a.count ?? 0) || a.label.localeCompare(b.label, lang),
    );
  }, [rows, chipFilter, lang, chipsActive, facets, chipParam, chipValue]);
  // Count on the "all" chip: with facets their sum (the result before search and
  // chip), otherwise the loaded rows — unknown for a server chip without rows.
  const chipAllCount = facets
    ? Object.values(facets).reduce((a, b) => a + b, 0)
    : chipParam && rows.length === 0 ? null : rows.length;

  const selectChip = (id: string | null) => {
    if (!chipParam) {
      setLocalChipValue(id);
      return;
    }
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (id === null) next.delete(chipParam);
      else next.set(chipParam, id);
      // A new chip starts on page 1.
      if (pageParam) next.delete(pageParam);
      return next;
    }, { replace: true });
  };

  const chipFiltered = useMemo(() => {
    // Server chip: the SQL has filtered already.
    if (!chipFilter || !chipValue || chipParam) return rows;
    const active = chipOptions.find(c => c.id === chipValue);
    if (!active) return rows;
    const allowed = new Set(active.values);
    return rows.filter(r => allowed.has(String(r[chipFilter.field] ?? '')));
  }, [rows, chipFilter, chipValue, chipOptions, chipParam]);

  // Generischer Volltext-Filter — sichtbar je nach `searchable`-Prop (true /
  // false / 'auto', Default 'auto' → ab >10 Rows). Greift VOR Sortierung,
  // damit der sortierte Output dem Suchergebnis entspricht.
  const search = useRowSearch(chipFiltered, {
    searchable: serverSide && !searchParam ? false : props.searchable as boolean | 'auto' | undefined,
    autoThreshold: props.searchAutoThreshold as number | undefined,
    placeholder: props.searchPlaceholder as string | undefined,
    // Local mode searches in component state; the URL term belongs to the server.
    searchParam: localMode ? undefined : searchParam,
    resetParams: serverSide ? [pageParam as string] : undefined,
    // Paged + URL-bound term = server-side search: the SQL already matched,
    // possibly on columns this table does not show.
    clientFilter: !(serverSide && searchParam),
    // Every URL change is a request: the term goes out after a short pause.
    debounceMs: serverSide ? SEARCH_DEBOUNCE_MS : undefined,
  });
  // A URL-bound term the SQL filters on can leave zero rows; the search field
  // must stay so the term can be corrected.
  const serverQuery = !!searchParam && search.query.trim() !== '';
  const searchVisible = search.visible || serverQuery;

  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Leaving local mode (e.g. a chip widened the result to several pages): the
  // local sort and search move into the URL once, so the view keeps them.
  const lastLocalQuery = useRef('');
  if (localMode) lastLocalQuery.current = search.query;
  const wasLocal = useRef(localMode);
  useEffect(() => {
    const leaving = wasLocal.current && !localMode;
    wasLocal.current = localMode;
    if (!leaving || !pageParam) return;
    const column = sortField ? columns.find(c => c.field === sortField) : undefined;
    const carrySort = !!column && column.sortable !== false && serverSort && !urlSort;
    const term = lastLocalQuery.current.trim();
    const carryQuery = !!searchParam && term !== '' && urlQuery.trim() === '';
    if (!carrySort && !carryQuery) return;
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (carrySort && column && sortParam && dirParam) {
        next.set(sortParam, column.sortKey ?? column.field);
        next.set(dirParam, sortDir);
      }
      if (carryQuery && searchParam) next.set(searchParam, term);
      next.delete(pageParam);
      return next;
    }, { replace: true });
    // Only the mode transition triggers the hand-over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localMode]);
  // 'copy'-format cells: id of the cell whose value was just copied (brief
  // checkmark feedback, auto-reset).
  const [copiedCell, setCopiedCell] = useState<string | null>(null);

  const sortedRows = useMemo(() => {
    // Server side: the SQL has sorted already.
    if (serverSide || !sortField) return search.filtered;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...search.filtered].sort(
      (a, b) => compareValues(a[sortField], b[sortField], lang) * dir,
    );
  }, [search.filtered, sortField, sortDir, lang, serverSide]);

  // Summary-Kennzahlen über den aktuell sichtbaren (gefilterten) Zeilen, damit
  // sie konsistent zum angezeigten "N Einträge" bleiben.
  const summaryNewCount = useMemo(() => {
    if (!summaryNewField) return null;
    const want = String(summaryNewValue ?? '');
    return sortedRows.reduce(
      (acc, r) => acc + (String(r[summaryNewField] ?? '') === want ? 1 : 0),
      0,
    );
  }, [sortedRows, summaryNewField, summaryNewValue]);

  const summaryTotalSize = useMemo(() => {
    if (!summarySizeField) return null;
    return sortedRows.reduce((acc, r) => acc + (Number(r[summarySizeField]) || 0), 0);
  }, [sortedRows, summarySizeField]);

  const summaryFlagCount = useMemo(() => {
    if (!summaryFlagField || !summaryFlagLabelKey) return null;
    const want = String(summaryFlagValue ?? '');
    return sortedRows.reduce((acc, r) => {
      const v = r[summaryFlagField];
      return acc + (v != null && String(v) === want ? 1 : 0);
    }, 0);
  }, [sortedRows, summaryFlagField, summaryFlagValue, summaryFlagLabelKey]);

  // A server chip can leave zero rows as well; the chip bar must stay to clear it.
  if (rows.length === 0 && !serverQuery && !(chipParam && chipValue != null)) {
    return <div className="dash-table__empty">{empty?.message ?? t('common:noEntries')}</div>;
  }

  const fmtNumber = (n: number) => formatKpiValue(n, 'number', lang);
  const pageFrom = (page - 1) * pageSize + 1;
  const countLabel = paged && pageCount > 1
    ? `${t('detail:autoTable.rowCountTruncated', {
        shown: `${fmtNumber(pageFrom)}–${fmtNumber(pageFrom + rows.length - 1)}`,
        total: fmtNumber(rowTotal as number),
      })} · ${t('detail:autoTable.page', { current: page, total: pageCount })}`
    : truncated
      ? t('detail:autoTable.rowCountTruncated', {
          shown: fmtNumber(rows.length),
          total: fmtNumber(rowTotal as number),
        })
      : t('detail:autoTable.rowCount', { count: sortedRows.length });
  const showCountBar = alwaysShowCount || searchVisible || truncated || (paged && pageCount > 1);

  const selectable = !!(selectionKey && selectField);
  const clickable = !!onRowClick || selectable;
  const hasQuery = search.query.trim() !== '';

  const handleRowClick = (row: Record<string, unknown>) => {
    if (selectable) toggle(selectionKey as string, String(row[selectField as string] ?? ''));
    if (onRowClick) dispatchAction(onRowClick, row, { navigate });
  };

  /** Selected source row, or a target row belonging to the selected value. */
  const isSelected = (row: Record<string, unknown>): boolean => {
    if (!selectionKey || !selectedValue) return false;
    if (selectField && String(row[selectField] ?? '') === selectedValue) return true;
    if (!highlightField) return false;
    const raw = row[highlightField];
    if (raw == null) return false;
    return String(raw).split(',').map(s => s.trim()).filter(Boolean).includes(selectedValue);
  };

  const handleHeaderClick = (c: ColumnSpec) => {
    if (!sortable || c.sortable === false) return;
    if (serverSort && sortParam && dirParam) {
      const key = c.sortKey ?? c.field;
      const nextDir = urlSort === key && urlDir !== 'desc' ? 'desc' : 'asc';
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.set(sortParam, key);
        next.set(dirParam, nextDir);
        if (pageParam) next.delete(pageParam);
        return next;
      }, { replace: true });
      return;
    }
    const field = c.field;
    if (sortField === field) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  return (
    <div className={`dash-table-wrap dash-table--${density}`}>
      {chipsActive && chipFilter && chipOptions.length > 0 && (
        <div className="dash-chip-bar" role="group" aria-label={chipFilter.allLabel ?? t('common:all') as string}>
          <button
            type="button"
            className={`dash-chip${chipValue === null ? ' dash-chip--active' : ''}`}
            onClick={() => selectChip(null)}
          >
            {chipFilter.allLabel ?? (t('common:all') as string)}
            {chipAllCount != null && <span className="dash-chip__count">{chipAllCount}</span>}
          </button>
          {chipOptions.map(opt => (
            <button
              key={opt.id}
              type="button"
              className={`dash-chip${chipValue === opt.id ? ' dash-chip--active' : ''}`}
              onClick={() => selectChip(opt.id)}
            >
              {opt.label}
              {opt.count != null && <span className="dash-chip__count">{opt.count}</span>}
            </button>
          ))}
        </div>
      )}
      {showCountBar && (
        <div className="dash-search-bar">
          <span className="dash-search-bar__count">
            {countLabel}
            {hasQuery && sortedRows.length !== search.totalCount && (
              <> · {t('detail:autoTable.filteredFrom', { count: search.totalCount })}</>
            )}
            {summaryNewCount != null && summaryNewCount > 0 && (
              <> · {t('detail:autoTable.newCount', { count: summaryNewCount })}</>
            )}
            {summaryTotalSize != null && (
              <> · {t('detail:autoTable.totalSize', {
                size: formatKpiValue(summaryTotalSize, 'filesize', lang),
              })}</>
            )}
            {summaryFlagCount != null && summaryFlagCount > 0 && summaryFlagLabelKey && (
              <>
                {' · '}
                <span className="dash-search-bar__flag">
                  {t(
                    summaryFlagCount === sortedRows.length
                      ? summaryFlagLabelKey
                      : `${summaryFlagLabelKey}_partial`,
                    { count: summaryFlagCount, total: sortedRows.length },
                  ) as string}
                </span>
                {summaryFlagHintKey && <> – {t(summaryFlagHintKey) as string}</>}
              </>
            )}
          </span>
          {paged && <Pager page={page} pageCount={pageCount} onGo={goToPage} position="top" />}
          {searchVisible && (
            <input
              type="search"
              className="dash-search-bar__input"
              placeholder={search.placeholder}
              value={search.query}
              onChange={e => search.setQuery(e.target.value)}
            />
          )}
        </div>
      )}
      <table className="dash-table" ref={tableRef}>
        <thead>
          <tr>
            {columns.map(c => {
              const alignClass = c.align ? `dash-table__th--${c.align}` : '';
              const canSort = sortable && c.sortable !== false;
              const sortClass = canSort ? 'dash-autotable__th--sortable' : '';
              const wrapClass = c.nowrap ? 'dash-table__th--nowrap' : '';
              const className = [alignClass, sortClass, wrapClass].filter(Boolean).join(' ') || undefined;
              const isSorted = serverSort ? urlSort === (c.sortKey ?? c.field) : sortField === c.field;
              const activeDir = serverSort ? (urlDir === 'desc' ? 'desc' : 'asc') : sortDir;
              const indicator = isSorted ? (activeDir === 'asc' ? ' ▲' : ' ▼') : '';
              return (
                <th
                  key={c.field}
                  className={className}
                  onClick={canSort ? () => handleHeaderClick(c) : undefined}
                >
                  {c.label}{indicator}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, i) => {
            // Index immer mit anhängen — Datasets dürfen mehrfache Werte in
            // rowKey-Spalten haben (z.B. mehrere Variablen mit gleichem
            // Variable_Name in unterschiedlichen Files).
            const key = rowKey ? `${String(row[rowKey] ?? '')}-${i}` : String(i);
            // Aktive-Filter-Markierung: wenn die onRowClick-Action einen
            // Filter setzen würde, der im URL bereits aktiv ist (z.B. die
            // Tabelle führt zu sich selbst mit `?api_family=X`), markieren
            // wir die Zeile farbig.
            const isActive = clickable && isActionActive(onRowClick, row, searchParams);
            // Live-Status dieser Zeile (nur während eines aktiven Laufs).
            const liveEntry = liveHighlightField && liveStates.active
              ? liveStates.states.get(String(row[liveHighlightField] ?? ''))
              : undefined;
            const liveState = liveEntry?.state;
            // Importierende Datei mit bekannter Chunk-Gesamtzahl → determinierter
            // Fortschrittsbalken (done/total) als linksbündiger Balken hinter der
            // Zeile. Solange total fehlt (kurz nach import_start im Fallback) bzw.
            // während des Splittens (chunking) bleibt es beim indeterminaten Puls.
            const fillTotal = liveState === 'importing' ? liveEntry?.total : undefined;
            const isFilling = typeof fillTotal === 'number' && fillTotal > 0;
            const fillPct = isFilling
              ? Math.max(0, Math.min(100, ((liveEntry?.done ?? 0) / fillTotal) * 100))
              : 0;
            // Zeilen-Highlight: chunking (+ importing ohne total) = indeterminater Puls,
            // importing mit total = wachsender Chunk-Balken, imported = grün, failed = rot.
            // planned/skipped/chunked bleiben neutral (nur das Status-Icon signalisiert sie).
            const rowClass = [
              clickable ? 'dash-table__row--clickable' : '',
              isActive ? 'dash-table__row--active' : '',
              isSelected(row) ? 'dash-table__row--selected' : '',
              isFilling ? 'dash-table__row--filling' : '',
              (!isFilling && (liveState === 'chunking' || liveState === 'importing')) ? 'dash-table__row--processing' : '',
              liveState === 'imported' ? 'dash-table__row--done' : '',
              liveState === 'failed' ? 'dash-table__row--failed' : '',
            ].filter(Boolean).join(' ') || undefined;
            // Fortschritts-Overlay: linksbündiger Balken bis fillPct der
            // ZEILEN-Breite, gerendert als absolut positioniertes <span> in der
            // ersten Zelle (siehe `tableWidth` oben). Die Farbe kommt aus der
            // theme-fähigen --fill-color (gesetzt von .dash-table__row--filling).
            const fillOverlay = isFilling ? (
              <span
                className="dash-table__fill"
                aria-hidden="true"
                style={{ width: `${(fillPct / 100) * tableWidth}px` }}
              />
            ) : null;
            return (
              <tr
                key={key}
                className={rowClass}
                onClick={clickable ? () => handleRowClick(row) : undefined}
                aria-current={isActive ? 'true' : undefined}
                aria-selected={selectable ? isSelected(row) : undefined}
              >
                {columns.map((c, ci) => {
                  let rawValue = row[c.field];
                  // Live-Status-Spalte (z.B. "emoji") während eines Laufs vom
                  // Live-Status überschreiben: beim Start alle Checkmarks leeren
                  // (Reset), pro fertiger Datei ✅ bzw. ⚠️ setzen. In Arbeit /
                  // noch nicht gestartet → leer. Nach Lauf-Ende (active=false)
                  // zeigt wieder der nachgeladene DB-Wert.
                  if (liveStatusField && c.field === liveStatusField && liveStates.active) {
                    rawValue = liveState ? LIVE_STATE_ICON[liveState] : '';
                  }
                  // Categorical cells (badges) frequently carry canonical
                  // English keys emitted from SQL — translate them so the UI
                  // matches the active language. Unknown values pass through.
                  // 'copy' format: no text — a subtle clipboard button whose
                  // tooltip shows the raw value; the click must not bubble into
                  // the row's onRowClick navigation.
                  if (c.format === 'copy') {
                    const copyValue = rawValue == null ? '' : String(rawValue);
                    const cellId = `${key}:${c.field}`;
                    const isCopied = copiedCell === cellId;
                    return (
                      <td
                        key={c.field}
                        className={cellClass(c)}
                      >
                        {ci === 0 && fillOverlay}
                        {copyValue !== '' && (
                          <button
                            type="button"
                            className={`dash-table__copy${isCopied ? ' dash-table__copy--copied' : ''}`}
                            title={copyValue}
                            aria-label={copyValue}
                            onClick={e => {
                              e.stopPropagation();
                              navigator.clipboard?.writeText(copyValue)
                                .then(() => {
                                  setCopiedCell(cellId);
                                  setTimeout(
                                    () => setCopiedCell(cur => (cur === cellId ? null : cur)),
                                    1500,
                                  );
                                })
                                .catch(() => { /* clipboard blocked */ });
                            }}
                          >
                            {isCopied ? (
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            ) : (
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                              </svg>
                            )}
                          </button>
                        )}
                      </td>
                    );
                  }
                  const isBadge = c.format === 'badge';
                  const value = isBadge ? translateCellValue(rawValue, t) : rawValue;
                  const formatted = formatTableCell(value, c.format, lang);
                  // Chunk-Zähler „k von N" hinter dem Dateinamen, solange diese
                  // Datei importiert wird (Phase D). Nur in der Highlight-Spalte.
                  const chunkCounter =
                    liveHighlightField && c.field === liveHighlightField &&
                    liveState === 'importing' && liveEntry?.total != null
                      ? (t('dashboard:xmlConvert.chunkCounter', {
                          done: liveEntry.done ?? 0,
                          total: liveEntry.total,
                          defaultValue: '{{done}} von {{total}}',
                        }) as string)
                      : null;
                  return (
                    <td
                      key={c.field}
                      className={cellClass(c)}
                    >
                      {ci === 0 && fillOverlay}
                      {isBadge ? (
                        // A badge is a category, and an absent value is no
                        // category — render nothing rather than a pill around
                        // the "—" placeholder. This is what lets a column show
                        // only the exceptions (XML import: `ddr_flag` is set on
                        // the files MISSING DDR info and null on all others).
                        rawValue == null || rawValue === '' ? null : (
                          <span
                            className={`dash-badge ${badgeToneClass(rawValue, c.badgeTone)}`}
                          >
                            {formatted}
                          </span>
                        )
                      ) : (
                        <>
                          {formatted}
                          {chunkCounter && (
                            <span className="dash-table__chunk-counter">{chunkCounter}</span>
                          )}
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {hasQuery && sortedRows.length === 0 && (
        <div className="dash-search-bar__empty">
          {t('detail:autoTable.noMatches', { query: search.query })}
        </div>
      )}
      {paged && <Pager page={page} pageCount={pageCount} onGo={goToPage} position="bottom" />}
    </div>
  );
}

function cellClass(c: ColumnSpec): string | undefined {
  return [c.align ? `dash-table__td--${c.align}` : '', c.nowrap ? 'dash-table__td--nowrap' : '']
    .filter(Boolean).join(' ') || undefined;
}

/** Non-negative integer from a convention column (number or numeric string), else null. */
function toCount(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}


function compareValues(a: unknown, b: unknown, lang: string): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'bigint' && typeof b === 'bigint') {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return String(a).localeCompare(String(b), lang, { numeric: true, sensitivity: 'base' });
}
