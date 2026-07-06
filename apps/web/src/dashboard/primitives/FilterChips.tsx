import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { PrimitiveProps } from '../types';
import { formatKpiValue } from './_format';

interface ChipOption {
  /** URL/getvariable value this chip selects. */
  value: string;
  /** Caption (i18n-overridable via `<id>.props.options[N].label`). */
  label: string;
  /** Optional dataset field (first row) whose number is shown as the chip count. */
  countField?: string;
}

/**
 * Server-side filter switch rendered as a chip bar (same look as the Table's
 * chipFilter). Unlike that client-side filter — which can only partition the
 * already-loaded, LIMIT-capped rows — FilterChips writes its choice into a URL
 * param that the dashboard forwards to the SQL as `getvariable('<param>')`, so
 * each option re-queries against the full table and its count (from the bound
 * summary dataset) is the true total, not a capped sample.
 *
 * Props:
 *   param    URL/getvariable name to drive (required, e.g. "comment")
 *   default  value selected when the param is absent from the URL
 *   options  [{ value, label, countField }]
 */
export function FilterChips({ node, dataset }: PrimitiveProps) {
  const { i18n } = useTranslation();
  const props = node.props ?? {};
  const param = props.param as string | undefined;
  const fallback = (props.default as string) ?? '';
  const options = (props.options as ChipOption[]) ?? [];
  const [searchParams, setSearchParams] = useSearchParams();

  if (!param || options.length === 0) return null;

  const current = searchParams.get(param) ?? fallback;
  const row = dataset?.data?.[0];

  const select = (value: string) => {
    setSearchParams(prev => {
      const n = new URLSearchParams(prev);
      // Keep the URL canonical: drop the param at its default.
      if (value === fallback) n.delete(param);
      else n.set(param, value);
      return n;
    }, { replace: true });
  };

  return (
    <div className="dash-chip-bar" role="group">
      {options.map(opt => {
        const rawCount = opt.countField && row ? row[opt.countField] : undefined;
        const active = current === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            className={`dash-chip${active ? ' dash-chip--active' : ''}`}
            onClick={() => select(opt.value)}
            aria-pressed={active}
          >
            {opt.label}
            {rawCount != null && (
              <span className="dash-chip__count">
                {formatKpiValue(rawCount, 'number', i18n.language)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
