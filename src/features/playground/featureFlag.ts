import type { ViewMode } from '@/stores/useAppStore';

export interface PlaygroundPreviewEnv {
  DEV?: boolean;
  VITE_ENABLE_PLAYGROUND_PREVIEW?: string;
}

export function isPlaygroundPreviewEnabled(
  env: PlaygroundPreviewEnv = import.meta.env,
): boolean {
  return env.DEV === true || env.VITE_ENABLE_PLAYGROUND_PREVIEW === 'true';
}

const KNOWN_VIEWS = new Set<ViewMode>([
  'dashboard', 'episode', 'scenes', 'assignee', 'team', 'calendar', 'schedule', 'vacation',
  'compositing', 'compositing-revisions', 'retake-hub', 'character-board', 'playground', 'settings',
]);

export function resolveAllowedView(
  value: unknown,
  env: PlaygroundPreviewEnv = import.meta.env,
): ViewMode {
  if (typeof value !== 'string' || !KNOWN_VIEWS.has(value as ViewMode)) return 'dashboard';
  if (value === 'playground' && !isPlaygroundPreviewEnabled(env)) return 'dashboard';
  return value as ViewMode;
}
