/**
 * 컴포지팅 대시보드 — 단계 변경 / 오류 사유 업데이트 액션 (낙관적 + Supabase sync).
 *
 * spec: 2026-05-21-compositing-dashboard-design.md (11.2)
 *
 * 패턴:
 *   1. UI 즉시 반영 (useDataStore.setCompositingState)
 *   2. Supabase UPSERT
 *   3. 성공: 서버 응답으로 store 다시 overwrite
 *   4. 실패: prev 로 롤백 + sonner.error
 *
 * 다른 사용자의 변경은 Realtime UPDATE 이벤트로 자동 수신 — caller 가 별도 호출 X.
 */

import { toast as sonnerToast } from 'sonner';
import type { CompositingErrorKind, CompositingState, CompositingStatus } from '@/types';
import { useDataStore, compositingKey } from '@/stores/useDataStore';
import { setCompositingState } from '@/services/supabaseService';

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
    // 3. 서버 응답으로 overwrite — id 가 'pending' 이었던 경우 진짜 uuid 로 교체.
    useDataStore.getState().setCompositingState(key, row);
  } catch (err) {
    // 4. 실패 → 롤백
    if (prev) useDataStore.getState().setCompositingState(key, prev);
    else useDataStore.getState().deleteCompositingState(key);
    const msg = err instanceof Error ? err.message : String(err);
    sonnerToast.error('단계 변경에 실패했어요', { description: msg });
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
    useDataStore.getState().setCompositingState(key, row);
  } catch (err) {
    useDataStore.getState().setCompositingState(key, prev);
    const msg = err instanceof Error ? err.message : String(err);
    sonnerToast.error('오류 사유 변경 실패', { description: msg });
  }
}
