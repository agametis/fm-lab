import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ThemeToggle, LanguageSelector } from '../components';
import { useApiLang } from '../hooks';
import { DocsBreadcrumb, type DocsCrumb } from './DocsBreadcrumb';
import './DocsEntryView.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3003';

interface DocsEntryResponse {
  id: string;
  title: string;
  content_html: string | null;
  content_md?: string | null;
  content_url?: string | null;       // Claris: separater HTML-Mirror-Endpoint
  metadata?: Record<string, unknown>;
  online_url?: string | null;
  format: 'html' | 'markdown';
  breadcrumb: DocsCrumb[];
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
  meta?: { lang?: string; id?: string; category?: string; references?: boolean };
}

/**
 * DocsEntryView — Function-Volltext-Route /docs/:set/:category/:function
 *
 * Layout (PRD §2):
 *   ├─ Header: Hauptnavigation (Zurück), Sprachumschaltung, Darkmode
 *   ├─ Navigationszeile: Breadcrumb (Docs → Set → Category → Function)
 *   ├─ Titel
 *   ├─ Metadaten (Docset, Category, Online-Link, Link zu Code-Referenzen)
 *   ├─ Content (HTML — Markdown wird im Backend vorher konvertiert)
 *   └─ Footer (Quelle / Lizenz / Edit-Link bei Wiki-basierten Sets)
 *
 * Sprachfallback (PRD §6.4): URL ?lang= wird durchgereicht. Backend setzt
 * X-Docs-Lang-Fallback: <code>, wenn die angeforderte Sprache nicht verfügbar
 * ist; wir zeigen dann einen dezenten Hinweis.
 */
