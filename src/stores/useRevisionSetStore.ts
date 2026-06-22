import { create } from 'zustand';
import type { CompRevisionSet } from '@/types';

/**
 * 리테이크 세트 스토어 (리테이크 허브 5단계 — Chunk D).
 * useRevisionStore 구조 미러링: 낙관적 add/patch/remove + raw setter(롤백용).
 *
 * 실제 서버 동기화/낙관 롤백 오케스트레이션은 src/services/revisionSetService.ts 가 담당.
 * 이 스토어는 상태 보관 + 낙관 패치 액션만 제공한다.
 */
interface RevisionSetState {
  sets: CompRevisionSet[];
  selectedSetId: string | null;
  loading: boolean;

  // ─── raw setter (서버 로딩/롤백용) ─────────────
  setSets: (sets: CompRevisionSet[]) => void;
  setLoading: (loading: boolean) => void;
  select: (setId: string | null) => void;

  // ─── 낙관적 변경 ─────────────
  addSetOptimistic: (set: CompRevisionSet) => void;
  patchSetOptimistic: (id: string, fields: Partial<CompRevisionSet>) => void;
  removeSetOptimistic: (id: string) => void;
  /** 낙관적 임시본(tempId)을 서버 확정본으로 교체. 못 찾으면 끝에 추가. */
  replaceSet: (tempId: string, next: CompRevisionSet) => void;

  /** 세트 전체 재로딩 (services/revisionSetService.loadRevisionSets 경유). */
  reload: () => Promise<void>;
}

export const useRevisionSetStore = create<RevisionSetState>((set, get) => ({
  sets: [],
  selectedSetId: null,
  loading: false,

  setSets: (sets) => set({ sets }),
  setLoading: (loading) => set({ loading }),
  select: (setId) => set({ selectedSetId: setId }),

  addSetOptimistic: (newSet) => {
    set((state) => ({ sets: [...state.sets, newSet] }));
  },

  patchSetOptimistic: (id, fields) => {
    set((state) => ({
      sets: state.sets.map((s) => (s.id === id ? { ...s, ...fields } : s)),
    }));
  },

  removeSetOptimistic: (id) => {
    set((state) => ({
      sets: state.sets.filter((s) => s.id !== id),
      // 삭제 대상이 선택돼 있으면 선택 해제.
      selectedSetId: state.selectedSetId === id ? null : state.selectedSetId,
    }));
  },

  replaceSet: (tempId, next) => {
    set((state) => {
      const hasTemp = state.sets.some((s) => s.id === tempId);
      // tempId 가 있으면 그 자리에 교체. 없으면(이미 realtime/reload 로 확정본이 들어온 경우)
      // next.id 중복을 피해 추가 — 없을 때만 append (중복 방지).
      let sets: CompRevisionSet[];
      if (hasTemp) {
        sets = state.sets.map((s) => (s.id === tempId ? next : s));
      } else if (state.sets.some((s) => s.id === next.id)) {
        sets = state.sets.map((s) => (s.id === next.id ? next : s));
      } else {
        sets = [...state.sets, next];
      }
      return {
        sets,
        selectedSetId: state.selectedSetId === tempId ? next.id : state.selectedSetId,
      };
    });
  },

  reload: async () => {
    // 동적 import 로 서비스↔스토어 순환 의존을 피한다 (useRevisionStore 패턴 동일).
    const { loadRevisionSets } = await import('@/services/revisionSetService');
    await loadRevisionSets();
  },
}));
