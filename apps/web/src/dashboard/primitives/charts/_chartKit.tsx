import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Shared building blocks of the chart primitives (CalendarHeatmap,
 * StackedTimeSeries, Sparkline).
 *
 * Contract with the datasets: the SQL delivers every value the chart shows —
 * buckets as text, levels, series slots, drill-down windows — and the charts only
 * draw. They never parse timestamps (the API would hand TIMESTAMP columns over as
 * UTC and the browser would shift them by its time zone).
 *
 * Colours are theme tokens (`--color-chart-*`, `--color-heat-*` in theme.css),
 * validated as a set against the card surface in both themes. SVG presentation
 * attributes do not resolve `var()`, so marks set them through `style`.
 */

/** Fill of a categorical series slot: 1–7 = palette, 0 = "Other", -1 = mass events. */
export function slotFill(slot: number, hatchId: string): string {
  if (slot >= 1 && slot <= 7) return `var(--color-chart-${slot})`;
  if (slot === -1) return `url(#${hatchId})`;
  return 'var(--color-chart-other)';
}

/** Solid key colour of a slot (legend/tooltip line keys; the hatch has no solid). */
export function slotKey(slot: number): string {
  if (slot >= 1 && slot <= 7) return `var(--color-chart-${slot})`;
  return 'var(--color-chart-other)';
}

export function heatFill(level: number): string {
  const l = Math.min(Math.max(Math.round(level), 0), 4);
  return `var(--color-heat-${l})`;
}

export const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const str = (v: unknown): string => (v == null ? '' : String(v));

export function useNumberFormat(): (n: number) => string {
  const { i18n } = useTranslation();
  return useMemo(() => {
    const f = new Intl.NumberFormat(i18n.language || 'en');
    return (n: number) => f.format(n);
  }, [i18n.language]);
}

/** Diagonal hatch for the mass-event series: texture, not hue, carries the meaning. */
export function HatchPattern({ id }: { id: string }) {
  return (
    <defs>
      <pattern id={id} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width={6} height={6} style={{ fill: 'var(--color-bg-surface-2)' }} />
        <line x1={0} y1={0} x2={0} y2={6} style={{ stroke: 'var(--color-chart-other)', strokeWidth: 3 }} />
      </pattern>
    </defs>
  );
}

/** Tooltip body: the value leads, labels follow (values are the reader's target). */
export function TipBody({ title, value, rows, notes }: {
  title: string;
  value?: string;
  rows?: Array<{ key: string; color?: string; label: string; value: string }>;
  notes?: ReactNode[];
}) {
  return (
    <div className="dash-chart-tip__body">
      {value && <div className="dash-chart-tip__value">{value}</div>}
      <div className="dash-chart-tip__title">{title}</div>
      {rows && rows.length > 0 && (
        <ul className="dash-chart-tip__rows">
          {rows.map(r => (
            <li key={r.key}>
              {r.color && <span className="dash-chart-tip__key" style={{ background: r.color }} aria-hidden="true" />}
              <strong>{r.value}</strong>
              <span>{r.label}</span>
            </li>
          ))}
        </ul>
      )}
      {notes?.map((n, i) => (
        <div key={i} className="dash-chart-tip__note">{n}</div>
      ))}
    </div>
  );
}

/**
 * Roving-focus helper for a list of marks: one tab stop for the whole chart,
 * arrow keys move between marks, Enter/Space activates the focused one.
 */
export function rovingKey(
  e: React.KeyboardEvent,
  index: number,
  count: number,
  move: (next: number) => void,
  activate: () => void,
  step: { left: number; right: number; up?: number; down?: number } = { left: -1, right: 1 },
): void {
  let delta: number | null = null;
  switch (e.key) {
    case 'ArrowLeft': delta = step.left; break;
    case 'ArrowRight': delta = step.right; break;
    case 'ArrowUp': delta = step.up ?? null; break;
    case 'ArrowDown': delta = step.down ?? null; break;
    case 'Home': e.preventDefault(); move(0); return;
    case 'End': e.preventDefault(); move(count - 1); return;
    case 'Enter':
    case ' ':
      e.preventDefault();
      activate();
      return;
    default:
      return;
  }
  if (delta == null) return;
  e.preventDefault();
  const next = index + delta;
  if (next >= 0 && next < count) move(next);
}
