import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { PrimitiveProps } from '../types';
import { formatTableCell } from './_format';
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

export function Table({ node, dataset, navigate }: PrimitiveProps) {
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
  const rows = dataset?.data ?? [];
  const [searchParams] = useSearchParams();

  // Generischer Volltext-Filter — sichtbar je nach `searchable`-Prop (true /
  // false / 'auto', Default 'auto' → ab >10 Rows). Greift VOR Sortierung,
  // damit der sortierte Output dem Suchergebnis entspricht.
  const search = useRowSearch(rows, {
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
      (a, b) => compareValues(a[sortField], b[sortField]) * dir,
    );
  }, [search.filtered, sortField, sortDir]);

  if (rows.length === 0) {
    return <div className="dash-table__empty">{empty?.message ?? 'Keine Einträge.'}</div>;
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
      {search.visible && (
        <div className="dash-search-bar">
          <span className="dash-search-bar__count">
            {sortedRows.length.toLocaleString('de-DE')}{' '}
            {sortedRows.length === 1 ? 'Eintrag' : 'Einträge'}
            {hasQuery && sortedRows.length !== search.totalCount && (
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
                  const value = row[c.field];
                  const formatted = formatTableCell(value, c.format);
                  const isBadge = c.format === 'badge';
                  return (
                    <td
                      key={c.field}
                      className={c.align ? `dash-table__td--${c.align}` : undefined}
                    >
                      {isBadge ? (
                        <span
                          className={`dash-badge dash-badge--${slugify(String(value ?? ''))}`}
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
          Keine Treffer für „{search.query}".
        </div>
      )}
    </div>
  );
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'bigint' && typeof b === 'bigint') {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return String(a).localeCompare(String(b), 'de', { numeric: true, sensitivity: 'base' });
}
