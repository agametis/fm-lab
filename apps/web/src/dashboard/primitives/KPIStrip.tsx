import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { PrimitiveProps } from '../types';
import { formatKpiValue } from './_format';
import { dispatchAction } from '../actions';
import { isActionActive } from '../actionState';
import { translateCellValue } from './_cellTranslate';
import type { ActionSpec } from '../actions';
import type { KpiItem } from './KPI';

export function KPIStrip({ node, row, navigate }: PrimitiveProps) {
  const { t, i18n } = useTranslation(['common', 'dashboard']);
  const items = (node.props?.items as KpiItem[]) ?? [];
  const [searchParams] = useSearchParams();

  return (
    <div className="dash-kpistrip">
      {items.map((item, i) => {
        const rawValue = row?.[item.field];
        const isBadge = item.format === 'badge';
        // Badges often carry canonical categorical strings — translate them
        // the same way Table cells do so KPI strips stay consistent.
        const value = isBadge ? translateCellValue(rawValue, t) : rawValue;
        const formatted = formatKpiValue(value, item.format, i18n.language);
        const click: ActionSpec | undefined = item.onClick;
        const clickable = !!click;
        const active = clickable ? isActionActive(click, row, searchParams) : false;
        const badgeClass = isBadge ? ` dash-kpi__value--badge dash-badge--${slugify(String(rawValue ?? ''))}` : '';
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
