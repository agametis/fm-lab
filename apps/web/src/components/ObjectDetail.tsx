import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useObjectDetails } from '../hooks/useObjectDetails';
import { useLayoutData } from '../hooks/useLayoutData';
import { useCurrentFile } from '../lib/currentFileContext';
import { LayoutCanvas, type LayoutCanvasHandle } from './LayoutCanvas';
import { LoadingSpinner } from './LoadingSpinner';
import { ErrorMessage } from './ErrorMessage';
import { ScriptDetail } from './ScriptDetail';
import { ScriptStepDetail } from './ScriptStepDetail';
import { CustomFunctionDetail } from './CustomFunctionDetail';
import { CustomMenuDetail } from './CustomMenuDetail';
import { FieldDetail } from './FieldDetail';
import { PrivilegeSetDetail } from './PrivilegeSetDetail';
import { RelationshipDetail } from './RelationshipDetail';
import { ValueListDetail } from './ValueListDetail';
import { BaseTableDetail } from './BaseTableDetail';
import '../views/LayoutView.css';

interface ObjectDetailProps {
  uuid: string;
  objectType: string;
  /**
   * UUIDs zum Hervorheben (Cross-Reference Highlight).
   * Wird je nach Ziel-View interpretiert:
   *  - LayoutCanvas:        matchUuids
   *  - ScriptViewer:        highlightRefUuids (Token-Match)
   *  - CustomFunctionViewer: highlightRefUuids
   */
  highlightUuids?: Set<string>;
  /**
   * Origin-Name für Substring-Highlight in Content-Views (GenericObjectDetail).
   */
  highlightText?: string | null;
  /**
   * Wird bei explizitem User-Eingriff (Suche, Typ-Filter) im LayoutCanvas
   * gefeuert, um den ref-Param aus der URL zu entfernen.
   */
  onClearRef?: () => void;
  /**
   * Liefert die im jeweiligen Viewer tatsächlich hervorgehobenen Token-
   * Vorkommen — Grundlage für die RefOriginPill, wenn der server-seitige
   * Container-Self-Link-Count die echte Anzahl unterschätzt (Script /
   * CustomFunction / Field als Token-Container).
   */
  onLiveMatchCount?: (count: number) => void;
  /**
   * Handle des eingebetteten LayoutCanvas (nur für objectType='Layout' belegt) —
   * von der DetailView für die ESC-Stufenlogik (Suche/Filter räumen) verdrahtet.
   */
  layoutCanvasRef?: React.Ref<LayoutCanvasHandle>;
}

/**
 * Embedded layout viewer used inside DetailView. Loads layout data and renders
 * the interactive LayoutCanvas — same component as the /layout/:uuid fullscreen
 * route, just inside a fixed-height container with a fullscreen link.
 */
const EmbeddedLayoutView: React.FC<{
  uuid: string;
  highlightUuids?: Set<string>;
  onClearRef?: () => void;
  layoutCanvasRef?: React.Ref<LayoutCanvasHandle>;
}> = ({ uuid, highlightUuids, onClearRef, layoutCanvasRef }) => {
  const { t } = useTranslation(['common', 'detail']);
  const currentFile = useCurrentFile();
  const { data, loading, error } = useLayoutData(uuid, currentFile);
  if (loading) return <LoadingSpinner message={t('detail:layoutPreview.loading') as string} />;
  if (error) return <ErrorMessage message={error} />;
  if (!data || data.objects.length === 0) {
    return <div className="no-references">{t('detail:layoutPreview.empty')}</div>;
  }
  return (
    <div className="object-detail" aria-label={t('detail:layoutPreview.heading') as string}>
      <div className="layout-detail-header">
        <h2 className="type-detail-heading">{t('detail:layoutPreview.heading')}</h2>
        <Link
          to={`/layout/${uuid}`}
          className="layout-detail-fullscreen"
          title={t('common:actions.openLayoutFullscreen') as string}
        >
          {t('common:actions.fullscreen')}
        </Link>
      </div>
      <div className="layout-detail-canvas">
        <LayoutCanvas
          ref={layoutCanvasRef}
          data={data}
          externalMatchUuids={highlightUuids}
          onClearRef={onClearRef}
        />
      </div>
    </div>
  );
};

/**
 * Highlight-Substring rendern: zerlegt Text an allen Vorkommen von `needle`
 * und wrappt diese in <mark>. Case-insensitive. Bei leerem needle: Text 1:1.
 */
