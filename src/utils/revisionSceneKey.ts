import { normalizeSceneIdKey } from './sceneIdKey.ts';

export type RevisionSceneKeyOptions = {
  siblingSceneIds?: readonly (string | null | undefined)[];
};

const DIGITS_ONLY_RE = /^\d+$/;

function normalizeRevisionPartId(part: string): string {
  return part.trim().toUpperCase();
}

function normalizeSceneIdForRevision(sceneId: string, part: string): string {
  return normalizeSceneIdKey(sceneId, part);
}

export function buildDistinctRevisionSceneId(sceneId: string | null | undefined): string {
  const normalized = (sceneId || '').trim().toLowerCase();
  return normalized ? `raw-${encodeURIComponent(normalized)}` : '';
}

function parseDistinctRevisionSceneId(sceneId: string): string {
  const normalized = sceneId.trim().toLowerCase();
  if (!normalized.startsWith('raw-')) return normalized;

  try {
    return decodeURIComponent(normalized.slice(4));
  } catch {
    return normalized.slice(4);
  }
}

export function buildLegacySharedRevisionSceneKey(sceneKey: string): string | null {
  const [episode = '', part = '', sceneId = ''] = sceneKey.split(':');
  const normalizedPart = normalizeRevisionPartId(part);
  const normalizedSceneId = sceneId.trim().toLowerCase();
  if (!normalizedSceneId.startsWith('raw-')) return null;

  const rawSceneId = parseDistinctRevisionSceneId(normalizedSceneId);
  const legacySceneId = normalizeSceneIdForRevision(rawSceneId, normalizedPart);
  if (!legacySceneId || legacySceneId === normalizedSceneId) return null;

  return `${episode}:${normalizedPart}:${legacySceneId}`;
}

function buildHistoricalRawAliasRevisionSceneKey(
  sceneKey: string,
  normalizedSceneKey: string,
): string | null {
  const [episode = '', part = '', sceneId = ''] = sceneKey.split(':');
  const normalizedPart = normalizeRevisionPartId(part);
  const rawSceneId = sceneId.trim();
  const normalizedSceneId = rawSceneId.toLowerCase();
  if (!rawSceneId || DIGITS_ONLY_RE.test(normalizedSceneId) || normalizedSceneId.startsWith('raw-')) {
    return null;
  }

  const rawAliasKey = `${episode}:${normalizedPart}:${buildDistinctRevisionSceneId(rawSceneId)}`;
  if (rawAliasKey === normalizedSceneKey) return null;

  const legacySharedKey = buildLegacySharedRevisionSceneKey(rawAliasKey);
  return legacySharedKey === normalizedSceneKey ? rawAliasKey : null;
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
  const normalizedPart = normalizeRevisionPartId(part);
  const trimmedSceneId = rawSceneId.trim();
  if (DIGITS_ONLY_RE.test(trimmedSceneId)) {
    return `${episode}:${normalizedPart}:${normalizeSceneIdForRevision(trimmedSceneId, normalizedPart)}`;
  }

  const revisionSceneId = buildRevisionSceneIdForScene(rawSceneId, normalizedPart, options);
  const normalizedSceneId = normalizeSceneIdForRevision(revisionSceneId, normalizedPart);
  return `${episode}:${normalizedPart}:${normalizedSceneId}`;
}

export function buildRevisionSceneKeyLookupKeys(
  sceneKey: string,
  options: RevisionSceneKeyOptions = {},
): string[] {
  const normalizedSceneKey = normalizeRevisionSceneKey(sceneKey, options);
  const keys = [normalizedSceneKey];
  const legacySharedKey = buildLegacySharedRevisionSceneKey(normalizedSceneKey);
  const historicalRawAliasKey = buildHistoricalRawAliasRevisionSceneKey(sceneKey, normalizedSceneKey);

  if (legacySharedKey && !keys.includes(legacySharedKey)) {
    keys.push(legacySharedKey);
  }
  if (historicalRawAliasKey && !keys.includes(historicalRawAliasKey)) {
    keys.push(historicalRawAliasKey);
  }

  return keys;
}

export function buildUnifiedRevisionSceneKey(
  sheetName: string,
  sceneId: string,
  options: RevisionSceneKeyOptions = {},
): string {
  const parts = sheetName.split('_');
  const episode = parts[0] || sheetName;
  const part = normalizeRevisionPartId(parts[1] || '');
  const revisionSceneId = buildRevisionSceneIdForScene(sceneId, part, options);
  const normalizedSceneId = normalizeSceneIdForRevision(revisionSceneId, part);
  return `${episode}:${part}:${normalizedSceneId}`;
}
