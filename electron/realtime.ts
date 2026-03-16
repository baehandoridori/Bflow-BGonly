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
let savedCallbacks: RealtimeCallbacks | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryCount = 0;
const MAX_RETRIES = 10;
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 60_000;

function getRetryDelay(): number {
  // 지수 백오프: 2s, 4s, 8s, 16s, 32s, 60s (cap)
  const delay = Math.min(BASE_DELAY_MS * 2 ** retryCount, MAX_DELAY_MS);
  return delay;
}

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
    );
}

function scheduleRetry(): void {
  if (!savedCallbacks) return;
  if (retryCount >= MAX_RETRIES) {
    console.error(`[Realtime] 최대 재시도 횟수(${MAX_RETRIES}) 초과 — 재연결 중단`);
    savedCallbacks.onStatusChange('CLOSED');
    return;
  }

  // 이미 예약된 재시도가 있으면 중복 방지
  if (retryTimer) return;

  const delay = getRetryDelay();
  console.log(`[Realtime] ${delay / 1000}초 후 재연결 시도 (${retryCount + 1}/${MAX_RETRIES})`);

  retryTimer = setTimeout(() => {
    retryTimer = null;
    retryCount++;
    if (savedCallbacks) {
      reconnect(savedCallbacks);
    }
  }, delay);
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
      retryCount = 0;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
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
  retryCount = 0;

  reconnect(callbacks);

  // cleanup 함수 반환
  return () => {
    teardownRealtime();
  };
}

/** Realtime 구독 해제 */
export function teardownRealtime(): void {
  savedCallbacks = null;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
}
