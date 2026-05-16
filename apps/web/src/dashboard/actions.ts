import type { NavigateFunction } from 'react-router-dom';
import { substituteDeep } from './tokens';

/**
 * Dashboard Click-Action-Whitelist (PRD §6).
 * Token-Substitution erfolgt VOR der Action.
 */

export type ActionName =
  | 'openObject'
  | 'openDashboard'
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
    out[p.slice(0, eq).trim()] = p.slice(eq + 1).trim();
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
      const params = args.params as Record<string, unknown> | undefined;
      const qs = params
        ? new URLSearchParams(
            Object.fromEntries(
              Object.entries(params)
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
      const params = args.params as Record<string, unknown> | undefined;
      const qs = params
        ? '?' +
          new URLSearchParams(
            Object.fromEntries(
              Object.entries(params)
                .filter(([, v]) => v != null)
                .map(([k, v]) => [k, String(v)])
            )
          ).toString()
        : '';
      ctx.navigate(`/dashboard/${encodeURIComponent(id)}${qs}`);
      return;
    }
    case 'applyFilter': {
      const usp = new URLSearchParams();
      if (args.q) usp.set('q', String(args.q));
      if (args.type) usp.set('type', String(args.type));
      if (args.file) usp.set('file', String(args.file));
      if (args.label) usp.set('label', String(args.label));
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
      if (!url.startsWith('https://')) {
        console.warn('[dashboard] openUrl requires https://', args);
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
