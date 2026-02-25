import { useMemo } from 'react';
import { useDataStore } from '@/stores/useDataStore';
import { useAppStore } from '@/stores/useAppStore';

/**
 * 대시보드 위젯용 에피소드 데이터 훅.
 * - episodeDashboardEp === null → 전체 에피소드 반환
 * - episodeDashboardEp !== null → 해당 EP만 필터링
 */
export function useDashboardEpisodes() {
  const episodes = useDataStore((s) => s.episodes);
  const epNum = useAppStore((s) => s.episodeDashboardEp);

  return useMemo(() => {
    if (epNum === null) return episodes;
    return episodes.filter((ep) => ep.episodeNumber === epNum);
  }, [episodes, epNum]);
}
