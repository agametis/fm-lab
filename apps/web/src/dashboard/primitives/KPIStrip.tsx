import { useSearchParams } from 'react-router-dom';
import type { PrimitiveProps } from '../types';
import { formatKpiValue } from './_format';
import { dispatchAction } from '../actions';
import { isActionActive } from '../actionState';
import type { ActionSpec } from '../actions';
import type { KpiItem } from './KPI';

export function KPIStrip({ node, row, navigate }: PrimitiveProps) {
  const items = (node.props?.items as KpiItem[]) ?? [];
  const [searchParams] = useSearchParams();

  return (
    <div className="dash-kpistrip">
      {items.map((item, i) => {
        const value = row?.[item.field];
        const formatted = formatKpiValue(value, item.format);
        const click: ActionSpec | undefined = item.onClick;
        const clickable = !!click;
        const active = clickable ? isActionActive(click, row, searchParams) : false;
        const isBadge = item.format === 'badge';
        const badgeClass = isBadge ? ` dash-kpi__value--badge dash-badge--${slugify(String(value ?? ''))}` : '';
        const cls = [
          'dash-kpi',
          clickable ? 'dash-kpi--clickable' : '',
          active ? 'dash-kpi--active' : '',
        ].filter(Boolean).join(' ');
        return (
          <button
            key={`${item.label}-${i}`}
            type="button"
            className={cls}
            onClick={clickable ? () => dispatchAction(click, row, { navigate }) : undefined}
            disabled={!clickable}
            aria-pressed={active}
          >
            <span className="dash-kpi__label">{item.label}</span>
            <span className={`dash-kpi__value${badgeClass}`}>{formatted}</span>
          </button>
        );
      })}
    </div>
  );
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
