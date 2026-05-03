import { create } from 'zustand';
import type { CompRevision, Episode, RevisionStatus } from '@/types';
import * as revisionService from '@/services/revisionService';
import { useDataStore } from '@/stores/useDataStore';

/**
 * v1.18.0: 리비전 등록 input. 우선순위/프레임/담당자 입력 UI 가 폼에서 제거되어
 * (한솔 결정 — spec 2026-05-03) 자동값으로 처리. 호출자는 sceneKey/description/이미지/
 * 알림 대상자/부서/등록자 정보만 전달.
 */
export interface CreateRevisionInput {
  sceneKey: string;
  description: string;
  imageUrl?: string;
  /** 부서 — sheetName 에서 추론한 값. 알림 자동 대상자 결정/저장용. */
  department?: 'bg' | 'acting';
  /** sceneKey → partUuid 역조회용 (BG/ACT 구분이 sceneKey 자체로는 불가능). */
  lookupDepartment?: 'bg' | 'acting';
  requesterId: string;
  requesterName: string;
  /** 알림 받을 사람 user.id 배열 (등록자 본인 포함 가능 — 자기 알림은 발송 시 스킵). */
  notifyUserIds: string[];
}

interface RevisionState {
  revisions: CompRevision[];
  revisionCountByScene: Record<string, number>; // sceneKey → open count
  totalOpenRevisionCount: number;
  isLoading: boolean;
  lastLoadTime: number | null;

  loadRevisions: () => Promise<void>;
  addRevisionOptimistic: (revision: CompRevision) => void;
  updateRevisionOptimistic: (id: string, sceneKey: string, updates: Partial<CompRevision>) => void;
  deleteRevisionOptimistic: (id: string) => void;

  createRevision: (input: CreateRevisionInput) => Promise<CompRevision>;

  updateStatus: (
    id: string,
    sceneKey: string,
    status: RevisionStatus,
    extra?: { resolvedBy?: string; resolvedNote?: string },
  ) => Promise<void>;

  deleteRevision: (id: string, sceneKey: string) => Promise<void>;

  getRevisionsForScene: (sceneKey: string) => CompRevision[];
  getOpenCount: (sceneKey: string) => number;
}

function buildCountMap(revisions: CompRevision[]): Record<string, number> {
  return revisionService.buildOpenRevisionCountMap(revisions);
}

function buildRevisionContextSignature(episodes: Episode[]): string {
  return episodes
    .map((episode) => episode.parts
      .map((part) => `${part.sheetName}:${part.scenes.map((scene) => scene.sceneId.trim().toLowerCase()).join(',')}`)
      .join('|'))
    .join('||');
}

function countOpenRevisions(revisions: CompRevision[]): number {
  const openRevisionIds = new Set<string>();
  revisions.forEach((revision) => {
    if (revision.status !== 'resolved') {
      openRevisionIds.add(revision.id);
    }
  });
  return openRevisionIds.size;
}

function getRevisionLookupKeys(sceneKey: string): Set<string> {
  return new Set(revisionService.getRevisionLookupSceneKeys(sceneKey));
}

export const useRevisionStore = create<RevisionState>((set, get) => ({
  revisions: [],
  revisionCountByScene: {},
  totalOpenRevisionCount: 0,
  isLoading: false,
  lastLoadTime: null,

  loadRevisions: async () => {
    set({ isLoading: true });
    try {
      const all = await revisionService.getAllRevisions();
      set({
        revisions: all,
        revisionCountByScene: buildCountMap(all),
        totalOpenRevisionCount: countOpenRevisions(all),
        lastLoadTime: Date.now(),
      });
    } catch (err) {
      console.error('[리비전 스토어] 로드 실패:', err);
    } finally {
      set({ isLoading: false });
    }
  },

  addRevisionOptimistic: (revision) => {
    set((state) => {
      const revisions = [...state.revisions, revision];
      return {
        revisions,
        revisionCountByScene: buildCountMap(revisions),
        totalOpenRevisionCount: countOpenRevisions(revisions),
      };
    });
  },

  updateRevisionOptimistic: (id, sceneKey, updates) => {
    set((state) => {
      const lookupKeys = getRevisionLookupKeys(sceneKey);
      const revisions = state.revisions.map((r) =>
        r.id === id && lookupKeys.has(r.sceneKey) ? { ...r, ...updates } : r,
      );
      return {
        revisions,
        revisionCountByScene: buildCountMap(revisions),
        totalOpenRevisionCount: countOpenRevisions(revisions),
      };
    });
  },

  deleteRevisionOptimistic: (id) => {
    set((state) => {
      const revisions = state.revisions.filter((r) => r.id !== id);
      return {
        revisions,
        revisionCountByScene: buildCountMap(revisions),
        totalOpenRevisionCount: countOpenRevisions(revisions),
      };
    });
  },

  createRevision: async (input) => {
    const revision = await revisionService.createRevision(input);
    get().addRevisionOptimistic(revision);
    return revision;
  },

  deleteRevision: async (id, sceneKey) => {
    get().deleteRevisionOptimistic(id);
    try {
      await revisionService.deleteRevision(id, sceneKey);
    } catch (err) {
      // Codex 리뷰 #6 P2: stale snapshot 복원은 in-flight 간 들어온 realtime/로컬 변경을
      // 덮어쓸 수 있음. 서버에서 재로드해 실제 상태와 동기화한다.
      console.error('[리비전 스토어] 삭제 실패 → 서버 재로드:', err);
      await get().loadRevisions();
      throw err;
    }
  },

  updateStatus: async (id, sceneKey, status, extra) => {
    const now = new Date().toISOString();
    // 낙관적 업데이트
    get().updateRevisionOptimistic(id, sceneKey, {
      status,
      updatedAt: now,
      ...(status === 'resolved'
        ? { resolvedAt: now, resolvedBy: extra?.resolvedBy, resolvedNote: extra?.resolvedNote }
        : { resolvedAt: undefined, resolvedBy: undefined, resolvedNote: undefined }),
    });

    try {
      await revisionService.updateRevisionStatus(id, sceneKey, status, extra);
    } catch (err) {
      console.error('[리비전 스토어] 상태 업데이트 실패:', err);
      // 롤백: 다시 로드
      await get().loadRevisions();
    }
  },

  getRevisionsForScene: (sceneKey) => {
    const lookupKeys = getRevisionLookupKeys(sceneKey);
    return get().revisions.filter((r) => lookupKeys.has(r.sceneKey));
  },

  getOpenCount: (sceneKey) => {
    const lookupKeys = getRevisionLookupKeys(sceneKey);
    return get().revisions.filter((r) =>
      lookupKeys.has(r.sceneKey) && r.status !== 'resolved',
    ).length;
  },
}));

let lastRevisionContextSignature = buildRevisionContextSignature(useDataStore.getState().episodes);

useDataStore.subscribe((state, previousState) => {
  if (state.episodes === previousState.episodes) return;

  const nextSignature = buildRevisionContextSignature(state.episodes);
  if (nextSignature === lastRevisionContextSignature) return;

  lastRevisionContextSignature = nextSignature;
  useRevisionStore.setState((revisionState) => ({
    revisionCountByScene: buildCountMap(revisionState.revisions),
  }));
});
