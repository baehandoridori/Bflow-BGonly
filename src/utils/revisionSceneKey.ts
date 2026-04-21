const TRAILING_DIGIT_GROUP_RE = /\d+$/;
const DIGITS_ONLY_RE = /^\d+$/;

function normalizeRevisionPart(part: string): string {
  return (part || '').trim().slice(0, 1).toLowerCase();
}

function normalizeSceneIdForRevision(sceneId: string, part: string): string {
  const rawSceneId = sceneId.trim();
  if (!rawSceneId) return '';

  const lowerSceneId = rawSceneId.toLowerCase();
  const match = lowerSceneId.match(TRAILING_DIGIT_GROUP_RE);
  if (!match) return lowerSceneId;

  const normalizedDigits = String(Number(match[0]));
  const normalizedPart = normalizeRevisionPart(part);
  if (!normalizedPart) return lowerSceneId;

  if (DIGITS_ONLY_RE.test(lowerSceneId)) return normalizedDigits;
  if (new RegExp(`^${normalizedPart}[a-z]*\\d+$`).test(lowerSceneId)) {
    return normalizedDigits;
  }

  return lowerSceneId;
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
