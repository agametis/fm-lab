import { useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLayoutData } from '../hooks/useLayoutData';
import { LayoutCanvas, type LayoutCanvasHandle } from '../components/LayoutCanvas';
import { SubNav } from '../components/SubNav';
import { StatusBar } from '../components/StatusBar';
import { buildBreadcrumb } from '../lib/navigation';
import { useEscapeStack } from '../hooks/useEscapeStack';
import { useUrlState } from '../hooks/useUrlState';
import { CurrentFileContext } from '../lib/currentFileContext';
import './LayoutView.css';

export function LayoutView() {
  const { t } = useTranslation(['common', 'errors', 'nav', 'types']);
  const { uuid } = useParams<{ uuid: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const canvasRef = useRef<LayoutCanvasHandle>(null);

  // Klon-Disambiguierung: `?file=` begleitet die UUID (Graceful Downgrade).
  const [fileParam] = useUrlState<string>('file', '');
  const { data, loading, error } = useLayoutData(uuid, fileParam || null);

  // Zurück: bevorzugt vorigen Eintrag, sonst Startseite (analog RelationshipGraphView).
  const handleBack = () => {
    if (location.key !== 'default') navigate(-1);
    else navigate('/');
  };

  // Mehrstufige ESC-Logik:
  //   1. Tooltip → schließen
  //   2. Suche / Selektion → leeren (kombiniert wie bisher)
  //   3. Typ-Filter → leeren
  //   4. Zurück.
  useEscapeStack([
    () => {
      if (canvasRef.current?.hasTooltip()) {
        canvasRef.current.closeTooltip();
        return true;
      }
      return false;
    },
    () => {
      if (canvasRef.current?.hasSearchState()) {
        canvasRef.current.clearSearch();
        return true;
      }
      return false;
    },
    () => {
      if (canvasRef.current?.hasFilters()) {
        canvasRef.current.clearFilters();
        return true;
      }
      return false;
    },
    () => {
      handleBack();
      return true;
    },
  ]);

  return (
    <CurrentFileContext.Provider value={data?.fileName || fileParam || null}>
    <div className="layout-view">
      <SubNav
        breadcrumbs={buildBreadcrumb(
          { kind: 'object', objectType: 'Layout', objectName: data?.layoutName || 'Layout' },
          t,
        )}
      />
      <StatusBar onBack={handleBack} />
      <header className="layout-view-header">
        <h1>
          Layout
          {data && (
            <span className="layout-view-title">
              : {data.layoutName}
              {data.layoutToName && (
                <span className="layout-view-subtitle"> ({data.layoutToName})</span>
              )}
            </span>
          )}
        </h1>
        {data && <div className="layout-view-file">{data.fileName}</div>}
      </header>

      <div className="layout-view-body">
        {loading && <div className="layout-view-empty">{t('common:loading')}</div>}
        {error && <div className="layout-view-error">{t('common:loadError', { message: error })}</div>}
        {!loading && !error && data && data.objects.length === 0 && (
          <div className="layout-view-empty">{t('common:layout.empty')}</div>
        )}
        {!loading && !error && data && data.objects.length > 0 && (
          <LayoutCanvas ref={canvasRef} data={data} />
        )}
      </div>
    </div>
    </CurrentFileContext.Provider>
  );
}
