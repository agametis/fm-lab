import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchHidden, setNodeVisibility, type HiddenNode } from '../lib/annotationsApi';
import { getTypeColor } from '../lib/graphColors';

/**
 * „Ausgeblendete verwalten" — Recovery-Liste für vom Nutzer ausgeblendete Knoten.
 * Unverzichtbar im `hide`-Modus, wo ausgeblendete Knoten im Graphen nicht mehr
 * erreichbar sind. Listet alle Hidden-Nodes (GET /api/annotations/hidden) und
 * blendet sie auf Klick wieder ein; `onChanged()` refetcht die Atlas-Ebene.
 */

type Props = { onClose: () => void; onChanged: () => void };

export default function AtlasHiddenManager({ onClose, onChanged }: Props) {
  const { t } = useTranslation('atlas');
  const [items, setItems] = useState<HiddenNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchHidden()
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    load();
    return () => window.removeEventListener('keydown', onKey);
  }, [load, onClose]);

  const restore = async (n: HiddenNode) => {
    const key = `${n.uuid}::${n.file ?? ''}`;
    setBusy(key);
    try {
      await setNodeVisibility(n.uuid, n.file, true);
      setItems((prev) => (prev ? prev.filter((x) => `${x.uuid}::${x.file ?? ''}` !== key) : prev));
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="atlas-panel-backdrop" onClick={onClose}>
      <div className="atlas-panel atlas-hiddenlist" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="atlas-panel-close" aria-label={t('panel.close') as string} onClick={onClose}>×</button>
        <h3 className="atlas-panel-title">{t('hidden.manage')}</h3>

        {error && <p className="atlas-panel-error">{error}</p>}
        {items && items.length === 0 && <p className="atlas-panel-meta">{t('hidden.empty')}</p>}

        {items && items.length > 0 && (
          <ul className="atlas-hiddenlist-items">
            {items.map((n) => (
              <li key={`${n.uuid}::${n.file ?? ''}`} className="atlas-hiddenlist-row">
                {n.type && <span className="atlas-typeswatch" style={{ background: getTypeColor(n.type) }} />}
                <span className="atlas-hiddenlist-label" title={n.label}>{n.label}</span>
                {n.file && <span className="atlas-hiddenlist-file">{n.file}</span>}
                <button
                  type="button"
                  className="atlas-panel-btn"
                  disabled={busy === `${n.uuid}::${n.file ?? ''}`}
                  onClick={() => restore(n)}
                >
                  {t('hidden.restore')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
