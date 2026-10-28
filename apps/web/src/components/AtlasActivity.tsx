import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import {
  RECENCY_CLASSES,
  SAVES_LEVELS,
  recencyPaint,
  savesPaint,
  type AtlasColorMode,
} from '../lib/activityColors';
import { formatStampDate } from '../lib/changeStamp';
import type { AtlasActivity, AtlasActivityHead } from '../hooks/useGraphOverview';
import './AtlasActivity.css';

/**
 * Change activity in the Graph Atlas: the legend of the colour modes "recency"
 * and "saves" (steps with their share of the visible nodes and the data state),
 * the tooltip text of a tile and the facts block of the "(...)" panel.
 *
 * Ages count back from the data state (the newest individual change of the
 * solution), not from today — the same reference as the classes themselves.
 */

/** Something with a node count and an activity (tile, super-node). */
export type ActivityItem = { nodes: number; activity?: AtlasActivity | null };

/** Share of the "unknown" class above which the legend suggests the saves mode. */
export const UNKNOWN_HINT_SHARE = 0.8;

/** Nodes per recency class 1…7 over the items (class counts add up per item). */
export function recencyTotals(items: ActivityItem[]): number[] {
  const totals = [0, 0, 0, 0, 0, 0, 0];
  for (const it of items) {
    const counts = it.activity?.class_counts;
    if (!counts) continue;
    counts.forEach((c, i) => { totals[i] += c; });
  }
  return totals;
}

/** Nodes per saves level 1…5 (+ index 5 = no stamped member) over the items. */
export function savesTotals(items: ActivityItem[]): number[] {
  const totals = [0, 0, 0, 0, 0, 0];
  for (const it of items) {
    if (!it.activity) continue;
    const lvl = it.activity.saves_level;
    totals[lvl !== null && lvl >= 1 && lvl <= 5 ? lvl - 1 : 5] += it.nodes;
  }
  return totals;
}

const pct = (n: number, total: number) => (total > 0 ? Math.round((100 * n) / total) : 0);

/** Multi-line tooltip text of a tile in an activity mode (native SVG <title>). */
export function activityTooltip(
  t: TFunction,
  label: string,
  mode: AtlasColorMode,
  a: AtlasActivity | null | undefined,
): string {
  if (mode === 'type' || !a) return label;
  const nodes = a.class_counts.reduce((x, y) => x + y, 0);
  const lines = [label, t('activity.tooltip.class', { label: t(`activity.class.${a.class}`) })];
  lines.push(
    a.newest_change
      ? t('activity.tooltip.newest', { date: formatStampDate(a.newest_change), days: a.newest_age_days ?? 0 })
      : t('activity.tooltip.newestNone'),
  );
  if (nodes > 1) lines.push(t('activity.tooltip.active', { n: a.active_90, total: nodes }));
  if (a.median_age_days !== null && nodes > 1) lines.push(t('activity.tooltip.medianAge', { days: a.median_age_days }));
  if (a.median_saves !== null) lines.push(t(nodes > 1 ? 'activity.tooltip.medianSaves' : 'activity.tooltip.saves', { n: a.median_saves }));
  if (a.stamped > 0) lines.push(t('activity.tooltip.undated', { pct: pct(a.undated, a.stamped) }));
  if (mode === 'saves' && a.saves_level !== null) lines.push(t('activity.tooltip.savesLevel', { level: a.saves_level }));
  return lines.join('\n');
}

/** Short secondary tile label in an activity mode: count · class / saves level. */
export function activitySubLabel(t: TFunction, base: string, mode: AtlasColorMode, a: AtlasActivity | null | undefined): string {
  if (mode === 'type' || !a) return base;
  const tag = mode === 'recency'
    ? t(`activity.class.${a.class}`)
    : a.saves_level !== null ? t('activity.savesShort', { level: a.saves_level }) : t('activity.class.7');
  return base ? `${base} · ${tag}` : tag;
}

type LegendProps = {
  mode: Exclude<AtlasColorMode, 'type'>;
  head: AtlasActivityHead | null;
  items: ActivityItem[];
  /** Offered when most nodes are of unknown age: switch to the saves mode. */
  onUseSaves?: () => void;
  /** Precomputed nodes per class (recency 1…7) — instead of `items` (Graph Explorer). */
  totals?: number[];
  /** Narrow side panel: stacked steps, no hint about the saves mode. */
  compact?: boolean;
};

