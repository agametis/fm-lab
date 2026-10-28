import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParentSize } from '@visx/responsive';
import { useTooltip, useTooltipInPortal } from '@visx/tooltip';
import { scaleLinear } from '@visx/scale';
import { AreaClosed, LinePath } from '@visx/shape';
import type { PrimitiveProps } from '../../types';
import { dispatchAction } from '../../actions';
import type { ActionSpec } from '../../actions';
import { TipBody, num, rovingKey, str, useNumberFormat } from './_chartKit';

/**
 * Sparkline — one small series over a few buckets (e.g. changes per month).
 *
 * Dataset contract: one row per point in order, `labelField` (default `month`)
 * as text, `valueField` (default `n`); the row tokens feed `onPointClick`.
 * One series → no legend; the label names it. A crosshair snaps to the nearest
 * point; one tab stop, ←/→ move, Enter opens the point.
 *
 * Props: label, valueField, labelField, onPointClick (ActionSpec), height, maxWidth.
 */

const PAD = 5;

export default function SparklineChart({ node, dataset, navigate }: PrimitiveProps) {
  const { t } = useTranslation(['dashboard']);
  const fmt = useNumberFormat();
  const props = node.props ?? {};
  const valueField = (props.valueField as string) || 'n';
  const labelField = (props.labelField as string) || 'month';
  const onPointClick = props.onPointClick as ActionSpec | undefined;
  const label = props.label as string | undefined;
  const height = Math.max(24, num(props.height) || 40);
  const maxWidth = num(props.maxWidth) || 360;
  const rows = useMemo(() => dataset?.data ?? [], [dataset?.data]);
  const values = rows.map(r => num(r[valueField]));
  const total = values.reduce((a, b) => a + b, 0);

  const { parentRef, width: parentW } = useParentSize<HTMLDivElement>({ debounceTime: 50, initialSize: { width: maxWidth } });
  const width = Math.max(80, Math.min(maxWidth, parentW));
  const { tooltipOpen, tooltipData, tooltipLeft, tooltipTop, showTooltip, hideTooltip } = useTooltip<number>();
  const { containerRef, TooltipInPortal } = useTooltipInPortal({ detectBounds: true, scroll: true });
  const svgRef = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState(-1);

  const xScale = useMemo(
    () => scaleLinear<number>({ domain: [0, Math.max(1, rows.length - 1)], range: [PAD, width - PAD] }),
    [rows.length, width],
  );
  const maxV = Math.max(1, ...values);
  const yScale = useMemo(
    () => scaleLinear<number>({ domain: [0, maxV], range: [height - PAD, PAD] }),
    [maxV, height],
  );

  if (rows.length === 0) return null;

  const show = (i: number) => {
    setActive(i);
    showTooltip({ tooltipData: i, tooltipLeft: xScale(i), tooltipTop: yScale(values[i]) });
  };
  const clear = () => {
    setActive(-1);
    hideTooltip();
  };
  const nearest = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return -1;
    const i = Math.round(xScale.invert(clientX - rect.left));
    return Math.min(rows.length - 1, Math.max(0, i));
  };
  const open = (i: number) => {
    if (onPointClick && i >= 0) dispatchAction(onPointClick, rows[i], { navigate });
  };
  const points = values.map((v, i) => ({ i, v }));
  const last = rows.length - 1;

  return (
    <div className="dash-chart dash-chart--sparkline">
      {label && (
        <div className="dash-chart__spark-head">
          <span className="dash-chart__spark-label">{label}</span>
          <strong>{fmt(total)}</strong>
        </div>
      )}
      <div ref={parentRef} className="dash-chart__fill" style={{ maxWidth }}>
        <div ref={containerRef} className="dash-chart__canvas" style={{ width }}>
          <svg
            ref={svgRef}
            width={width}
            height={height}
            role="button"
            tabIndex={0}
            aria-label={`${label ?? ''} ${rows.map((r, i) => `${str(r[labelField])}: ${fmt(values[i])}`).join(', ')}`.trim()}
            className={onPointClick ? 'dash-chart__hit--click' : undefined}
            onPointerMove={e => show(nearest(e.clientX))}
            onPointerLeave={clear}
            onClick={e => open(nearest(e.clientX))}
            onFocus={() => show(active >= 0 ? active : last)}
            onBlur={clear}
            onKeyDown={e => rovingKey(e, active >= 0 ? active : last, rows.length, show, () => open(active >= 0 ? active : last))}
          >
            <AreaClosed data={points} x={p => xScale(p.i)} y={p => yScale(p.v)} yScale={yScale}
                        className="dash-chart__spark-area" />
            <LinePath data={points} x={p => xScale(p.i)} y={p => yScale(p.v)} className="dash-chart__spark-line" />
            {active >= 0 && (
              <line x1={xScale(active)} x2={xScale(active)} y1={0} y2={height} className="dash-chart__crosshair" />
            )}
            <circle cx={xScale(active >= 0 ? active : last)} cy={yScale(values[active >= 0 ? active : last])} r={4}
                    className="dash-chart__spark-dot" />
          </svg>
        </div>
      </div>
      {tooltipOpen && tooltipData != null && (
        <TooltipInPortal left={tooltipLeft} top={tooltipTop} unstyled applyPositionStyle className="dash-chart-tip">
          <TipBody
            value={t('dashboard:chart.changes', { count: values[tooltipData], formatted: fmt(values[tooltipData]) })}
            title={str(rows[tooltipData][labelField])}
            notes={onPointClick && values[tooltipData] > 0 ? [t('dashboard:chart.clickHint')] : []}
          />
        </TooltipInPortal>
      )}
    </div>
  );
}
