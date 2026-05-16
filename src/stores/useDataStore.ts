import { create } from 'zustand';
import type { Episode, Scene, DashboardStats, Department, Stage, ScenePhaseState } from '@/types';
import { SCENE_PHASE_ROUND_MIN, SCENE_PHASE_ROUND_MAX } from '@/types';
import { calcDashboardStats } from '@/utils/calcStats';

interface DataState {
  // 에피소드 데이터
  episodes: Episode[];
  setEpisodes: (episodes: Episode[]) => void;

  // 에피소드 커스텀 제목 (episodeNumber → title)
  episodeTitles: Record<number, string>;
  setEpisodeTitles: (titles: Record<number, string>) => void;
  /** ep.title 대신 커스텀 제목을 우선 반환 */
  getEpisodeDisplayName: (ep: Episode) => string;

  // 에피소드 메모 (episodeNumber → memo)
  episodeMemos: Record<number, string>;
  setEpisodeMemos: (memos: Record<number, string>) => void;

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
  // 명시적 값 적용 (delta 수신용 — 토글이 아니라 값 직접 세팅)
  setSceneStageValue: (sheetName: string, sceneId: string, stage: Stage, value: boolean) => void;
  setSceneFieldBySceneId: (sheetName: string, sceneId: string, field: string, value: string) => void;

  /**
   * v1.25.0~: 액팅 씬 단계 상태 변경 (낙관적). 진입 시점에 차수 자동 동기화.
   * spec 4-2 전이 규칙 적용:
   *  - 대기 → 작업중: workRound = 1 (기존 0 일 때)
   *  - 작업중 → 피드백 대기: feedbackRound = workRound 동기화
   *  - 피드백 대기 → 작업중: workRound = feedbackRound + 1 (자동 +1)
   *  - 어떤 상태 → 대기 또는 완료: round 모두 0
   *  - 어떤 상태 → 피드백 대기 (직접 점프): feedbackRound = max(1, 기존)
   */
  setScenePhaseOptimistic: (
    sheetName: string,
    sceneId: string,
    newState: ScenePhaseState
  ) => void;

  /** 차수 +/- 수동 조정. 활성 칩 안 ▴▾ 버튼용. [1, 99] 범위 클램프. */
  bumpScenePhaseRoundOptimistic: (
    sheetName: string,
    sceneId: string,
    kind: 'work' | 'feedback',
    delta: 1 | -1
  ) => void;

  addEpisodeOptimistic: (episodeNumber: number, department?: Department) => void;
  addPartOptimistic: (episodeNumber: number, partId: string, department?: Department) => void;
  addSceneOptimistic: (sheetName: string, sceneId: string, assignee: string, memo: string) => void;
  deleteSceneOptimistic: (sheetName: string, rowIndex: number) => void;
  updateSceneFieldOptimistic: (sheetName: string, rowIndex: number, field: string, value: string) => void;
  deletePartOptimistic: (sheetName: string) => void;
  deleteEpisodeOptimistic: (episodeNumber: number) => void;
  /** Supabase UUID로 씬 필드 직접 업데이트 (Realtime delta용) */
  updateSceneByUuid: (uuid: string, fields: Partial<Scene>) => boolean;
  /** UUID로 씬 제거 (일괄 삭제·Realtime DELETE delta용) */
  removeSceneByUuid: (uuid: string) => boolean;
  /** UUID로 씬 검색 (새 배열 미생성, O(n) loop) */
  findSceneByUuid: (uuid: string) => Scene | undefined;
  /** sceneId(사용자 지정 ID)로 씬 검색 */
  findSceneBySceneId: (sceneId: string) => Scene | undefined;
  /**
   * v1.25.0~ 시트 안에서 sceneId 로 씬 검색 (글로벌 검색이 아니라 특정 sheet 내).
   * 코덱스 1차 리뷰 P1 fix: 같은 sceneId 가 다른 에피소드/파트에 있어도 정확히 그 시트의 씬만 반환.
   */
  findSceneInSheet: (sheetName: string, sceneId: string) => Scene | undefined;
}

function applyUpdate(get: () => DataState, episodes: Episode[]) {
  return { episodes, stats: calcDashboardStats(episodes) };
}

/**
 * 코덱스 5차 P1 #11 fix: 액팅 단계 → legacy boolean 4개 매핑.
 * electron/supabase.ts 의 updateScenePhase 의 dual-write 매핑과 동일.
 * 마이그레이션 SQL 매핑과 round-trip 가능.
 *
 * v1.27.0 코덱스 1차 P1 fix: bulk ACT phase set 에서도 동일 매핑 사용하도록 export.
 */
