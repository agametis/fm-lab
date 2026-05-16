import type { PrimitiveProps } from '../types';
import { formatKpiValue } from './_format';
import { dispatchAction } from '../actions';
import type { ActionSpec } from '../actions';

export interface KpiItem {
  label: string;
  field: string;
  format?: string;
  onClick?: ActionSpec;
}

export function KPI({ node, row, navigate }: PrimitiveProps) {
  const props = node.props ?? {};
  const label = props.label as string;
  const field = props.field as string;
  const format = props.format as string | undefined;
  const onClick = props.onClick as ActionSpec | undefined;

  const value = row?.[field];
  const formatted = formatKpiValue(value, format);
  const clickable = !!onClick;

  return (
    <button
      type="button"
      className={`dash-kpi${clickable ? ' dash-kpi--clickable' : ''}`}
      onClick={clickable ? () => dispatchAction(onClick, row, { navigate }) : undefined}
      disabled={!clickable}
    >
      <span className="dash-kpi__label">{label}</span>
      <span className="dash-kpi__value">{formatted}</span>
    </button>
  );
}
