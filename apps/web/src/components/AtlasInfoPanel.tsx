import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { setNodeVisibility } from '../lib/annotationsApi';
import { CommunityAnnotationForm } from './CommunityAnnotationForm';

/**
 * „(...)"-Optionen-Panel des Graph-Atlas — sekundäre Aktion neben dem primären
 * Kachel-/Super-Node-Klick (Drill/Navigate). Kontextuell:
 *  - Community: eigener Name + Notiz editierbar (persistent), →Explorer.
 *  - Knoten: Sichtbarkeit umschalten (Noise-Filter), →Explorer, →Detail.
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
    }
  | {
      kind: 'node';
      uuid: string;
      file: string | null;
      label: string;
      type: string;
      hidden: boolean;
    };

type Props = {
  target: PanelTarget;
  onClose: () => void;
  onChanged: () => void;
  onOpenExplorer: (uuid: string, file: string | null) => void;
  onOpenDetail: (uuid: string, file: string | null) => void;
};

export default function AtlasInfoPanel({ target, onClose, onChanged, onOpenExplorer, onOpenDetail }: Props) {
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
          ? <CommunityBody target={target} onChanged={onChanged} onOpenExplorer={onOpenExplorer} />
          : <NodeBody target={target} onChanged={onChanged} onOpenExplorer={onOpenExplorer} onOpenDetail={onOpenDetail} />}
      </div>
    </div>
  );
}

function CommunityBody({
  target,
  onChanged,
  onOpenExplorer,
}: {
  target: Extract<PanelTarget, { kind: 'community' }>;
  onChanged: () => void;
  onOpenExplorer: (uuid: string, file: string | null) => void;
}) {
  const { t } = useTranslation('atlas');

  return (
    <>
      <h3 className="atlas-panel-title">{t('panel.community.title')}</h3>
      <p className="atlas-panel-sub">{target.label}</p>

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
}: {
  target: Extract<PanelTarget, { kind: 'node' }>;
  onChanged: () => void;
  onOpenExplorer: (uuid: string, file: string | null) => void;
  onOpenDetail: (uuid: string, file: string | null) => void;
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
