import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { FMObject } from '../types';
import { parsePluginFunctionName } from '../lib/objectName';

interface ObjectHeaderProps {
  object: FMObject;
}

/**
 * Folder ist im Datenmodell ein einziger Object_Type; im UI zeigen wir den Pseudo-Typ
 * (ScriptFolder/LayoutFolder/CustomFunctionFolder), abgeleitet aus Source_Table.
 */
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
 * Object Header Component
 * Two-column title box: left column carries the file name (top) and the
 * object title + type badge (bottom); the right column carries the source
 * table (top) and the UUID + copy button (bottom). The "Open in FileMaker"
 * action is rendered next to the tab navigation (see DetailView), not here.
 */
export const ObjectHeader: React.FC<ObjectHeaderProps> = ({ object }) => {
  const { t } = useTranslation(['common', 'detail']);
  const [copied, setCopied] = useState(false);

  // PluginFunctions tragen einen redundanten Katalognamen (`MBS:<Sub>::<Sub>`);
  // für die Anzeige lösen wir ihn in Funktionsname + Komponente auf.
  const isPluginFn = object.Object_Type === 'PluginFunction';
  const pluginParts = isPluginFn ? parsePluginFunctionName(object.Object_Name) : null;
  const titleText = pluginParts ? pluginParts.name
    : (object.Object_Name || t('detail:objectHeader.noName'));

  const handleCopyUUID = async () => {
    try {
      await navigator.clipboard.writeText(object.Object_UUID);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: silently fail on older browsers
    }
  };

  return (
    <div className="detail-object-header">
      <div className="detail-header-row detail-header-row--top">
        <div className="detail-file-name">
          {object.File_Name}
        </div>
        {object.Source_Table && (
          <span className="detail-source">
            {t('detail:objectHeader.source')} {object.Source_Table}
          </span>
        )}
      </div>
      <div className="detail-header-row detail-header-row--bottom">
        <div className="detail-title-row">
          <h1
            id="object-title"
            className="detail-title"
            title={isPluginFn ? object.Object_Name : undefined}
          >
            {titleText}
            {pluginParts?.component && (
              <span className="detail-title-plugin-component"> · {pluginParts.component}</span>
            )}
          </h1>
          <span className="object-type">{displayObjectType(object.Object_Type, object.Source_Table)}</span>
          {object.Object_Type === 'TableOccurrence' && object.File_Name && (
            <Link
              to={`/relationship-graph/${encodeURIComponent(object.File_Name)}?to=${encodeURIComponent(object.Object_UUID)}`}
              className="detail-rg-link"
              title={t('common:actions.showInRelationshipGraph') as string}
            >
              {t('detail:objectHeader.relationshipGraphLink')}
            </Link>
          )}
        </div>
        <div className="detail-uuid-row">
          <code className="object-uuid">
            {object.Object_UUID}
          </code>
          <button
            onClick={handleCopyUUID}
            className={`copy-button${copied ? ' copied' : ''}`}
            aria-label={t('detail:objectHeader.copyUuidAria') as string}
            title={t('common:actions.copyUuid') as string}
          >
            {copied ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
