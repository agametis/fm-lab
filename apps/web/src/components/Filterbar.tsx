import type { ReactNode } from 'react';

interface FilterbarProps {
  children: ReactNode;
  className?: string;
}

/**
 * Filterbar — Ebene 4/5: a compact, generic container
 * for filter controls and view-specific tools. The former bulky `.search-form`
 * and the inline graph toolbars collapse into this bar.
 */
export function Filterbar({ children, className }: FilterbarProps) {
  return <div className={`filterbar${className ? ' ' + className : ''}`}>{children}</div>;
}