/** Stepped legend of the active colour mode with node shares and data state. */
export function AtlasActivityLegend({ mode, head, items, onUseSaves, totals: given, compact = false }: LegendProps) {
  const { t } = useTranslation('atlas');
  const recency = mode === 'recency';
  const totals = given ?? (recency ? recencyTotals(items) : savesTotals(items));
  const sum = totals.reduce((x, y) => x + y, 0);
  const steps = recency
    ? RECENCY_CLASSES.map((c, i) => ({ key: `r${c}`, paint: recencyPaint(c), label: t(`activity.class.${c}`), n: totals[i] }))
    : [
        ...SAVES_LEVELS.map((l, i) => ({
          key: `s${l}`,
          paint: savesPaint(l),
          label: l === 1 ? t('activity.savesFew') : l === 5 ? t('activity.savesMany') : t('activity.savesShort', { level: l }),
          n: totals[i],
        })),
        { key: 's0', paint: savesPaint(null), label: t('activity.class.7'), n: totals[5] },
      ];
  const unknownShare = recency && sum > 0 ? totals[5] / sum : 0;

  return (
    <div className={`atlas-legend${compact ? ' compact' : ''}`} role="group" aria-label={t(recency ? 'activity.legendRecency' : 'activity.legendSaves') as string}>
      <span className="atlas-legend-title">{t(recency ? 'activity.legendRecency' : 'activity.legendSaves')}</span>
      {steps.map((s) => (
        <span key={s.key} className={`atlas-legend-step${s.n === 0 ? ' empty' : ''}`}>
          <span
            className={`atlas-legend-swatch${s.paint.hatched ? ' hatched' : ''}`}
            style={{ background: s.paint.fill }}
          />
          {s.label}
          <span className="atlas-legend-share">{pct(s.n, sum)} %</span>
        </span>
      ))}
      {head?.data_state && (
        <span className="atlas-legend-state">
          {t('activity.dataState', { date: head.data_state })}
          {recency && head.bulk === 'include' ? ` · ${t('activity.bulkIncluded')}` : ''}
        </span>
      )}
      {!compact && unknownShare > UNKNOWN_HINT_SHARE && (
        <span className="atlas-legend-hint">
          {t('activity.unknownHint', { pct: Math.round(unknownShare * 100) })}
          {onUseSaves && (
            <button type="button" className="atlas-legend-link" onClick={onUseSaves}>
              {t('activity.useSaves')}
            </button>
          )}
        </span>
      )}
    </div>
  );
}

/** Facts block of the "(...)" panel: class, newest change, shares, medians. */
export function AtlasActivityFacts({ activity, head }: { activity: AtlasActivity; head: AtlasActivityHead | null }) {
  const { t } = useTranslation('atlas');
  const nodes = activity.class_counts.reduce((x, y) => x + y, 0);
  const paint = recencyPaint(activity.class);
  return (
    <dl className="atlas-panel-facts">
      <dt>{t('activity.tooltip.classLabel')}</dt>
      <dd>
        <span className={`atlas-legend-swatch${paint.hatched ? ' hatched' : ''}`} style={{ background: paint.fill }} />
        {t(`activity.class.${activity.class}`)}
      </dd>
      <dt>{t('activity.panel.newest')}</dt>
      <dd>
        {activity.newest_change
          ? t('activity.panel.newestValue', { date: formatStampDate(activity.newest_change), days: activity.newest_age_days ?? 0 })
          : '—'}
      </dd>
      {nodes > 1 && (
        <>
          <dt>{t('activity.panel.active')}</dt>
          <dd>{t('activity.panel.activeValue', { n: activity.active_90, total: nodes })}</dd>
          <dt>{t('activity.panel.medianAge')}</dt>
          <dd>{activity.median_age_days !== null ? t('activity.panel.days', { days: activity.median_age_days }) : '—'}</dd>
        </>
      )}
      <dt>{t(nodes > 1 ? 'activity.panel.medianSaves' : 'activity.panel.saves')}</dt>
      <dd>{activity.median_saves ?? '—'}</dd>
      <dt>{t('activity.panel.undated')}</dt>
      <dd>{activity.stamped > 0 ? `${pct(activity.undated, activity.stamped)} %` : '—'}</dd>
      {head?.data_state && (
        <>
          <dt>{t('activity.panel.dataState')}</dt>
          <dd>{head.data_state}</dd>
        </>
      )}
    </dl>
  );
}
