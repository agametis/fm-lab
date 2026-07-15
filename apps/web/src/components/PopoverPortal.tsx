import React from 'react';
import { createPortal } from 'react-dom';
import type { PopoverPos } from './useHoverPopover';

interface PopoverPortalProps {
  /** Berechnete Fixed-Position (aus {@link useHoverPopover}). */
  pos: PopoverPos;
  /** CSS-Klasse(n) des Panels — inkl. der `--portal`-Variante zum Re-Binden gescopeter Vars. */
  className?: string;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  children: React.ReactNode;
}

/**
 * Rendert ein Doku-Popover per Portal an <body>, `fixed` positioniert, damit es
 * kein überlaufender Script-/Detail-Container abschneidet. Position/Flip kommen
 * aus {@link useHoverPopover}; das Styling bleibt Sache der übergebenen Klasse.
 */
export const PopoverPortal: React.FC<PopoverPortalProps> = ({
  pos,
  className,
  onMouseEnter,
  onMouseLeave,
  children,
}) => {
  return createPortal(
    <span
      className={className}
      role="tooltip"
      style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, zIndex: 1000 }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </span>,
    document.body,
  );
};
