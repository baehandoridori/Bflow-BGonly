import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { createRetryManager } from './retry-utils';

// ─── Realtime 구독 관리 ────────────────────────
// 모든 테이블 변경을 하나의 채널로 구독 (무료 플랜 연결 수 절약)

type ChangePayload = RealtimePostgresChangesPayload<Record<string, unknown>>;

export interface RealtimeCallbacks {
  onSceneChange: (payload: ChangePayload) => void;
  onCommentChange: (payload: ChangePayload) => void;
  onRevisionChange: (payload: ChangePayload) => void;
  onRevisionSetChange?: (payload: ChangePayload) => void;
  onEpisodeChange: (payload: ChangePayload) => void;
  onPartChange: (payload: ChangePayload) => void;
  onSceneWorkLinkChange?: (payload: ChangePayload) => void;
  onActivityInsert: (payload: ChangePayload) => void;
  onStatusChange: (status: string) => void;
}

let channel: RealtimeChannel | null = null;
let savedCallbacks: RealtimeCallbacks | null = null;
const retry = createRetryManager('Realtime');

function createChannel(callbacks: RealtimeCallbacks): RealtimeChannel {
  return supabase
    .channel('bflow-realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'scenes' },
      (payload) => {
        console.log('[Realtime] scenes 이벤트 수신:', payload.eventType, payload.new && (payload.new as Record<string, unknown>).id);
        callbacks.onSceneChange(payload);
      },
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'comments' },
      (payload) => {
        console.log('[Realtime] comments 이벤트 수신:', payload.eventType);
        callbacks.onCommentChange(payload);
      },
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'comp_revisions' },
      (payload) => {
        console.log('[Realtime] comp_revisions 이벤트 수신:', payload.eventType);
        callbacks.onRevisionChange(payload);
      },
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'comp_revision_sets' },
      (payload) => {
        console.log('[Realtime] comp_revision_sets 이벤트 수신:', payload.eventType);
        callbacks.onRevisionSetChange?.(payload);
      },
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'episodes' },
      (payload) => {
        console.log('[Realtime] episodes 이벤트 수신:', payload.eventType);
        callbacks.onEpisodeChange(payload);
      },
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'parts' },
      (payload) => {
        console.log('[Realtime] parts 이벤트 수신:', payload.eventType);
        callbacks.onPartChange(payload);
      },
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'scene_work_links' },
      (payload) => {
        console.log('[Realtime] scene_work_links 이벤트 수신:', payload.eventType);
        callbacks.onSceneWorkLinkChange?.(payload);
      },
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'activity_log' },
      (payload) => {
        // 활동 기록은 INSERT 만 추적 (UPDATE/DELETE 없음)
        callbacks.onActivityInsert(payload);
      },
    );
}

function scheduleRetry(): void {
  if (!savedCallbacks) return;
  const scheduled = retry.schedule(() => {
    if (savedCallbacks) reconnect(savedCallbacks);
  });
  // 최대 재시도 초과 → 영구 실패 알림
  if (!scheduled) {
    savedCallbacks.onStatusChange('CLOSED');
  }
}

function reconnect(callbacks: RealtimeCallbacks): void {
  // 기존 채널 정리
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }

  const newChannel = createChannel(callbacks);
  channel = newChannel;

  newChannel.subscribe((status) => {
    // 이미 교체된 채널의 콜백은 무시 (stale 방지)
    if (channel !== newChannel) return;

    console.log(`[Realtime] 구독 상태: ${status}`);
    callbacks.onStatusChange(status);

    if (status === 'SUBSCRIBED') {
      // 연결 성공 — 재시도 카운터 초기화
      retry.reset();
    } else if (status === 'TIMED_OUT') {
      // 타임아웃 — CLOSED로 이어지므로 여기서는 로그만
      console.log('[Realtime] 연결 시간 초과, CLOSED 전환 대기...');
    } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
      // 연결 끊김 — 재시도 스케줄
      scheduleRetry();
    }
  });
}

/** Realtime 구독 시작 (자동 재연결 포함) */
export function setupRealtimeSubscription(callbacks: RealtimeCallbacks): () => void {
  savedCallbacks = callbacks;
  retry.reset();

  reconnect(callbacks);

  // cleanup 함수 반환
  return () => {
    teardownRealtime();
  };
}

/** Realtime 구독 해제 */
export function teardownRealtime(): void {
  savedCallbacks = null;
  retry.clear();
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
}
