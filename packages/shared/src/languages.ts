/**
 * Supported UI / API languages — single source of truth.
 *
 * Consumers:
 *   - Frontend i18next init (`supportedLngs`, `fallbackLng`)
 *   - Language selector dropdown
 *   - REST-API Joi validator for the `?lang=` query param
 *   - Dashboard locale resolver fallback chain
 *
 * English is the canonical language: every fallback eventually lands on `en`.
 */

export const DEFAULT_LANGUAGE = 'en' as const;

export interface LanguageDescriptor {
  /** BCP-47-ish language tag matching directory names under `i18n/locales/<code>/`. */
  code: string;
  /** English-language label (used in the dropdown when running in English). */
  label: string;
  /** Native-language label (always shown alongside `label`). */
  nativeLabel: string;
}

export const SUPPORTED_LANGUAGES: readonly LanguageDescriptor[] = [
  { code: 'en',      label: 'English',              nativeLabel: 'English'    },
  { code: 'de',      label: 'German',               nativeLabel: 'Deutsch'    },
  { code: 'es',      label: 'Spanish',              nativeLabel: 'Español'    },
  { code: 'fr',      label: 'French',               nativeLabel: 'Français'   },
  { code: 'it',      label: 'Italian',              nativeLabel: 'Italiano'   },
  { code: 'nl',      label: 'Dutch',                nativeLabel: 'Nederlands' },
  { code: 'pt',      label: 'Portuguese',           nativeLabel: 'Português'  },
  { code: 'sv',      label: 'Swedish',              nativeLabel: 'Svenska'    },
  { code: 'ja',      label: 'Japanese',             nativeLabel: '日本語'      },
  { code: 'ko',      label: 'Korean',               nativeLabel: '한국어'      },
  { code: 'zh-Hans', label: 'Chinese (Simplified)', nativeLabel: '简体中文'    },
] as const;

export const SUPPORTED_LANGUAGE_CODES: readonly string[] =
  SUPPORTED_LANGUAGES.map((l) => l.code);

export type SupportedLanguageCode = typeof SUPPORTED_LANGUAGES[number]['code'];

/**
 * Normalise an arbitrary input string to a supported language code, or return
 * `DEFAULT_LANGUAGE` if no match exists. Accepts case-insensitive input and
 * resolves things like `de-DE` → `de`.
 */
export function resolveLanguage(input: string | null | undefined): string {
  if (!input) return DEFAULT_LANGUAGE;
  const lower = input.toLowerCase();
  for (const lang of SUPPORTED_LANGUAGES) {
    if (lang.code.toLowerCase() === lower) return lang.code;
  }
  const primary = lower.split('-')[0];
  for (const lang of SUPPORTED_LANGUAGES) {
    if (lang.code.toLowerCase().startsWith(primary)) return lang.code;
  }
  return DEFAULT_LANGUAGE;
}
