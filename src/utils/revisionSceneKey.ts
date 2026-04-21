import { normalizeSceneIdKey } from './sceneIdKey.ts';

function normalizeSceneIdForRevision(sceneId: string, part: string): string {
  return normalizeSceneIdKey(sceneId, part);
}

export function normalizeRevisionSceneKey(sceneKey: string): string {
  const [episode = '', part = '', rawSceneId = ''] = sceneKey.split(':');
  const normalizedSceneId = normalizeSceneIdForRevision(rawSceneId, part);
  return `${episode}:${part}:${normalizedSceneId}`;
}

export function buildUnifiedRevisionSceneKey(sheetName: string, sceneId: string): string {
  const parts = sheetName.split('_');
  const episode = parts[0] || sheetName;
  const part = parts[1] || '';
  const normalizedSceneId = normalizeSceneIdForRevision(sceneId, part);
  return `${episode}:${part}:${normalizedSceneId}`;
}
