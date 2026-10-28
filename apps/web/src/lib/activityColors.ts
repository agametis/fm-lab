import type { AtlasActivity } from '../hooks/useGraphOverview';

/**
 * Colour modes of the Graph Atlas (URL param `color`):
 *   type     object-type palette (graphColors.ts) — the default
 *   recency  age of the newest individual change, one blue ramp (--color-recency-*)
 *   saves    lifetime save counter, one orange ramp (--color-saves-*)
 * Both ramps are ordinal and theme-tokenised (theme.css); every fill brings its own
 * ink token so tile labels stay readable on the strong steps. The values are CSS
 * var() strings — set them via `style`, SVG presentation attributes do not resolve
 * var(). Cytoscape needs resolved colours: see resolveCssColor().
 */
export type AtlasColorMode = 'type' | 'recency' | 'saves';
export const COLOR_MODES: AtlasColorMode[] = ['type', 'recency', 'saves'];

/** Activity classes 1…7 (1 ≤ 30 days … 5 > 2 years, 6 unknown, 7 no stamp). */
export const RECENCY_CLASSES = [1, 2, 3, 4, 5, 6, 7] as const;
/** Saves levels 1 (few) … 5 (many). */
export const SAVES_LEVELS = [1, 2, 3, 4, 5] as const;

export type ActivityPaint = {
  /** CSS colour (var()) of the fill; for a hatched tile the base colour. */
  fill: string;
  /** Ink token for labels on this fill. */
  ink: string;
  /** Unknown class: draw the hatch pattern over the fill. */
  hatched: boolean;
  /** CSS custom property names (without var()) — for Cytoscape. */
  fillVar: string;
};

const paint = (fillVar: string, inkVar: string, hatched = false): ActivityPaint => ({
  fill: `var(${fillVar})`,
  ink: `var(${inkVar})`,
  hatched,
  fillVar,
});

/** Paint of a recency class (1…7). */
export function recencyPaint(cls: number): ActivityPaint {
  if (cls >= 1 && cls <= 5) return paint(`--color-recency-${cls}`, `--color-recency-ink-${cls}`);
  if (cls === 6) return paint('--color-recency-unknown', '--color-recency-ink-unknown', true);
  return paint('--color-recency-none', '--color-recency-ink-none');
}

/** Paint of a saves level (1…5); null = no stamped member. */
export function savesPaint(level: number | null): ActivityPaint {
  if (level !== null && level >= 1 && level <= 5) return paint(`--color-saves-${level}`, `--color-saves-ink-${level}`);
  return paint('--color-recency-none', '--color-recency-ink-none');
}

/** Paint of a tile in an activity mode; null in type mode or without activity. */
export function activityPaint(mode: AtlasColorMode, activity: AtlasActivity | null | undefined): ActivityPaint | null {
  if (mode === 'type' || !activity) return null;
  return mode === 'recency' ? recencyPaint(activity.class) : savesPaint(activity.saves_level);
}

/** Resolve a CSS custom property against the current theme (Cytoscape knows no var()). */
export function resolveCssColor(varName: string, fallback = '#888888'): string {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || fallback;
}
