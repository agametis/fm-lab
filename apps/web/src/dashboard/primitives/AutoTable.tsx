import { useMemo, useState } from 'react';
import type { PrimitiveProps } from '../types';
import { formatTableCell } from './_format';
import { dispatchAction } from '../actions';
import type { ActionSpec } from '../actions';

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
 */
export function AutoTable({ node, dataset, datasets, navigate }: PrimitiveProps) {
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

  const clickAction =
    (meta?.click_action as string | null | undefined) ??
    (props.clickAction as string | undefined) ??
    null;
  const clickArgs =
    (meta?.click_args as string | null | undefined) ??
    (props.clickArgs as string | undefined) ??
    null;

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

  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0);

  // Filter
  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const needle = search.trim().toLowerCase();
    return rows.filter(row =>
      columns.some(c => {
        const v = row[c.field];
        if (v === null || v === undefined) return false;
        return String(v).toLowerCase().includes(needle);
      }),
    );
  }, [rows, search, columns]);

  // Sortierung
  const sorted = useMemo(() => {
    if (!sortField) return filtered;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => compareValues(a[sortField], b[sortField]) * dir);
  }, [filtered, sortField, sortDir]);

  const total = sorted.length;
  const pageCount = paginate ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const safePage = Math.min(page, pageCount - 1);
  const visible = paginate
    ? sorted.slice(safePage * pageSize, safePage * pageSize + pageSize)
    : sorted;

  const clickable = !!clickAction;
  const clickSpec: ActionSpec | undefined = clickAction
    ? { action: clickAction, argsString: clickArgs ?? '' }
    : undefined;

  function handleHeaderClick(field: string) {
    if (!sortable) return;
    if (sortField === field) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
    setPage(0);
  }

  if (rows.length === 0) {
    return <div className="dash-table__empty">Keine Einträge.</div>;
  }

  const wrapStyle = paginate ? undefined : { maxHeight };
  const wrapClass = paginate
    ? `dash-autotable__scroll dash-table-wrap dash-table--${density}`
    : `dash-autotable__scroll dash-autotable__scroll--bounded dash-table-wrap dash-table--${density}`;

  return (
    <div className="dash-autotable">
      <div className="dash-autotable__head">
        <span className="dash-autotable__count">
          {total.toLocaleString('de-DE')} {total === 1 ? 'Eintrag' : 'Einträge'}
          {search.trim() && total !== rows.length && (
            <> · gefiltert aus {rows.length.toLocaleString('de-DE')}</>
          )}
          {paginate && pageCount > 1 && (
            <> · Seite {safePage + 1} / {pageCount}</>
          )}
        </span>
        {searchable && (
          <input
            type="search"
            className="dash-autotable__search"
            placeholder="Suchen …"
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        )}
      </div>
      <div className={wrapClass} style={wrapStyle}>
        <table className="dash-table">
          <thead>
            <tr>
              {columns.map(c => {
                const isSorted = sortField === c.field;
                const indicator = isSorted ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
                return (
                  <th
                    key={c.field}
                    className={sortable ? 'dash-autotable__th--sortable' : undefined}
                    onClick={sortable ? () => handleHeaderClick(c.field) : undefined}
                  >
                    {c.label}{indicator}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => {
              const offset = paginate ? safePage * pageSize : 0;
              const key = `${offset + i}-${String(row.uuid ?? '')}`;
              return (
                <tr
                  key={key}
                  className={clickable ? 'dash-table__row--clickable' : undefined}
                  onClick={clickable ? () => dispatchAction(clickSpec, row, { navigate }) : undefined}
                >
                  {columns.map(c => (
                    <td key={c.field}>{formatTableCell(row[c.field], c.format)}</td>
                  ))}
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="dash-autotable__noresult">
                  Keine Treffer für „{search}".
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {paginate && pageCount > 1 && (
        <div className="dash-autotable__pager">
          <button
            type="button"
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={safePage === 0}
          >
            ← Zurück
          </button>
          <span>{safePage + 1} / {pageCount}</span>
          <button
            type="button"
            onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
            disabled={safePage >= pageCount - 1}
          >
            Weiter →
          </button>
        </div>
      )}
    </div>
  );
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

function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  // BigInt aus DuckDB-Counts
  if (typeof a === 'bigint' && typeof b === 'bigint') {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return String(a).localeCompare(String(b), 'de', { numeric: true, sensitivity: 'base' });
}
