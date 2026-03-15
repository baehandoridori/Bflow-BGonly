import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

// ─── Supabase Broadcast 채널 ────────────────────
// postgres_changes와 달리 Publication 설정이 필요 없음.
// 쓰기 후 즉시 다른 클라이언트에 delta를 전파하여 지연 제거.

let broadcastChannel: RealtimeChannel | null = null;
type BroadcastListener = (event: string, payload: Record<string, unknown>) => void;
let listener: BroadcastListener | null = null;

/** Broadcast 채널 초기화 + 수신 콜백 등록 */
export function setupBroadcast(onReceive: BroadcastListener): () => void {
  listener = onReceive;

  broadcastChannel = supabase
    .channel('bflow-broadcast')
    .on('broadcast', { event: 'scene-update' }, ({ payload }) => {
      listener?.('scene-update', payload as Record<string, unknown>);
    })
    .on('broadcast', { event: 'scene-field-update' }, ({ payload }) => {
      listener?.('scene-field-update', payload as Record<string, unknown>);
    })
    .on('broadcast', { event: 'data-change' }, ({ payload }) => {
      listener?.('data-change', payload as Record<string, unknown>);
    })
    .on('broadcast', { event: 'comment-added' }, ({ payload }) => {
      listener?.('comment-added', payload as Record<string, unknown>);
    });

  broadcastChannel.subscribe((status) => {
    console.log(`[Broadcast] 구독 상태: ${status}`);
  });

  return () => {
    teardownBroadcast();
  };
}

/** 체크박스 토글 broadcast 전송 */
export function broadcastSceneUpdate(
  sceneUuid: string,
  stage: string,
  value: boolean,
  senderId?: string,
): void {
  if (!broadcastChannel) return;
  broadcastChannel.send({
    type: 'broadcast',
    event: 'scene-update',
    payload: { sceneUuid, stage, value, senderId, ts: Date.now() },
  });
}

/** 씬 필드 업데이트 broadcast 전송 */
export function broadcastSceneFieldUpdate(
  sceneUuid: string,
  field: string,
  value: string,
  senderId?: string,
): void {
  if (!broadcastChannel) return;
  broadcastChannel.send({
    type: 'broadcast',
    event: 'scene-field-update',
    payload: { sceneUuid, field, value, senderId, ts: Date.now() },
  });
}

/** 구조적 변경 (에피소드/파트/씬 추가·삭제 등) broadcast 전송 */
export function broadcastDataChange(table: string, action: string, senderId?: string): void {
  if (!broadcastChannel) return;
  broadcastChannel.send({
    type: 'broadcast',
    event: 'data-change',
    payload: { table, action, senderId, ts: Date.now() },
  });
}

/** 댓글 추가 broadcast 전송 */
export function broadcastCommentAdded(
  sceneId: string,
  userName: string,
  userId: string,
  text: string,
  mentions?: string[],
): void {
  if (!broadcastChannel) return;
  broadcastChannel.send({
    type: 'broadcast',
    event: 'comment-added',
    payload: { sceneId, userName, userId, text, mentions: mentions ?? [], ts: Date.now() },
  });
}

/** Broadcast 채널 해제 */
export function teardownBroadcast(): void {
  listener = null;
  if (broadcastChannel) {
    supabase.removeChannel(broadcastChannel);
    broadcastChannel = null;
  }
}
