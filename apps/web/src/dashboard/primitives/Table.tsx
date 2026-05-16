import type { PrimitiveProps } from '../types';
import { formatTableCell } from './_format';
import { dispatchAction } from '../actions';
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
  const rows = dataset?.data ?? [];

  if (rows.length === 0) {
    return <div className="dash-table__empty">{empty?.message ?? 'Keine Einträge.'}</div>;
  }

  const clickable = !!onRowClick;

  return (
    <div className={`dash-table-wrap dash-table--${density}`}>
      <table className="dash-table">
        <thead>
          <tr>
            {columns.map(c => (
              <th key={c.field} className={c.align ? `dash-table__th--${c.align}` : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            // Index immer mit anhängen — Datasets dürfen mehrfache Werte in
            // rowKey-Spalten haben (z.B. mehrere Variablen mit gleichem
            // Variable_Name in unterschiedlichen Files).
            const key = rowKey ? `${String(row[rowKey] ?? '')}-${i}` : String(i);
            return (
              <tr
                key={key}
                className={clickable ? 'dash-table__row--clickable' : undefined}
                onClick={clickable ? () => dispatchAction(onRowClick, row, { navigate }) : undefined}
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
    </div>
  );
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
