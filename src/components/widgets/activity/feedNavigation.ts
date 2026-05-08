import type { Activity, Episode } from '../../../types';

export interface ActivitySceneNavigationTarget {
  episodeNumber: number;
  partId: string;
  sheetName: string;
  sceneId: string;
}

/** EP 접두("EP02 ")를 사용자가 지정한 에피소드 제목으로 교체한다. */
export function formatActivitySceneLabel(
  sceneLabel: string | null,
  episodeNumber: number | null,
  episodeTitles: Record<number, string>,
): string {
  if (!sceneLabel) return '';
  if (episodeNumber == null) return sceneLabel;
  const epPrefix = `EP${String(episodeNumber).padStart(2, '0')}`;
  if (!sceneLabel.startsWith(epPrefix)) return sceneLabel;
  const customTitle = episodeTitles[episodeNumber];
  if (!customTitle) return sceneLabel;
  return customTitle + sceneLabel.slice(epPrefix.length);
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
