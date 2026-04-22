import { create } from 'zustand';
import type { BulkUpdateResult } from '@/types';

// ─── 일괄 작업 상태 타입 ──────────────────────────

export type OpKind = 'delete' | 'stage-toggle' | 'field-edit';
export type OpStatus = 'in-flight' | 'complete' | 'partial-fail' | 'network-error' | 'cancelled';
export type BulkOpExecutor = (uuids: string[]) => Promise<BulkUpdateResult[]>;
/** 개별 항목 성공 시 useDataStore 등에 반영할 부가 처리. runBulkOp이 kind별로 생성·주입. */
export type BulkOpSideEffect = (sceneUuid: string, result: BulkUpdateResult) => void;

export type PendingOp = {
  id: string;
  kind: OpKind;
  totalCount: number;
  completedCount: number;
  failedItems: Array<{ sceneUuid: string; error: string }>;
  pendingSceneUuids: Set<string>;
  startedAt: number;
  status: OpStatus;
  targetStage?: 'lo' | 'done' | 'review' | 'png';
  /**
   * "다시 시도" 버튼이 직접 호출하는 재전송 함수.
   * 최초 op 시작 시 저장되고, failed uuids만 재전송할 수 있어야 함.
   * (함수라 persist 대상 아님 — 본 스토어는 persist 미사용이므로 무해)
   */
  retryExecutor?: BulkOpExecutor;
  /**
   * 성공 항목마다 실행할 데이터 스토어 반영 로직.
   * runBulkOp 최초 호출에서 kind별 sideeffect를 클로저로 캡처해 저장하고,
   * retryFailed도 동일한 sideeffect를 호출해 retry 성공 시 UI가 stale해지지 않도록 한다.
   */
  retrySideEffect?: BulkOpSideEffect;
};

interface BulkOperationsStore {
  activeOp: PendingOp | null;
  startOp(init: Omit<PendingOp, 'completedCount' | 'failedItems' | 'startedAt' | 'status'>): void;
  markConfirmed(sceneUuid: string): void;
  markFailed(sceneUuid: string, error: string): void;
  setStatus(status: OpStatus): void;
  /** retryFn 미지정 시 activeOp.retryExecutor 사용 */
  retryFailed(retryFn?: BulkOpExecutor): Promise<void>;
  cancel(): void;
  clear(): void;
}

/**
 * totalCount에 도달하면 자동으로 terminal status(complete | partial-fail)로 전이.
 * 그 외에는 현재 status를 유지한다.
 */
function deriveTerminalStatus(op: PendingOp): OpStatus {
  if (op.completedCount + op.failedItems.length === op.totalCount) {
    return op.failedItems.length === 0 ? 'complete' : 'partial-fail';
  }
  return op.status;
}

export const useBulkOperationsStore = create<BulkOperationsStore>((set, get) => ({
  activeOp: null,

  startOp: (init) => {
    set({
      activeOp: {
        ...init,
        completedCount: 0,
        failedItems: [],
        startedAt: Date.now(),
        status: 'in-flight',
        pendingSceneUuids: new Set(init.pendingSceneUuids),
      },
    });
  },

  markConfirmed: (sceneUuid) => {
    const op = get().activeOp;
    if (!op) return;
    // idempotency: 이미 처리된(pending에 없는) UUID는 무시
    if (!op.pendingSceneUuids.has(sceneUuid)) return;
    const nextSet = new Set(op.pendingSceneUuids);
    nextSet.delete(sceneUuid);
    const next: PendingOp = {
      ...op,
      pendingSceneUuids: nextSet,
      completedCount: op.completedCount + 1,
    };
    next.status = deriveTerminalStatus(next);
    set({ activeOp: next });
  },

  markFailed: (sceneUuid, error) => {
    const op = get().activeOp;
    if (!op) return;
    // idempotency: 이미 처리된 UUID는 무시 + 중복 실패 방지
    if (!op.pendingSceneUuids.has(sceneUuid)) return;
    if (op.failedItems.some((f) => f.sceneUuid === sceneUuid)) return;
    const nextSet = new Set(op.pendingSceneUuids);
    nextSet.delete(sceneUuid);
    const next: PendingOp = {
      ...op,
      pendingSceneUuids: nextSet,
      failedItems: [...op.failedItems, { sceneUuid, error }],
    };
    next.status = deriveTerminalStatus(next);
    set({ activeOp: next });
  },

  setStatus: (status) => {
    const op = get().activeOp;
    if (!op) return;
    set({ activeOp: { ...op, status } });
  },

  retryFailed: async (retryFn) => {
    const op = get().activeOp;
    if (!op) return;
    const effectiveFn = retryFn ?? op.retryExecutor;
    if (!effectiveFn) {
      console.warn('[useBulkOperationsStore] retryFailed: no retryExecutor available');
      return;
    }
    // 재시도 대상 = 실패 항목 ∪ 아직 미확정인 pending 항목.
    // network-error 케이스에서는 failedItems가 비어있고 pendingSceneUuids에만 uuid가 남는다.
    // partial-fail 케이스에서는 failedItems에만 들어있다. 합집합으로 양쪽 모두 대응.
    const toRetry = Array.from(
      new Set<string>([
        ...op.failedItems.map((f) => f.sceneUuid),
        ...Array.from(op.pendingSceneUuids),
      ]),
    );
    if (toRetry.length === 0) return;
    // opId를 await 전에 캡처. runBulkOp과 동일한 scope 패턴.
    // 사용자가 retry 진행 중 취소 + 새 op 시작 시 이전 응답이 새 op을 오염시키는 것을 차단.
    const opId = op.id;
    const isStillActive = () => get().activeOp?.id === opId;

    const nextSet = new Set(toRetry);
    set({
      activeOp: {
        ...op,
        status: 'in-flight',
        pendingSceneUuids: nextSet,
        failedItems: [],
      },
    });
    try {
      const results = await effectiveFn(toRetry);
      if (!isStillActive()) return; // op 교체됨 — 응답 무시
      const sideEffect = get().activeOp?.retrySideEffect;
      for (const r of results) {
        if (r.success) {
          get().markConfirmed(r.sceneUuid);
          // runBulkOp과 동일하게 데이터 스토어 반영 (Realtime 에코 지연/누락에 무관하게 UI 최신화)
          sideEffect?.(r.sceneUuid, r);
        } else {
          get().markFailed(r.sceneUuid, r.error ?? 'Unknown error');
        }
      }
    } catch (_e) {
      if (!isStillActive()) return;
      get().setStatus('network-error');
    }
  },

  cancel: () => {
    const op = get().activeOp;
    if (!op) return;
    set({
      activeOp: {
        ...op,
        status: 'cancelled',
        pendingSceneUuids: new Set(),
      },
    });
  },

  clear: () => set({ activeOp: null }),
}));
