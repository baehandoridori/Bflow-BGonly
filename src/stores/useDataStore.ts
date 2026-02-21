import { create } from 'zustand';
import type { Episode, Scene, DashboardStats, Department } from '@/types';
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

  // 낙관적 업데이트 — UI 즉시 반영
  toggleSceneStage: (
    sheetName: string,
    sceneId: string,
    stage: keyof Pick<Scene, 'lo' | 'done' | 'review' | 'png'>
  ) => void;
  addEpisodeOptimistic: (episodeNumber: number, department?: Department) => void;
  addPartOptimistic: (episodeNumber: number, partId: string, department?: Department) => void;
  addSceneOptimistic: (sheetName: string, sceneId: string, assignee: string, memo: string) => void;
  deleteSceneOptimistic: (sheetName: string, rowIndex: number) => void;
  updateSceneFieldOptimistic: (sheetName: string, rowIndex: number, field: string, value: string) => void;
}

function applyUpdate(get: () => DataState, episodes: Episode[]) {
  return { episodes, stats: calcDashboardStats(episodes) };
}

export const useDataStore = create<DataState>((set, get) => ({
  episodes: [],
  stats: calcDashboardStats([]),

  setEpisodes: (episodes) => set(applyUpdate(get, episodes)),

  isSyncing: false,
  lastSyncTime: null,
  syncError: null,
  setSyncing: (v) => set({ isSyncing: v }),
  setLastSyncTime: (t) => set({ lastSyncTime: t }),
  setSyncError: (err) => set({ syncError: err }),

  toggleSceneStage: (sheetName, sceneId, stage) => {
    const episodes = get().episodes.map((ep) => ({
      ...ep,
      parts: ep.parts.map((part) => {
        if (part.sheetName !== sheetName) return part;
        return {
          ...part,
          scenes: part.scenes.map((scene) => {
            if (scene.sceneId !== sceneId) return scene;
            return { ...scene, [stage]: !scene[stage] };
          }),
        };
      }),
    }));
    set(applyUpdate(get, episodes));
  },

  addEpisodeOptimistic: (episodeNumber, department: Department = 'bg') => {
    const deptSuffix = department === 'bg' ? '_BG' : '_ACT';
    const tabName = `EP${String(episodeNumber).padStart(2, '0')}_A${deptSuffix}`;
    const newEp: Episode = {
      episodeNumber,
      title: `EP.${String(episodeNumber).padStart(2, '0')}`,
      parts: [{ partId: 'A', department, sheetName: tabName, scenes: [] }],
    };
    set(applyUpdate(get, [...get().episodes, newEp]));
  },

  addPartOptimistic: (episodeNumber, partId, department: Department = 'bg') => {
    const deptSuffix = department === 'bg' ? '_BG' : '_ACT';
    const tabName = `EP${String(episodeNumber).padStart(2, '0')}_${partId}${deptSuffix}`;
    const episodes = get().episodes.map((ep) => {
      if (ep.episodeNumber !== episodeNumber) return ep;
      return { ...ep, parts: [...ep.parts, { partId, department, sheetName: tabName, scenes: [] }] };
    });
    set(applyUpdate(get, episodes));
  },

  addSceneOptimistic: (sheetName, sceneId, assignee, memo) => {
    const episodes = get().episodes.map((ep) => ({
      ...ep,
      parts: ep.parts.map((part) => {
        if (part.sheetName !== sheetName) return part;
        const nextNo = part.scenes.length > 0
          ? Math.max(...part.scenes.map((s) => s.no)) + 1
          : 1;
        const newScene: Scene = {
          no: nextNo,
          sceneId: sceneId || '',
          memo: memo || '',
          storyboardUrl: '',
          guideUrl: '',
          assignee: assignee || '',
          layoutId: '',
          lo: false, done: false, review: false, png: false,
        };
        return { ...part, scenes: [...part.scenes, newScene] };
      }),
    }));
    set(applyUpdate(get, episodes));
  },

  deleteSceneOptimistic: (sheetName, rowIndex) => {
    const episodes = get().episodes.map((ep) => ({
      ...ep,
      parts: ep.parts.map((part) => {
        if (part.sheetName !== sheetName) return part;
        return { ...part, scenes: part.scenes.filter((_, i) => i !== rowIndex) };
      }),
    }));
    set(applyUpdate(get, episodes));
  },

  updateSceneFieldOptimistic: (sheetName, rowIndex, field, value) => {
    const episodes = get().episodes.map((ep) => ({
      ...ep,
      parts: ep.parts.map((part) => {
        if (part.sheetName !== sheetName) return part;
        return {
          ...part,
          scenes: part.scenes.map((scene, i) => {
            if (i !== rowIndex) return scene;
            if (field === 'lo' || field === 'done' || field === 'review' || field === 'png') {
              return { ...scene, [field]: value === 'true' };
            }
            if (field === 'no') return { ...scene, no: parseInt(value, 10) || 0 };
            return { ...scene, [field]: value };
          }),
        };
      }),
    }));
    set(applyUpdate(get, episodes));
  },
}));
