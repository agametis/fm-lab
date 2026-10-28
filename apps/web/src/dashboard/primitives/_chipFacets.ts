/**
 * Reads the convention column `_chip_facets` (`{value: count}` over the whole
 * result before the chip filter) of a server-filtered chip bar (Table,
 * AutoTable). A JSON column arrives as a string OR as an already parsed object,
 * depending on the driver — both are accepted. Anything unusable (parse error,
 * empty object, non-numeric counts) yields `null`, so the caller falls back to
 * counting the loaded rows.
 */
export function parseFacets(raw: unknown): Record<string, number> | null {
  if (raw == null) return null;
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return null;
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return null;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (value == null || value === '') continue;
    const n = Number(value);
    if (Number.isFinite(n)) out[key] = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}
