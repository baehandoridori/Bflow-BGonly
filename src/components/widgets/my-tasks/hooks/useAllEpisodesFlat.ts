import { useMemo } from 'react';
import { useDataStore } from '@/stores/useDataStore';
import { makeKey } from '../types';
import type { FlatScene } from '../types';

/**
 * 전체 에피소드를 평탄화한 FlatScene 배열을 반환하는 훅.
 *
 * useDataStore.episodes(전체)를 직접 구독하므로, EP 대시보드 모드처럼
 * 특정 EP만 보는 상태에서도 항상 모든 에피소드의 씬을 포함한다.
 * (useDashboardEpisodes 사용 금지 — EP 스코핑 버그 원인)
 */
export function useAllEpisodesFlat(): FlatScene[] {
  const episodes = useDataStore((s) => s.episodes);

  return useMemo(() => {
    const result: FlatScene[] = [];
    for (const ep of episodes) {
      for (const part of ep.parts) {
        part.scenes.forEach((scene, idx) => {
          result.push({
            scene,
            sheetName: part.sheetName,
            sceneIndex: idx,
            episodeNumber: ep.episodeNumber,
            partId: part.partId,
            department: part.department,
            key: makeKey(part.sheetName, scene.sceneId),
          });
        });
      }
    }
    return result;
  }, [episodes]);
}
