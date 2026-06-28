import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ThemeToggle } from './ThemeToggle';
import { LanguageSelector } from './LanguageSelector';

interface StartHeaderProps {
  /** Active main-nav mode. */
  mode: 'search' | 'tree';
  /** Switch the main-nav mode (Search ⇄ Hierarchy). */
  onSelectMode: (mode: 'search' | 'tree') => void;
}

/**
 * StartHeader — Ebene 1+2: the trimmed Home header that
 * appears **only** on the empty start page (Klasse S).
 *
 *   FM-Lab · Object Browser                              [Lang] [Theme]
 *   [ Search | Hierarchy | Graph ]                              [⚙]
 *
 * The Settings gear lives exclusively here in the Main Navi (Ebene 2) — never in
 * the sub-page meta navi (V4).
 */
export function StartHeader({ mode, onSelectMode }: StartHeaderProps) {
  const navigate = useNavigate();
  const { t } = useTranslation(['common', 'nav', 'atlas']);

  return (
    <header className="start-header">
      <div className="app-title-row">
        <h1>{t('common:appTitle')}</h1>
        <div className="app-title-actions">
          <LanguageSelector />
          <ThemeToggle />
        </div>
      </div>

      <nav className="app-mode-tabs start-header__mainnav" role="tablist" aria-label={t('nav:modeTabsAriaLabel') as string}>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'search'}
          className={`tab-button${mode === 'search' ? ' active' : ''}`}
          onClick={() => onSelectMode('search')}
        >
          {t('nav:tabs.search')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'tree'}
          className={`tab-button${mode === 'tree' ? ' active' : ''}`}
          onClick={() => onSelectMode('tree')}
        >
          {t('nav:tabs.tree')}
        </button>
        <button
          type="button"
          className="tab-button"
          onClick={() => navigate('/atlas')}
          title={t('atlas:headerButton_hint') as string}
        >
          {t('atlas:headerButton')}
        </button>

        <button
          type="button"
          className="start-header__settings"
          onClick={() => navigate('/settings')}
          aria-label={t('nav:settings.ariaLabel') as string}
          title={t('nav:settings.title') as string}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </nav>
    </header>
  );
}
