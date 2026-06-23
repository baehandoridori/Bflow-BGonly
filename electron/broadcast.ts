import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { createRetryManager } from './retry-utils';

// ─── Supabase Broadcast 채널 ────────────────────
// postgres_changes와 달리 Publication 설정이 필요 없음.
// 쓰기 후 즉시 다른 클라이언트에 delta를 전파하여 지연 제거.

let broadcastChannel: RealtimeChannel | null = null;
let gcalChannel: RealtimeChannel | null = null;
let broadcastConnected = false;
type BroadcastListener = (event: string, payload: Record<string, unknown>) => void;
let listener: BroadcastListener | null = null;

const retry = createRetryManager('Broadcast');

function createChannel(onReceive: BroadcastListener): RealtimeChannel {
  return supabase
    .channel('bflow-broadcast')
    .on('broadcast', { event: 'scene-update' }, ({ payload }) => {
      onReceive('scene-update', payload as Record<string, unknown>);
    })
    .on('broadcast', { event: 'scene-field-update' }, ({ payload }) => {
      onReceive('scene-field-update', payload as Record<string, unknown>);
    })
    .on('broadcast', { event: 'scene-phase-update' }, ({ payload }) => {
      onReceive('scene-phase-update', payload as Record<string, unknown>);
    })
    .on('broadcast', { event: 'acting-feedback-request' }, ({ payload }) => {
      onReceive('acting-feedback-request', payload as Record<string, unknown>);
    })
    .on('broadcast', { event: 'scene-assignment-notification' }, ({ payload }) => {
      onReceive('scene-assignment-notification', payload as Record<string, unknown>);
    })
    .on('broadcast', { event: 'data-change' }, ({ payload }) => {
      onReceive('data-change', payload as Record<string, unknown>);
    })
    .on('broadcast', { event: 'comment-added' }, ({ payload }) => {
      onReceive('comment-added', payload as Record<string, unknown>);
    })
    .on('broadcast', { event: 'comment-reaction-changed' }, ({ payload }) => {
      // 코덱스 2차 P1: 다른 클라이언트가 자체 fetch 트리거할 수 있도록.
      onReceive('comment-reaction-changed', payload as Record<string, unknown>);
    })
    // v1.29.0 (코덱스 1차 P1): 새 broadcast 이벤트 3종 subscribe 등록.
    //   sender 측은 broadcastCommentReactionNotification/Removed/ActivityRemoved 로 emit 하지만
    //   receiver 측이 .on() 등록 안 하면 payload 가 채널에서 drop → 실시간 반영 누락.
    .on('broadcast', { event: 'comment-reaction-notification' }, ({ payload }) => {
      onReceive('comment-reaction-notification', payload as Record<string, unknown>);
    })
    .on('broadcast', { event: 'comment-reaction-notification-removed' }, ({ payload }) => {
      onReceive('comment-reaction-notification-removed', payload as Record<string, unknown>);
    })
    .on('broadcast', { event: 'activity-removed' }, ({ payload }) => {
      onReceive('activity-removed', payload as Record<string, unknown>);
    })
    .on('broadcast', { event: 'calendar-changed' }, ({ payload }) => {
      onReceive('calendar-changed', payload as Record<string, unknown>);
    });
}

function scheduleBroadcastRetry(): void {
  if (!listener) return;
  retry.schedule(() => {
    if (listener) reconnectBroadcast(listener);
  });
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
      retry.reset();
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
  retry.reset();

  reconnectBroadcast(onReceive);

  // gcal-sync 채널: GCal webhook → Supabase → 렌더러 파이프라인
  gcalChannel = supabase.channel('gcal-sync')
    .on('broadcast', { event: 'calendar-changed' }, ({ payload }) => {
      onReceive('calendar-changed', payload as Record<string, unknown>);
    })
    .subscribe();

  return () => {
    teardownBroadcast();
  };
}

