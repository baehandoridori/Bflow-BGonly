import type { Episode, Part, Scene } from '../types/index.ts';
import { buildCanonicalSceneId } from './sceneIdKey.ts';
import { buildUnifiedRevisionSceneKey, normalizeRevisionSceneKey } from './revisionSceneKey.ts';

type SceneThreadInput = {
  episodeNumber?: number | string | null;
  partId?: string | null;
  sceneId?: string | null;
  sheetName?: string | null;
  fallbackKey?: string | null;
};

function parseSheetName(sheetName: string | null | undefined): { episode: string; part: string } {
  const [episode = '', part = ''] = (sheetName ?? '').split('_');
  return { episode, part };
}

function normalizeEpisodeLabel(value: number | string | null | undefined): string {
  const raw = String(value ?? '').trim();
  const digits = raw.match(/\d+/)?.[0] ?? '';
  if (!digits) return raw.toUpperCase();
  return `EP${digits.padStart(2, '0')}`;
}

function getEpisodeNumberForPart(episodes: readonly Episode[], part: Part): number | string {
  const owner = episodes.find((episode) => episode.parts.some((candidate) => candidate.sheetName === part.sheetName));
  return owner?.episodeNumber ?? parseSheetName(part.sheetName).episode;
}

function buildCanonicalSceneThreadKey(episode: string, part: string, sceneId: string): string {
  const normalizedRevisionKey = normalizeRevisionSceneKey(buildUnifiedRevisionSceneKey(`${episode}_${part}`, sceneId));
  const [normalizedEpisode = episode, normalizedPart = part] = normalizedRevisionKey.split(':');
  const canonicalSceneId = buildCanonicalSceneId(normalizedPart, sceneId);

  return `${normalizedEpisode}:${normalizedPart}:${canonicalSceneId}`;
}

export function buildSceneThreadKeyForScene(input: SceneThreadInput): string {
  const fallback = input.fallbackKey?.trim() ?? '';
  const sheetContext = parseSheetName(input.sheetName);
  const episode = normalizeEpisodeLabel(input.episodeNumber ?? sheetContext.episode);
  const part = String(input.partId ?? sheetContext.part ?? '').trim().toUpperCase();
  const sceneId = String(input.sceneId ?? '').trim();

  if (!episode || !part || !sceneId) return fallback;

  return buildCanonicalSceneThreadKey(episode, part, sceneId);
}

export function buildSceneThreadKeyFromPartScene(
  episodes: readonly Episode[],
  part: Part,
  scene: Pick<Scene, 'sceneId'>,
  fallbackKey: string,
): string {
  return buildSceneThreadKeyForScene({
    episodeNumber: getEpisodeNumberForPart(episodes, part),
    partId: part.partId,
    sceneId: scene.sceneId,
    sheetName: part.sheetName,
    fallbackKey,
  });
}

export function buildSceneThreadKeyFromRevisionKey(sceneKey: string): string {
  const normalizedRevisionKey = normalizeRevisionSceneKey(sceneKey);
  const [episode = '', part = '', sceneId = ''] = normalizedRevisionKey.split(':');
  const [, , rawSceneId = sceneId] = sceneKey.split(':');
  const canonicalSceneId = buildCanonicalSceneId(part, rawSceneId);

  return `${episode}:${part}:${canonicalSceneId}`;
}

export function buildSceneThreadKeyFromCommentKey(
  episodes: readonly Episode[],
  commentSceneKey: string,
): string {
  const [sheetName = '', rawSceneNo = ''] = commentSceneKey.split(':');
  const part = episodes.flatMap((episode) => episode.parts).find((candidate) => candidate.sheetName === sheetName);
  if (!part) return commentSceneKey;

  const scene = part.scenes.find((candidate) => {
    return String(candidate.no) === rawSceneNo || candidate.sceneId.trim().toLowerCase() === rawSceneNo.trim().toLowerCase();
  });

  if (!scene) return commentSceneKey;

  return buildSceneThreadKeyFromPartScene(episodes, part, scene, commentSceneKey);
}

export function buildLegacyCommentSceneKey(sheetName: string, scene: Pick<Scene, 'no'>): string {
  return `${sheetName}:${scene.no}`;
}
