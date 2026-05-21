/**
 * 컴포지팅 대시보드 — 단계 변경 / 오류 사유 업데이트 액션 (낙관적 + Supabase sync).
 *
 * spec: 2026-05-21-compositing-dashboard-design.md (11.2)
 *
 * 패턴:
 *   1. UI 즉시 반영 (useDataStore.setCompositingState)
 *   2. Supabase UPSERT
 *   3. 성공: 서버 응답으로 store 다시 overwrite — 단, "본인이 발행한 최신 mutation 이 아니면 무시"
 *   4. 실패: prev 로 롤백 + sonner.error — 단, 동일 조건
 *
 * 다른 사용자의 변경은 Realtime UPDATE 이벤트로 자동 수신 — caller 가 별도 호출 X.
 *
 * ─── stale response 가드 (코덱스 2차 P1) ───
 * 빠른 단계 변경 (rapid clicks / 1~6 단축키) 시 여러 mutate 가 in-flight 상태가 되고,
 * 응답이 out-of-order 로 도착하면 옛 응답이 새 상태를 덮어써 UI 가 stale 한 단계로 되돌리는 문제.
 * → 씬 단위 monotonic sequence 를 모듈 스코프에 보관, 호출 시점 sequence 를 캡처하여
 *   응답 도착 시 "여전히 그 sceneKey 의 최신 in-flight 인가" 만 store 에 반영.
 *   더 새로운 mutation 이 이미 발행됐다면 그 응답이 결국 도착하므로, 이 옛 응답은 안전하게 폐기.
 */

import { toast as sonnerToast } from 'sonner';
import type { CompositingErrorKind, CompositingState, CompositingStatus } from '@/types';
import { useDataStore, compositingKey } from '@/stores/useDataStore';
import { setCompositingState } from '@/services/supabaseService';

// 모듈 스코프 — 모든 mutate 가 공유. 씬 단위 monotonic 카운터.
const sceneSeq = new Map<string, number>();

function nextSeq(key: string): number {
  const v = (sceneSeq.get(key) ?? 0) + 1;
  sceneSeq.set(key, v);
  return v;
}

function isLatest(key: string, seq: number): boolean {
  return sceneSeq.get(key) === seq;
}

interface ToggleArgs {
  episodeNumber: number;
  sceneId: string;
  partId: string;
  next: CompositingStatus;
  currentUserId: string;
}

export async function toggleCompositingStatus({
  episodeNumber, sceneId, partId, next, currentUserId,
}: ToggleArgs): Promise<void> {
  const key = compositingKey(episodeNumber, sceneId);
  const store = useDataStore.getState();
  const prev = store.compositingStates.get(key);
  const seq = nextSeq(key);

  // 1. 낙관적 — UI 즉시 반영
  const optimistic: CompositingState = {
    id: prev?.id ?? 'pending',
    episodeNumber,
    sceneId,
    partId,
    status: next,
    // 단계 변경 시 error 관련 필드 정리 (다른 단계로 갈 때)
    errorKind: next === 'error' ? prev?.errorKind ?? null : null,
    errorNote: next === 'error' ? prev?.errorNote ?? null : null,
    progressPercent: prev?.progressPercent ?? 0,
    updatedAt: new Date().toISOString(),
    updatedBy: currentUserId,
  };
  store.setCompositingState(key, optimistic);

  // 2. Supabase UPSERT
  try {
    const row = await setCompositingState({
      episodeNumber, sceneId, partId,
      status: next,
      errorKind: optimistic.errorKind,
      errorNote: optimistic.errorNote,
      progressPercent: optimistic.progressPercent,
      updatedBy: currentUserId,
    });
    // 3. 본인이 발행한 최신 mutation 일 때만 서버 응답으로 overwrite.
    //    더 새로운 mutation 이 진행 중이면 그 응답이 결국 도착하므로 이 옛 응답은 무시.
    if (isLatest(key, seq)) {
      useDataStore.getState().setCompositingState(key, row);
    }
  } catch (err) {
    // 4. 실패 → 본인이 최신 일 때만 롤백 + 토스트. 옛 mutation 의 실패는 옛 상태 보존 의미 없음.
    if (isLatest(key, seq)) {
      if (prev) useDataStore.getState().setCompositingState(key, prev);
      else useDataStore.getState().deleteCompositingState(key);
      const msg = err instanceof Error ? err.message : String(err);
      sonnerToast.error('단계 변경에 실패했어요', { description: msg });
    }
  }
}

interface UpdateErrorArgs {
  episodeNumber: number;
  sceneId: string;
  partId: string;
  currentUserId: string;
  errorKind: CompositingErrorKind | null;
  errorNote: string | null;
}

export async function updateCompositingError({
  episodeNumber, sceneId, partId, currentUserId, errorKind, errorNote,
}: UpdateErrorArgs): Promise<void> {
  const key = compositingKey(episodeNumber, sceneId);
  const store = useDataStore.getState();
  const prev = store.compositingStates.get(key);
  if (!prev) return; // status='error' 가 아닐 때는 update 불가 (caller 가 보장)

  const seq = nextSeq(key);

  const optimistic: CompositingState = {
    ...prev,
    errorKind,
    errorNote,
    updatedAt: new Date().toISOString(),
    updatedBy: currentUserId,
  };
  store.setCompositingState(key, optimistic);

  try {
    const row = await setCompositingState({
      episodeNumber, sceneId, partId,
      status: prev.status,
      errorKind,
      errorNote,
      progressPercent: prev.progressPercent,
      updatedBy: currentUserId,
    });
    if (isLatest(key, seq)) {
      useDataStore.getState().setCompositingState(key, row);
    }
  } catch (err) {
    if (isLatest(key, seq)) {
      useDataStore.getState().setCompositingState(key, prev);
      const msg = err instanceof Error ? err.message : String(err);
      sonnerToast.error('오류 사유 변경 실패', { description: msg });
    }
  }
}