/** 연결 상태 확인 후 안전하게 send (미연결 시 스킵) */
function safeSend(event: string, payload: Record<string, unknown>): void {
  if (!broadcastChannel || !broadcastConnected) {
    console.warn(`[Broadcast] '${event}' send 스킵 — 채널 미연결 (channel=${!!broadcastChannel}, connected=${broadcastConnected})`);
    return;
  }
  console.log(`[Broadcast] send '${event}'`, Object.keys(payload));
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

/** 씬 필드 업데이트 broadcast 전송.
 *  v1.16.0: value 가 null 도 허용 (lengthChange 해제 시 NULL 의미를 피어에 정확히 전달).
 *  string 만 받던 시절엔 빈 문자열로 보내고 수신부에서 정규화했지만,
 *  단일 수신부에 의존하면 다른 컨슈머에서 store 가 오염될 수 있어 송신부에서 normalize 해서 전달. */
export function broadcastSceneFieldUpdate(
  sceneUuid: string,
  field: string,
  value: string | null,
  senderId?: string,
): void {
  safeSend('scene-field-update', { sceneUuid, field, value, senderId, ts: Date.now() });
}

/** 구조적 변경 (에피소드/파트/씬 추가·삭제 등) broadcast 전송 */
export function broadcastDataChange(table: string, action: string, senderId?: string): void {
  safeSend('data-change', { table, action, senderId, ts: Date.now() });
}

/** v1.25.0~ 액팅 씬 단계 변경 broadcast (sceneState + workRound + feedbackRound 한 번에). */
export function broadcastScenePhaseUpdate(
  sceneUuid: string,
  sceneState: string,
  workRound: number,
  feedbackRound: number,
  senderId?: string,
): void {
  safeSend('scene-phase-update', { sceneUuid, sceneState, workRound, feedbackRound, senderId, ts: Date.now() });
}

/** v1.25.0~ 액팅 피드백 요청 알림 broadcast.
 *  recipients 안에 자신의 user.id 가 있는 클라이언트만 토스트 표시.
 *  spec: docs/superpowers/specs/2026-05-11-acting-phase-toggle-design.md (섹션 7) */
export interface FeedbackBroadcastPayload {
  sceneUuid: string;
  sceneId: string;
  sheetName: string;
  episodeNumber: number;
  senderId: string;
  senderName: string;
  fromState: string;
  toState: string;
  workRound: number;
  feedbackRound: number;
  recipients: string[];
  message?: string;
  /** v1.25.5 코덱스 1차 P2 #3 fix: INSERT 결과의 (recipient_id → notification_id) 매핑.
   *  수신자가 자기 ID 로 notificationId 찾아 markRead 가능. */
  notificationIdsByRecipient?: Record<string, string>;
  notificationCreatedAtByRecipient?: Record<string, string>;
  ts: number;
}
export function broadcastActingFeedbackRequest(payload: Omit<FeedbackBroadcastPayload, 'ts'>): void {
  safeSend('acting-feedback-request', { ...payload, ts: Date.now() });
}

/** v1.25.8 씬 담당자 배정 알림 broadcast.
 *  recipient_id 가 자기 user.id 와 같은 클라이언트만 토스트 표시. */
export interface AssignmentBroadcastPayload {
  notificationId: string;
  createdAt?: string;
  sceneUuid: string;
  sceneId: string;
  sheetName: string;
  episodeNumber: number;
  recipientId: string;
  senderId: string;
  senderName: string;
  prevAssignee: string;
  newAssignee: string;
  ts: number;
}
export function broadcastSceneAssignmentNotification(payload: Omit<AssignmentBroadcastPayload, 'ts'>): void {
  safeSend('scene-assignment-notification', { ...payload, ts: Date.now() });
}

/** 캘린더(공개 GCal 이벤트 + 개인 비공개 이벤트) 변경 broadcast.
 *  수신 측(calendarService) 에서 sync/재렌더 트리거. 다른 기기 비공개 CRUD 도 실시간 반영된다. */
export function broadcastCalendarChanged(action: string, senderId?: string): void {
  safeSend('calendar-changed', { action, senderId, ts: Date.now() });
}

/** v1.28.0 (코덱스 2차 P1): 댓글 이모지 리액션 변경 broadcast.
 *  다른 클라이언트가 변경된 commentId 의 리액션을 다시 fetch 하도록 신호만 보낸다. */
export function broadcastCommentReactionChanged(
  commentId: string,
  action: 'add' | 'remove',
  emoji: string,
  senderId?: string,
): void {
  safeSend('comment-reaction-changed', { commentId, action, emoji, senderId, ts: Date.now() });
}

/** v1.29.0: 댓글 이모지 반응 알림 broadcast (UPSERT 결과 1행).
 *  - 자기 자신이 자기 댓글에 반응 → emit 안 함 (송신 단계에서 skip)
 *  - 수신측은 payload.notification.recipientId === currentUserId 일 때만 store 반영 */
export interface CommentReactionNotificationPayload {
  notification: {
    id: string;
    recipientId: string;
    actorId: string;
    actorName: string;
    commentId: string;
    emojis: string[];
    reactionCount: number;
    sceneId?: string;
    episodeNumber?: number;
    partId?: string;
    dept?: string;
    lastActionAt: string;
    createdAt: string;
    readAt: string | null;
  };
  ts: number;
}
export function broadcastCommentReactionNotification(
  payload: Omit<CommentReactionNotificationPayload, 'ts'>,
): void {
  safeSend('comment-reaction-notification', { ...payload, ts: Date.now() });
}

/** v1.29.0: 댓글 이모지 반응 알림 축소/삭제 broadcast.
 *  - deleted=true → 행 자체 삭제됨, 수신측은 removeNotificationById
 *  - deleted=false → emojis 만 축소, 수신측은 refetch 또는 store 직접 갱신 */
export interface CommentReactionNotificationRemovedPayload {
  recipientId: string;
  notificationId: string;
  deleted: boolean;
  emoji: string;
  commentId: string;
  actorId: string;
  ts: number;
}
export function broadcastCommentReactionNotificationRemoved(
  payload: Omit<CommentReactionNotificationRemovedPayload, 'ts'>,
): void {
  safeSend('comment-reaction-notification-removed', { ...payload, ts: Date.now() });
}

/** v1.29.0: 활동 로그 단일 행 삭제 broadcast (이모지 반응 취소 시).
 *  수신측은 activityStore.removeById 호출 — missing-ID 면 no-op. */
export interface ActivityRemovedPayload {
  activityId: string;
  ts: number;
}
export function broadcastActivityRemoved(
  payload: Omit<ActivityRemovedPayload, 'ts'>,
): void {
  safeSend('activity-removed', { ...payload, ts: Date.now() });
}

/** 댓글 추가 broadcast 전송 */
export function broadcastCommentAdded(
  sceneId: string,
  userName: string,
  userId: string,
  text: string,
  mentions?: string[],
  /** v1.24.0: realtime 경로와 동일한 분기를 위해 commentId/parentCommentId/partId 도 함께 broadcast.
   *  렌더러는 두 경로(broadcast + realtime) 어느 쪽에서 먼저 도착하든 같은 알림 분기를 호출해야 한다. */
  commentId?: string,
  parentCommentId?: string | null,
  partId?: string,
  revisionId?: string | null,
  createdAt?: string,
): void {
  safeSend('comment-added', {
    sceneId,
    userName,
    userId,
    text,
    mentions: mentions ?? [],
    commentId: commentId ?? null,
    parentCommentId: parentCommentId ?? null,
    partId: partId ?? null,
    revisionId: revisionId ?? null,
    createdAt: createdAt ?? null,
    ts: Date.now(),
  });
}

/** Broadcast 채널 해제 */
export function teardownBroadcast(): void {
  listener = null;
  retry.clear();
  if (broadcastChannel) {
    supabase.removeChannel(broadcastChannel);
    broadcastChannel = null;
    broadcastConnected = false;
  }
  if (gcalChannel) {
    supabase.removeChannel(gcalChannel);
    gcalChannel = null;
  }
}