function highlightSubstring(text: string, needle: string | null | undefined): React.ReactNode {
  if (!needle || needle.length < 2) return text;
  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const out: React.ReactNode[] = [];
  let start = 0;
  let idx = lowerText.indexOf(lowerNeedle, start);
  while (idx !== -1) {
    if (idx > start) out.push(text.slice(start, idx));
    out.push(
      <mark key={`m-${idx}`} className="fm-content-highlight">
        {text.slice(idx, idx + needle.length)}
      </mark>
    );
    start = idx + needle.length;
    idx = lowerText.indexOf(lowerNeedle, start);
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

/**
 * Generic non-Layout detail view: lädt content via /api/get-details und rendert
 * als formatierten Text-Block. Eigene Komponente, damit ihre Hooks in einer
 * eigenen Aufruf-Reihenfolge stehen und nicht mit dem Layout-Pfad kollidieren.
 *
 * `highlightText` legt einen Substring-Highlight über alle Zeilen.
 */
const GenericObjectDetail: React.FC<ObjectDetailProps> = ({ uuid, objectType, highlightText }) => {
  const { t } = useTranslation(['common', 'detail']);
  const currentFile = useCurrentFile();
  const { data, loading, error, retry } = useObjectDetails(uuid, currentFile);

  const renderedLines = useMemo(() => {
    if (!data) return null;
    return data.map((row, index) => (
      <span key={index} className="content-line">
        {highlightSubstring(String(row.content), highlightText)}
        {'\n'}
      </span>
    ));
  }, [data, highlightText]);

  if (loading) return <LoadingSpinner message={t('common:loading') as string} />;
  if (error) return <ErrorMessage message={error} onRetry={retry} />;
  if (!data || data.length === 0) {
    return <div className="no-references">{t('common:noData')}</div>;
  }

  const heading = t(`detail:headings.${objectType}`, { defaultValue: 'Details' });
  const countLabel = objectType === 'Script' ? ` ${t('detail:scriptViewer.stepCount', { count: data.length })}` : '';

  return (
    <div className="object-detail" aria-label={heading as string}>
      <h2 className="type-detail-heading">{heading}{countLabel}</h2>
      <pre className="content-text">
        <code>{renderedLines}</code>
      </pre>
    </div>
  );
};

/**
 * Unified Object Detail Component.
 * - Layouts: interactive LayoutCanvas (Hover, Suche, Filter, Cross-Nav)
 * - Other types: formatted text in a code block
 */
export const ObjectDetail: React.FC<ObjectDetailProps> = ({
  uuid,
  objectType,
  highlightUuids,
  highlightText,
  onClearRef,
  onLiveMatchCount,
  layoutCanvasRef,
}) => {
  if (objectType === 'Layout') {
    return (
      <EmbeddedLayoutView
        uuid={uuid}
        highlightUuids={highlightUuids}
        onClearRef={onClearRef}
        layoutCanvasRef={layoutCanvasRef}
      />
    );
  }
  if (objectType === 'Script') {
    return <ScriptDetail uuid={uuid} highlightRefUuids={highlightUuids} onLiveMatchCount={onLiveMatchCount} />;
  }
  if (objectType === 'ScriptStep') {
    return <ScriptStepDetail uuid={uuid} highlightRefUuids={highlightUuids} onLiveMatchCount={onLiveMatchCount} />;
  }
  if (objectType === 'CustomFunction') {
    return <CustomFunctionDetail uuid={uuid} highlightRefUuids={highlightUuids} onLiveMatchCount={onLiveMatchCount} />;
  }
  if (objectType === 'CustomMenu' || objectType === 'CustomMenuItem') {
    return <CustomMenuDetail uuid={uuid} objectType={objectType} highlightRefUuids={highlightUuids} onLiveMatchCount={onLiveMatchCount} />;
  }
  if (objectType === 'Field') {
    return <FieldDetail uuid={uuid} highlightRefUuids={highlightUuids} onLiveMatchCount={onLiveMatchCount} />;
  }
  if (objectType === 'PrivilegeSet') {
    return <PrivilegeSetDetail uuid={uuid} highlightRefUuids={highlightUuids} />;
  }
  if (objectType === 'Relationship') {
    return <RelationshipDetail uuid={uuid} />;
  }
  if (objectType === 'ValueList') {
    return <ValueListDetail uuid={uuid} />;
  }
  if (objectType === 'BaseTable') {
    return <BaseTableDetail uuid={uuid} />;
  }
  return (
    <GenericObjectDetail
      uuid={uuid}
      objectType={objectType}
      highlightText={highlightText}
    />
  );
};
