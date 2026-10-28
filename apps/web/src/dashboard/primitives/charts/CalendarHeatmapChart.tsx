import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParentSize } from '@visx/responsive';
import { useTooltip, useTooltipInPortal } from '@visx/tooltip';
import type { PrimitiveProps } from '../../types';
import { dispatchAction } from '../../actions';
import type { ActionSpec } from '../../actions';
import { heatFill, num, str, useNumberFormat, TipBody } from './_chartKit';

/**
 * CalendarHeatmap — activity map in the GitHub style.
 *
 * Dataset contract (one row per cell of the frame, empty cells included):
 *   grain 'day'  → row = weekday (0 = Monday), col = week column; a calendar
 *   grain 'hour' → row = day of the frame, col = hour; row_label names the day
 *   grain 'week' → one block per `year`: row = section of the month (0–4: days
 *                  1–7 … 29–end), col = month (0 = January); blocks wrap
 *   level 0–4 (0 = no change; 1–4 = quartiles of the non-empty cells), n, label,
 *   q1/q2/q3 (level thresholds; the busiest cell is always 4), bulk_objects/
 *   bulk_events (marker: a ring, never a hue), top_types/top_persons
 *   ([{key, n}], tooltip), from_at/to_at and
 *   is_selected (drill-down), count_mode.
 *
 * Props: onCellClick (ActionSpec, row tokens of the cell), ariaLabel.
 * The cell is the hit target (incl. its gap); one tab stop, arrow keys move
 * through the grid, Enter opens the cell.
 */

type TopEntry = { key: string; n: number };
type Grain = 'day' | 'hour' | 'week';

type Cell = {
  raw: Record<string, unknown>;
  grain: Grain;
  row: number;
  col: number;
  year: number;
  rowLabel: string;
  month: number;
  label: string;
  n: number;
  level: number;
  bulkObjects: number;
  bulkEvents: number;
  topTypes: TopEntry[];
  topPersons: TopEntry[];
  selected: boolean;
};

const GAP = 3;
const TOP_H = 18;
// week grain: year blocks of 12 months × 5 sections
const YEAR_W = 44;
const BLOCK_HEAD = 14;
const BLOCK_HGAP = 24;
const BLOCK_VGAP = 10;

function topList(v: unknown): TopEntry[] {
  if (!Array.isArray(v)) return [];
  return v
    .map(e => (e && typeof e === 'object' ? { key: str((e as TopEntry).key), n: num((e as TopEntry).n) } : null))
    .filter((e): e is TopEntry => !!e && e.key !== '');
}

function toCell(r: Record<string, unknown>): Cell {
  return {
    raw: r,
    grain: r.grain === 'hour' || r.grain === 'week' ? r.grain : 'day',
    row: num(r.row),
    col: num(r.col),
    year: num(r.year),
    rowLabel: str(r.row_label),
    month: num(r.month),
    label: str(r.label),
    n: num(r.n),
    level: num(r.level),
    bulkObjects: num(r.bulk_objects),
    bulkEvents: num(r.bulk_events),
    topTypes: topList(r.top_types),
    topPersons: topList(r.top_persons),
    selected: r.is_selected === true,
  };
}

