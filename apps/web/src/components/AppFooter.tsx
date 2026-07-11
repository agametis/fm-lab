import './AppFooter.css';

/**
 * AppFooter — discreet brand/license line shown only on the start page and the
 * settings page (not on the neutral sub-pages). A thin separator rule above,
 * then a centered, small, muted line: name · tagline · license · repo link.
 */
export function AppFooter() {
  return (
    <footer className="app-footer">
      <span className="app-footer__brand">FM-Lab</span>
      {' · '}
      Open Source framework for agentic FileMaker development
      {' · '}
      MIT License
      {' · '}
      <a
        className="app-footer__link"
        href="https://github.com/marcel-more/fm-lab"
        target="_blank"
        rel="noopener noreferrer"
      >
        GitHub Repo
      </a>
    </footer>
  );
}
