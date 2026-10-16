import type { ViewMode } from '@/stores/useAppStore';

const PLAYGROUND_HANSOL_USER_ID = 'fcc4b438-2696-4e88-a03f-d6f34e73e08f';
const PLAYGROUND_PREVIEW_HANSOL_USER_ID = '1';
const PLAYGROUND_HANSOL_USER_NAME = '배한솔';

export type PlaygroundIdentity = {
  id?: unknown;
  name?: unknown;
} | null | undefined;

export function isExplicitPlaygroundPreviewMode(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  return document.documentElement.dataset.devElectronApi === 'installed'
    && new URLSearchParams(window.location.search).get('preview') === '1';
}

export function canAccessPlayground(
  user: PlaygroundIdentity,
  previewMode = isExplicitPlaygroundPreviewMode(),
): boolean {
  if (typeof user?.id !== 'string' || typeof user.name !== 'string') return false;
  if (user.name.normalize('NFC') !== PLAYGROUND_HANSOL_USER_NAME) return false;
  return user.id === PLAYGROUND_HANSOL_USER_ID
    || (previewMode && user.id === PLAYGROUND_PREVIEW_HANSOL_USER_ID);
}

/**
 * 배경 라이브러리는 v1.142.0부터 팀 전체에 열려 있다: 로그인한 사람이면 누구나 메뉴와 화면을 본다. 고칠 수 있는 사람은
 * 서버가 정한다(관리자와, 관리자가 설정에서 지정한 배경 편집자 — 나머지는 보기와 에피소드별 배경만).
 * 메뉴 노출과 화면 진입이 모두 이 함수를 거치므로, 공개 범위를 바꿀 때는 여기만 바꾼다.
 */
export function canAccessBackgroundLibrary(
  user: PlaygroundIdentity,
  _previewMode = isExplicitPlaygroundPreviewMode(),
): boolean {
  return typeof user?.id === 'string' && user.id.length > 0 && typeof user.name === 'string';
}

const KNOWN_VIEWS = new Set<ViewMode>([
  'dashboard', 'episode', 'scenes', 'assignee', 'team', 'calendar', 'schedule', 'vacation',
  'compositing', 'compositing-revisions', 'retake-hub', 'character-board', 'background-library', 'playground', 'settings',
]);

export function resolveAllowedView(
  value: unknown,
  user: PlaygroundIdentity,
  previewMode = isExplicitPlaygroundPreviewMode(),
): ViewMode {
  if (typeof value !== 'string' || !KNOWN_VIEWS.has(value as ViewMode)) return 'dashboard';
  if (value === 'playground' && !canAccessPlayground(user, previewMode)) return 'dashboard';
  if (value === 'background-library' && !canAccessBackgroundLibrary(user, previewMode)) return 'dashboard';
  return value as ViewMode;
}
