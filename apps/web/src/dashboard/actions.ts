import { API_BASE } from '../config/apiBase';
import type { NavigateFunction } from 'react-router-dom';
import { substituteDeep } from './tokens';

/**
 * Dashboard Click-Action-Whitelist (PRD §6).
 * Token-Substitution erfolgt VOR der Action.
 */

export type ActionName =
  | 'openObject'
  | 'openDashboard'
  | 'openDocsEntry'
  | 'applyFilter'
  | 'runQuery'
  | 'openUrl'
  | 'copyToClipboard';

export interface ActionSpec {
  action: string;
  /** Args als Objekt — Token-Substitution wird rekursiv angewendet. */
  args?: Record<string, unknown>;
  /** Alternative: Args als "k=v&k2=v2"-String (z.B. aus DB-Spalten). */
  argsString?: string;
}

export interface ActionContext {
  navigate: NavigateFunction;
}

function parseArgsString(str: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!str) return out;
  // Wir unterstützen "k=v&k2=v2" und "k=v, k2=v2"
  const pairs = str.split(/[&,]/).map(s => s.trim()).filter(Boolean);
  for (const p of pairs) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    const key = p.slice(0, eq).trim();
    const rawValue = p.slice(eq + 1).trim();
    // URL-decode the value so that backends that emit %XX sequences in
    // action_args (e.g. encodeURIComponent("fn:1") → "fn%3A1") deliver clean
    // values to action handlers. Without this, URLSearchParams would re-encode
    // the %XX as %25XX, producing a double-encoded query string.
    let value = rawValue;
    try {
      value = decodeURIComponent(rawValue);
    } catch {
      // Malformed percent-encoding — keep the raw value.
    }
    out[key] = value;
  }
  return out;
}

/**
 * Resolviert Tokens in einem ActionSpec gegen die Datenzeile,
 * gibt {action, args} mit fertig substituierten Args zurück oder null,
 * wenn die Action nach Substitution kein gültiger Name mehr ist.
 */
export function resolveAction(
  spec: ActionSpec | undefined,
  row: Record<string, unknown> | undefined
): { action: string; args: Record<string, unknown> } | null {
  if (!spec || !spec.action) return null;

  const resolvedAction = (substituteDeep(spec.action, row) as string) || '';
  if (!resolvedAction) return null;

  let args: Record<string, unknown> = {};
  if (spec.args) {
    args = (substituteDeep(spec.args, row) as Record<string, unknown>) || {};
  }
  if (spec.argsString) {
    const stringResolved = (substituteDeep(spec.argsString, row) as string) || '';
    args = { ...parseArgsString(stringResolved), ...args };
  }
  return { action: resolvedAction, args };
}

/**
 * Führt eine Action aus. Unbekannte Actions werden geloggt, aber ignoriert.
 */
