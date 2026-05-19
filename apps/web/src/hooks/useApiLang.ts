import { useTranslation } from 'react-i18next';
import { resolveLanguage } from '@packages/shared/languages';

/**
 * Returns the currently active language code, normalised against the list of
 * supported languages. Components pass the result to API calls (`?lang=`) and
 * to token-fetch hooks so the cache keys correctly partition by language.
 *
 * Subscribing through `useTranslation` triggers a re-render on language
 * change without needing a dedicated React context.
 */
export function useApiLang(): string {
  const { i18n } = useTranslation();
  return resolveLanguage(i18n.language);
}
