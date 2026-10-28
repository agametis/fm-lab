import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParentSize } from '@visx/responsive';
import { useTooltip, useTooltipInPortal } from '@visx/tooltip';
import { scaleBand, scaleLinear } from '@visx/scale';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { BarRounded } from '@visx/shape';
import { Group } from '@visx/group';
import type { PrimitiveProps } from '../../types';
import { dispatchAction } from '../../actions';
import type { ActionSpec } from '../../actions';
import { HatchPattern, TipBody, num, rovingKey, slotFill, slotKey, str, useNumberFormat } from './_chartKit';

/**
 * StackedTimeSeries — stacked columns per time bucket.
 *
 * Dataset contract (one row per bucket × series; a bucket without changes keeps
 * one row with series NULL): bucket_index, bucket_label, tick, series,
 * series_label, slot (1–7 palette, 0 = other, -1 = mass events, hatched),
 * series_total, series_members, n, bucket_n, bulk_objects/bulk_events (flag
 * above the column), from_at/to_at and is_selected (drill-down), stack_by,
 * count_mode, bulk_mode.
 *
 * The stack order is the slot order (bottom = slot 1), so a series keeps its
 * place and its colour whatever the filter. Legend: a click toggles one series,
 * Shift- or Alt/Option-click shows only that series (again on the only visible
 * one: all series), "All series" restores the default. The column (incl. its
 * padding) is the hit target; one tab stop, ←/→ move.
 *
 * Props: onBarClick (ActionSpec, row tokens of the bucket), height, ariaLabel.
 */

type Row = {
  raw: Record<string, unknown>;
  index: number;
  label: string;
  tick: string;
  series: string | null;
  seriesLabel: string;
  slot: number;
  total: number;
  members: number;
  n: number;
  bulkObjects: number;
  bulkEvents: number;
  selected: boolean;
};

type Bucket = {
  index: number;
  label: string;
  tick: string;
  raw: Record<string, unknown>;
  values: Map<string, number>;
  bulkObjects: number;
  bulkEvents: number;
  selected: boolean;
};

type Series = { key: string; slot: number; label: string; total: number; members: number };

const MARGIN = { top: 18, right: 8, bottom: 26 };
const GAP = 2;
const MAX_BAR = 24;

const slotOrder = (slot: number) => (slot > 0 ? slot : slot === 0 ? 8 : 9);

function toRow(r: Record<string, unknown>): Row {
  return {
    raw: r,
    index: num(r.bucket_index),
    label: str(r.bucket_label),
    tick: str(r.tick),
    series: r.series == null ? null : str(r.series),
    seriesLabel: str(r.series_label),
    slot: num(r.slot),
    total: num(r.series_total),
    members: num(r.series_members),
    n: num(r.n),
    bulkObjects: num(r.bulk_objects),
    bulkEvents: num(r.bulk_events),
    selected: r.is_selected === true,
  };
}

