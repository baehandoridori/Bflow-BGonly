import { normalizeSceneIdKey } from './sceneIdKey.ts';

export type RevisionSceneKeyOptions = {
  siblingSceneIds?: readonly (string | null | undefined)[];
};

function normalizeSceneIdForRevision(sceneId: string, part: string): string {
  return normalizeSceneIdKey(sceneId, part);
}

export function buildDistinctRevisionSceneId(sceneId: string | null | undefined): string {
  const normalized = (sceneId || '').trim().toLowerCase();
  return normalized ? `raw-${encodeURIComponent(normalized)}` : '';
}

export function buildRevisionSceneIdForScene(
  sceneId: string,
  part: string,
  options: RevisionSceneKeyOptions = {},
): string {
  const rawSceneId = sceneId.trim();
  if (!rawSceneId) return '';

  const normalizedSceneId = normalizeSceneIdForRevision(rawSceneId, part);
  const hasAliasCollision = (options.siblingSceneIds ?? []).some((siblingSceneId) => {
    const rawSiblingSceneId = (siblingSceneId || '').trim();
    if (!rawSiblingSceneId) return false;
    if (rawSiblingSceneId.toLowerCase() === rawSceneId.toLowerCase()) return false;
    return normalizeSceneIdForRevision(rawSiblingSceneId, part) === normalizedSceneId;
  });

  return hasAliasCollision ? buildDistinctRevisionSceneId(rawSceneId) : rawSceneId;
}

export function normalizeRevisionSceneKey(
  sceneKey: string,
  options: RevisionSceneKeyOptions = {},
): string {
  const [episode = '', part = '', rawSceneId = ''] = sceneKey.split(':');
  const revisionSceneId = buildRevisionSceneIdForScene(rawSceneId, part, options);
  const normalizedSceneId = normalizeSceneIdForRevision(revisionSceneId, part);
  return `${episode}:${part}:${normalizedSceneId}`;
}

export function buildUnifiedRevisionSceneKey(
  sheetName: string,
  sceneId: string,
  options: RevisionSceneKeyOptions = {},
): string {
  const parts = sheetName.split('_');
  const episode = parts[0] || sheetName;
  const part = parts[1] || '';
  const revisionSceneId = buildRevisionSceneIdForScene(sceneId, part, options);
  const normalizedSceneId = normalizeSceneIdForRevision(revisionSceneId, part);
  return `${episode}:${part}:${normalizedSceneId}`;
}
