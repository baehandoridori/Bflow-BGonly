import { create } from 'zustand';
import type { CompRevision, Episode, RevisionStatus } from '@/types';
import * as revisionService from '@/services/revisionService';
import { useDataStore } from '@/stores/useDataStore';
import {
  startAssignee, completeAssignee, revertAssignee, deriveRevisionStatus, sanitizeAssignees,
} from '@/utils/revisionWorkflow';
import { buildRevisionAssigneeCompletionNotifyUserIds } from '@/utils/revisionNotificationRecipients';

/**
 * v1.18.0: 리테이크 등록 input. 우선순위/프레임/담당자 입력 UI 가 폼에서 제거되어
 * (한솔 결정 — spec 2026-05-03) 자동값으로 처리. 호출자는 sceneKey/description/이미지/
 * 알림 대상자/부서/등록자 정보만 전달.
 */
export interface CreateRevisionInput {
  /** 씬 매인 항목은 필수. 허브 '전반' 항목은 미지정. */
  sceneKey?: string;
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
  /** 생성 시 담당자 지정 (리테이크 허브 2단계). 항상 notifyUserIds 부분집합으로 보정됨. */
  assigneeIds?: string[];
  /** 리테이크 세트 소속(허브 항목 추가). */
  setId?: string | null;
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

  // ─── 담당 워크플로우 (리테이크 허브 1단계) ─────────────
  startAssignee: (rev: CompRevision, userId: string) => Promise<void>;
  completeAssignee: (rev: CompRevision, userId: string, note: string, notifyUserIds?: string[], completerName?: string) => Promise<void>;
  reassign: (rev: CompRevision, nextAssigneeIds: string[]) => Promise<void>;
  finalResolve: (rev: CompRevision, byName: string) => Promise<void>;
  revertFinalResolve: (rev: CompRevision) => Promise<void>;
  revertAssignee: (rev: CompRevision, userId: string) => Promise<void>;

  deleteRevision: (id: string, sceneKey: string) => Promise<void>;

  getRevisionsForScene: (sceneKey: string) => CompRevision[];
  getOpenCount: (sceneKey: string) => number;
}

function buildCountMap(revisions: CompRevision[]): Record<string, number> {
  return revisionService.buildOpenRevisionCountMap(revisions);
}

/**
 * 세트(set_id)에 속한 리비전의 status/membership 이 바뀌면 그 세트의 자동완료를 재계산한다(코덱스 P2).
 * 허브 뷰를 안 보고 있어도 일반 씬 패널의 최종완료/되돌리기/삭제가 comp_revision_sets.status 에 반영되게 한다.
 * revisionSetService 와 순환 의존이라 동적 import + fire-and-forget(상태 변경 흐름을 막지도 실패시키지도 않음).
 */
