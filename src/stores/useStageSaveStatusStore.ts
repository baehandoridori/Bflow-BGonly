/**
 * 단계 체크 저장 상태 — '다시 보내는 중' 칸과 방금 되돌린 칸 (움직임 폴리싱 20번 safety-net).
 *
 * 씬 목록 화면(ScenesView)의 저장 경로가 쓰고, 세 버튼 묶음(LO/완료/검수/PNG 칸 · 액팅 칩 · 담당자별 버튼)이
 * 씬 UUID 로 골라 읽는다. 카드·시트·상세 창 어디에 떠 있든 같은 칸에 같은 표시가 붙는다.
 *
 * - retrying[씬 UUID][저장 묶음 key] = 칸 이름 목록. 묶음(씬 단위 칸 / 액팅 칩 / 담당자별)마다 따로 지운다.
 * - rollbacks[씬 UUID] = { at, cells } — at 이 바뀔 때마다 표시가 다시 시작된다(key 재마운트). 테두리가
 *   다 사라지면 지운다(카드가 나중에 다시 그려져도 되풀이되지 않게).
 * 칸 이름 규칙은 src/components/scenes/stageSaveFeedback.ts.
 */
import { create } from 'zustand';
// node --test 가 그대로 import 하도록 상대 경로(.ts 까지).
import { ROLLBACK_FLASH_CLEAR_MS } from '../components/scenes/stageSaveFeedback.ts';

export interface StageRollbackFlash {
  at: number;
  cells: readonly string[];
}

interface StageSaveStatusState {
  retrying: Record<string, Record<string, readonly string[]>>;
  rollbacks: Record<string, StageRollbackFlash>;
  setRetrying: (sceneUuid: string, slot: string, cells: readonly string[]) => void;
  clearRetrying: (sceneUuid: string, slot: string) => void;
  flashRollback: (sceneUuid: string, cells: readonly string[]) => void;
}

let flashSeq = 0;

export const useStageSaveStatusStore = create<StageSaveStatusState>((set, get) => ({
  retrying: {},
  rollbacks: {},

  setRetrying: (sceneUuid, slot, cells) => {
    if (cells.length === 0) {
      get().clearRetrying(sceneUuid, slot);
      return;
    }
    set((state) => ({
      retrying: {
        ...state.retrying,
        [sceneUuid]: { ...state.retrying[sceneUuid], [slot]: [...cells] },
      },
    }));
  },

  clearRetrying: (sceneUuid, slot) => {
    const bySlot = get().retrying[sceneUuid];
    if (!bySlot || !(slot in bySlot)) return;
    set((state) => {
      const rest = { ...state.retrying[sceneUuid] };
      delete rest[slot];
      const next = { ...state.retrying };
      if (Object.keys(rest).length === 0) delete next[sceneUuid];
      else next[sceneUuid] = rest;
      return { retrying: next };
    });
  },

  flashRollback: (sceneUuid, cells) => {
    if (cells.length === 0) return;
    // 같은 밀리초에 두 번 와도 다시 시작되게 순번을 섞는다.
    const at = Date.now() * 1000 + (flashSeq++ % 1000);
    set((state) => ({ rollbacks: { ...state.rollbacks, [sceneUuid]: { at, cells: [...cells] } } }));
    setTimeout(() => {
      if (get().rollbacks[sceneUuid]?.at !== at) return;
      set((state) => {
        const next = { ...state.rollbacks };
        delete next[sceneUuid];
        return { rollbacks: next };
      });
    }, ROLLBACK_FLASH_CLEAR_MS);
  },
}));
