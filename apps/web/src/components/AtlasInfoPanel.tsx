import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { setNodeVisibility } from '../lib/annotationsApi';
import type { AtlasActivity, AtlasActivityHead } from '../hooks/useGraphOverview';
import { AtlasActivityFacts } from './AtlasActivity';
import { CommunityAnnotationForm } from './CommunityAnnotationForm';

/**
 * „(...)"-Optionen-Panel des Graph-Atlas — sekundäre Aktion neben dem primären
 * Kachel-/Super-Node-Klick (Drill/Navigate). Kontextuell:
 *  - Community: eigener Name + Notiz editierbar (persistent), →Explorer,
 *    →Dashboard „Modul-Aktivität" (gefiltert auf die Community).
 *  - Knoten: Sichtbarkeit umschalten (Noise-Filter), →Explorer, →Detail.
 * In den Farbmodi „Aktivität"/„Speicherungen" zeigt es zusätzlich die
 * Änderungs-Aktivität der Kachel (neueste Änderung, Anteile, Mediane).
 *
 * Schreibt über annotationsApi in die Sidecar-DB; nach Erfolg `onChanged()` →
 * der View refetcht die aktuelle Ebene (Backend-Cache ist bereits geleert).
 */

export type PanelTarget =
  | {
      kind: 'community';
      engine: string;
      community: number;
      label: string;
      userName: string;
      userNotes: string;
      topMemberUuid: string | null;
      activity?: AtlasActivity | null;
    }
  | {
      kind: 'node';
      uuid: string;
      file: string | null;
      label: string;
      type: string;
      hidden: boolean;
      activity?: AtlasActivity | null;
    };

type Props = {
  target: PanelTarget;
  onClose: () => void;
  onChanged: () => void;
  onOpenExplorer: (uuid: string, file: string | null) => void;
  onOpenDetail: (uuid: string, file: string | null) => void;
  /** Aktivitäts-Kopf der aktuellen Ebene (Datenstand, Stempel vorhanden). */
  activityHead?: AtlasActivityHead | null;
};

export default function AtlasInfoPanel({ target, onClose, onChanged, onOpenExplorer, onOpenDetail, activityHead = null }: Props) {
  const { t } = useTranslation('atlas');
  const dialogRef = useRef<HTMLDivElement>(null);

  // Esc schließt, Klick außerhalb schließt — wie ein leichtgewichtiges Popover.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="atlas-panel-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="atlas-panel"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="atlas-panel-close" aria-label={t('panel.close') as string} onClick={onClose}>
          ×
        </button>
        {target.kind === 'community'
          ? <CommunityBody target={target} onChanged={onChanged} onOpenExplorer={onOpenExplorer} activityHead={activityHead} />
          : <NodeBody target={target} onChanged={onChanged} onOpenExplorer={onOpenExplorer} onOpenDetail={onOpenDetail} activityHead={activityHead} />}
      </div>
    </div>
  );
}

function CommunityBody({
  target,
  onChanged,
  onOpenExplorer,
  activityHead,
}: {
  target: Extract<PanelTarget, { kind: 'community' }>;
  onChanged: () => void;
  onOpenExplorer: (uuid: string, file: string | null) => void;
  activityHead: AtlasActivityHead | null;
}) {
  const { t } = useTranslation('atlas');

  return (
    <>
      <h3 className="atlas-panel-title">{t('panel.community.title')}</h3>
      <p className="atlas-panel-sub">{target.label}</p>

      {target.activity && <AtlasActivityFacts activity={target.activity} head={activityHead} />}
      {activityHead?.available && (
        <p className="atlas-panel-link">
          <Link to={`/dashboard/module_activity?module=${encodeURIComponent(String(target.community))}`}>
            {t('activity.panel.openDashboard')}
          </Link>
        </p>
      )}

      <CommunityAnnotationForm
        engine={target.engine}
        community={target.community}
        initialName={target.userName}
        initialNotes={target.userNotes}
        onSaved={onChanged}
        extraActions={
          target.topMemberUuid ? (
            <button
              type="button"
              className="caf-btn"
              onClick={() => onOpenExplorer(target.topMemberUuid as string, null)}
            >
              {t('panel.openExplorer')}
            </button>
          ) : null
        }
      />
    </>
  );
}

function NodeBody({
  target,
  onChanged,
  onOpenExplorer,
  onOpenDetail,
  activityHead,
}: {
  target: Extract<PanelTarget, { kind: 'node' }>;
  onChanged: () => void;
  onOpenExplorer: (uuid: string, file: string | null) => void;
  onOpenDetail: (uuid: string, file: string | null) => void;
  activityHead: AtlasActivityHead | null;
}) {
  const { t } = useTranslation('atlas');
  const [hidden, setHidden] = useState(target.hidden);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    setBusy(true);
    setError(null);
    const next = !hidden;
    try {
      await setNodeVisibility(target.uuid, target.file, !next /* visible = !hidden */);
      setHidden(next);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h3 className="atlas-panel-title">
        {t('panel.node.title')}
        {hidden && <span className="atlas-panel-badge">{t('panel.hiddenBadge')}</span>}
      </h3>
      <p className="atlas-panel-sub">{target.label}</p>
      <p className="atlas-panel-meta">
        {t('panel.type')}: {target.type}
        {target.file ? ` · ${target.file}` : ''}
      </p>

      {target.activity && <AtlasActivityFacts activity={target.activity} head={activityHead} />}

      {error && <p className="atlas-panel-error">{error}</p>}

      <div className="atlas-panel-actions">
        <button type="button" className="atlas-panel-btn" onClick={() => onOpenDetail(target.uuid, target.file)}>
          {t('panel.openDetail')}
        </button>
        <button type="button" className="atlas-panel-btn" onClick={() => onOpenExplorer(target.uuid, target.file)}>
          {t('panel.openExplorer')}
        </button>
        <button type="button" className={`atlas-panel-btn${hidden ? '' : ' danger'}`} disabled={busy} onClick={toggle}>
          {hidden ? t('panel.unhideNode') : t('panel.hideNode')}
        </button>
      </div>
    </>
  );
}
