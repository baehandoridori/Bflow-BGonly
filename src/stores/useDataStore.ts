import { create } from 'zustand';
import type { Episode, Scene, DashboardStats } from '@/types';
import { calcDashboardStats } from '@/utils/calcStats';

interface DataState {
  // 에피소드 데이터
  episodes: Episode[];
  setEpisodes: (episodes: Episode[]) => void;

  // 통계 (episodes에서 파생)
  stats: DashboardStats;

  // 동기화 상태
  isSyncing: boolean;
  lastSyncTime: number | null;
  syncError: string | null;
  setSyncing: (v: boolean) => void;
  setLastSyncTime: (t: number) => void;
  setSyncError: (err: string | null) => void;

  // 씬 체크박스 토글 (낙관적 업데이트)
  toggleSceneStage: (
    episodeNumber: number,
    partId: string,
    sceneId: string,
    stage: keyof Pick<Scene, 'lo' | 'done' | 'review' | 'png'>
  ) => void;
}

export const useDataStore = create<DataState>((set, get) => ({
  episodes: [],
  stats: calcDashboardStats([]),

  setEpisodes: (episodes) =>
    set({
      episodes,
      stats: calcDashboardStats(episodes),
    }),

  isSyncing: false,
  lastSyncTime: null,
  syncError: null,
  setSyncing: (v) => set({ isSyncing: v }),
  setLastSyncTime: (t) => set({ lastSyncTime: t }),
  setSyncError: (err) => set({ syncError: err }),

  toggleSceneStage: (episodeNumber, partId, sceneId, stage) => {
    const episodes = get().episodes.map((ep) => {
      if (ep.episodeNumber !== episodeNumber) return ep;
      return {
        ...ep,
        parts: ep.parts.map((part) => {
          if (part.partId !== partId) return part;
          return {
            ...part,
            scenes: part.scenes.map((scene) => {
              if (scene.sceneId !== sceneId) return scene;
              return { ...scene, [stage]: !scene[stage] };
            }),
          };
        }),
      };
    });
    set({
      episodes,
      stats: calcDashboardStats(episodes),
    });
  },
}));
