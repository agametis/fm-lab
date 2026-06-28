import { useCallback, type PointerEvent as ReactPointerEvent } from 'react';

interface PanelResizeOptions {
  /** Which panel the splitter belongs to. `left` grows on rightward drag,
   *  `right` grows on leftward drag (both = "drag towards the canvas shrinks"). */
  side: 'left' | 'right';
  /** Lower clamp (px) so the panel stays usable. */
  min?: number;
  /** Upper clamp (px) so it can't swallow the canvas. */
  max?: number;
}

/**
 * Drag-to-resize behaviour for a side panel splitter. Returns a pointer-down
 * handler for the splitter element; the actual move/up listeners live on
 * `window` for the duration of the drag so the cursor may leave the 6px strip.
 * The width is clamped to [min, max] and pushed to `setWidth` on every move.
 */
export function usePanelResize(
  width: number,
  setWidth: (w: number) => void,
  { side, min = 180, max = 720 }: PanelResizeOptions,
) {
  return useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = width;
      const prevCursor = document.body.style.cursor;
      const prevSelect = document.body.style.userSelect;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = (ev: PointerEvent) => {
        const delta = side === 'left' ? ev.clientX - startX : startX - ev.clientX;
        setWidth(Math.min(max, Math.max(min, startW + delta)));
      };
      const onUp = () => {
        document.body.style.cursor = prevCursor;
        document.body.style.userSelect = prevSelect;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [width, setWidth, side, min, max],
  );
}
