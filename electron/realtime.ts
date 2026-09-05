import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { createRetryManager } from './retry-utils';

// ─── Realtime 구독 관리 ────────────────────────
// 모든 테이블 변경을 하나의 채널로 구독 (무료 플랜 연결 수 절약)

type ChangePayload = RealtimePostgresChangesPayload<Record<string, unknown>>;
export type SharedCalendarRealtimeTable =
  | 'calendars'
  | 'calendar_members'
  | 'calendar_events'
  | 'calendar_tags';

export type SharedCalendarRealtimeInvalidation = {
  eventType: ChangePayload['eventType'];
};

/** Renderer가 최초 join과 retry 뒤 join을 구분하되 DB 행은 받지 않는 상태 메타데이터. */
export type RealtimeStatusMetadata = {
  reconnected: boolean;
};

const SHARED_CALENDAR_REALTIME_TABLES: readonly SharedCalendarRealtimeTable[] = [
  'calendars',
  'calendar_members',
  'calendar_events',
  'calendar_tags',
];

export interface RealtimeCallbacks {
  onGanttChange?: () => void;
  onSceneChange: (payload: ChangePayload) => void;
  onCommentChange: (payload: ChangePayload) => void;
  onRevisionChange: (payload: ChangePayload) => void;
  onRevisionSetChange?: (payload: ChangePayload) => void;
  onEpisodeChange: (payload: ChangePayload) => void;
  onPartChange: (payload: ChangePayload) => void;
  onSceneWorkLinkChange?: (payload: ChangePayload) => void;
  onCalendarChange: (
    table: SharedCalendarRealtimeTable,
    payload: SharedCalendarRealtimeInvalidation,
  ) => void;
  onCalendarNotificationInsert?: (payload: ChangePayload) => void;
  onActivityInsert: (payload: ChangePayload) => void;
  onStatusChange: (status: string, metadata: RealtimeStatusMetadata) => void;
  /** Supabase presence sync/join/leave — 전체 presence 상태 스냅샷 전달 */
  onPresenceSync?: (state: Record<string, unknown[]>) => void;
}

let channel: RealtimeChannel | null = null;
let savedCallbacks: RealtimeCallbacks | null = null;
// 마지막으로 track한 presence 페이로드 — 재연결(SUBSCRIBED) 시 최신 채널로 재track.
let lastPresencePayload: unknown | null = null;
// 현재 채널이 SUBSCRIBED(join 완료) 상태인지. join 전 track()은 reject → unhandled rejection이 되므로 게이트로 막는다.
let isSubscribed = false;
// presence track 실패(비-ok status/reject) 시 바운드 재시도 타이머. 항상 최신 payload를 재track.
let presenceTrackRetryTimer: NodeJS.Timeout | null = null;
const retry = createRetryManager('Realtime');

/**
 * 현재 채널로 lastPresencePayload를 track 시도.
 * Supabase channel.track()은 push 실패를 reject가 아니라 'error'/'timed out' status로 resolve하므로,
 * status !== 'ok' 이거나 reject면 바운드 재시도를 예약한다(성공을 놓치지 않기 위함).
 */
function attemptTrackPresence(): void {
  if (!isSubscribed || !channel || lastPresencePayload == null) return;
  channel.track(lastPresencePayload as Record<string, unknown>)
    .then((status) => { if (status !== 'ok') scheduleTrackPresenceRetry(); })
    .catch(() => scheduleTrackPresenceRetry());
}

/** 재시도 예약(항상 하나의 pending 재시도만). 최신 lastPresencePayload로 재시도해 수렴. */
function scheduleTrackPresenceRetry(): void {
  if (presenceTrackRetryTimer) return;
  presenceTrackRetryTimer = setTimeout(() => {
    presenceTrackRetryTimer = null;
    attemptTrackPresence();
  }, 2000);
}

