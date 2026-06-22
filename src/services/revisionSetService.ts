/**
 * 리테이크 세트 서비스 (리테이크 허브 5단계 — Chunk D)
 *
 * comp_revision_sets 테이블 동기화. revisionService 패턴 미러링:
 * - 모든 변경은 useRevisionSetStore 낙관적 업데이트 → electronAPI 호출 → 실패 시 롤백.
 * - 세트 편입/해제는 기존 revisionService.reassign 경로가 아니라 리비전의 set_id 만 갱신한다.
 *
 * 순수 진행률·자동완료 로직은 src/utils/revisionSet.ts (computeSetProgress / nextSetStatus).
 */

import type { CompRevisionSet } from '../types';
import { nextSetStatus, type SetItemLike } from '../utils/revisionSet';
import { useRevisionSetStore } from '../stores/useRevisionSetStore';
import { useRevisionStore } from '../stores/useRevisionStore';
import { setRevisionSet } from './revisionService';

type CreateRevisionSetInput = Parameters<typeof window.electronAPI.supabaseAddRevisionSet>[0];
type PatchRevisionSetFields = Parameters<typeof window.electronAPI.supabaseUpdateRevisionSet>[1];

/** 세트 전체 로딩 → 스토어 반영. */
export async function loadRevisionSets(): Promise<CompRevisionSet[]> {
  const store = useRevisionSetStore.getState();
  store.setLoading(true);
  try {
    const sets = await window.electronAPI.supabaseReadRevisionSets();
    store.setSets(sets ?? []);
    return sets ?? [];
  } catch (err) {
    console.error('[리테이크 세트] 로드 실패:', err);
    return [];
  } finally {
    store.setLoading(false);
  }
}

/**
 * 세트 생성 — 낙관적 추가 후 서버 반영.
 * 서버가 반환한 실제 세트(id/타임스탬프 확정)로 낙관적 임시본을 교체한다.
 */
export async function createRevisionSet(input: CreateRevisionSetInput): Promise<CompRevisionSet | null> {
  const store = useRevisionSetStore.getState();
  const now = new Date().toISOString();
  const tempId = `temp-set-${crypto.randomUUID()}`;
  const optimistic: CompRevisionSet = {
    id: tempId,
    title: input.title,
    episodeNumber: input.episodeNumber ?? null,
    department: input.department ?? null,
    aggregatorId: input.aggregatorId ?? null,
    status: 'open',
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };
  store.addSetOptimistic(optimistic);

  try {
    const created = await window.electronAPI.supabaseAddRevisionSet(input);
    // 낙관적 임시본 → 서버 확정본 교체 (id 갱신).
    store.replaceSet(tempId, created);
    return created;
  } catch (err) {
    console.error('[리테이크 세트] 생성 실패 → 롤백:', err);
    store.removeSetOptimistic(tempId);
    return null;
  }
}

/** 세트 필드 수정 — 낙관적 패치 후 서버 반영. 실패 시 서버 재로드로 동기화. */
export async function patchRevisionSet(id: string, fields: PatchRevisionSetFields): Promise<boolean> {
  const store = useRevisionSetStore.getState();
  store.patchSetOptimistic(id, { ...fields, updatedAt: new Date().toISOString() });
  try {
    await window.electronAPI.supabaseUpdateRevisionSet(id, fields);
    return true;
  } catch (err) {
    // 낙관적 스냅샷 복원이 in-flight 변경을 덮어쓸 수 있어 서버 재로드로 동기화.
    console.error('[리테이크 세트] 수정 실패 → 서버 재로드:', err);
    await loadRevisionSets();
    return false;
  }
}

/** 세트 삭제 — 낙관적 제거 후 서버 반영. 실패 시 서버 재로드로 동기화. */
export async function removeRevisionSet(id: string): Promise<boolean> {
  const store = useRevisionSetStore.getState();
  store.removeSetOptimistic(id);
  try {
    await window.electronAPI.supabaseDeleteRevisionSet(id);
    return true;
  } catch (err) {
    console.error('[리테이크 세트] 삭제 실패 → 서버 재로드:', err);
    await loadRevisionSets();
    return false;
  }
}

/**
 * 리비전의 setId 를 낙관 패치 → 서버 반영 → 실패 시 리비전 스토어 재로드(롤백).
 * useRevisionStore 의 기존 updateRevisionOptimistic / loadRevisions 를 재사용한다(신규 액션 불필요).
 */
async function changeRevisionSet(revisionId: string, setId: string | null): Promise<void> {
  const revStore = useRevisionStore.getState();
  const rev = revStore.revisions.find((r) => r.id === revisionId);
  if (!rev) {
    console.warn('[리테이크 세트] 대상 리비전 없음 — 편입/해제 스킵:', revisionId);
    return;
  }
  revStore.updateRevisionOptimistic(rev.id, rev.sceneKey, { setId });
  try {
    await setRevisionSet(rev, setId);
  } catch (err) {
    console.error('[리테이크 세트] 편입/해제 실패 → 리비전 재로드:', err);
    await useRevisionStore.getState().loadRevisions();
    throw err;
  }
}

/** 리비전을 세트에 편입 — 해당 리비전의 setId 를 setId 로 갱신. */
export async function assignToSet(revisionId: string, setId: string): Promise<void> {
  await changeRevisionSet(revisionId, setId);
}

/** 리비전을 세트에서 해제 — setId 를 null 로. */
export async function removeFromSet(revisionId: string): Promise<void> {
  await changeRevisionSet(revisionId, null);
}

/**
 * 하위 항목 상태로부터 세트 자동완료 동기화.
 *
 * - items 는 호출자(허브 뷰, Chunk E)가 useRevisionStore 에서 set_id 로 필터해 넘긴다.
 *   서비스는 순수하게 비교·업데이트만 한다.
 * - nextSetStatus(items) 가 set.status 와 다를 때만 patch (중복 쓰기 방지 — no-op 가드).
 * - 빈 세트(items 0개)는 nextSetStatus 가 'open' 이므로, done 세트가 모든 하위를 잃으면
 *   open 으로 되돌아간다 (스펙 §9.5).
 *
 * @returns status 를 실제로 변경했으면 true, no-op 면 false.
 */
export async function maybeAutoCompleteSet(
  set: CompRevisionSet,
  items: readonly SetItemLike[],
): Promise<boolean> {
  const next = nextSetStatus(items);
  if (next === set.status) return false; // no-op — 중복 쓰기 방지
  await patchRevisionSet(set.id, { status: next });
  return true;
}
