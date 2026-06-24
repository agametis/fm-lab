import React, { useMemo, useRef, useCallback, useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useObjectDetail } from '../hooks/useObjectDetail';
import { useRefOrigin } from '../hooks/useRefOrigin';
import { ObjectHeader } from './ObjectHeader';
import { HierarchyTree, type HierarchyTreeHandle } from './HierarchyTree';
import { TypeDetail } from './TypeDetail';
import { ObjectGraphPanel, type ObjectGraphPanelHandle } from './ObjectGraphPanel';
import { Breadcrumbs } from './Breadcrumbs';
import { LoadingSpinner } from './LoadingSpinner';
import { ErrorMessage } from './ErrorMessage';
import { ThemeToggle } from './ThemeToggle';
import { RefOriginPill } from './RefOriginPill';
import { AmbiguousFilePicker } from './AmbiguousFilePicker';
import { useEscapeStack } from '../hooks/useEscapeStack';
import { useUrlState } from '../hooks/useUrlState';
import { CurrentFileContext } from '../lib/currentFileContext';
import type { BreadcrumbItem, DetailViewTab } from '../types';
import { DETAIL_TABS } from '../types';
import '../DetailView.css';

function displayObjectType(objectType: string, sourceTable?: string | null): string {
  if (objectType !== 'Folder') return objectType;
  switch (sourceTable) {
    case 'ScriptCatalog':          return 'ScriptFolder';
    case 'Layouts':                return 'LayoutFolder';
    case 'CustomFunctionsCatalog': return 'CustomFunctionFolder';
    default:                       return 'Folder';
  }
}

/**
 * Detail View Component
 * Displays full object details with sub-navigation tabs:
 * Details | Referenzen | Graph | Versions | Notes
 */
