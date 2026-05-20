import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { PrimitiveProps } from '../types';
import { formatTableCell } from './_format';
import { translateCellValue } from './_cellTranslate';
import { useRowSearch } from './_useRowSearch';
import { dispatchAction } from '../actions';
import { isActionActive } from '../actionState';
import type { ActionSpec } from '../actions';

interface ColumnSpec {
  field: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  format?: string;
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
}

interface ChipOption {
  // Stabile ID des Chips. Bei Gruppen: "group:<label>", sonst der Wert selbst.
  id: string;
  label: string;
  count: number;
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
  // Sortierung ist Opt-in. Default false, damit Bestands-Dashboards mit
  // bewusster Reihenfolge (z.B. die führende "Alle"-Zeile in api_families)
  // ihre Sortierung nicht verlieren, sobald sie einen Sort-State bekämen.
  const sortable = (props.sortable as boolean) ?? false;
  const chipFilter = props.chipFilter as ChipFilterSpec | undefined;
  const rows = dataset?.data ?? [];
  const [searchParams] = useSearchParams();

  // Chip-Filter: Werte des konfigurierten Felds plus Counts, sortiert nach
  // Häufigkeit. Wird VOR der Volltextsuche angewendet, damit Counts und
  // Suchresultate konsistent bleiben. `chipValue` hält die Chip-ID (nicht den
  // Roh-Wert), damit Gruppen-Chips eindeutig adressierbar sind.
  const [chipValue, setChipValue] = useState<string | null>(null);
  const chipOptions = useMemo<ChipOption[]>(() => {
    if (!chipFilter) return [];

    // 1) Roh-Counts pro Wert.
    const counts = new Map<string, number>();
    for (const row of rows) {
      const v = row[chipFilter.field];
      if (v == null) continue;
      const key = String(v);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    // 2) Gruppen vorne anstellen, alle gruppierten Werte aus counts entfernen.
    const grouped = new Set<string>();
    const groupChips: ChipOption[] = (chipFilter.groups ?? []).map(g => {
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

    // 4) Sortierung: alle Chips gemeinsam nach Count (desc), bei Tie alphabetisch.
    return [...groupChips, ...singleChips].sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label, lang),
    );
  }, [rows, chipFilter, lang]);

  const chipFiltered = useMemo(() => {
    if (!chipFilter || !chipValue) return rows;
    const active = chipOptions.find(c => c.id === chipValue);
    if (!active) return rows;
    const allowed = new Set(active.values);
    return rows.filter(r => allowed.has(String(r[chipFilter.field] ?? '')));
  }, [rows, chipFilter, chipValue, chipOptions]);

  // Generischer Volltext-Filter — sichtbar je nach `searchable`-Prop (true /
  // false / 'auto', Default 'auto' → ab >10 Rows). Greift VOR Sortierung,
  // damit der sortierte Output dem Suchergebnis entspricht.
  const search = useRowSearch(chipFiltered, {
    searchable: props.searchable as boolean | 'auto' | undefined,
    autoThreshold: props.searchAutoThreshold as number | undefined,
    placeholder: props.searchPlaceholder as string | undefined,
  });

  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const sortedRows = useMemo(() => {
    if (!sortField) return search.filtered;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...search.filtered].sort(
      (a, b) => compareValues(a[sortField], b[sortField], lang) * dir,
    );
  }, [search.filtered, sortField, sortDir, lang]);

  if (rows.length === 0) {
    return <div className="dash-table__empty">{empty?.message ?? t('common:noEntries')}</div>;
  }

  const clickable = !!onRowClick;
  const hasQuery = search.query.trim() !== '';

  const handleHeaderClick = (field: string) => {
    if (!sortable) return;
    if (sortField === field) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  return (
    <div className={`dash-table-wrap dash-table--${density}`}>
      {chipFilter && chipOptions.length > 0 && (
        <div className="dash-chip-bar" role="group" aria-label={chipFilter.allLabel ?? t('common:all') as string}>
          <button
            type="button"
            className={`dash-chip${chipValue === null ? ' dash-chip--active' : ''}`}
            onClick={() => setChipValue(null)}
          >
            {chipFilter.allLabel ?? (t('common:all') as string)}
            <span className="dash-chip__count">{rows.length}</span>
          </button>
          {chipOptions.map(opt => (
            <button
              key={opt.id}
              type="button"
              className={`dash-chip${chipValue === opt.id ? ' dash-chip--active' : ''}`}
              onClick={() => setChipValue(opt.id)}
            >
              {opt.label}
              <span className="dash-chip__count">{opt.count}</span>
            </button>
          ))}
        </div>
      )}
      {search.visible && (
        <div className="dash-search-bar">
          <span className="dash-search-bar__count">
            {t('detail:autoTable.rowCount', { count: sortedRows.length })}
            {hasQuery && sortedRows.length !== search.totalCount && (
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
      <table className="dash-table">
        <thead>
          <tr>
            {columns.map(c => {
              const alignClass = c.align ? `dash-table__th--${c.align}` : '';
              const sortClass = sortable ? 'dash-autotable__th--sortable' : '';
              const className = [alignClass, sortClass].filter(Boolean).join(' ') || undefined;
              const isSorted = sortField === c.field;
              const indicator = isSorted ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
              return (
                <th
                  key={c.field}
                  className={className}
                  onClick={sortable ? () => handleHeaderClick(c.field) : undefined}
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
            const rowClass = [
              clickable ? 'dash-table__row--clickable' : '',
              isActive ? 'dash-table__row--active' : '',
            ].filter(Boolean).join(' ') || undefined;
            return (
              <tr
                key={key}
                className={rowClass}
                onClick={clickable ? () => dispatchAction(onRowClick, row, { navigate }) : undefined}
                aria-current={isActive ? 'true' : undefined}
              >
                {columns.map(c => {
                  const rawValue = row[c.field];
                  // Categorical cells (badges) frequently carry canonical
                  // English keys emitted from SQL — translate them so the UI
                  // matches the active language. Unknown values pass through.
                  const isBadge = c.format === 'badge';
                  const value = isBadge ? translateCellValue(rawValue, t) : rawValue;
                  const formatted = formatTableCell(value, c.format, lang);
                  return (
                    <td
                      key={c.field}
                      className={c.align ? `dash-table__td--${c.align}` : undefined}
                    >
                      {isBadge ? (
                        <span
                          className={`dash-badge dash-badge--${slugify(String(rawValue ?? ''))}`}
                        >
                          {formatted}
                        </span>
                      ) : (
                        formatted
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
    </div>
  );
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
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
