import type { ViewMode } from '@/stores/useAppStore';

const PLAYGROUND_ALLOWED_USER_NAMES = new Set(['배한솔']);

export function canAccessPlayground(userName: unknown): boolean {
  return typeof userName === 'string' && PLAYGROUND_ALLOWED_USER_NAMES.has(userName);
}

const KNOWN_VIEWS = new Set<ViewMode>([
  'dashboard', 'episode', 'scenes', 'assignee', 'team', 'calendar', 'schedule', 'vacation',
  'compositing', 'compositing-revisions', 'retake-hub', 'character-board', 'playground', 'settings',
]);

export function resolveAllowedView(
  value: unknown,
  userName: unknown,
): ViewMode {
  if (typeof value !== 'string' || !KNOWN_VIEWS.has(value as ViewMode)) return 'dashboard';
  if (value === 'playground' && !canAccessPlayground(userName)) return 'dashboard';
  return value as ViewMode;
}
