/**
 * 미리보기 모드 여부 — 모듈 평가 시 한 번만 계산해 캐시.
 *
 * 활성 조건 (둘 다 만족):
 * - import.meta.env.DEV === true       : vite dev server. production build 에서는 정적으로 false 치환됨
 * - URL 쿼리 ?preview=1 (엄격 매치)    : 의도되지 않은 진입 차단. ?preview=true / ?preview 단독은 무시
 *
 * URL 은 페이지 라이프사이클 중 변하지 않으므로 매 호출 재계산 불필요.
 * 안정적인 boolean 참조 값을 반환해 useEffect 의존성에도 안전.
 */
const PREVIEW_MODE_FLAG: boolean = (() => {
  if (!import.meta.env.DEV) return false;
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('preview') === '1';
})();

export function isPreviewMode(): boolean {
  return PREVIEW_MODE_FLAG;
}
