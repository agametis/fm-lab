import type { PrimitiveProps } from '../types';
import { dispatchAction } from '../actions';
import type { ActionSpec } from '../actions';

/**
 * NavButton — große Klick-Kachel mit Titel, optionalem Subtitel und Count-Badge.
 * Wenn ein Dataset gebunden ist, wird `count` automatisch aus dataset.data.length
 * bereitgestellt — kein eigenes count_*-Dataset nötig.
 *
 * `variant: "link"` rendert stattdessen einen dezenten Textlink mit Pfeil (CSS)
 * — für Quer-/Fußverweise, die eine volle Kachel optisch überbetonen würde.
 */
export function NavButton({ node, dataset, navigate }: PrimitiveProps) {
  const props = node.props ?? {};
  const label = (props.label as string) ?? '';
  const subtitle = props.subtitle as string | undefined;
  const showCount = (props.showCount as boolean) ?? false;
  const onClick = props.onClick as ActionSpec | undefined;
  const variant = props.variant as string | undefined;

  const count = dataset?.data?.length ?? 0;
  const clickable = !!onClick;

  return (
    <button
      type="button"
      className={`dash-navbutton${variant ? ` dash-navbutton--${variant}` : ''}${clickable ? '' : ' dash-navbutton--disabled'}`}
      onClick={clickable ? () => dispatchAction(onClick, undefined, { navigate }) : undefined}
      disabled={!clickable}
    >
      <span className="dash-navbutton__label">
        {label}
        {showCount && (
          <span className="dash-navbutton__count">{count}</span>
        )}
      </span>
      {subtitle && <span className="dash-navbutton__subtitle">{subtitle}</span>}
    </button>
  );
}
