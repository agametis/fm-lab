import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Fixed-Position eines schwebenden Popovers, berechnet aus dem Anker-Rect.
 * `top`/`bottom` ist wechselseitig `'auto'` — je nachdem ob unter- oder
 * oberhalb des Ankers geklappt wird.
 */
export interface PopoverPos {
  left: number;
  top: number | 'auto';
  bottom: number | 'auto';
}

interface HoverPopoverOptions {
  /**
   * Popover-Mindestbreite (px) für den horizontalen Viewport-Clamp — sollte der
   * `min-width` der Popover-CSS-Klasse entsprechen, damit rechts nichts abschneidet.
   */
  minWidth: number;
  /** Verzögerung bis zum Öffnen beim Hover (ms). Default 250. */
  openDelay?: number;
  /** Verzögerung bis zum Schließen nach MouseLeave (ms). Default 120. */
  closeDelay?: number;
  /**
   * Wenn false, ist der Hover deaktiviert (z.B. nicht-angereicherte Tokens ohne
   * Doku) — startHover wird zum No-Op.
   */
  enabled?: boolean;
  /**
   * Callback, sobald das Popover öffnet (nach der Open-Verzögerung) — z.B. um
   * eine Doku asynchron nachzuladen. Der Aufrufer guarded selbst gegen
   * Mehrfach-Fetches.
   */
  onOpen?: () => void;
}

/**
 * Wiederverwendbare Hover-Popover-Mechanik für portalierte Doku-Panels.
 *
 * Kapselt die Lösung, die zuerst am MBS-Plugin-Popover erprobt wurde: Das Panel
 * wird per Portal an <body> gehängt (siehe {@link PopoverPortal}) und `fixed`
 * positioniert, damit es NICHT vom überlaufenden Script-/Detail-Container
 * abgeschnitten wird, wenn die Viewbox auf wenige Zeilen kollabiert.
 *
 * Position wird beim Öffnen aus dem Anker-Rect berechnet — mit Flip nach oben bei
 * wenig Platz unten und horizontalem Clamp in den Viewport. Der Close-Timer ist
 * abbrechbar: Da das Popover kein Kind des Ankers mehr ist, feuert dessen
 * onMouseLeave beim Übergang in den 4px-Spalt — ohne cancelbaren Timer würde das
 * Popover unter dem wandernden Cursor schließen.
 */
export function useHoverPopover<T extends HTMLElement = HTMLSpanElement>(
  opts: HoverPopoverOptions,
) {
  const { minWidth, openDelay = 250, closeDelay = 120, enabled = true, onOpen } = opts;

  const anchorRef = useRef<T | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PopoverPos | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  // onOpen ohne Re-Bind der Callbacks durchreichen (Inline-Arrows würden sonst
  // startHover bei jedem Render neu erzeugen).
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  const computePos = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const MARGIN = 8;
    const spaceBelow = vh - r.bottom;
    const spaceAbove = r.top;
    // Horizontal am Anker ausrichten, aber im Viewport halten.
    const left = Math.max(MARGIN, Math.min(r.left, vw - minWidth - MARGIN));
    // Bevorzugt unterhalb; nur nach oben klappen, wenn unten wenig und oben mehr Platz.
    if (spaceBelow < 240 && spaceAbove > spaceBelow) {
      setPos({ left, top: 'auto', bottom: vh - r.top + 4 });
    } else {
      setPos({ left, top: r.bottom + 4, bottom: 'auto' });
    }
  }, [minWidth]);

  const startHover = useCallback(() => {
    if (!enabled) return;
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      computePos();
      setOpen(true);
      onOpenRef.current?.();
    }, openDelay);
  }, [enabled, computePos, openDelay]);

  const cancelHover = useCallback(() => {
    if (hoverTimer.current) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), closeDelay);
  }, [closeDelay]);

  // Cursor ist ins Popover gewandert → geplantes Öffnen/Schließen abbrechen.
  const keepOpen = useCallback(() => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  // Sofortiges Schließen ohne Verzögerung (z.B. beim Klick auf den Anker-Link).
  const close = useCallback(() => {
    if (hoverTimer.current) { window.clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
    setOpen(false);
  }, []);

  useEffect(() => () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  }, []);

  return { anchorRef, open, pos, startHover, cancelHover, keepOpen, close };
}