export function legacyStagesFor(state: ScenePhaseState): { lo: boolean; done: boolean; review: boolean; png: boolean } {
  switch (state) {
    case 'wait':     return { lo: false, done: false, review: false, png: false };
    case 'work':     return { lo: true,  done: true,  review: false, png: false };
    case 'feedback': return { lo: true,  done: true,  review: true,  png: false };
    case 'done':     return { lo: true,  done: true,  review: true,  png: true  };
  }
}

export const useDataStore = create<DataState>((set, get) => ({
  episodes: [],
  stats: calcDashboardStats([]),

  setEpisodes: (episodes) => set(applyUpdate(get, episodes)),

  episodeTitles: {},
  setEpisodeTitles: (titles) => set({ episodeTitles: titles }),
  getEpisodeDisplayName: (ep) => {
    const custom = get().episodeTitles[ep.episodeNumber];
    return custom || ep.title;
  },

  episodeMemos: {},
  setEpisodeMemos: (memos) => set({ episodeMemos: memos }),

  isSyncing: false,
  lastSyncTime: null,
  syncError: null,
  setSyncing: (v) => set({ isSyncing: v }),
  setLastSyncTime: (t) => set({ lastSyncTime: t }),
  setSyncError: (err) => set({ syncError: err }),

  toggleSceneStage: (sheetName, sceneId, stage) => {
    const episodes = get().episodes.map((ep) => {
      if (!ep.parts.some((p) => p.sheetName === sheetName)) return ep;
      return {
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
      };
    });
    set(applyUpdate(get, episodes));
  },

  setSceneStageValue: (sheetName, sceneId, stage, value) => {
    const episodes = get().episodes.map((ep) => {
      if (!ep.parts.some((p) => p.sheetName === sheetName)) return ep;
      return {
        ...ep,
        parts: ep.parts.map((part) => {
          if (part.sheetName !== sheetName) return part;
          return {
            ...part,
            scenes: part.scenes.map((scene) => {
              if (scene.sceneId !== sceneId) return scene;
              return { ...scene, [stage]: value };
            }),
          };
        }),
      };
    });
    set(applyUpdate(get, episodes));
  },

  setScenePhaseOptimistic: (sheetName, sceneId, newState) => {
    const episodes = get().episodes.map((ep) => {
      if (!ep.parts.some((p) => p.sheetName === sheetName)) return ep;
      return {
        ...ep,
        parts: ep.parts.map((part) => {
          if (part.sheetName !== sheetName) return part;
          return {
            ...part,
            scenes: part.scenes.map((scene) => {
              if (scene.sceneId !== sceneId) return scene;
              const prev = scene.sceneState ?? null;
              const prevWork = scene.workRound ?? 0;
              const prevFb = scene.feedbackRound ?? 0;
              let workRound = prevWork;
              let feedbackRound = prevFb;
              if (newState === 'wait' || newState === 'done') {
                workRound = 0;
                feedbackRound = 0;
              } else if (newState === 'work') {
                if (prev === 'feedback') {
                  // 자동 +1 — 코덱스 2차 P2 fix: 99 상한 클램프
                  workRound = Math.min(SCENE_PHASE_ROUND_MAX, prevFb + 1);
                } else if (prev !== 'work') {
                  workRound = Math.max(SCENE_PHASE_ROUND_MIN, Math.min(SCENE_PHASE_ROUND_MAX, prevWork || 1));
                }
                // prev === 'work' 이면 그대로 유지
              } else if (newState === 'feedback') {
                if (prev === 'work') {
                  // 라운드 동기화 — 코덱스 2차 P2 fix: 99 상한 클램프
                  feedbackRound = Math.min(SCENE_PHASE_ROUND_MAX, prevWork);
                } else if (prev !== 'feedback') {
                  feedbackRound = Math.max(SCENE_PHASE_ROUND_MIN, Math.min(SCENE_PHASE_ROUND_MAX, prevFb || 1));
                }
              }
              // 코덱스 5차 P1 #11 fix: legacy lo/done/review/png 동시 갱신 — calcStats 등이
              //   아직 boolean 4개를 읽기 때문에 split state 방지. BG 합류 시 제거 예정.
              const legacy = legacyStagesFor(newState);
              return {
                ...scene,
                sceneState: newState,
                workRound,
                feedbackRound,
                lo: legacy.lo, done: legacy.done, review: legacy.review, png: legacy.png,
              };
            }),
          };
        }),
      };
    });
    set(applyUpdate(get, episodes));
  },

  bumpScenePhaseRoundOptimistic: (sheetName, sceneId, kind, delta) => {
    const episodes = get().episodes.map((ep) => {
      if (!ep.parts.some((p) => p.sheetName === sheetName)) return ep;
      return {
        ...ep,
        parts: ep.parts.map((part) => {
          if (part.sheetName !== sheetName) return part;
          return {
            ...part,
            scenes: part.scenes.map((scene) => {
              if (scene.sceneId !== sceneId) return scene;
              const cur = kind === 'work' ? (scene.workRound ?? 0) : (scene.feedbackRound ?? 0);
              const next = Math.max(SCENE_PHASE_ROUND_MIN, Math.min(SCENE_PHASE_ROUND_MAX, cur + delta));
              return kind === 'work'
                ? { ...scene, workRound: next }
                : { ...scene, feedbackRound: next };
            }),
          };
        }),
      };
    });
    set(applyUpdate(get, episodes));
  },

  setSceneFieldBySceneId: (sheetName, sceneId, field, value) => {
    const episodes = get().episodes.map((ep) => {
      if (!ep.parts.some((p) => p.sheetName === sheetName)) return ep;
      return {
        ...ep,
        parts: ep.parts.map((part) => {
          if (part.sheetName !== sheetName) return part;
          return {
            ...part,
            scenes: part.scenes.map((scene) => {
              if (scene.sceneId !== sceneId) return scene;
              if (field === 'lo' || field === 'done' || field === 'review' || field === 'png') {
                return { ...scene, [field]: value === 'true' };
              }
              if (field === 'no') return { ...scene, no: parseInt(value, 10) || 0 };
              return { ...scene, [field]: value };
            }),
          };
        }),
      };
    });
    set(applyUpdate(get, episodes));
  },

  addEpisodeOptimistic: (episodeNumber, department: Department = 'bg') => {
    const pad = String(episodeNumber).padStart(2, '0');
    const newEp: Episode = {
      episodeNumber,
      title: `EP.${pad}`,
      parts: [
        { partId: 'A', department: 'bg', sheetName: `EP${pad}_A_BG`, scenes: [] },
        { partId: 'A', department: 'acting', sheetName: `EP${pad}_A_ACT`, scenes: [] },
      ],
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

  deletePartOptimistic: (sheetName) => {
    const episodes = get().episodes
      .map((ep) => ({
        ...ep,
        parts: ep.parts.filter((p) => p.sheetName !== sheetName),
      }))
      .filter((ep) => ep.parts.length > 0);
    set(applyUpdate(get, episodes));
  },

  deleteEpisodeOptimistic: (episodeNumber) => {
    const episodes = get().episodes.filter((ep) => ep.episodeNumber !== episodeNumber);
    set(applyUpdate(get, episodes));
  },

  findSceneByUuid: (uuid) => {
    for (const ep of get().episodes) {
      for (const part of ep.parts) {
        const scene = part.scenes.find((s) => s.id === uuid);
        if (scene) return scene;
      }
    }
    return undefined;
  },

  findSceneBySceneId: (sceneId) => {
    for (const ep of get().episodes) {
      for (const part of ep.parts) {
        const scene = part.scenes.find((s) => s.sceneId === sceneId);
        if (scene) return scene;
      }
    }
    return undefined;
  },

  findSceneInSheet: (sheetName, sceneId) => {
    for (const ep of get().episodes) {
      for (const part of ep.parts) {
        if (part.sheetName !== sheetName) continue;
        return part.scenes.find((s) => s.sceneId === sceneId);
      }
    }
    return undefined;
  },

  updateSceneByUuid: (uuid, fields) => {
    const oldEpisodes = get().episodes;
    for (let ei = 0; ei < oldEpisodes.length; ei++) {
      const ep = oldEpisodes[ei];
      for (let pi = 0; pi < ep.parts.length; pi++) {
        const part = ep.parts[pi];
        const si = part.scenes.findIndex((s) => s.id === uuid);
        if (si < 0) continue;
        // 변경된 branch만 새 참조 생성
        const newScenes = [...part.scenes];
        newScenes[si] = { ...newScenes[si], ...fields };
        const newParts = [...ep.parts];
        newParts[pi] = { ...part, scenes: newScenes };
        const newEpisodes = [...oldEpisodes];
        newEpisodes[ei] = { ...ep, parts: newParts };
        set(applyUpdate(get, newEpisodes));
        return true;
      }
    }
    return false;
  },

  removeSceneByUuid: (uuid) => {
    const oldEpisodes = get().episodes;
    for (let ei = 0; ei < oldEpisodes.length; ei++) {
      const ep = oldEpisodes[ei];
      for (let pi = 0; pi < ep.parts.length; pi++) {
        const part = ep.parts[pi];
        const si = part.scenes.findIndex((s) => s.id === uuid);
        if (si < 0) continue;
        // 변경된 branch만 새 참조 생성
        const newScenes = part.scenes.filter((_, i) => i !== si);
        const newParts = [...ep.parts];
        newParts[pi] = { ...part, scenes: newScenes };
        const newEpisodes = [...oldEpisodes];
        newEpisodes[ei] = { ...ep, parts: newParts };
        set(applyUpdate(get, newEpisodes));
        return true;
      }
    }
    return false;
  },
}));
