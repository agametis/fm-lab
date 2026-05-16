import type { PrimitiveProps } from '../types';
import { formatKpiValue } from './_format';
import { dispatchAction } from '../actions';
import type { ActionSpec } from '../actions';
import type { KpiItem } from './KPI';

export function KPIStrip({ node, row, navigate }: PrimitiveProps) {
  const items = (node.props?.items as KpiItem[]) ?? [];

  return (
    <div className="dash-kpistrip">
      {items.map((item, i) => {
        const value = row?.[item.field];
        const formatted = formatKpiValue(value, item.format);
        const click: ActionSpec | undefined = item.onClick;
        const clickable = !!click;
        const isBadge = item.format === 'badge';
        const badgeClass = isBadge ? ` dash-kpi__value--badge dash-badge--${slugify(String(value ?? ''))}` : '';
        return (
          <button
            key={`${item.label}-${i}`}
            type="button"
            className={`dash-kpi${clickable ? ' dash-kpi--clickable' : ''}`}
            onClick={clickable ? () => dispatchAction(click, row, { navigate }) : undefined}
            disabled={!clickable}
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
