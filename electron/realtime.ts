import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from './supabase';

// ─── Realtime 구독 관리 ────────────────────────
// 모든 테이블 변경을 하나의 채널로 구독 (무료 플랜 연결 수 절약)

type ChangePayload = RealtimePostgresChangesPayload<Record<string, unknown>>;

export interface RealtimeCallbacks {
  onSceneChange: (payload: ChangePayload) => void;
  onCommentChange: (payload: ChangePayload) => void;
  onRevisionChange: (payload: ChangePayload) => void;
  onEpisodeChange: (payload: ChangePayload) => void;
  onPartChange: (payload: ChangePayload) => void;
  onStatusChange: (status: string) => void;
}

let channel: RealtimeChannel | null = null;

/** Realtime 구독 시작 */
export function setupRealtimeSubscription(callbacks: RealtimeCallbacks): () => void {
  // 기존 채널이 있으면 정리
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }

  channel = supabase
    .channel('bflow-realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'scenes' },
      callbacks.onSceneChange,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'comments' },
      callbacks.onCommentChange,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'comp_revisions' },
      callbacks.onRevisionChange,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'episodes' },
      callbacks.onEpisodeChange,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'parts' },
      callbacks.onPartChange,
    )
    .subscribe((status) => {
      callbacks.onStatusChange(status);
    });

  // cleanup 함수 반환
  return () => {
    if (channel) {
      supabase.removeChannel(channel);
      channel = null;
    }
  };
}

/** Realtime 구독 해제 */
export function teardownRealtime(): void {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
}