export default function StackedTimeSeriesChart({ node, dataset, navigate }: PrimitiveProps) {
  const { t } = useTranslation(['dashboard', 'types']);
  const fmt = useNumberFormat();
  const hatchId = `hatch-${useId().replace(/:/g, '')}`;
  const props = node.props ?? {};
  const onBarClick = props.onBarClick as ActionSpec | undefined;
  const height = Math.max(120, num(props.height) || 220);
  const data = dataset?.data;
  const first = data?.[0];
  const stackBy = str(first?.stack_by) || 'type';
  const actions = first?.count_mode === 'actions';
  const bulkHidden = first?.bulk_mode !== 'include';
  const ariaLabel = (props.ariaLabel as string) || t('dashboard:chart.series.aria');

  const { parentRef, width } = useParentSize<HTMLDivElement>({ debounceTime: 50, initialSize: { width: 640 } });
  const { tooltipOpen, tooltipData, tooltipLeft, tooltipTop, showTooltip, hideTooltip } = useTooltip<Bucket>();
  const { containerRef, TooltipInPortal } = useTooltipInPortal({ detectBounds: true, scroll: true });
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [focusIdx, setFocusIdx] = useState(-1);
  const [hasFocus, setHasFocus] = useState(false);
  const [hoverIdx, setHoverIdx] = useState(-1);

  const { buckets, series } = useMemo(() => {
    const byIndex = new Map<number, Bucket>();
    const meta = new Map<string, Series>();
    for (const r of (data ?? []).map(toRow)) {
      let b = byIndex.get(r.index);
      if (!b) {
        b = { index: r.index, label: r.label, tick: r.tick, raw: r.raw, values: new Map(),
              bulkObjects: r.bulkObjects, bulkEvents: r.bulkEvents, selected: r.selected };
        byIndex.set(r.index, b);
      }
      if (r.series != null) {
        b.values.set(r.series, r.n);
        if (!meta.has(r.series)) {
          meta.set(r.series, { key: r.series, slot: r.slot, label: r.seriesLabel, total: r.total, members: r.members });
        }
      }
    }
    return {
      buckets: [...byIndex.values()].sort((a, b) => a.index - b.index),
      series: [...meta.values()].sort((a, b) => slotOrder(a.slot) - slotOrder(b.slot)),
    };
  }, [data]);

  const visible = series.filter(s => !hidden.has(s.key));
  const totalOf = (b: Bucket) => visible.reduce((sum, s) => sum + (b.values.get(s.key) ?? 0), 0);
  const yMax = Math.max(1, ...buckets.map(totalOf));

  const seriesName = (s: Series): string => {
    if (s.key === '__other__') return t('dashboard:chart.other', { count: s.members, formatted: fmt(s.members) });
    if (s.key === '__bulk__') return t('dashboard:chart.massEvents');
    if (stackBy === 'type') return t(`types:objectTypes.${s.key}`, { defaultValue: s.key });
    return s.label || s.key;
  };
  const valueText = (n: number) =>
    actions ? t('dashboard:chart.actions', { count: n, formatted: fmt(n) })
            : t('dashboard:chart.changes', { count: n, formatted: fmt(n) });
  const bulkText = (b: Bucket) =>
    t('dashboard:chart.massEventsIn', { count: b.bulkEvents, objects: fmt(b.bulkObjects) }) +
    (bulkHidden ? ` ${t('dashboard:chart.notCounted')}` : '');

  const marginLeft = Math.max(28, fmt(yMax).length * 7 + 12);
  const innerW = Math.max(40, width - marginLeft - MARGIN.right);
  const innerH = height - MARGIN.top - MARGIN.bottom;

  const xScale = useMemo(
    () => scaleBand<number>({ domain: buckets.map(b => b.index), range: [0, innerW], paddingInner: 0.2, paddingOuter: 0.1 }),
    [buckets, innerW],
  );
  const yScale = useMemo(
    () => scaleLinear<number>({ domain: [0, yMax], range: [innerH, 0], nice: true }),
    [yMax, innerH],
  );

  const step = xScale.step();
  const band = xScale.bandwidth();
  const barW = Math.max(1, Math.min(band, MAX_BAR));
  const tickEvery = Math.max(1, Math.ceil((buckets.length * 44) / innerW));
  const tickValues = buckets.filter((_, i) => i % tickEvery === 0).map(b => b.index);
  const tickOf = new Map(buckets.map(b => [b.index, b.tick]));

  const open = (b: Bucket) => {
    if (onBarClick) dispatchAction(onBarClick, b.raw, { navigate });
  };
  const show = (b: Bucket) => {
    const x = marginLeft + (xScale(b.index) ?? 0) + band / 2;
    const y = MARGIN.top + yScale(totalOf(b));
    showTooltip({ tooltipData: b, tooltipLeft: x, tooltipTop: y });
  };
  const moveFocus = (next: number) => {
    setFocusIdx(next);
    show(buckets[next]);
    document.getElementById(`${node.id ?? 'series'}-bar-${next}`)?.focus();
  };

  const toggle = (key: string) =>
    setHidden(prev => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  // Only this series; on the series that already stands alone: back to all.
  const solo = (key: string) =>
    setHidden(prev => {
      const others = series.filter(s => s.key !== key).map(s => s.key);
      const alone = !prev.has(key) && others.every(k => prev.has(k));
      return alone ? new Set() : new Set(others);
    });
  const anyHidden = series.some(s => hidden.has(s.key));

  if (buckets.length === 0) {
    return <div className="dash-chart dash-chart--empty">{t('dashboard:chart.noData')}</div>;
  }

  const tabIdx = focusIdx >= 0 ? focusIdx : Math.max(0, buckets.findIndex(b => b.selected));

  return (
    <div className="dash-chart dash-chart--series">
      {series.length > 0 && (
        <div className="dash-chart__legend dash-chart__legend--top" role="group" aria-label={t('dashboard:chart.series.legend')}>
          {series.map(s => {
            const on = !hidden.has(s.key);
            return (
              <button
                key={s.key}
                type="button"
                className={`dash-chart__toggle${on ? '' : ' dash-chart__toggle--off'}`}
                aria-pressed={on}
                title={t('dashboard:chart.series.toggleHint')}
                // Shift-click would otherwise extend a text selection over the legend
                onMouseDown={e => { if (e.shiftKey) e.preventDefault(); }}
                onClick={e => (e.shiftKey || e.altKey ? solo(s.key) : toggle(s.key))}
              >
                <span
                  className={`dash-chart__swatch${s.slot === -1 ? ' dash-chart__swatch--hatch' : ''}`}
                  style={s.slot === -1 ? undefined : { background: slotKey(s.slot) }}
                  aria-hidden="true"
                />
                <span>{seriesName(s)}</span>
                <span className="dash-chart__toggle-total">{fmt(s.total)}</span>
              </button>
            );
          })}
          {anyHidden && (
            <button type="button" className="dash-chart__reset" onClick={() => setHidden(new Set())}>
              {t('dashboard:chart.series.reset')}
            </button>
          )}
        </div>
      )}
      <div ref={parentRef} className="dash-chart__fill">
        <div ref={containerRef} className="dash-chart__canvas">
          <svg width={width} height={height} role="group" aria-label={ariaLabel}>
            <HatchPattern id={hatchId} />
            <Group left={marginLeft} top={MARGIN.top}>
              {yScale.ticks(4).map(v => (
                <line key={v} x1={0} x2={innerW} y1={yScale(v)} y2={yScale(v)} className="dash-chart__grid" />
              ))}
              {buckets.map((b, i) => {
                const x0 = xScale(b.index) ?? 0;
                const active = hoverIdx === i || (hasFocus && focusIdx === i);
                const segs = visible
                  .map(s => ({ s, n: b.values.get(s.key) ?? 0 }))
                  .filter(e => e.n > 0);
                let cum = 0;
                const x = x0 + (band - barW) / 2;
                return (
                  <g key={b.index}>
                    {active && (
                      <rect x={x0 - (step - band) / 2} y={-MARGIN.top} width={step} height={innerH + MARGIN.top}
                            className="dash-chart__hover-band" />
                    )}
                    {segs.map((e, k) => {
                      const yTop = yScale(cum + e.n);
                      const yBottom = yScale(cum);
                      cum += e.n;
                      const below = k > 0;
                      const h = Math.max(1, yBottom - yTop - (below ? GAP : 0));
                      const isTop = k === segs.length - 1;
                      const style = { fill: slotFill(e.s.slot, hatchId) };
                      return isTop ? (
                        <BarRounded key={e.s.key} x={x} y={yTop} width={barW} height={h}
                                    radius={Math.min(4, barW / 2, h)} top style={style} />
                      ) : (
                        <rect key={e.s.key} x={x} y={yTop} width={barW} height={h} style={style} />
                      );
                    })}
                    {b.bulkEvents > 0 && (
                      <g className="dash-chart__flag" transform={`translate(${x0 + band / 2}, ${-MARGIN.top + 2})`}>
                        <line x1={0} y1={0} x2={0} y2={12} />
                        <path d="M0,0 L7,3 L0,6 Z" />
                      </g>
                    )}
                    {b.selected && (
                      <rect x={x0} y={innerH + 1} width={band} height={3} className="dash-chart__selected-mark" />
                    )}
                    <rect
                      id={`${node.id ?? 'series'}-bar-${i}`}
                      x={x0 - (step - band) / 2} y={-MARGIN.top} width={step} height={innerH + MARGIN.top}
                      className={`dash-chart__hit${onBarClick ? ' dash-chart__hit--click' : ''}`}
                      role="button"
                      tabIndex={i === tabIdx ? 0 : -1}
                      aria-label={`${b.label}: ${valueText(totalOf(b))}${b.bulkEvents > 0 ? `, ${bulkText(b)}` : ''}`}
                      aria-pressed={b.selected || undefined}
                      onPointerEnter={() => { setHoverIdx(i); show(b); }}
                      onPointerLeave={() => { setHoverIdx(-1); hideTooltip(); }}
                      onFocus={() => { setFocusIdx(i); setHasFocus(true); show(b); }}
                      onBlur={() => { setHasFocus(false); hideTooltip(); }}
                      onClick={() => open(b)}
                      onKeyDown={e => rovingKey(e, i, buckets.length, moveFocus, () => open(b))}
                    />
                  </g>
                );
              })}
              <AxisLeft
                scale={yScale}
                numTicks={4}
                tickFormat={v => fmt(Number(v))}
                hideAxisLine
                hideTicks
                axisClassName="dash-chart__axis"
                tickLabelProps={() => ({ className: 'dash-chart__label', textAnchor: 'end', dx: -4, dy: '0.32em' })}
              />
              <AxisBottom
                top={innerH}
                scale={xScale}
                tickValues={tickValues}
                tickFormat={v => tickOf.get(Number(v)) ?? ''}
                hideTicks
                axisClassName="dash-chart__axis"
                tickLabelProps={() => ({ className: 'dash-chart__label', textAnchor: 'middle', dy: '0.25em' })}
              />
            </Group>
          </svg>
        </div>
      </div>
      {tooltipOpen && tooltipData && (
        <TooltipInPortal left={tooltipLeft} top={tooltipTop} unstyled applyPositionStyle className="dash-chart-tip">
          <TipBody
            value={valueText(totalOf(tooltipData))}
            title={tooltipData.label}
            rows={visible
              .filter(s => (tooltipData.values.get(s.key) ?? 0) > 0)
              .map(s => ({ key: s.key, color: slotKey(s.slot), label: seriesName(s), value: fmt(tooltipData.values.get(s.key) ?? 0) }))}
            notes={[
              ...(tooltipData.bulkEvents > 0 ? [`⚑ ${bulkText(tooltipData)}`] : []),
              ...(onBarClick && (totalOf(tooltipData) > 0 || tooltipData.bulkObjects > 0) ? [t('dashboard:chart.clickHint')] : []),
            ]}
          />
        </TooltipInPortal>
      )}
    </div>
  );
}
