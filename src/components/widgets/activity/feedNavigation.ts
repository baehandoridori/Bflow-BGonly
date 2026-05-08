import type { Activity, Episode } from '../../../types';

export interface ActivitySceneNavigationTarget {
  episodeNumber: number;
  partId: string;
  sheetName: string;
  sceneId: string;
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

/** activity.sceneId(UUID)를 ScenesView deep-link가 이해하는 sheetName + sceneId로 변환한다. */
export function resolveActivitySceneNavigation(
  activity: Pick<Activity, 'sceneId'>,
  episodes: Episode[],
): ActivitySceneNavigationTarget | null {
  if (!activity.sceneId) return null;
  for (const ep of episodes) {
    for (const part of ep.parts) {
      const scene = part.scenes.find((candidate) => candidate.id === activity.sceneId);
      if (!scene) continue;
      return {
        episodeNumber: ep.episodeNumber,
        partId: part.partId,
        sheetName: part.sheetName,
        sceneId: scene.sceneId,
      };
    }
  }
  return null;
}
