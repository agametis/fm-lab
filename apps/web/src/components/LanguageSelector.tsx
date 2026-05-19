import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, resolveLanguage } from '@packages/shared/languages';
import { LANGUAGE_STORAGE_KEY } from '../i18n';
import './LanguageSelector.css';

/**
 * Header-level language picker. Persists the active language to
 * `localStorage["fmlab.lang"]` and triggers an i18next language change
 * — which causes all `useTranslation()` consumers to re-render and the
 * (lang,*)-keyed token caches to miss naturally on the next fetch.
 */
export function LanguageSelector() {
  const { t, i18n } = useTranslation('common');
  const current = resolveLanguage(i18n.language);

  const onChange = (next: string) => {
    const resolved = resolveLanguage(next);
    void i18n.changeLanguage(resolved);
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, resolved);
    } catch {
      // localStorage unavailable (private mode) — language still applies for the session
    }
  };

  return (
    <label className="language-selector" aria-label={t('language.selectorAriaLabel')}>
      <span className="visually-hidden">{t('language.label')}</span>
      <select
        className="language-selector__select"
        value={current}
        onChange={(e) => onChange(e.target.value)}
        title={t('language.label') as string}
      >
        {SUPPORTED_LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.nativeLabel}
          </option>
        ))}
      </select>
    </label>
  );
}
