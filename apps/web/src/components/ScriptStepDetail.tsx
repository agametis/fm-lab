import { API_BASE } from '../config/apiBase';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useScriptTokens } from '../hooks/useScriptTokens';
import { useApiLang } from '../hooks/useApiLang';
import { ScriptViewer } from './ScriptViewer';
import { LoadingSpinner } from './LoadingSpinner';
import { ErrorMessage } from './ErrorMessage';
import './ScriptStepDetail.css';

interface ScriptStepDetailProps {
  uuid: string;
  highlightRefUuids?: Set<string> | null;
  onLiveMatchCount?: (count: number) => void;
}

const baseUrl = API_BASE;

/**
 * Detail-Ansicht für einen einzelnen ScriptStep.
 *
 * Nutzt die existierende Token-Pipeline (kind: 'script') mit einem 1-Zeilen-
 * Payload, sodass der ScriptViewer ohne Anpassung das Token-Rendering, die
 * Hover-Popovers und die klickbaren Refs übernimmt. Ergänzt wird eine
 * Kontext-Karte oberhalb mit:
 *   - Parent-Script-Link (springt zum vollständigen Script-Viewer)
 *   - Step-Position (1-basiert wie im FileMaker-Editor)
 *   - Step-Type-Badge mit Display-Name
 *   - Hilfe-Link auf die Claris-Help-Seite des ScriptStep-Typs
 */
export const ScriptStepDetail: React.FC<ScriptStepDetailProps> = ({ uuid, highlightRefUuids, onLiveMatchCount }) => {
  const { t } = useTranslation(['detail']);
  const lang = useApiLang();
  const { data, loading, error, retry } = useScriptTokens(uuid, lang);

  if (loading) return <LoadingSpinner message={t('detail:loadingObject') as string} />;
  if (error) return <ErrorMessage message={error} onRetry={retry} />;
  if (!data || !data.lines || data.lines.length === 0) {
    return <div className="no-references">{t('detail:noReferences')}</div>;
  }

  const line = data.lines[0];
  const parent = data.object.parentScript;
  // Step-Index 1-basiert wie im FileMaker-Skript-Editor (DB ist 0-basiert).
  const displayIndex = typeof data.object.stepIndex === 'number' ? data.object.stepIndex + 1 : null;

  const helpHref = line.stepLocalHelpUrl
    ? `${baseUrl}${line.stepLocalHelpUrl}`
    : line.stepHelpUrl;

  return (
    <div className="script-step-detail">
      <div className="script-step-card">
        <div className="script-step-card__row">
          {line.stepName && (
            <span className="script-step-card__type-badge" title={line.stepDescription || ''}>
              {line.stepDisplayName || line.stepName}
            </span>
          )}
          {displayIndex !== null && (
            <span className="script-step-card__position">
              Step {displayIndex}
            </span>
          )}
          {!line.enabled && (
            <span className="script-step-card__disabled-badge">
              disabled
            </span>
          )}
          {helpHref && (
            <a
              className="script-step-card__help-link"
              href={helpHref}
              target="_blank"
              rel="noopener noreferrer"
              title={`Claris Help: ${line.stepName}`}
            >
              ? Help
            </a>
          )}
        </div>
        {parent && (
          <div className="script-step-card__breadcrumb">
            <span className="script-step-card__file">{parent.file}</span>
            <span className="script-step-card__separator" aria-hidden="true">▸</span>
            <Link
              to={`/object/${parent.uuid}?step=${uuid}`}
              className="script-step-card__script-link"
              title={t('detail:objectListItem.showAria', { type: 'Script', name: parent.name }) as string}
            >
              {parent.name}
            </Link>
            {displayIndex !== null && (
              <>
                <span className="script-step-card__separator" aria-hidden="true">▸</span>
                <span className="script-step-card__step-pos">Step {displayIndex}</span>
              </>
            )}
          </div>
        )}
      </div>

      <ScriptViewer
        tokens={data}
        highlightRefUuids={highlightRefUuids}
        onLiveMatchCount={onLiveMatchCount}
        hideToolbar
      />
    </div>
  );
};
