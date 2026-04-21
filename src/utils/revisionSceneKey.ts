const TRAILING_DIGIT_GROUP_RE = /\d+$/;

function normalizeSceneIdForRevision(sceneId: string): string {
  const match = sceneId.match(TRAILING_DIGIT_GROUP_RE);
  if (!match) return sceneId;
  return String(Number(match[0]));
}

export function normalizeRevisionSceneKey(sceneKey: string): string {
  const [episode = '', part = '', rawSceneId = ''] = sceneKey.split(':');
  const normalizedSceneId = normalizeSceneIdForRevision(rawSceneId);
  return `${episode}:${part}:${normalizedSceneId}`;
}

export function buildUnifiedRevisionSceneKey(sheetName: string, sceneId: string): string {
  const parts = sheetName.split('_');
  const episode = parts[0] || sheetName;
  const part = parts[1] || '';
  const normalizedSceneId = normalizeSceneIdForRevision(sceneId);
  return `${episode}:${part}:${normalizedSceneId}`;
}
