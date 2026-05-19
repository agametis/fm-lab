/**
 * Formatting helpers for dashboard primitives.
 *
 * `lang` is the active UI locale (e.g. "de", "en"). It drives number /
 * date / relative-time formatting. Pass it from the React tree via
 * `useTranslation().i18n.language` — defaults to the browser locale when
 * omitted (acceptable fallback for non-React callers).
 */

export function formatKpiValue(
  value: unknown,
  format: string | undefined,
  lang?: string,
): string {
  if (value == null || value === '') return '—';

  if (!format) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value.toLocaleString(lang);
    }
    return String(value);
  }

  if (format === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString(lang) : String(value);
  }

  // 'count' behaves like 'number' but suppresses zero — useful for pivot
  // tables where many cells are 0 and the zeros add visual noise.
  if (format === 'count') {
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return '';
    return n.toLocaleString(lang);
  }

  if (format === 'badge') {
    return String(value);
  }

  if (format.startsWith('date')) {
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime())) return String(value);
    if (format === 'date:relative') return formatRelative(d, lang);
    if (format === 'date:iso') return d.toISOString();
    return d.toLocaleString(lang);
  }

  return String(value);
}

export function formatTableCell(
  value: unknown,
  format: string | undefined,
  lang?: string,
): string {
  return formatKpiValue(value, format, lang);
}

/**
 * Renders a `Date` as a relative-time string ("5 days ago" / "vor 5 Tagen")
 * using `Intl.RelativeTimeFormat`. Falls back to the browser locale when
 * `lang` is omitted; falls back to a plain locale date string for diffs
 * older than a week so we don't degrade into "5 months ago" for archival
 * dates where the absolute date is more useful.
 */
function formatRelative(date: Date, lang?: string): string {
  const diffMs = Date.now() - date.getTime();
  const sec = Math.round(diffMs / 1000);
  const abs = Math.abs(sec);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  // RelativeTimeFormat expects a *signed* delta from "now":
  //   past → negative number, future → positive number.
  const sign = sec >= 0 ? -1 : 1;

  if (abs < 60)         return rtf.format(sign * abs,                   'second');
  if (abs < 3600)       return rtf.format(sign * Math.round(abs / 60),  'minute');
  if (abs < 86400)      return rtf.format(sign * Math.round(abs / 3600),'hour');
  if (abs < 7 * 86400)  return rtf.format(sign * Math.round(abs / 86400),'day');
  return date.toLocaleDateString(lang);
}
