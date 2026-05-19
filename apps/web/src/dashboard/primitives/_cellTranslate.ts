/**
 * Helper for translating dashboard cell values (e.g. API-family categories
 * like "All", "Other", "Internal LAN", "Local Import").
 *
 * SQL templates emit canonical English keys. The UI looks them up under
 * `dashboard:cellValues.<value>` and falls back to the raw value when no
 * translation exists — so unknown values like "AWS" or "Stripe" still pass
 * through untouched.
 *
 * Only string-typed values are translated. Numbers, booleans, dates etc.
 * are returned as-is.
 */

type Translator = (key: string, opts?: Record<string, unknown>) => unknown;

export function translateCellValue(value: unknown, t: Translator): unknown {
  if (typeof value !== 'string' || value === '') return value;
  return t(`dashboard:cellValues.${value}`, { defaultValue: value });
}