export const DocsEntryView: React.FC = () => {
  const { t, i18n } = useTranslation(['nav', 'errors']);
  const { set, category, fn } = useParams<{ set: string; category: string; fn: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  // i18n ist die Source-of-Truth — der LanguageSelector im Header setzt
  // `i18n.language`, und alle abhängigen Hooks/Effekte (Inhalts-Fetch +
  // Backend-Lang-Param) reagieren darauf. Der URL-Param `?lang=` ist nur
  // Deep-Linking-Zustand: er wird beim Mount nach i18n synchronisiert (falls
  // gesetzt) und danach bei jedem Sprachwechsel als URL-Update gespiegelt.
  const lang = useApiLang();

  // Deep-Link-Sync: URL `?lang=de` beim Initial-Mount nach i18n übernehmen.
  // Verhindert, dass `/docs/...?lang=de` in englischer UI hängt, wenn der
  // localStorage-State EN sagt. Läuft nur einmal — danach übernimmt i18n.
  useEffect(() => {
    const urlLang = searchParams.get('lang');
    if (urlLang && urlLang !== lang) {
      void i18n.changeLanguage(urlLang);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // URL ↔ i18n: bei Sprachwechsel den URL-Param mitschreiben, damit Deep-
  // Links + Share-Links die gewählte Sprache transportieren.
  useEffect(() => {
    const urlLang = searchParams.get('lang');
    if (urlLang !== lang) {
      const next = new URLSearchParams(searchParams);
      next.set('lang', lang);
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  const [entry, setEntry] = useState<DocsEntryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [langFallback, setLangFallback] = useState<string | null>(null);
  const [externalHtml, setExternalHtml] = useState<string | null>(null);

  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!set || !category || !fn) return;
    let cancelled = false;
    // Reset alle Render-Zustände sofort, damit Breadcrumb/Titel/Content beim
    // Wechsel zwischen zwei Doc-Pages nicht den alten Eintrag stehen lassen,
    // während im Hintergrund die neuen Daten geladen werden.
    setEntry(null);
    setLoading(true);
    setError(null);
    setLangFallback(null);
    setExternalHtml(null);

    const url = `${API_BASE}/api/docs/${encodeURIComponent(set)}/categories/${encodeURIComponent(category)}/${encodeURIComponent(fn)}?lang=${encodeURIComponent(lang)}`;

    (async () => {
      try {
        const res = await fetch(url);
        const fallback = res.headers.get('X-Docs-Lang-Fallback');
        if (fallback && !cancelled) setLangFallback(fallback);
        const json = (await res.json()) as ApiEnvelope<DocsEntryResponse>;
        if (cancelled) return;
        if (!res.ok || !json.success || !json.data) {
          setError(json.error?.message || `HTTP ${res.status}`);
          setEntry(null);
          return;
        }
        // Backend rendert content_html mit absoluten /api/... Pfaden. Im
        // Vite-Dev-Setup hängt /api an Port 5173 → 404. Wir prefixen alle
        // /api/-URLs mit dem API-Base, damit <img src> und ähnliches die
        // tatsächliche API treffen. Im Produktiv-Setup (gleicher Origin) hat
        // VITE_API_URL kein Schema und das wird transparent leer ersetzt.
        const data = { ...json.data };
        if (API_BASE && data.content_html) {
          data.content_html = data.content_html.replace(/="\/api\//g, `="${API_BASE}/api/`);
        }
        setEntry(data);

        // Claris-Pfad: getEntry liefert nur `content_url`, der HTML-Body kommt
        // über den bestehenden /api/reference/help-Mirror. Nachladen.
        if (!data.content_html && data.content_url) {
          const htmlRes = await fetch(`${API_BASE}${data.content_url}`);
          if (!cancelled && htmlRes.ok) {
            const html = await htmlRes.text();
            // Auch hier relative /api-Pfade auf API-Base umlenken.
            const rewritten = API_BASE
              ? html.replace(/="\/api\//g, `="${API_BASE}/api/`)
              : html;
            setExternalHtml(rewritten);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message || 'Fetch failed');
          setEntry(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [set, category, fn, lang]);

  // Wrapper für sicheres Scrollen zu einem Header: probiert zwei RAFs +
  // einen Mikro-Timeout, weil das Content-DOM nach `dangerouslySetInnerHTML`
  // erst nach dem nächsten Browser-Paint ausgemessen werden kann.
  const scrollToAnchor = useCallback((hash: string) => {
    const id = hash.replace(/^#/, '');
    if (!id) return;
    let tries = 0;
    const attempt = () => {
      const el = contentRef.current?.querySelector(`#${CSS.escape(id)}`) as HTMLElement | null;
      if (el) {
        // Instant scrollen (kein Smooth-Scroll), damit der Sprung in jedem
        // Browser-Engine sofort sichtbar ist — der Container hat sonst
        // `scroll-behavior: smooth` via .docs-content geerbt.
        el.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'start' });
        return;
      }
      if (tries++ < 5) requestAnimationFrame(attempt);
    };
    requestAnimationFrame(attempt);
  }, []);

  // In-Document-Anchor-Sprünge nach dem Rendern: wenn ein #hash in der URL
  // ist, dort hin scrollen sobald der Content im DOM hängt.
  useEffect(() => {
    if (!entry || loading) return;
    if (!location.hash) return;
    scrollToAnchor(location.hash);
  }, [entry, loading, location.hash, scrollToAnchor]);

  // Klicks auf interne Links (z.B. /docs/fmide/...) sollen durch React-Router
  // gehen, nicht zu einem Full-Page-Reload führen.
  const handleContentClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest('a') as HTMLAnchorElement | null;
    if (!anchor) return;
    const href = anchor.getAttribute('href') || '';
    // Externe + API-Asset-Links normal öffnen
    if (/^(?:https?:|mailto:|tel:|fmp:|fmps:)/i.test(href)) return;
    if (href.startsWith('/api/')) return;
    // In-document anchor: URL aktualisieren UND direkt scrollen. Wir warten
    // nicht auf den useEffect, weil location.hash-Updates innerhalb der
    // gleichen Route in React-Router gelegentlich kein Re-Render auslösen.
    if (href.startsWith('#')) {
      e.preventDefault();
      navigate(`${location.pathname}${location.search}${href}`, { replace: false });
      scrollToAnchor(href);
      return;
    }
    // App-interne Route → SPA-Navigation
    if (href.startsWith('/')) {
      e.preventDefault();
      navigate(href);
    }
  }, [navigate, location.pathname, location.search, scrollToAnchor]);

  const handleBack = () => {
    if (location.key !== 'default') navigate(-1);
    else navigate('/');
  };

  const renderedHtml = externalHtml ?? entry?.content_html ?? '';

  return (
    <div className="app docs-entry" role="main" aria-labelledby="docs-entry-title">
      {/* Header */}
      <div className="app-title-row">
        <h1>{t('nav:home.title') as string}</h1>
        <div className="app-title-actions">
          <LanguageSelector />
          <ThemeToggle />
        </div>
      </div>

      {/* Navigation row */}
      <div className="docs-entry__nav">
        <button onClick={handleBack} className="back-button" aria-label={t('nav:detailView.backAria') as string}>
          &larr; {t('nav:detailView.backLabel')}
        </button>
        {entry?.breadcrumb && entry.breadcrumb.length > 0 && (
          <DocsBreadcrumb items={entry.breadcrumb} />
        )}
      </div>

      {/* Language fallback hint */}
      {langFallback && (
        <div className="docs-entry__lang-fallback" role="status">
          {t('nav:docs.langFallback', { lang: langFallback })}
        </div>
      )}

      {/* Title */}
      {entry?.title && (
        <h2 id="docs-entry-title" className="docs-entry__title">{entry.title}</h2>
      )}

      {/* Metadata strip */}
      {entry && (
        <div className="docs-entry__meta">
          {entry.breadcrumb?.find(c => c.kind === 'docset') && (
            <span className="docs-entry__meta-item">
              <span className="docs-entry__meta-label">{t('nav:docs.docset')}:</span>
              <span>{entry.breadcrumb.find(c => c.kind === 'docset')?.label}</span>
            </span>
          )}
          {entry.breadcrumb?.find(c => c.kind === 'category') && (
            <span className="docs-entry__meta-item">
              <span className="docs-entry__meta-label">{t('nav:docs.category')}:</span>
              <span>{entry.breadcrumb.find(c => c.kind === 'category')?.label}</span>
            </span>
          )}
          {entry.online_url && (
            <a
              href={entry.online_url}
              target="_blank"
              rel="noopener noreferrer"
              className="docs-entry__meta-link"
            >
              {t('nav:docs.openOnline')}
            </a>
          )}
        </div>
      )}

      {/* Content */}
      {loading && <div className="docs-entry__loading">{t('nav:list.loading')}</div>}
      {error && (
        <div className="docs-entry__error error-message" role="alert">
          {error}
        </div>
      )}
      {!loading && !error && renderedHtml && (
        <article
          ref={contentRef}
          className="docs-content"
          onClick={handleContentClick}
          // Inhalt ist serverseitig sanitized (siehe rest-api/src/services/docs-content.js).
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
      )}
      {!loading && !error && !renderedHtml && entry && (
        <div className="docs-entry__empty">
          {t('nav:docs.noContent')}
        </div>
      )}

      {/* Footer
       * Inhalt nach PRD §9 Open Point #2: Quellen-Hinweis, "Im Browser öffnen"
       * und ein optionaler Edit-Link bei Wiki-basierten Sets. Den Edit-Link
       * bauen wir aus der Online-URL nach GitHub-Wiki-Konvention
       * (`<wiki>/_edit/<slug>`). Andere Quellen liefern keinen Edit-Link.
       */}
      {entry && (
        <footer className="docs-entry__footer">
          {entry.metadata && typeof entry.metadata === 'object' && 'source_file' in entry.metadata && (
            <span className="docs-entry__footer-source">
              {t('nav:docs.source')}: <code>{String((entry.metadata as Record<string, unknown>).source_file)}</code>
            </span>
          )}
          <span className="docs-entry__footer-actions">
            {entry.online_url && set === 'fmide' && (
              <a
                href={entry.online_url.replace(/\/wiki\//, '/wiki/_edit/')}
                target="_blank"
                rel="noopener noreferrer"
                className="docs-entry__footer-link"
              >
                {t('nav:docs.edit')}
              </a>
            )}
            {entry.online_url && (
              <a
                href={entry.online_url}
                target="_blank"
                rel="noopener noreferrer"
                className="docs-entry__footer-link"
              >
                {t('nav:docs.openInBrowser')} ↗
              </a>
            )}
          </span>
        </footer>
      )}
    </div>
  );
};
