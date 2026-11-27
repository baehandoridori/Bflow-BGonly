/**
 * 앱 전체 화면 켜고 끄기 (F11 · 위쪽 끝 '전체 화면 끝내기' 띠, 2026-11-27).
 * 앱에서는 창 자체의 전체 화면 하나만 쓴다 (메인 'window:set-fullscreen'). 화면 속 요소 전체 화면(requestFullscreen)이
 * 걸려 있으면 그것도 함께 푼다 — 두 가지가 엇갈리면 F11 로 빠져나오지 못하던 것이 이번에 고친 문제다.
 * 미리보기 브라우저처럼 창 기능이 없으면 화면 속 전체 화면으로 대신한다.
 */
type FullscreenApi = { setWindowFullscreen?: (want: boolean | 'toggle') => Promise<boolean> } | undefined;
const api = (): FullscreenApi => (window as unknown as { electronAPI?: FullscreenApi }).electronAPI;

async function exitDocumentFullscreen(): Promise<void> {
  if (!document.fullscreenElement) return;
  try { await document.exitFullscreen(); } catch { /* 이미 풀림 */ }
}

/** 전체 화면 끝내기 (창 · 화면 속 둘 다). */
export async function leaveAppFullscreen(): Promise<void> {
  await exitDocumentFullscreen();
  try { await api()?.setWindowFullscreen?.(false); } catch { /* 창이 닫히는 중 */ }
}

/** F11: 전체 화면이면 끝내고, 아니면 창 전체 화면으로. */
export async function toggleAppFullscreen(): Promise<void> {
  if (document.fullscreenElement) { await leaveAppFullscreen(); return; }
  const set = api()?.setWindowFullscreen;
  if (set) { try { await set('toggle'); } catch { /* 창이 닫히는 중 */ } return; }
  try { await document.documentElement.requestFullscreen(); } catch { /* 브라우저가 막음 */ }
}