export function dispatchAction(
  spec: ActionSpec | undefined,
  row: Record<string, unknown> | undefined,
  ctx: ActionContext
): void {
  const resolved = resolveAction(spec, row);
  if (!resolved) return;
  const { action, args } = resolved;

  switch (action as ActionName | string) {
    case 'openObject': {
      const uuid = String(args.uuid || '');
      if (!uuid) {
        console.warn('[dashboard] openObject called without uuid', args);
        return;
      }
      // Zwei Aufruf-Formen (analog openDashboard):
      //   args = { uuid, params: { tab, ref, ... } }   — explizit verschachtelt
      //   args = { uuid, tab, ref, ... }               — flat, kommt aus
      //                                                 argsString="uuid=...&tab=..."
      // Im Flat-Fall heben wir alles außer uuid in den Query-String.
      const nested = args.params as Record<string, unknown> | undefined;
      const flat: Record<string, unknown> = {};
      if (!nested) {
        for (const [k, v] of Object.entries(args)) {
          if (k === 'uuid') continue;
          if (v != null) flat[k] = v;
        }
      }
      const merged = nested ?? flat;
      const qs = Object.keys(merged).length > 0
        ? new URLSearchParams(
            Object.fromEntries(
              Object.entries(merged)
                .filter(([, v]) => v != null && String(v) !== '')
                .map(([k, v]) => [k, String(v)])
            )
          ).toString()
        : '';
      ctx.navigate(`/object/${encodeURIComponent(uuid)}${qs ? '?' + qs : ''}`);
      return;
    }
    case 'openDashboard': {
      const id = String(args.id || '');
      if (!id) {
        console.warn('[dashboard] openDashboard called without id', args);
        return;
      }
      // Two supported shapes:
      //   args = { id, params: { ... } }         — nested form, used by hand-written JSON
      //   args = { id, ...flatParams }           — flat form, produced by argsString="id=...&docset=..."
      // The flat form lifts everything except `id` itself into query-string params.
      const nested = args.params as Record<string, unknown> | undefined;
      const flat: Record<string, unknown> = {};
      if (!nested) {
        for (const [k, v] of Object.entries(args)) {
          if (k === 'id') continue;
          if (v != null) flat[k] = v;
        }
      }
      const merged = nested ?? flat;
      const qs = Object.keys(merged).length > 0
        ? '?' +
          new URLSearchParams(
            Object.fromEntries(
              Object.entries(merged)
                .filter(([, v]) => v != null)
                .map(([k, v]) => [k, String(v)])
            )
          ).toString()
        : '';
      ctx.navigate(`/dashboard/${encodeURIComponent(id)}${qs}`);
      return;
    }
    case 'openDocsEntry': {
      // Navigates to /docs/:set/:category/:fn. Used by docset_category Functions-Liste
      // to open the Function-Volltext-View (PRD prd_docs_redesign.md §6.1).
      const setId = String(args.set || args.docset || '');
      const category = String(args.category || '');
      const fn = String(args.fn || args.function || '');
      if (!setId || !category || !fn) {
        console.warn('[dashboard] openDocsEntry needs set/category/fn', args);
        return;
      }
      const lang = args.lang ? String(args.lang) : '';
      const qs = lang ? `?lang=${encodeURIComponent(lang)}` : '';
      ctx.navigate(`/docs/${encodeURIComponent(setId)}/${encodeURIComponent(category)}/${encodeURIComponent(fn)}${qs}`);
      return;
    }
    case 'applyFilter': {
      const usp = new URLSearchParams();
      if (args.q) usp.set('q', String(args.q));
      if (args.type) usp.set('type', String(args.type));
      if (args.file) usp.set('file', String(args.file));
      if (args.label) usp.set('label', String(args.label));
      // Pseudo-Token-Filter (BuiltinFunction/ScriptStepType/PluginFunction):
      // initialCategory wird vom PseudoTokenView aus ?category= gelesen.
      if (args.category) usp.set('category', String(args.category));
      if (args.sort) usp.set('sort', String(args.sort));
      const qs = usp.toString();
      ctx.navigate(qs ? `/?${qs}` : '/');
      return;
    }
    case 'runQuery': {
      const q = String(args.query || '');
      if (!q) {
        console.warn('[dashboard] runQuery called without query', args);
        return;
      }
      // Phase 2: _generic-Dashboard. Vorerst: navigiere auf /query/:name (Stub).
      ctx.navigate(`/query/${encodeURIComponent(q)}`);
      return;
    }
    case 'openUrl': {
      const url = String(args.url || '');
      if (!url) return;
      // Local API paths: prefix with VITE_API_URL and navigate in the SAME tab
      // (no confirmation) — they hit our own backend (e.g.
      // /api/plugin-docs/mbs/Clipboard.GetText/page returns the locally
      // mirrored MBS help HTML). Same-tab navigation keeps the browser back
      // button as the obvious way back to the dashboard.
      if (url.startsWith('/api/')) {
        const apiBase = (API_BASE).replace(/\/+$/, '');
        window.location.href = `${apiBase}${url}`;
        return;
      }
      // External URLs: require https:// and ask for confirmation. These stay
      // in a new tab so the user doesn't lose dashboard context to a third
      // party site.
      if (!url.startsWith('https://')) {
        console.warn('[dashboard] openUrl requires https:// or /api/', args);
        return;
      }
      const ok = window.confirm(`Externe URL öffnen?\n${url}`);
      if (ok) window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    case 'copyToClipboard': {
      const value = String(args.value ?? '');
      navigator.clipboard?.writeText(value).catch(err => {
        console.warn('[dashboard] copyToClipboard failed', err);
      });
      return;
    }
    default:
      console.warn(`[dashboard] unknown action: ${action}`);
  }
}
