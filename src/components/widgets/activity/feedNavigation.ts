import type { Activity, Episode } from '../../../types';

export interface ActivitySceneNavigationTarget {
  episodeNumber: number;
  partId: string;
  sheetName: string;
  sceneId: string;
}

interface ParsedActivitySceneLabel {
  episodeNumber: number | null;
  partId: string | null;
  sceneRef: string;
}

/**
 * v1.23.0: 가운데점(·) 분리 포맷.
 * 입력: "EP02 E #15"  →  출력: "그림자국 · E · #15"
 * 에피소드 제목 없으면: "EP02 · E · #15"
 * 단순 EP 접두만 있는 경우: "EP02"  →  "그림자국" (또는 "EP02")
 */
export function formatActivitySceneLabel(
  sceneLabel: string | null,
  episodeNumber: number | null,
  episodeTitles: Record<number, string>,
): string {
  if (!sceneLabel) return '';
  if (episodeNumber == null) return sceneLabel;

  const epPrefix = `EP${String(episodeNumber).padStart(2, '0')}`;
  const epDisplay = episodeTitles[episodeNumber] || epPrefix;

  if (!sceneLabel.startsWith(epPrefix)) return sceneLabel;
  const remainder = sceneLabel.slice(epPrefix.length).trim();
  if (!remainder) return epDisplay;

  const parts = remainder.split(/\s+/).filter(Boolean);
  return [epDisplay, ...parts].join(' · ');
}

/** 묶음 헤더는 특정 씬 번호 대신 에피소드 단위 라벨만 표시한다. */
export function formatActivityGroupLabel(
  activity: Pick<Activity, 'episodeNumber' | 'sceneLabel'>,
  episodeTitles: Record<number, string>,
): string {
  if (activity.episodeNumber != null) {
    return episodeTitles[activity.episodeNumber]
      || `EP${String(activity.episodeNumber).padStart(2, '0')}`;
  }
  return activity.sceneLabel ?? '';
}

function buildNavigationTarget(
  episodeNumber: number,
  part: Episode['parts'][number],
  scene: Episode['parts'][number]['scenes'][number],
): ActivitySceneNavigationTarget {
  return {
    episodeNumber,
    partId: part.partId,
    sheetName: part.sheetName,
    sceneId: scene.sceneId,
  };
}

function parseActivitySceneLabel(sceneLabel: string | null): ParsedActivitySceneLabel | null {
  if (!sceneLabel) return null;
  const label = sceneLabel.trim();
  if (!label) return null;

  const withEpisode = label.match(/^EP(\d+)\s+([A-Za-z0-9_-]+)\s+#([^\s]+)/i);
  if (withEpisode) {
    return {
      episodeNumber: Number(withEpisode[1]),
      partId: withEpisode[2],
      sceneRef: withEpisode[3],
    };
  }

  const withoutEpisode = label.match(/^([A-Za-z0-9_-]+)\s+#([^\s]+)/i);
  if (withoutEpisode) {
    return {
      episodeNumber: null,
      partId: withoutEpisode[1],
      sceneRef: withoutEpisode[2],
    };
  }

  return null;
}

function matchesSceneIdentifier(
  scene: Episode['parts'][number]['scenes'][number],
  identifier: string,
): boolean {
  const normalized = identifier.trim().replace(/^#/, '').toLowerCase();
  if (!normalized) return false;

  if (scene.sceneId.trim().toLowerCase() === normalized) return true;
  return String(scene.no).trim().toLowerCase() === normalized;
}

function findSceneNavigationByIdentifier(
  episodes: Episode[],
  identifier: string,
  opts: { episodeNumber?: number | null; partId?: string | null } = {},
): ActivitySceneNavigationTarget | null {
  const normalizedPartId = opts.partId?.trim().toLowerCase() ?? null;
  const matches: ActivitySceneNavigationTarget[] = [];

  for (const ep of episodes) {
    if (opts.episodeNumber != null && ep.episodeNumber !== opts.episodeNumber) continue;
    for (const part of ep.parts) {
      if (normalizedPartId && part.partId.trim().toLowerCase() !== normalizedPartId) continue;
      for (const scene of part.scenes) {
        if (!matchesSceneIdentifier(scene, identifier)) continue;
        matches.push(buildNavigationTarget(ep.episodeNumber, part, scene));
      }
    }
  }

  return matches.length === 1 ? matches[0] : null;
}

/** activity.sceneId(UUID)를 ScenesView deep-link가 이해하는 sheetName + sceneId로 변환한다. */
export function resolveActivitySceneNavigation(
  activity: Pick<Activity, 'sceneId' | 'sceneLabel' | 'episodeNumber'>,
  episodes: Episode[],
): ActivitySceneNavigationTarget | null {
  if (activity.sceneId) {
    for (const ep of episodes) {
      for (const part of ep.parts) {
        const scene = part.scenes.find((candidate) => candidate.id === activity.sceneId);
        if (!scene) continue;
        return buildNavigationTarget(ep.episodeNumber, part, scene);
      }
    }
  }

  const parsedLabel = parseActivitySceneLabel(activity.sceneLabel);
  if (parsedLabel) {
    const byLabel = findSceneNavigationByIdentifier(episodes, parsedLabel.sceneRef, {
      episodeNumber: activity.episodeNumber ?? parsedLabel.episodeNumber,
      partId: parsedLabel.partId,
    });
    if (byLabel) return byLabel;
  }

  if (!activity.sceneId) return null;
  return findSceneNavigationByIdentifier(episodes, activity.sceneId, {
    episodeNumber: activity.episodeNumber ?? parsedLabel?.episodeNumber,
    partId: parsedLabel?.partId,
  });
}
