/**
 * Formatting of FileMaker change stamps (`<UUID @timestamp>`).
 *
 * Stamps are the local time of the editing client WITHOUT time zone. They are
 * shown as written (`YYYY-MM-DD HH:MM`, no time-zone conversion); the age is an
 * approximation against the browser clock.
 */

/** `2026-01-19T11:21:44` / `2026-01-19 11:21:44` → `2026-01-19 11:21`. */
export function formatStamp(ts: string | null | undefined): string | null {
  if (!ts) return null;
  return ts.replace('T', ' ').slice(0, 16);
}

/** `2026-01-19 11:21:44` → `2026-01-19`. */
export function formatStampDate(ts: string | null | undefined): string | null {
  if (!ts) return null;
  return ts.slice(0, 10);
}

/**
 * Age of a stamp as relative time in the UI language ("9 months ago" /
 * "vor 9 Monaten"), from seconds up to years. `null` for unparsable input.
 */
export function formatStampAge(ts: string | null | undefined, lang?: string): string | null {
  if (!ts) return null;
  const d = new Date(ts.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return null;
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  const abs = Math.abs(sec);
  const sign = sec >= 0 ? -1 : 1;
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  if (abs < 60) return rtf.format(sign * abs, 'second');
  if (abs < 3600) return rtf.format(sign * Math.round(abs / 60), 'minute');
  if (abs < 86400) return rtf.format(sign * Math.round(abs / 3600), 'hour');
  if (abs < 30 * 86400) return rtf.format(sign * Math.round(abs / 86400), 'day');
  if (abs < 365 * 86400) return rtf.format(sign * Math.round(abs / (30 * 86400)), 'month');
  return rtf.format(sign * Math.round(abs / (365 * 86400)), 'year');
}
