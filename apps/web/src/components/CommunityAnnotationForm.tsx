import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { setCommunityAnnotation } from '../lib/annotationsApi';
import './CommunityAnnotationForm.css';

/**
 * Gemeinsame Community-Annotations-Form (Name + Notiz + Speichern) — aus
 * `AtlasInfoPanel.CommunityBody` extrahiert. Beide Konsumenten
 * teilen dieselbe Form + dieselben i18n-Keys (`atlas:panel.community.*`):
 *   - Graph-Atlas „(…)"-Panel  → ohne onCancel, mit „Im Graph öffnen" als extraActions
 *   - Cluster-Liste `[Edit]`   → mit onCancel (Inline-Editor Save/Cancel)
 *
 * Schreibt über `setCommunityAnnotation` (PUT /api/annotations/community); nach
 * Erfolg `onSaved()` → der Aufrufer refetcht (Backend-Cache ist bereits geleert).
 */

type Props = {
  engine: string;
  community: number;
  initialName: string;
  initialNotes: string;
  /** Nach erfolgreichem Speichern — Aufrufer lädt die Liste/Ebene neu. */
  onSaved: () => void;
  /** Inline-Editor (Cluster-Liste): blendet einen „Abbrechen"-Button ein. */
  onCancel?: () => void;
  /** Zusätzliche Aktionen in derselben Button-Zeile (z.B. „Im Graph öffnen"). */
  extraActions?: React.ReactNode;
  /** Name-Feld beim Mounten fokussieren (Inline-Editor). */
  autoFocus?: boolean;
};

export function CommunityAnnotationForm({
  engine,
  community,
  initialName,
  initialNotes,
  onSaved,
  onCancel,
  extraActions,
  autoFocus,
}: Props) {
  const { t } = useTranslation('atlas');
  const [name, setName] = useState(initialName);
  const [notes, setNotes] = useState(initialNotes);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = name !== initialName || notes !== initialNotes;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await setCommunityAnnotation(engine, community, name, notes);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="caf">
      <label className="caf-field">
        <span>{t('panel.community.nameLabel')}</span>
        <input
          type="text"
          value={name}
          autoFocus={autoFocus}
          placeholder={t('panel.community.namePlaceholder') as string}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="caf-field">
        <span>{t('panel.community.notesLabel')}</span>
        <textarea
          rows={3}
          value={notes}
          placeholder={t('panel.community.notesPlaceholder') as string}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>

      {error && <p className="caf-error">{error}</p>}

      <div className="caf-actions">
        <button type="button" className="caf-btn caf-btn--primary" disabled={!dirty || saving} onClick={save}>
          {saving ? t('panel.saving') : t('panel.save')}
        </button>
        {onCancel && (
          <button type="button" className="caf-btn" disabled={saving} onClick={onCancel}>
            {t('panel.cancel', { defaultValue: 'Cancel' }) as string}
          </button>
        )}
        {extraActions}
      </div>
    </div>
  );
}

export default CommunityAnnotationForm;
