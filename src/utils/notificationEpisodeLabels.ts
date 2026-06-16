import type { Episode } from '../types';

export function parseEpisodeNumberFromSceneKey(sceneKey: string | null | undefined): number | null {
  if (!sceneKey) return null;
  const match = sceneKey.match(/^EP\.?\s*(\d+)/i);
  if (!match) return null;
  const episodeNumber = Number(match[1]);
  return Number.isFinite(episodeNumber) ? episodeNumber : null;
}

export function parsePartIdFromSceneKey(sceneKey: string | null | undefined): string | null {
  if (!sceneKey) return null;
  const colonParts = sceneKey.split(':');
  if (colonParts.length >= 3) return colonParts[1]?.trim() || null;

  const sheetParts = sceneKey.split('_');
  if (sheetParts.length >= 2 && /^EP/i.test(sheetParts[0])) return sheetParts[1]?.trim() || null;
  return null;
}

export function parseSceneIdFromSceneKey(sceneKey: string | null | undefined): string | null {
  if (!sceneKey) return null;
  const colonParts = sceneKey.split(':');
  if (colonParts.length >= 3) return colonParts.slice(2).join(':').trim() || null;

  const sheetParts = sceneKey.split('_');
  if (sheetParts.length >= 3 && /^EP/i.test(sheetParts[0])) return sheetParts.slice(2).join('_').trim() || null;
  return sceneKey.trim() || null;
}

export function formatEpisodeDisplayName(
  episodeNumber: number | null | undefined,
  episodeTitles: Record<number, string>,
  episodes: readonly Episode[] = [],
): string {
  if (!Number.isFinite(episodeNumber)) return '';
  const normalizedEpisodeNumber = Number(episodeNumber);
  const customTitle = episodeTitles[normalizedEpisodeNumber]?.trim();
  if (customTitle) return customTitle;

  const episodeTitle = episodes.find((episode) => episode.episodeNumber === normalizedEpisodeNumber)?.title?.trim();
  if (episodeTitle) return episodeTitle;

  return `EP${String(episodeNumber).padStart(2, '0')}`;
}

export function buildNotificationSceneDisplayLabel({
  episodeNumber,
  partId,
  sceneId,
  episodeTitles,
  episodes = [],
}: {
  episodeNumber?: number | null;
  partId?: string | null;
  sceneId?: string | null;
  episodeTitles: Record<number, string>;
  episodes?: readonly Episode[];
}): string {
  const parts = [
    formatEpisodeDisplayName(episodeNumber, episodeTitles, episodes),
    partId?.trim().toUpperCase(),
    sceneId?.trim(),
  ].filter(Boolean);

  return parts.join(' · ');
}

export function buildNotificationSceneDisplayLabelFromSceneKey(
  sceneKey: string | null | undefined,
  episodeTitles: Record<number, string>,
  episodes: readonly Episode[] = [],
): string {
  return buildNotificationSceneDisplayLabel({
    episodeNumber: parseEpisodeNumberFromSceneKey(sceneKey),
    partId: parsePartIdFromSceneKey(sceneKey),
    sceneId: parseSceneIdFromSceneKey(sceneKey),
    episodeTitles,
    episodes,
  });
}
