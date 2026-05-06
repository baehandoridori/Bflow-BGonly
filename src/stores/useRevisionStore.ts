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

    // 코덱스 P2 fix (4차, 2026-05-05): 본인 액션 self-mark — Realtime UPDATE 가 본인이 일으킨
    // 변경이면 알림 스킵하기 위함. resolved_by 컬럼이 'in_progress' 변경에는 안 채워져
    // 기존 가드(`resolved_by === me.name`) 가 in_progress 자기 액션을 못 걸렀던 문제 해결.
    if (status === 'in_progress' || status === 'resolved') {
      const action = status === 'resolved' ? 'resolve' : 'in_progress';
      markSelfRevisionAction(id, action);
    }

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

// ─── 본인 액션 self-mark (코덱스 P2 fix 4차, 2026-05-05) ──────────────────
// updateStatus 호출 시 5초 동안 그 revisionId+action 을 마크. App.tsx Realtime UPDATE
// 핸들러가 이 마크를 체크해서 본인이 일으킨 변경의 알림은 스킵.
// resolved_by 컬럼은 'resolved' 변경 시에만 채워져 in_progress 자기 액션을 못 걸렀음.

const SELF_ACTION_TTL_MS = 5000;
const _recentSelfRevisionActions = new Map<string, number>();

export function markSelfRevisionAction(revisionId: string, action: 'in_progress' | 'resolve'): void {
  const key = `${revisionId}:${action}`;
  _recentSelfRevisionActions.set(key, Date.now());
  setTimeout(() => {
    const ts = _recentSelfRevisionActions.get(key);
    if (ts && Date.now() - ts >= SELF_ACTION_TTL_MS) {
      _recentSelfRevisionActions.delete(key);
    }
  }, SELF_ACTION_TTL_MS + 100);
}

export function isRecentSelfRevisionAction(revisionId: string, action: 'in_progress' | 'resolve'): boolean {
  const key = `${revisionId}:${action}`;
  const ts = _recentSelfRevisionActions.get(key);
  if (!ts) return false;
  if (Date.now() - ts >= SELF_ACTION_TTL_MS) {
    _recentSelfRevisionActions.delete(key);
    return false;
  }
  return true;
}
