import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

// ─── Supabase Broadcast 채널 ────────────────────
// postgres_changes와 달리 Publication 설정이 필요 없음.
// 쓰기 후 즉시 다른 클라이언트에 delta를 전파하여 지연 제거.

let broadcastChannel: RealtimeChannel | null = null;
let broadcastConnected = false;
type BroadcastListener = (event: string, payload: Record<string, unknown>) => void;
let listener: BroadcastListener | null = null;

// 재연결 관련
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryCount = 0;
const MAX_RETRIES = 10;
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 60_000;

function getRetryDelay(): number {
  return Math.min(BASE_DELAY_MS * 2 ** retryCount, MAX_DELAY_MS);
}

function createChannel(onReceive: BroadcastListener): RealtimeChannel {
  return supabase
    .channel('bflow-broadcast')
    .on('broadcast', { event: 'scene-update' }, ({ payload }) => {
      onReceive('scene-update', payload as Record<string, unknown>);
    })
    .on('broadcast', { event: 'scene-field-update' }, ({ payload }) => {
      onReceive('scene-field-update', payload as Record<string, unknown>);
    })
    .on('broadcast', { event: 'data-change' }, ({ payload }) => {
      onReceive('data-change', payload as Record<string, unknown>);
    })
    .on('broadcast', { event: 'comment-added' }, ({ payload }) => {
      onReceive('comment-added', payload as Record<string, unknown>);
    });
}

function scheduleBroadcastRetry(): void {
  if (!listener) return;
  if (retryCount >= MAX_RETRIES) {
    console.error(`[Broadcast] 최대 재시도 횟수(${MAX_RETRIES}) 초과 — 재연결 중단`);
    return;
  }
  if (retryTimer) return; // 이미 예약됨

  const delay = getRetryDelay();
  console.log(`[Broadcast] ${delay / 1000}초 후 재연결 시도 (${retryCount + 1}/${MAX_RETRIES})`);

  retryTimer = setTimeout(() => {
    retryTimer = null;
    retryCount++;
    if (listener) reconnectBroadcast(listener);
  }, delay);
}

function reconnectBroadcast(onReceive: BroadcastListener): void {
  if (broadcastChannel) {
    supabase.removeChannel(broadcastChannel);
    broadcastChannel = null;
    broadcastConnected = false;
  }

  const newChannel = createChannel(onReceive);
  broadcastChannel = newChannel;

  newChannel.subscribe((status) => {
    // stale 채널 콜백 무시
    if (broadcastChannel !== newChannel) return;

    console.log(`[Broadcast] 구독 상태: ${status}`);

    if (status === 'SUBSCRIBED') {
      broadcastConnected = true;
      retryCount = 0;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    } else if (status === 'TIMED_OUT') {
      broadcastConnected = false;
      // CLOSED로 전환 대기
    } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
      broadcastConnected = false;
      scheduleBroadcastRetry();
    }
  });
}

/** Broadcast 채널 초기화 + 수신 콜백 등록 */
export function setupBroadcast(onReceive: BroadcastListener): () => void {
  listener = onReceive;
  retryCount = 0;

  reconnectBroadcast(onReceive);

  return () => {
    teardownBroadcast();
  };
}

/** 연결 상태 확인 후 안전하게 send (미연결 시 스킵) */
function safeSend(event: string, payload: Record<string, unknown>): void {
  if (!broadcastChannel || !broadcastConnected) return;
  broadcastChannel.send({
    type: 'broadcast',
    event,
    payload,
  });
}

/** 체크박스 토글 broadcast 전송 */
export function broadcastSceneUpdate(
  sceneUuid: string,
  stage: string,
  value: boolean,
  senderId?: string,
): void {
  safeSend('scene-update', { sceneUuid, stage, value, senderId, ts: Date.now() });
}

/** 씬 필드 업데이트 broadcast 전송 */
export function broadcastSceneFieldUpdate(
  sceneUuid: string,
  field: string,
  value: string,
  senderId?: string,
): void {
  safeSend('scene-field-update', { sceneUuid, field, value, senderId, ts: Date.now() });
}

/** 구조적 변경 (에피소드/파트/씬 추가·삭제 등) broadcast 전송 */
export function broadcastDataChange(table: string, action: string, senderId?: string): void {
  safeSend('data-change', { table, action, senderId, ts: Date.now() });
}

/** 댓글 추가 broadcast 전송 */
export function broadcastCommentAdded(
  sceneId: string,
  userName: string,
  userId: string,
  text: string,
  mentions?: string[],
): void {
  safeSend('comment-added', { sceneId, userName, userId, text, mentions: mentions ?? [], ts: Date.now() });
}

/** Broadcast 채널 해제 */
export function teardownBroadcast(): void {
  listener = null;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (broadcastChannel) {
    supabase.removeChannel(broadcastChannel);
    broadcastChannel = null;
    broadcastConnected = false;
  }
}
