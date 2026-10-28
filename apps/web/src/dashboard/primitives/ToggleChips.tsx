import { useSearchParams } from 'react-router-dom';
import type { PrimitiveProps } from '../types';

interface ToggleItem {
  /** URL/getvariable param this chip drives. */
  param: string;
  /** Caption (i18n-overridable via `<id>.props.items[N].label`). */
  label: string;
  /** Param value while the chip is on, and while it is off. */
  on: string;
  off: string;
  /** Value when the param is absent from the URL (decides the initial state). */
  default: string;
  /** URL params dropped when this chip changes (in addition to the shared list). */
  resetParams?: string[];
}

/**
 * ToggleChips — a chip bar of independent on/off switches, one URL param each
 * (e.g. "Mass events", "Technical authors"). Where FilterChips chooses one of
 * several values for ONE param, every chip here flips its own param between
 * `on` and `off`; the URL stays canonical (a param at its default is dropped).
 *
 * Props:
 *   items        [{ param, label, on, off, default, resetParams? }]
 *   resetParams  URL params dropped with every change (e.g. the page param of a
 *                server-paged table)
 */
export function ToggleChips({ node }: PrimitiveProps) {
  const props = node.props ?? {};
  const items = (props.items as ToggleItem[]) ?? [];
  const shared = (props.resetParams as string[] | undefined) ?? [];
  const [searchParams, setSearchParams] = useSearchParams();

  if (items.length === 0) return null;

  const flip = (item: ToggleItem, active: boolean) => {
    const next = active ? item.off : item.on;
    setSearchParams(prev => {
      const n = new URLSearchParams(prev);
      if (next === item.default) n.delete(item.param);
      else n.set(item.param, next);
      for (const key of [...shared, ...(item.resetParams ?? [])]) n.delete(key);
      return n;
    }, { replace: true });
  };

  return (
    <div className="dash-chip-bar" role="group">
      {items.map(item => {
        const active = (searchParams.get(item.param) ?? item.default) === item.on;
        return (
          <button
            key={item.param}
            type="button"
            className={`dash-chip dash-chip--toggle${active ? ' dash-chip--active' : ''}`}
            onClick={() => flip(item, active)}
            aria-pressed={active}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
