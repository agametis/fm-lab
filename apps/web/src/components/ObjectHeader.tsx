import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { FMObject } from '../types';
import { parsePluginFunctionName, formatObjectDisplayName } from '../lib/objectName';

interface ObjectHeaderProps {
  object: FMObject;
}

/**
 * Synthetic replacement UUIDs from duplicate healing are md5 hex — 32 chars
 * WITHOUT dashes — and thus formally distinguishable from native
 * 8-4-4-4-12 UUIDs (see ObjectHealing in ../types).
 */
const SYNTHETIC_UUID_RE = /^[0-9a-fA-F]{32}$/;

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
  const { t } = useTranslation(['common', 'detail', 'types']);
  const [copied, setCopied] = useState(false);
  const [badgeCopied, setBadgeCopied] = useState(false);

  // Duplicate healing: synthetic catalog identity (badge + copy redirection).
  // The healing field only arrives via the detail API; the UUID pattern also
  // covers list payloads without it.
  const isSynthetic =
    object.healing?.is_synthetic === true || SYNTHETIC_UUID_RE.test(object.Object_UUID);
  const originalUuid = (isSynthetic && object.healing?.original_uuid) || null;

  // PluginFunctions tragen einen redundanten Katalognamen (`MBS:<Sub>::<Sub>`);
  // für die Anzeige lösen wir ihn in Funktionsname + Komponente auf. Themes werden
  // (falls die interne `com.filemaker.theme.*`-ID durchschlägt) auf den Klarnamen
  // aufgelöst — alle anderen Typen bleiben unverändert (formatObjectDisplayName).
  const isPluginFn = object.Object_Type === 'PluginFunction';
  const pluginParts = isPluginFn ? parsePluginFunctionName(object.Object_Name) : null;
  const titleText = pluginParts ? pluginParts.name
    : (formatObjectDisplayName(object.Object_Type, object.Object_Name) || t('detail:objectHeader.noName'));

  const handleCopyUUID = async () => {
    try {
      // For healed objects the copy button yields the ORIGINAL UUID (the one
      // the source file knows — ambiguous there); without a resolvable
      // original it falls back to the synthetic UUID. Native UUIDs unchanged.
      await navigator.clipboard.writeText(originalUuid ?? object.Object_UUID);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: silently fail on older browsers
    }
  };

  // Badge click copies the synthetic UUID (the catalog identity).
  const handleCopySyntheticUUID = async () => {
    try {
      await navigator.clipboard.writeText(object.Object_UUID);
      setBadgeCopied(true);
      setTimeout(() => setBadgeCopied(false), 2000);
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
          <span className="object-type">
            {(() => {
              const typeKey = displayObjectType(object.Object_Type, object.Source_Table);
              return t(`types:objectTypes.${typeKey}`, { defaultValue: typeKey });
            })()}
          </span>
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
          {isSynthetic && (
            <button
              onClick={handleCopySyntheticUUID}
              className={`uuid-healed-badge${badgeCopied ? ' copied' : ''}`}
              title={t('detail:objectHeader.syntheticTooltip') as string}
              aria-label={t('detail:objectHeader.copySyntheticUuidAria') as string}
            >
              {t('detail:objectHeader.syntheticBadge')}
            </button>
          )}
          <code className="object-uuid">
            {object.Object_UUID}
          </code>
          <button
            onClick={handleCopyUUID}
            className={`copy-button${copied ? ' copied' : ''}`}
            aria-label={t(
              originalUuid
                ? 'detail:objectHeader.copyOriginalUuidAria'
                : 'detail:objectHeader.copyUuidAria'
            ) as string}
            title={t(
              originalUuid ? 'common:actions.copyOriginalUuid' : 'common:actions.copyUuid'
            ) as string}
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
