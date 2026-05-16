/**
 * Token-Substitution für Dashboard-Layouts.
 * PRD: prd_dashboards.md §3.2, §8.2.
 *
 * Unterstützt:
 *   {{field}}
 *   {{ field | upper }}
 *   {{ field | lower }}
 *   {{ field | number }}
 *   {{ field | number:2 }}
 *   {{ field | date:relative }}
 *   {{ field | date:iso }}
 *   {{ field | truncate:60 }}
 *   {{ field | default:N/A }}
 *
 * Bewusst eingeschränkt: keine verschachtelten Ausdrücke, kein eval.
 */

type Row = Record<string, unknown>;

const TOKEN_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

export function hasToken(input: unknown): input is string {
  return typeof input === 'string' && TOKEN_RE.test(input);
}

export function substituteString(template: string, row: Row | undefined): string {
  if (!template) return template;
  // reset lastIndex (TOKEN_RE is global)
  TOKEN_RE.lastIndex = 0;
  return template.replace(TOKEN_RE, (_, expr) => {
    const value = evaluateExpression(expr, row);
    return value == null ? '' : String(value);
  });
}

/**
 * Wie substituteString, gibt aber den nativen Wert zurück, wenn der ganze Input
 * genau ein einzelnes Token ist. Sonst String-Substitution.
 *
 * Beispiel: "{{ uuid }}" → das tatsächliche uuid (string|null|undefined),
 *           "Hello {{name}}!" → "Hello Marcel!"
 */
export function substituteValue(template: unknown, row: Row | undefined): unknown {
  if (typeof template !== 'string') return template;
  const trimmed = template.trim();
  const fullMatch = /^\{\{\s*([^}]+?)\s*\}\}$/.exec(trimmed);
  if (fullMatch) {
    return evaluateExpression(fullMatch[1], row);
  }
  return substituteString(template, row);
}

/**
 * Substitution rekursiv durch ein verschachteltes Objekt mit Strings.
 */
export function substituteDeep(input: unknown, row: Row | undefined): unknown {
  if (input == null) return input;
  if (typeof input === 'string') return substituteValue(input, row);
  if (Array.isArray(input)) return input.map(v => substituteDeep(v, row));
  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = substituteDeep(v, row);
    }
    return out;
  }
  return input;
}

function evaluateExpression(expr: string, row: Row | undefined): unknown {
  const parts = expr.split('|').map(s => s.trim());
  const fieldName = parts[0];
  let value: unknown = row && fieldName in row ? row[fieldName] : undefined;

  for (let i = 1; i < parts.length; i++) {
    value = applyFilter(value, parts[i]);
  }
  return value;
}

function applyFilter(value: unknown, filter: string): unknown {
  const colon = filter.indexOf(':');
  const name = colon >= 0 ? filter.slice(0, colon).trim() : filter.trim();
  const arg = colon >= 0 ? filter.slice(colon + 1).trim() : '';

  switch (name) {
    case 'upper':
      return value == null ? '' : String(value).toUpperCase();
    case 'lower':
      return value == null ? '' : String(value).toLowerCase();
    case 'number': {
      if (value == null || value === '') return '';
      const n = Number(value);
      if (!Number.isFinite(n)) return String(value);
      const digits = arg ? Math.max(0, Math.min(20, parseInt(arg, 10) || 0)) : 0;
      return n.toLocaleString('de-DE', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
    }
    case 'date': {
      if (value == null || value === '') return '';
      const d = new Date(String(value));
      if (Number.isNaN(d.getTime())) return String(value);
      if (arg === 'relative') return formatRelative(d);
      if (arg === 'iso') return d.toISOString();
      return d.toLocaleString('de-DE');
    }
    case 'truncate': {
      const n = parseInt(arg, 10) || 60;
      const s = value == null ? '' : String(value);
      return s.length > n ? `${s.slice(0, n - 1)}…` : s;
    }
    case 'default':
      return value == null || value === '' ? arg : value;
    default:
      return value;
  }
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