/** pending 재시도 타이머 정리. */
function clearTrackPresenceRetry(): void {
  if (presenceTrackRetryTimer) {
    clearTimeout(presenceTrackRetryTimer);
    presenceTrackRetryTimer = null;
  }
}

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
  for (const table of SHARED_CALENDAR_REALTIME_TABLES) {
    built.on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      (payload) => {
        console.log(`[Realtime] ${table} 이벤트 수신:`, payload.eventType);
        // 공유 캘린더 행은 renderer 권한 경계 밖으로 전달하지 않는다. 변경 종류만 알리고,
        // 각 renderer가 현재 actor 기준의 canonical IPC를 다시 읽어 권한을 재검증한다.
        callbacks.onCalendarChange(table, { eventType: payload.eventType });
      },
    );
  }
  built.on(
    'postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'calendar_notifications' },
    (payload) => callbacks.onCalendarNotificationInsert?.(payload),
  );
  // presence 는 와일드카드('*') 미지원 → sync/join/leave 3개 이벤트를 개별 구독.
  // 각 이벤트마다 전체 상태를 다시 병합하도록 스냅샷을 넘긴다.
  // 간트 테이블은 publication 에 없다(행 내용이 anon 구독자에게 흘러가지 않게). DB 트리거가
  // realtime.send 로 같은 공개 채널에 '변경됐다' 신호만 보내고, 앱은 RPC 로 다시 읽는다.
  built.on('broadcast', { event: 'gantt-changed' }, () => callbacks.onGanttChange?.());
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
    if (savedCallbacks) reconnect(savedCallbacks, true);
  });
  // 최대 재시도 초과 → 영구 실패 알림
  if (!scheduled) {
    savedCallbacks.onStatusChange('CLOSED', { reconnected: false });
  }
}

function reconnect(callbacks: RealtimeCallbacks, isRetry: boolean): void {
  // 기존 채널 정리
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }

  const newChannel = createChannel(callbacks);
  channel = newChannel;
  // 새 채널은 아직 join 전 → track 금지 상태로 초기화.
  isSubscribed = false;
  // retry로 만든 채널의 첫 성공 join만 renderer catch-up 경계다. 같은 채널이
  // SUBSCRIBED를 중복 통지해도 정본 재조회를 반복하지 않도록 한 번만 소비한다.
  let reconnectCatchUpPending = isRetry;

  newChannel.subscribe((status) => {
    // 이미 교체된 채널의 콜백은 무시 (stale 방지)
    if (channel !== newChannel) return;

    console.log(`[Realtime] 구독 상태: ${status}`);
    // Supabase SDK는 CHANNEL_ERROR/join timeout 뒤 같은 RealtimeChannel 안에서도
    // 자동 rejoin한다. 외부 retry가 새 채널을 만들기 전에 성공할 수 있으므로,
    // 연결 단절을 본 현재 채널도 다음 성공 join에서 catch-up을 한 번 요구한다.
    if (status === 'TIMED_OUT' || status === 'CLOSED' || status === 'CHANNEL_ERROR') {
      reconnectCatchUpPending = true;
    }
    const reconnected = status === 'SUBSCRIBED' && reconnectCatchUpPending;
    if (status === 'SUBSCRIBED') reconnectCatchUpPending = false;
    callbacks.onStatusChange(status, { reconnected });

    if (status === 'SUBSCRIBED') {
      // 연결 성공 — 재시도 카운터 초기화
      retry.reset();
      isSubscribed = true;
      // 재연결 시 최신 채널로 presence 재track (끊긴 사이 유실 방지). 비-ok status는 바운드 재시도.
      clearTrackPresenceRetry();
      attemptTrackPresence();
    } else if (status === 'TIMED_OUT') {
      // 타임아웃 — CLOSED로 이어지므로 여기서는 로그만
      console.log('[Realtime] 연결 시간 초과, CLOSED 전환 대기...');
    } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
      // 연결 끊김 — join 무효화 + pending 재시도 정리 후 재연결 스케줄
      isSubscribed = false;
      clearTrackPresenceRetry();
      scheduleRetry();
    }
  });
}

/** Realtime 구독 시작 (자동 재연결 포함) */
export function setupRealtimeSubscription(callbacks: RealtimeCallbacks): () => void {
  savedCallbacks = callbacks;
  retry.reset();

  reconnect(callbacks, false);

  // cleanup 함수 반환
  return () => {
    teardownRealtime();
  };
}

/**
 * presence 페이로드를 항상 현재(최신) 채널로 track.
 * 마지막 페이로드를 모듈 스코프에 저장해 재연결(SUBSCRIBED) 시 재track한다.
 * `channel`은 reconnect마다 교체되는 모듈 스코프 변수 → 호출 시점의 최신 채널 사용.
 * join(SUBSCRIBED) 전에는 저장만 하고 SUBSCRIBED 핸들러가 재track한다.
 * 새 payload가 오면 pending 재시도를 대체(항상 최신 상태로 수렴, 무한 루프 없음).
 */
export function trackPresence(payload: unknown): void {
  lastPresencePayload = payload;
  clearTrackPresenceRetry();
  attemptTrackPresence();
}

/** Realtime 구독 해제 */
export function teardownRealtime(): void {
  savedCallbacks = null;
  lastPresencePayload = null;
  isSubscribed = false;
  clearTrackPresenceRetry();
  retry.clear();
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
}
