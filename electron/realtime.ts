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
  /** Supabase presence sync/join/leave — 전체 presence 상태 스냅샷 전달 */
  onPresenceSync?: (state: Record<string, unknown[]>) => void;
}

let channel: RealtimeChannel | null = null;
let savedCallbacks: RealtimeCallbacks | null = null;
// 마지막으로 track한 presence 페이로드 — 재연결(SUBSCRIBED) 시 최신 채널로 재track.
let lastPresencePayload: unknown | null = null;
const retry = createRetryManager('Realtime');

function createChannel(callbacks: RealtimeCallbacks): RealtimeChannel {
  const built = supabase
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
  // presence 는 와일드카드('*') 미지원 → sync/join/leave 3개 이벤트를 개별 구독.
  // 각 이벤트마다 전체 상태를 다시 병합하도록 스냅샷을 넘긴다.
  const emitPresence = () => callbacks.onPresenceSync?.(built.presenceState() as Record<string, unknown[]>);
  built
    .on('presence', { event: 'sync' }, emitPresence)
    .on('presence', { event: 'join' }, emitPresence)
    .on('presence', { event: 'leave' }, emitPresence);
  return built;
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
      // 재연결 시 최신 채널로 presence 재track (끊긴 사이 유실 방지).
      if (lastPresencePayload) {
        void newChannel.track(lastPresencePayload as Record<string, unknown>);
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
  retry.reset();

  reconnect(callbacks);

  // cleanup 함수 반환
  return () => {
    teardownRealtime();
  };
}

/**
 * presence 페이로드를 항상 현재(최신) 채널로 track.
 * 마지막 페이로드를 모듈 스코프에 저장해 재연결(SUBSCRIBED) 시 재track한다.
 * `channel`은 reconnect마다 교체되는 모듈 스코프 변수 → 호출 시점의 최신 채널 사용.
 */
export function trackPresence(payload: unknown): void {
  lastPresencePayload = payload;
  void channel?.track(payload as Record<string, unknown>);
}

/** Realtime 구독 해제 */
export function teardownRealtime(): void {
  savedCallbacks = null;
  lastPresencePayload = null;
  retry.clear();
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
}
