import type { Episode } from '../types';

export interface NotificationSceneMetadata {
  sceneId?: string;
  sceneName?: string;
  sheetName?: string;
  partId?: string;
  commentSceneId?: string;
  commentPartId?: string;
}

export interface NotificationSceneTarget {
  episodeNumber: number;
  partId: string;
  sheetName: string;
  sceneUuid?: string;
  sceneName: string;
}

type NotificationShortcutType =
  | 'comment'
  | 'mention'
  | 'revision'
  | 'scene_change'
  | 'acting_feedback'
  | 'scene_assignment';

const SCENE_SHORTCUT_TYPES = new Set<string>([
  'comment',
  'mention',
  'revision',
  'scene_change',
  'acting_feedback',
  'scene_assignment',
]);

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function buildTarget(
  ep: Episode,
  part: Episode['parts'][number],
  scene: Episode['parts'][number]['scenes'][number],
): NotificationSceneTarget {
  return {
    episodeNumber: ep.episodeNumber,
    partId: part.partId,
    sheetName: part.sheetName,
    sceneUuid: scene.id,
    sceneName: scene.sceneId,
  };
}

function findBySceneUuid(episodes: Episode[], sceneUuid: string): NotificationSceneTarget | null {
  for (const ep of episodes) {
    for (const part of ep.parts) {
      const scene = part.scenes.find((candidate) => candidate.id === sceneUuid);
      if (scene) return buildTarget(ep, part, scene);
    }
  }
  return null;
}

function findByCommentStorage(
  episodes: Episode[],
  partUuid: string | undefined,
  sceneNo: string | undefined,
): NotificationSceneTarget | null {
  if (!partUuid || !sceneNo) return null;
  const numericNo = Number(sceneNo);
  if (!Number.isFinite(numericNo)) return null;

  for (const ep of episodes) {
    for (const part of ep.parts) {
      if (part.id !== partUuid) continue;
      const scene = part.scenes.find((candidate) => Number(candidate.no) === numericNo);
      if (scene) return buildTarget(ep, part, scene);
    }
  }
  return null;
}

function findBySheetContext(
  episodes: Episode[],
  sheetName: string | undefined,
  sceneNoOrName: string | undefined,
): NotificationSceneTarget | null {
  if (!sheetName || !sceneNoOrName) return null;
  const numericNo = Number(sceneNoOrName);
  const normalizedName = sceneNoOrName.trim().toLowerCase();

  for (const ep of episodes) {
    for (const part of ep.parts) {
      if (part.sheetName !== sheetName) continue;
      const scene = part.scenes.find((candidate) => {
        if (Number.isFinite(numericNo) && Number(candidate.no) === numericNo) return true;
        return candidate.sceneId.trim().toLowerCase() === normalizedName;
      });
      if (scene) return buildTarget(ep, part, scene);
    }
  }
  return null;
}

function parseSceneKey(sceneKey: string): { episodeNumber: number; partId: string; sceneName: string } | null {
  const parts = sceneKey.split(':');
  if (parts.length < 3) return null;
  const episodeNumber = Number(parts[0].replace(/\D/g, ''));
  const partId = parts[1]?.trim();
  const sceneName = parts.slice(2).join(':').trim();
  if (!Number.isFinite(episodeNumber) || !partId || !sceneName) return null;
  return { episodeNumber, partId, sceneName };
}

function findBySceneKey(episodes: Episode[], sceneKey: string | undefined): NotificationSceneTarget | null {
  if (!sceneKey || !sceneKey.includes(':')) return null;
  const parsed = parseSceneKey(sceneKey);
  if (!parsed) return null;
  const normalizedScene = parsed.sceneName.toLowerCase();
  const normalizedPart = parsed.partId.toLowerCase();

  for (const ep of episodes) {
    if (ep.episodeNumber !== parsed.episodeNumber) continue;
    for (const part of ep.parts) {
      if (part.partId.trim().toLowerCase() !== normalizedPart) continue;
      const scene = part.scenes.find((candidate) => candidate.sceneId.trim().toLowerCase() === normalizedScene);
      if (scene) return buildTarget(ep, part, scene);
    }
  }
  return null;
}

function findUniqueBySceneName(episodes: Episode[], sceneName: string | undefined): NotificationSceneTarget | null {
  if (!sceneName || sceneName.includes(':')) return null;
  const normalized = sceneName.trim().toLowerCase();
  const matches: NotificationSceneTarget[] = [];

  for (const ep of episodes) {
    for (const part of ep.parts) {
      const scene = part.scenes.find((candidate) => candidate.sceneId.trim().toLowerCase() === normalized);
      if (scene) matches.push(buildTarget(ep, part, scene));
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

export function hasSceneTargetHint(metadata?: NotificationSceneMetadata | Record<string, unknown> | null): boolean {
  if (!metadata) return false;
  return Boolean(
    asString(metadata.sceneId) ||
    asString(metadata.sceneName) ||
    asString(metadata.sheetName) ||
    asString(metadata.commentPartId) ||
    asString(metadata.commentSceneId),
  );
}

export function shouldShowSceneShortcut(
  type: NotificationShortcutType | string,
  metadata?: NotificationSceneMetadata | Record<string, unknown> | null,
): boolean {
  return SCENE_SHORTCUT_TYPES.has(type) || hasSceneTargetHint(metadata);
}

export function getSceneShortcutVisibilityClass(showShortcut: boolean): string {
  return showShortcut
    ? 'opacity-100'
    : 'opacity-0 group-hover/noti:opacity-100 group-focus-within/noti:opacity-100';
}

export function resolveNotificationSceneTarget(
  metadata: NotificationSceneMetadata | Record<string, unknown> | undefined | null,
  episodes: Episode[],
): NotificationSceneTarget | null {
  if (!metadata || episodes.length === 0) return null;

  const sceneUuid = asString(metadata.sceneId);
  const sceneName = asString(metadata.sceneName);
  const sheetName = asString(metadata.sheetName);
  const commentSceneId = asString(metadata.commentSceneId);
  const commentPartId = asString(metadata.commentPartId);

  return (
    (sceneUuid ? findBySceneUuid(episodes, sceneUuid) : null) ||
    findByCommentStorage(episodes, commentPartId, commentSceneId) ||
    findBySheetContext(episodes, sheetName, commentSceneId ?? sceneName) ||
    findBySceneKey(episodes, sceneName) ||
    findUniqueBySceneName(episodes, sceneName) ||
    (sceneUuid ? findUniqueBySceneName(episodes, sceneUuid) : null)
  );
}