function syncSetForRevision(setId: string | null | undefined): void {
  if (!setId) return;
  void import('@/services/revisionSetService')
    .then((m) => m.recomputeSetCompletion(setId))
    .catch((err) => console.error('[리테이크 세트] 자동완료 재계산 실패:', err));
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
      console.error('[리테이크 스토어] 로드 실패:', err);
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
    // 세트 소속(허브 항목)이면 세트 status(open/done) 재평가 — 새 open 항목이 done 세트를 open 으로 되돌림.
    syncSetForRevision(revision.setId);
    return revision;
  },

  deleteRevision: async (id, sceneKey) => {
    const setId = get().revisions.find((r) => r.id === id)?.setId;
    get().deleteRevisionOptimistic(id);
    try {
      await revisionService.deleteRevision(id, sceneKey);
    } catch (err) {
      // Codex 리뷰 #6 P2: stale snapshot 복원은 in-flight 간 들어온 realtime/로컬 변경을
      // 덮어쓸 수 있음. 서버에서 재로드해 실제 상태와 동기화한다.
      console.error('[리테이크 스토어] 삭제 실패 → 서버 재로드:', err);
      await get().loadRevisions();
      throw err;
    }
    syncSetForRevision(setId); // 세트 항목이 삭제되면 그 세트 자동완료 재계산(빈 세트 open 복귀 등)
  },

  updateStatus: async (id, sceneKey, status, extra) => {
    const setId = get().revisions.find((r) => r.id === id)?.setId;
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
      console.error('[리테이크 스토어] 상태 업데이트 실패:', err);
      // 롤백: 다시 로드
      await get().loadRevisions();
    }
    syncSetForRevision(setId); // resolved 진입/이탈이 세트 진행률을 바꾸므로 세트 자동완료 재계산
  },

  // ─── 담당 워크플로우 (리테이크 허브 1단계) ─────────────
  // 모두 낙관적 업데이트 → 서비스 호출 → 실패 시 서버 재로드(롤백).

  // Codex P1 완화: 담당 상태 전이는 액션 직전 store 최신 스냅샷(realtime 반영)을 merge base 로 사용한다.
  // rev prop 이 stale 이면(다른 담당자가 그 사이 done 처리) 그 담당자 상태를 덮어써 완료가 손실되므로,
  // get().revisions 의 최신 행에서 assigneeStates/assigneeIds 를 다시 읽어 본인 키만 갱신한다.
  startAssignee: async (rev, userId) => {
    const cur = get().revisions.find((r) => r.id === rev.id) ?? rev;
    if (cur.finalResolvedAt) return; // 최종완료 상태에선 담당 전이 차단 (spec §6.2 — resolved 는 final 유무로만 이탈)
    const now = new Date().toISOString();
    const states = startAssignee(cur.assigneeStates ?? {}, userId, now);
    const status = deriveRevisionStatus(cur.assigneeIds ?? [], states, cur.finalResolvedAt);
    get().updateRevisionOptimistic(rev.id, rev.sceneKey, { assigneeStates: states, status, updatedAt: now });
    markSelfFromStatus(rev.id, status);
    try { await revisionService.startAssigneeWork(cur, userId); }
    catch { await get().loadRevisions(); }
  },

  completeAssignee: async (rev, userId, note, notifyUserIds, completerName) => {
    const cur = get().revisions.find((r) => r.id === rev.id) ?? rev;
    if (cur.finalResolvedAt) return; // 최종완료 상태에선 담당 전이 차단 (spec §6.2)
    const now = new Date().toISOString();
    const recipients = buildRevisionAssigneeCompletionNotifyUserIds({
      notifyUserIds: cur.notifyUserIds,
      requesterId: cur.requesterId,
      selectedUserIds: notifyUserIds,
      completerId: userId,
    });
    const states = completeAssignee(cur.assigneeStates ?? {}, userId, note, now);
    states[userId] = {
      ...states[userId],
      completionNotifyUserIds: recipients,
      completedByName: completerName || userId,
    };
    const status = deriveRevisionStatus(cur.assigneeIds ?? [], states, cur.finalResolvedAt);
    get().updateRevisionOptimistic(rev.id, rev.sceneKey, { assigneeStates: states, status, updatedAt: now });
    markSelfFromStatus(rev.id, status);
    try {
      await revisionService.completeAssigneeWork(cur, userId, note, recipients, completerName || userId, now);
      if (recipients.length > 0) {
        await revisionService.dispatchRetakeAssigneeCompletionNotification({
          revisionId: cur.id,
          sceneKey: cur.sceneKey,
          setId: cur.setId ?? null,
          revisionNo: cur.revisionNo,
          senderId: userId,
          senderName: completerName || userId,
          recipients,
          note,
          status,
          updatedAt: now,
        });
      }
    }
    catch { await get().loadRevisions(); }
  },

  reassign: async (rev, nextAssigneeIds) => {
    const now = new Date().toISOString();
    const { assigneeIds, assigneeStates } = sanitizeAssignees(nextAssigneeIds, rev.assigneeStates ?? {}, rev.notifyUserIds ?? []);
    // 담당 (재)배정 시 legacy/백필 final 잔재 clear (Codex P1) — final 무시로 파생 + 낙관 패치도 비움.
    const status = deriveRevisionStatus(assigneeIds, assigneeStates, null);
    get().updateRevisionOptimistic(rev.id, rev.sceneKey, { assigneeIds, assigneeStates, status, finalResolvedAt: undefined, finalResolvedBy: undefined, updatedAt: now });
    markSelfFromStatus(rev.id, status); // 재배정이 status 전이를 동반하면 그 알림을 본인에게서 억제
    try { await revisionService.reassignRevision(rev, nextAssigneeIds); }
    catch { await get().loadRevisions(); }
  },

  finalResolve: async (rev, byName) => {
    const now = new Date().toISOString();
    get().updateRevisionOptimistic(rev.id, rev.sceneKey, { finalResolvedAt: now, finalResolvedBy: byName, status: 'resolved', updatedAt: now });
    markSelfRevisionAction(rev.id, 'resolve');
    try { await revisionService.finalResolveRevision(rev, byName); }
    catch { await get().loadRevisions(); }
    syncSetForRevision(rev.setId); // 세트 소속이면 최종완료가 세트 자동완료(done)에 반영되게
  },

  revertFinalResolve: async (rev) => {
    const now = new Date().toISOString();
    const status = deriveRevisionStatus(rev.assigneeIds ?? [], rev.assigneeStates ?? {}, null);
    get().updateRevisionOptimistic(rev.id, rev.sceneKey, { finalResolvedAt: undefined, finalResolvedBy: undefined, status, updatedAt: now });
    markSelfFromStatus(rev.id, status);
    try { await revisionService.revertFinalResolve(rev); }
    catch { await get().loadRevisions(); }
    syncSetForRevision(rev.setId); // 최종완료 되돌리면 세트가 done→open 으로 복귀해야 함
  },

  revertAssignee: async (rev, userId) => {
    const cur = get().revisions.find((r) => r.id === rev.id) ?? rev;
    if (cur.finalResolvedAt) return; // 최종완료 상태면 차단 (spec §6.2)
    const now = new Date().toISOString();
    const states = revertAssignee(cur.assigneeStates ?? {}, userId);
    const status = deriveRevisionStatus(cur.assigneeIds ?? [], states, cur.finalResolvedAt);
    get().updateRevisionOptimistic(rev.id, rev.sceneKey, { assigneeStates: states, status, updatedAt: now });
    markSelfFromStatus(rev.id, status);
    try { await revisionService.revertAssigneeWork(cur, userId); }
    catch { await get().loadRevisions(); }
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

// 리테이크 허브 2단계: 담당 워크플로우 액션도 self-mark 대상에 포함.
// action 값은 App.tsx 알림 핸들러의 status→action 매핑과 동일해야 self-억제가 동작한다.
export type SelfRevisionAction = 'in_progress' | 'assignee_done' | 'resolve';

/** 파생 status → 알림 action. open 은 알림이 없으므로 null(self-mark 불필요). */
export function statusToSelfAction(status: RevisionStatus): SelfRevisionAction | null {
  if (status === 'in_progress') return 'in_progress';
  if (status === 'assignee_done') return 'assignee_done';
  if (status === 'resolved') return 'resolve';
  return null;
}

export function markSelfRevisionAction(revisionId: string, action: SelfRevisionAction): void {
  const key = `${revisionId}:${action}`;
  _recentSelfRevisionActions.set(key, Date.now());
  setTimeout(() => {
    const ts = _recentSelfRevisionActions.get(key);
    if (ts && Date.now() - ts >= SELF_ACTION_TTL_MS) {
      _recentSelfRevisionActions.delete(key);
    }
  }, SELF_ACTION_TTL_MS + 100);
}

export function isRecentSelfRevisionAction(revisionId: string, action: SelfRevisionAction): boolean {
  const key = `${revisionId}:${action}`;
  const ts = _recentSelfRevisionActions.get(key);
  if (!ts) return false;
  if (Date.now() - ts >= SELF_ACTION_TTL_MS) {
    _recentSelfRevisionActions.delete(key);
    return false;
  }
  return true;
}

/** 파생 status 로부터 알림 action 을 정해 self-mark. open(알림 없음)이면 아무것도 안 함. */
function markSelfFromStatus(revisionId: string, status: RevisionStatus): void {
  const action = statusToSelfAction(status);
  if (action) markSelfRevisionAction(revisionId, action);
}