export default function CalendarHeatmapChart({ node, dataset, navigate }: PrimitiveProps) {
  const { t, i18n } = useTranslation(['dashboard', 'types']);
  const fmt = useNumberFormat();
  const props = node.props ?? {};
  const onCellClick = props.onCellClick as ActionSpec | undefined;
  const data = dataset?.data;
  const cells = useMemo(() => (data ?? []).map(toCell), [data]);
  const grain = cells[0]?.grain ?? 'day';
  const actions = data?.[0]?.count_mode === 'actions';
  const bulkHidden = data?.[0]?.bulk_mode !== 'include';
  const ariaLabel = (props.ariaLabel as string) || t('dashboard:chart.heatmap.aria');

  const { parentRef, width } = useParentSize<HTMLDivElement>({ debounceTime: 50, initialSize: { width: 640 } });
  const { tooltipOpen, tooltipData, tooltipLeft, tooltipTop, showTooltip, hideTooltip } = useTooltip<Cell>();
  const { containerRef, TooltipInPortal } = useTooltipInPortal({ detectBounds: true, scroll: true });
  const [focusIdx, setFocusIdx] = useState(-1);
  const [hasFocus, setHasFocus] = useState(false);

  const years = useMemo(() => [...new Set(cells.map(c => c.year))].sort((a, b) => a - b), [cells]);

  const layout = useMemo(() => {
    if (grain === 'week') {
      // year blocks side by side, wrapping onto further rows of blocks
      const fit = Math.floor((width - YEAR_W) / 12) - GAP;
      const cell = Math.max(8, Math.min(13, fit));
      const pitch = cell + GAP;
      const blockW = YEAR_W + 12 * pitch;
      const blockH = BLOCK_HEAD + 5 * pitch;
      const perRow = Math.max(1, Math.min(years.length, Math.floor((width + BLOCK_HGAP) / (blockW + BLOCK_HGAP))));
      const blockRows = Math.ceil(years.length / perRow);
      const blockOf = (year: number) => {
        const b = Math.max(0, years.indexOf(year));
        return { x: (b % perRow) * (blockW + BLOCK_HGAP), y: Math.floor(b / perRow) * (blockH + BLOCK_VGAP) };
      };
      return {
        nRows: 5, nCols: 12, leftW: YEAR_W, cell, pitch, blockOf,
        w: perRow * (blockW + BLOCK_HGAP) - BLOCK_HGAP,
        h: blockRows * (blockH + BLOCK_VGAP) - BLOCK_VGAP,
      };
    }
    const nRows = grain === 'hour' ? Math.max(0, ...cells.map(c => c.row)) + 1 : 7;
    const nCols = grain === 'hour' ? 24 : Math.max(0, ...cells.map(c => c.col)) + 1;
    const leftW = grain === 'hour' ? 78 : 36;
    const maxCell = grain === 'hour' || nCols <= 14 ? 22 : 16;
    const fit = Math.floor((width - leftW) / nCols) - GAP;
    const cell = Math.max(8, Math.min(maxCell, fit));
    const pitch = cell + GAP;
    return {
      nRows, nCols, leftW, cell, pitch, blockOf: null,
      w: leftW + nCols * pitch, h: TOP_H + nRows * pitch,
    };
  }, [cells, grain, width, years]);

  // (year, row, col) → cell index, for the arrow keys; the year only splits the
  // week grain (day and hour grids are one block)
  const keyOf = (year: number, row: number, col: number) => `${grain === 'week' ? year : 0}:${row}:${col}`;
  const indexAt = useMemo(() => {
    const m = new Map<string, number>();
    cells.forEach((c, i) => m.set(`${grain === 'week' ? c.year : 0}:${c.row}:${c.col}`, i));
    return m;
  }, [cells, grain]);
  const yearTotal = useMemo(() => {
    const m = new Map<number, number>();
    for (const c of cells) m.set(c.year, (m.get(c.year) ?? 0) + c.n);
    return m;
  }, [cells]);

  const lang = i18n.language || 'en';
  const weekdayLabel = useMemo(() => {
    const f = new Intl.DateTimeFormat(lang, { weekday: 'short' });
    // 2024-01-01 is a Monday: row 0 … 6 = Monday … Sunday
    return (row: number) => f.format(new Date(2024, 0, 1 + row));
  }, [lang]);
  const monthLabel = useMemo(() => {
    const f = new Intl.DateTimeFormat(lang, { month: 'short' });
    return (month: number) => f.format(new Date(2024, month - 1, 1));
  }, [lang]);
  const monthInitial = useMemo(() => {
    const f = new Intl.DateTimeFormat(lang, { month: 'narrow' });
    return (month: number) => f.format(new Date(2024, month - 1, 1));
  }, [lang]);

  // Month headers: at the first column whose top cell starts a new month.
  const monthHeads = useMemo(() => {
    if (grain !== 'day') return [] as Array<{ col: number; month: number }>;
    const topOfCol = new Map<number, Cell>();
    for (const c of cells) {
      const cur = topOfCol.get(c.col);
      if (!cur || c.row < cur.row) topOfCol.set(c.col, c);
    }
    const heads: Array<{ col: number; month: number }> = [];
    let prev = -1;
    for (let col = 0; col < layout.nCols; col++) {
      const c = topOfCol.get(col);
      if (!c) continue;
      if (c.month !== prev) heads.push({ col, month: c.month });
      prev = c.month;
    }
    // a head squeezed into the first two columns would collide with the next one,
    // a head in the last two columns would run past the grid
    if (heads.length > 1 && heads[1].col - heads[0].col < 3) heads.shift();
    return heads.filter(h => h.col <= layout.nCols - 3 || layout.nCols < 3);
  }, [cells, grain, layout.nCols]);

  const active = cells.filter(c => c.n > 0).length;
  const max = cells.reduce((m, c) => Math.max(m, c.n), 0);
  const q = [num(data?.[0]?.q1), num(data?.[0]?.q2), num(data?.[0]?.q3)];
  const hasBulk = cells.some(c => c.bulkObjects > 0);

  const valueText = (n: number) =>
    actions ? t('dashboard:chart.actions', { count: n, formatted: fmt(n) })
            : t('dashboard:chart.changes', { count: n, formatted: fmt(n) });
  const typeLabel = (k: string) => t(`types:objectTypes.${k}`, { defaultValue: k });
  const bulkText = (c: Cell) =>
    t('dashboard:chart.massEventsIn', { count: c.bulkEvents, objects: fmt(c.bulkObjects) }) +
    (bulkHidden ? ` ${t('dashboard:chart.notCounted')}` : '');

  const levelRange = (level: number): string => {
    const lo = level === 1 ? 1 : q[level - 2] + 1;
    if (level === 4) return lo <= max ? `≥ ${fmt(Math.min(lo, max))}` : fmt(max);
    const hi = Math.min(q[level - 1], max - 1);
    if (hi < lo) return '—';
    return lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`;
  };

  const xOf = (c: Cell) =>
    layout.blockOf ? layout.blockOf(c.year).x + YEAR_W + c.col * layout.pitch : layout.leftW + c.col * layout.pitch;
  const yOf = (c: Cell) =>
    layout.blockOf ? layout.blockOf(c.year).y + BLOCK_HEAD + c.row * layout.pitch : TOP_H + c.row * layout.pitch;

  const open = (c: Cell) => {
    if (onCellClick) dispatchAction(onCellClick, c.raw, { navigate });
  };
  const show = (c: Cell) =>
    showTooltip({ tooltipData: c, tooltipLeft: xOf(c) + layout.cell / 2, tooltipTop: yOf(c) });

  const moveFocus = (next: number) => {
    setFocusIdx(next);
    show(cells[next]);
    const el = document.getElementById(`${node.id ?? 'heatmap'}-cell-${next}`);
    el?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const c = cells[i];
    const target = (row: number, col: number) => {
      // week grain: ←/→ cross from December into the next year's January and back
      if (grain === 'week' && col < 0) return indexAt.get(keyOf(c.year - 1, row, 11));
      if (grain === 'week' && col > 11) return indexAt.get(keyOf(c.year + 1, row, 0));
      return indexAt.get(keyOf(c.year, row, col));
    };
    let next: number | undefined;
    switch (e.key) {
      case 'ArrowLeft': next = target(c.row, c.col - 1); break;
      case 'ArrowRight': next = target(c.row, c.col + 1); break;
      case 'ArrowUp': next = target(c.row - 1, c.col); break;
      case 'ArrowDown': next = target(c.row + 1, c.col); break;
      case 'Home': next = 0; break;
      case 'End': next = cells.length - 1; break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        open(c);
        return;
      default:
        return;
    }
    e.preventDefault();
    if (next != null) moveFocus(next);
  };

  if (cells.length === 0) {
    return <div className="dash-chart dash-chart--empty">{t('dashboard:chart.noData')}</div>;
  }

  const tabIdx = focusIdx >= 0 ? focusIdx : Math.max(0, cells.findIndex(c => c.selected));
  const unit = grain === 'hour' ? 'Hour' : grain === 'week' ? 'Week' : 'Day';

  return (
    <div className="dash-chart dash-chart--heatmap">
      <div ref={parentRef} className="dash-chart__scroll">
        <div ref={containerRef} className="dash-chart__canvas" style={{ width: layout.w }}>
          <svg width={layout.w} height={layout.h} role="group" aria-label={ariaLabel}>
            {layout.blockOf && years.map(y => {
              const b = layout.blockOf!(y);
              return (
                <g key={`year-${y}`}>
                  <text className="dash-chart__label dash-chart__label--year" x={b.x}
                        y={b.y + BLOCK_HEAD + layout.cell / 2} dominantBaseline="central">{y}</text>
                  <text className="dash-chart__label" x={b.x}
                        y={b.y + BLOCK_HEAD + layout.pitch + layout.cell / 2} dominantBaseline="central">
                    {fmt(yearTotal.get(y) ?? 0)}
                  </text>
                  {Array.from({ length: 12 }, (_, m) => (
                    <text key={m} className="dash-chart__label" textAnchor="middle"
                          x={b.x + YEAR_W + m * layout.pitch + layout.cell / 2} y={b.y + BLOCK_HEAD - 4}>
                      {monthInitial(m + 1)}
                    </text>
                  ))}
                </g>
              );
            })}
            {grain === 'week' ? null : grain === 'day'
              ? [0, 2, 4].map(r => (
                  <text key={r} className="dash-chart__label" x={layout.leftW - 6} y={TOP_H + r * layout.pitch + layout.cell / 2}
                        textAnchor="end" dominantBaseline="central">{weekdayLabel(r)}</text>
                ))
              : Array.from(new Set(cells.map(c => c.row))).map(r => {
                  const c = cells.find(x => x.row === r);
                  return (
                    <text key={r} className="dash-chart__label" x={layout.leftW - 6} y={TOP_H + r * layout.pitch + layout.cell / 2}
                          textAnchor="end" dominantBaseline="central">{c?.rowLabel}</text>
                  );
                })}
            {grain === 'week' ? null : grain === 'day'
              ? monthHeads.map(h => (
                  <text key={h.col} className="dash-chart__label" x={layout.leftW + h.col * layout.pitch} y={TOP_H - 6}>
                    {monthLabel(h.month)}
                  </text>
                ))
              : [0, 6, 12, 18].map(hr => (
                  <text key={hr} className="dash-chart__label" x={layout.leftW + hr * layout.pitch} y={TOP_H - 6}>
                    {String(hr).padStart(2, '0')}
                  </text>
                ))}
            {cells.map((c, i) => {
              const x = xOf(c);
              const y = yOf(c);
              const focused = hasFocus && i === focusIdx;
              const aria = `${c.label}: ${valueText(c.n)}${c.bulkObjects > 0 ? `, ${bulkText(c)}` : ''}`;
              return (
                <g key={i}>
                  <rect x={x} y={y} width={layout.cell} height={layout.cell} rx={2}
                        style={{ fill: heatFill(c.level) }} />
                  {c.bulkObjects > 0 && (
                    <rect x={x - 1.5} y={y - 1.5} width={layout.cell + 3} height={layout.cell + 3} rx={3}
                          className="dash-chart__bulk-ring" />
                  )}
                  {(c.selected || focused) && (
                    <rect x={x - 2.5} y={y - 2.5} width={layout.cell + 5} height={layout.cell + 5} rx={4}
                          className={focused ? 'dash-chart__focus-ring' : 'dash-chart__selected-ring'} />
                  )}
                  <rect
                    id={`${node.id ?? 'heatmap'}-cell-${i}`}
                    x={x - GAP / 2} y={y - GAP / 2} width={layout.pitch} height={layout.pitch}
                    className={`dash-chart__hit${onCellClick ? ' dash-chart__hit--click' : ''}`}
                    role="button"
                    tabIndex={i === tabIdx ? 0 : -1}
                    aria-label={aria}
                    aria-pressed={c.selected || undefined}
                    onPointerEnter={() => show(c)}
                    onPointerLeave={hideTooltip}
                    onFocus={() => { setFocusIdx(i); setHasFocus(true); show(c); }}
                    onBlur={() => { setHasFocus(false); hideTooltip(); }}
                    onClick={() => open(c)}
                    onKeyDown={e => onKeyDown(e, i)}
                  />
                </g>
              );
            })}
          </svg>
        </div>
      </div>
      <div className="dash-chart__legend">
        <span className="dash-chart__legend-scale">
          <span>{t('dashboard:chart.heatmap.less')}</span>
          {[0, 1, 2, 3, 4].map(l => (
            <span key={l} className="dash-chart__swatch" style={{ background: heatFill(l) }}
                  title={l === 0 ? t('dashboard:chart.heatmap.none') : levelRange(l)} />
          ))}
          <span>{t('dashboard:chart.heatmap.more')}</span>
        </span>
        {hasBulk && (
          <span className="dash-chart__legend-item">
            <span className="dash-chart__swatch dash-chart__swatch--ring" aria-hidden="true" />
            {t('dashboard:chart.massEvent')}
          </span>
        )}
        <span className="dash-chart__legend-summary">
          {t(`dashboard:chart.heatmap.summary${unit}`, { count: active, formatted: fmt(active), max: fmt(max) })}
        </span>
      </div>
      {tooltipOpen && tooltipData && (
        <TooltipInPortal left={tooltipLeft} top={tooltipTop} unstyled applyPositionStyle className="dash-chart-tip">
          <TipBody
            value={valueText(tooltipData.n)}
            title={tooltipData.label}
            rows={tooltipData.topTypes.map(e => ({ key: e.key, label: typeLabel(e.key), value: fmt(e.n) }))}
            notes={[
              ...(tooltipData.topPersons.length > 0
                ? [tooltipData.topPersons.map(e => `${e.key} (${fmt(e.n)})`).join(' · ')]
                : []),
              ...(tooltipData.bulkObjects > 0 ? [`⚑ ${bulkText(tooltipData)}`] : []),
              ...(onCellClick && tooltipData.n + tooltipData.bulkObjects > 0 ? [t('dashboard:chart.clickHint')] : []),
            ]}
          />
        </TooltipInPortal>
      )}
    </div>
  );
}
