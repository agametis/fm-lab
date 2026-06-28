import type { ReactNode } from 'react';

interface TitleBoxProps {
  title: string;
  /** Small generic-type subtitle (e.g. "Dashboard"). */
  subtitle?: ReactNode;
  /** Optional id on the title element (for aria-labelledby). */
  titleId?: string;
  /** Extra content rendered inside the box, below the title/subtitle
   *  (e.g. the docs metadata strip). */
  children?: ReactNode;
}

/**
 * TitleBox — Ebene 6: the framed title box for generic
 * object-entry pages (Dashboard/Query/Doc entry). Big title + optional small
 * subtitle + optional extra content (metadata), mirroring the catalog-object
 * ObjectHeader and the docset hero card. Leitseiten use a bare `.page-title`.
 */
export function TitleBox({ title, subtitle, titleId, children }: TitleBoxProps) {
  return (
    <div className="title-box">
      <h1 id={titleId} className="title-box__title">{title}</h1>
      {subtitle && <div className="title-box__subtitle">{subtitle}</div>}
      {children}
    </div>
  );
}
