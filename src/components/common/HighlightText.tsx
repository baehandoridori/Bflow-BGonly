/** 검색 하이라이트 CSS — 글로우 애니메이션 */
const SEARCH_HIGHLIGHT_CSS = `
@keyframes search-glow-pulse {
  0%   { box-shadow: 0 0 3px 1px rgba(var(--color-accent), 0.5), 0 0 8px 2px rgba(var(--color-accent), 0.3); }
  50%  { box-shadow: 0 0 6px 2px rgba(var(--color-accent), 0.7), 0 0 14px 4px rgba(var(--color-accent), 0.4); }
  100% { box-shadow: 0 0 3px 1px rgba(var(--color-accent), 0.5), 0 0 8px 2px rgba(var(--color-accent), 0.3); }
}
.search-highlight-text {
  background-color: rgba(var(--color-accent), 0.25);
  color: rgba(var(--color-accent), 1);
  font-weight: 600;
  padding: 1px 3px;
  border-radius: 3px;
  animation: search-glow-pulse 1.5s ease-in-out infinite;
  text-decoration: underline;
  text-decoration-color: rgba(var(--color-accent), 0.5);
  text-underline-offset: 2px;
}
`;
let searchHighlightCssInjected = false;
function ensureSearchHighlightCss() {
  if (searchHighlightCssInjected) return;
  const el = document.createElement('style');
  el.textContent = SEARCH_HIGHLIGHT_CSS;
  document.head.appendChild(el);
  searchHighlightCssInjected = true;
}

/** 검색어 하이라이트 — CSS 클래스 기반 글로우 */
export function HighlightText({ text, query }: { text: string; query?: string }) {
  if (!query || !text) return <>{text}</>;
  const q = query.toLowerCase();
  const idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return <>{text}</>;
  ensureSearchHighlightCss();
  return (
    <>
      {text.slice(0, idx)}
      <span className="search-highlight-text">
        {text.slice(idx, idx + query.length)}
      </span>
      {text.slice(idx + query.length)}
    </>
  );
}
