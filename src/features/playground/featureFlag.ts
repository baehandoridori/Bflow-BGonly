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

const KNOWN_VIEWS = new Set<ViewMode>([
  'dashboard', 'episode', 'scenes', 'assignee', 'team', 'calendar', 'schedule', 'vacation',
  'compositing', 'compositing-revisions', 'retake-hub', 'character-board', 'playground', 'settings',
]);

export function resolveAllowedView(
  value: unknown,
  user: PlaygroundIdentity,
  previewMode = isExplicitPlaygroundPreviewMode(),
): ViewMode {
  if (typeof value !== 'string' || !KNOWN_VIEWS.has(value as ViewMode)) return 'dashboard';
  if (value === 'playground' && !canAccessPlayground(user, previewMode)) return 'dashboard';
  return value as ViewMode;
}
