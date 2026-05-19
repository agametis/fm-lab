/**
 * i18next initialisation for the web frontend.
 *
 * Resolution order for the initial language:
 *   1. `localStorage["fmlab.lang"]` (user pick from the LanguageSelector)
 *   2. Server-supplied default from `/api/system/config` (set later via `applyServerLanguage`)
 *   3. Browser `navigator.language` reduced to a supported code
 *   4. `DEFAULT_LANGUAGE` ('en')
 *
 * English is always the fallback — every supported language is allowed to be
 * partial; missing keys fall back to the English master.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGE_CODES,
  resolveLanguage,
} from '@packages/shared/languages';

import enCommon    from './locales/en/common.json';
import enNav       from './locales/en/nav.json';
import enDetail    from './locales/en/detail.json';
import enErrors    from './locales/en/errors.json';
import enTypes     from './locales/en/types.json';
import enDashboard from './locales/en/dashboard.json';

import deCommon    from './locales/de/common.json';
import deNav       from './locales/de/nav.json';
import deDetail    from './locales/de/detail.json';
import deErrors    from './locales/de/errors.json';
import deTypes     from './locales/de/types.json';
import deDashboard from './locales/de/dashboard.json';

import esCommon    from './locales/es/common.json';
import esNav       from './locales/es/nav.json';
import esDetail    from './locales/es/detail.json';
import esErrors    from './locales/es/errors.json';
import esTypes     from './locales/es/types.json';
import esDashboard from './locales/es/dashboard.json';

import frCommon    from './locales/fr/common.json';
import frNav       from './locales/fr/nav.json';
import frDetail    from './locales/fr/detail.json';
import frErrors    from './locales/fr/errors.json';
import frTypes     from './locales/fr/types.json';
import frDashboard from './locales/fr/dashboard.json';

import itCommon    from './locales/it/common.json';
import itNav       from './locales/it/nav.json';
import itDetail    from './locales/it/detail.json';
import itErrors    from './locales/it/errors.json';
import itTypes     from './locales/it/types.json';
import itDashboard from './locales/it/dashboard.json';

import nlCommon    from './locales/nl/common.json';
import nlNav       from './locales/nl/nav.json';
import nlDetail    from './locales/nl/detail.json';
import nlErrors    from './locales/nl/errors.json';
import nlTypes     from './locales/nl/types.json';
import nlDashboard from './locales/nl/dashboard.json';

import ptCommon    from './locales/pt/common.json';
import ptNav       from './locales/pt/nav.json';
import ptDetail    from './locales/pt/detail.json';
import ptErrors    from './locales/pt/errors.json';
import ptTypes     from './locales/pt/types.json';
import ptDashboard from './locales/pt/dashboard.json';

import svCommon    from './locales/sv/common.json';
import svNav       from './locales/sv/nav.json';
import svDetail    from './locales/sv/detail.json';
import svErrors    from './locales/sv/errors.json';
import svTypes     from './locales/sv/types.json';
import svDashboard from './locales/sv/dashboard.json';

import jaCommon    from './locales/ja/common.json';
import jaNav       from './locales/ja/nav.json';
import jaDetail    from './locales/ja/detail.json';
import jaErrors    from './locales/ja/errors.json';
import jaTypes     from './locales/ja/types.json';
import jaDashboard from './locales/ja/dashboard.json';

import koCommon    from './locales/ko/common.json';
import koNav       from './locales/ko/nav.json';
import koDetail    from './locales/ko/detail.json';
import koErrors    from './locales/ko/errors.json';
import koTypes     from './locales/ko/types.json';
import koDashboard from './locales/ko/dashboard.json';

import zhHansCommon    from './locales/zh-Hans/common.json';
import zhHansNav       from './locales/zh-Hans/nav.json';
import zhHansDetail    from './locales/zh-Hans/detail.json';
import zhHansErrors    from './locales/zh-Hans/errors.json';
import zhHansTypes     from './locales/zh-Hans/types.json';
import zhHansDashboard from './locales/zh-Hans/dashboard.json';

export const LANGUAGE_STORAGE_KEY = 'fmlab.lang';

export const I18N_NAMESPACES = ['common', 'nav', 'detail', 'errors', 'types', 'dashboard'] as const;

const resources = {
  en: {
    common:    enCommon,
    nav:       enNav,
    detail:    enDetail,
    errors:    enErrors,
    types:     enTypes,
    dashboard: enDashboard,
  },
  de: {
    common:    deCommon,
    nav:       deNav,
    detail:    deDetail,
    errors:    deErrors,
    types:     deTypes,
    dashboard: deDashboard,
  },
  es: {
    common:    esCommon,
    nav:       esNav,
    detail:    esDetail,
    errors:    esErrors,
    types:     esTypes,
    dashboard: esDashboard,
  },
  fr: {
    common:    frCommon,
    nav:       frNav,
    detail:    frDetail,
    errors:    frErrors,
    types:     frTypes,
    dashboard: frDashboard,
  },
  it: {
    common:    itCommon,
    nav:       itNav,
    detail:    itDetail,
    errors:    itErrors,
    types:     itTypes,
    dashboard: itDashboard,
  },
  nl: {
    common:    nlCommon,
    nav:       nlNav,
    detail:    nlDetail,
    errors:    nlErrors,
    types:     nlTypes,
    dashboard: nlDashboard,
  },
  pt: {
    common:    ptCommon,
    nav:       ptNav,
    detail:    ptDetail,
    errors:    ptErrors,
    types:     ptTypes,
    dashboard: ptDashboard,
  },
  sv: {
    common:    svCommon,
    nav:       svNav,
    detail:    svDetail,
    errors:    svErrors,
    types:     svTypes,
    dashboard: svDashboard,
  },
  ja: {
    common:    jaCommon,
    nav:       jaNav,
    detail:    jaDetail,
    errors:    jaErrors,
    types:     jaTypes,
    dashboard: jaDashboard,
  },
  ko: {
    common:    koCommon,
    nav:       koNav,
    detail:    koDetail,
    errors:    koErrors,
    types:     koTypes,
    dashboard: koDashboard,
  },
  'zh-Hans': {
    common:    zhHansCommon,
    nav:       zhHansNav,
    detail:    zhHansDetail,
    errors:    zhHansErrors,
    types:     zhHansTypes,
    dashboard: zhHansDashboard,
  },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: SUPPORTED_LANGUAGE_CODES as string[],
    nonExplicitSupportedLngs: true,
    ns: I18N_NAMESPACES as unknown as string[],
    defaultNS: 'common',
    interpolation: { escapeValue: false }, // React already escapes
    detection: {
      order:  ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ['localStorage'],
    },
    returnNull: false,
  });

/**
 * Apply a server-supplied default language only when the user has not yet
 * picked one explicitly (no localStorage entry). Lets local installs ship
 * their own default (e.g. `de`) without overriding a manual selection.
 */
export function applyServerLanguage(serverDefault: string | null | undefined): void {
  if (!serverDefault) return;
  if (typeof window === 'undefined') return;
  const userPick = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (userPick) return;
  const resolved = resolveLanguage(serverDefault);
  if (resolved !== i18n.language) {
    void i18n.changeLanguage(resolved);
  }
}

export default i18n;
