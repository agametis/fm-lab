/**
 * Hilfsfunktionen für Primitive-Formatierung. Dünn — schwere Logik liegt in tokens.ts.
 */

export function formatKpiValue(value: unknown, format: string | undefined): string {
  if (value == null || value === '') return '—';

  if (!format) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value.toLocaleString('de-DE');
    }
    return String(value);
  }

  if (format === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString('de-DE') : String(value);
  }

  // 'count' verhält sich wie 'number', unterdrückt aber den Wert 0.
  // Nützlich für Pivot-Tabellen, in denen viele Zellen 0 sind und 0er
  // visuelles Grundrauschen erzeugen würden.
  if (format === 'count') {
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return '';
    return n.toLocaleString('de-DE');
  }

  if (format === 'badge') {
    return String(value);
  }

  if (format.startsWith('date')) {
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime())) return String(value);
    if (format === 'date:relative') return formatRelative(d);
    if (format === 'date:iso') return d.toISOString();
    return d.toLocaleString('de-DE');
  }

  return String(value);
}

export function formatTableCell(value: unknown, format: string | undefined): string {
  return formatKpiValue(value, format);
}

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const sec = Math.round(diffMs / 1000);
  const abs = Math.abs(sec);
  if (abs < 60) return 'gerade eben';
  if (abs < 3600) return `vor ${Math.round(abs / 60)} min`;
  if (abs < 86400) return `vor ${Math.round(abs / 3600)} h`;
  if (abs < 7 * 86400) return `vor ${Math.round(abs / 86400)} Tagen`;
  return date.toLocaleDateString('de-DE');
}
