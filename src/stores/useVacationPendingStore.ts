/**
 * 휴가 등록 pending 상태 스토어
 *
 * 휴가 등록 요청을 낙관적으로 UI에 반영하기 위한 임시 pending 이벤트 저장소.
 * - 등록 버튼 누르는 즉시 pending 이벤트 추가 → 노란색으로 위젯/캘린더에 표시
 * - API 성공 시 제거 + 완료 브로드캐스트 → 전 창 토스트
 * - API 실패 시 제거 + 실패 브로드캐스트
 * - 30초 타임아웃: 메인 창(App.tsx) 전용 주기적 clearStale 호출
 * - 영속화: pendingVacations.json (AppData) — 화면 전환/재시작에도 유지
 */

import { create } from 'zustand';
import type { VacationEvent } from '@/types/vacation';

export interface PendingVacationEvent extends VacationEvent {
  status: 'pending';
  pendingId: string;
  createdAt: number;
  reason?: string;
}

interface Store {
  pending: PendingVacationEvent[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  add: (ev: PendingVacationEvent) => Promise<void>;
  remove: (pendingId: string) => Promise<void>;
  /** 제한 시간 경과 항목을 제거하고 제거된 항목을 반환 */
  clearStale: (olderThanMs: number) => Promise<PendingVacationEvent[]>;
}

export const useVacationPendingStore = create<Store>((set, get) => ({
  pending: [],
  hydrated: false,
  hydrate: async () => {
    try {
      const list = (await window.electronAPI?.vacationPendingLoad?.()) as
        | PendingVacationEvent[]
        | null
        | undefined;
      set({ pending: list ?? [], hydrated: true });
    } catch (err) {
      console.warn('[vacation:pending] hydrate 실패', err);
      set({ pending: [], hydrated: true });
    }
  },
  add: async (ev) => {
    const prev = get().pending;
    const next = [...prev, ev];
    set({ pending: next });
    const result = await window.electronAPI?.vacationPendingSave?.(next);
    // 디스크 쓰기 실패(권한/용량/손상 등) — 메모리 rollback 후 throw.
    // window.electronAPI 자체가 없는 dev 환경에서는 result === undefined → skip.
    if (result && (result as { ok: boolean }).ok === false) {
      set({ pending: prev });
      throw new Error('pending 저장 실패: 디스크 쓰기 실패');
    }
    // 다른 창(팝업 등)이 hydrate하여 노란 pending 상태 동기화 — 송신자는 excludeSenderId로 제외
    await window.electronAPI?.vacationBroadcastPendingChanged?.();
  },
  remove: async (pendingId) => {
    const prev = get().pending;
    const next = prev.filter((p) => p.pendingId !== pendingId);
    set({ pending: next });
    const result = await window.electronAPI?.vacationPendingSave?.(next);
    if (result && (result as { ok: boolean }).ok === false) {
      set({ pending: prev });
      throw new Error('pending 저장 실패: 디스크 쓰기 실패');
    }
    await window.electronAPI?.vacationBroadcastPendingChanged?.();
  },
  clearStale: async (olderThanMs) => {
    const now = Date.now();
    const prev = get().pending;
    const stale = prev.filter((p) => now - p.createdAt >= olderThanMs);
    if (stale.length === 0) return [];
    const next = prev.filter((p) => now - p.createdAt < olderThanMs);
    set({ pending: next });
    const result = await window.electronAPI?.vacationPendingSave?.(next);
    if (result && (result as { ok: boolean }).ok === false) {
      set({ pending: prev });
      throw new Error('pending 저장 실패: 디스크 쓰기 실패');
    }
    await window.electronAPI?.vacationBroadcastPendingChanged?.();
    return stale;
  },
}));
