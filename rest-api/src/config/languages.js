/**
 * Supported UI / API languages for the REST API (mirror of
 * `packages/shared/src/languages.ts`).
 *
 * Kept in sync manually because the REST API runs in CommonJS while the
 * shared package emits ESM — duplicating the small list is cheaper than
 * juggling dual builds. If a language is added here, also add it to
 * `packages/shared/src/languages.ts`.
 */

const DEFAULT_LANGUAGE = 'en';

const SUPPORTED_LANGUAGES = Object.freeze([
  Object.freeze({ code: 'en',      label: 'English',              nativeLabel: 'English'    }),
  Object.freeze({ code: 'de',      label: 'German',               nativeLabel: 'Deutsch'    }),
  Object.freeze({ code: 'es',      label: 'Spanish',              nativeLabel: 'Español'    }),
  Object.freeze({ code: 'fr',      label: 'French',               nativeLabel: 'Français'   }),
  Object.freeze({ code: 'it',      label: 'Italian',              nativeLabel: 'Italiano'   }),
  Object.freeze({ code: 'nl',      label: 'Dutch',                nativeLabel: 'Nederlands' }),
  Object.freeze({ code: 'pt',      label: 'Portuguese',           nativeLabel: 'Português'  }),
  Object.freeze({ code: 'sv',      label: 'Swedish',              nativeLabel: 'Svenska'    }),
  Object.freeze({ code: 'ja',      label: 'Japanese',             nativeLabel: '日本語'      }),
  Object.freeze({ code: 'ko',      label: 'Korean',               nativeLabel: '한국어'      }),
  Object.freeze({ code: 'zh-Hans', label: 'Chinese (Simplified)', nativeLabel: '简体中文'    }),
]);

const SUPPORTED_LANGUAGE_CODES = Object.freeze(SUPPORTED_LANGUAGES.map((l) => l.code));

function resolveLanguage(input) {
  if (!input) return DEFAULT_LANGUAGE;
  const lower = String(input).toLowerCase();
  for (const lang of SUPPORTED_LANGUAGES) {
    if (lang.code.toLowerCase() === lower) return lang.code;
  }
  const primary = lower.split('-')[0];
  for (const lang of SUPPORTED_LANGUAGES) {
    if (lang.code.toLowerCase().startsWith(primary)) return lang.code;
  }
  return DEFAULT_LANGUAGE;
}

module.exports = {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  SUPPORTED_LANGUAGE_CODES,
  resolveLanguage,
};