export const DetailView: React.FC = () => {
  const { t } = useTranslation(['nav', 'errors']);
  const { uuid } = useParams<{ uuid: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  // Klon-Disambiguierung: `?file=` ist der zweite Identitäts-Begleiter neben der
  // UUID (siehe lib/navigation.ts). Fehlt er, gilt Graceful Downgrade.
  const [fileParam] = useUrlState<string>('file', '');
  const { object, references, loading, error, ambiguousFiles, retry } = useObjectDetail(uuid, fileParam || null);
  const hierarchyRef = useRef<HierarchyTreeHandle>(null);
  const graphPanelRef = useRef<ObjectGraphPanelHandle>(null);

  // URL ist Single Source of Truth für Tab — beim Wechsel wird die URL
  // aktualisiert (replace), sodass beim Zurück-Navigieren der Tab erhalten
  // bleibt. Default 'detail' wird NICHT in die URL geschrieben (saubere URL).
  const validTabIds = useMemo(
    () => new Set(DETAIL_TABS.filter(t => t.enabled).map(t => t.id)),
    [],
  );
  const [tabParam, setTabParam] = useUrlState<string>('tab', 'detail');
  const activeTab: DetailViewTab = (validTabIds.has(tabParam as DetailViewTab) ? tabParam : 'detail') as DetailViewTab;
  const setActiveTab = useCallback((tab: DetailViewTab) => {
    setTabParam(tab);
  }, [setTabParam]);

  // Cross-Reference Highlight.
  // `ref` lebt nur in der URL; useRefOrigin holt das Origin + alle Back-Reference-
  // UUIDs im Destination-Container vom Backend und cached pro (dst, ref)-Paar.
  const [refParam, setRefParam] = useUrlState<string>('ref', '');
  // destFile skopiert die Destination-Seite (das aktuell geöffnete, klon-
  // aufgelöste Objekt) im Back-Refs-Lookup; der Origin (ref) bleibt downgrade.
  const refOrigin = useRefOrigin(uuid, refParam || null, fileParam || null);
  const dismissRefOrigin = useCallback(() => setRefParam(''), [setRefParam]);

  // Live-Match-Count aus Token-Container-Viewern (Script / CustomFunction /
  // Field). back_references zählt für diese Container nur 1 Self-Link, daher
  // korrigiert der Viewer die Anzeige der RefOriginPill mit der echten Anzahl
  // hervorgehobener Token-Vorkommen. Reset beim Wechsel von uuid oder ref-Param.
  const [liveMatchCount, setLiveMatchCount] = useState<number | undefined>(undefined);
  useEffect(() => { setLiveMatchCount(undefined); }, [uuid, refParam]);

  const handleBack = () => {
    // Falls die DetailView per Direkt-Link/Bookmark geöffnet wurde, gibt es
    // keinen Vorgänger im History-Stack — dann auf die Startseite gehen.
    if (location.key !== 'default') navigate(-1);
    else navigate('/');
  };

  // Mehrstufige ESC-Logik: Suchfeld leeren → Filter leeren → Zurück.
  // Stages werden in Reihenfolge geprüft, die erste aktive konsumiert ESC.
  useEscapeStack([
    () => {
      if (hierarchyRef.current?.hasQuery()) {
        hierarchyRef.current.clearQuery();
        return true;
      }
      return false;
    },
    () => {
      if (hierarchyRef.current?.hasFilters()) {
        hierarchyRef.current.clearFilters();
        return true;
      }
      return false;
    },
    // Graph-Tab: ein aktiver Namensfilter wird zuerst geleert (nur gemountet,
    // wenn der Graph-Tab aktiv ist — sonst ist der Ref null und die Stage fällt
    // durch zur Zurück-Navigation).
    () => graphPanelRef.current?.clearTransientFilters() ?? false,
    () => {
      handleBack();
      return true;
    },
  ]);

  if (loading) {
    return (
      <div className="app">
        <LoadingSpinner message={t('nav:detailView.loadingDetails') as string} />
      </div>
    );
  }

  // Sicherheitsnetz: bare-UUID-Navigation auf ein in mehreren Dateien existierendes
  // Objekt (409 AMBIGUOUS_UUID) → Datei-Picker statt hartem Fehler.
  if (ambiguousFiles && ambiguousFiles.length > 0 && uuid) {
    return (
      <div className="app">
        <button onClick={handleBack} className="back-button" aria-label={t('nav:detailView.backAria') as string}>
          &larr; {t('nav:detailView.backLabel')}
        </button>
        <div style={{ marginTop: '1rem' }}>
          <AmbiguousFilePicker uuid={uuid} files={ambiguousFiles} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app">
        <button onClick={handleBack} className="back-button" aria-label={t('nav:detailView.backAria') as string}>
          &larr; {t('nav:detailView.backLabel')}
        </button>
        <div style={{ marginTop: '1rem' }}>
          <ErrorMessage message={error} onRetry={retry} />
        </div>
      </div>
    );
  }

  if (!object) {
    return (
      <div className="app">
        <ErrorMessage message={t('nav:detailView.objectNotFound') as string} />
      </div>
    );
  }

  const breadcrumbType = displayObjectType(object.Object_Type, object.Source_Table);
  const breadcrumbItems: BreadcrumbItem[] = [
    { label: t('nav:breadcrumbs.search') as string, path: '/' },
    { label: breadcrumbType, path: `/?type=${breadcrumbType}` },
    { label: object.Object_Name || (t('nav:detailView.noName') as string), path: null },
  ];

  const renderTabContent = () => {
    switch (activeTab) {
      case 'detail':
        return (
          <TypeDetail
            objectType={object.Object_Type}
            uuid={object.Object_UUID}
            highlightUuids={refOrigin.matchUuids}
            highlightText={refOrigin.origin?.name ?? null}
            onClearRef={dismissRefOrigin}
            onLiveMatchCount={setLiveMatchCount}
          />
        );
      case 'references':
        return <HierarchyTree ref={hierarchyRef} references={references} />;
      case 'graph':
        return <ObjectGraphPanel ref={graphPanelRef} object={object} />;
      default:
        return null;
    }
  };

  return (
    <CurrentFileContext.Provider value={object.File_Name ?? null}>
    <div className="app" role="main" aria-labelledby="object-title">
      {/* Navigation bar */}
      <div className="detail-nav">
        <button onClick={handleBack} className="back-button" aria-label={t('nav:detailView.backAria') as string}>
          &larr; {t('nav:detailView.backLabel')}
        </button>
        <Breadcrumbs items={breadcrumbItems} />
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <ThemeToggle />
        </div>
      </div>

      {/* Object header */}
      <ObjectHeader object={object} />

      {/* Origin-Indikator-Pill (Cross-Reference Highlight) — nur sichtbar,
          wenn ein `ref`-Parameter in der URL gesetzt ist. liveMatchCount
          überschreibt den server-seitigen Container-Self-Link-Count für
          Token-Container-Detail-Tabs (Script / CustomFunction / Field). */}
      {refParam && (
        <RefOriginPill
          state={refOrigin}
          rawRef={refParam}
          onDismiss={dismissRefOrigin}
          liveMatchCount={activeTab === 'detail' ? liveMatchCount : undefined}
        />
      )}

      {/* Sub-navigation tabs */}
      <nav className="detail-tab-nav" role="tablist" aria-label={t('nav:detailView.tabsAria') as string}>
        {DETAIL_TABS.map((tab) => (
          <button
            key={tab.id}
            className={`tab-button${activeTab === tab.id ? ' active' : ''}${!tab.enabled ? ' disabled' : ''}`}
            onClick={() => tab.enabled && setActiveTab(tab.id)}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-disabled={!tab.enabled}
            tabIndex={tab.enabled ? 0 : -1}
          >
            {t(`nav:${tab.label}`)}
          </button>
        ))}
      </nav>

      {/* Separator */}
      <hr className="detail-separator" />

      {/* Tab content */}
      {renderTabContent()}
    </div>
    </CurrentFileContext.Provider>
  );
};
