/**
 * BAE경 코멘트 통로 고르기: 앱에서는 preload 의 window.baeCommentsAPI(메인 → bae_gyeong_session_comment_* 세션 래퍼),
 * 테스트 모드(?preview=1)에서는 같은 규칙의 가짜 저장소(previewBaeComments). 둘 다 아니면 '준비가 필요해요'.
 */
import { isExplicitPlaygroundPreviewMode } from '@/features/playground/featureFlag';
import { useAuthStore } from '@/stores/useAuthStore';
import { createUuid } from '@/utils/createUuid';
import { createCommentNotificationPreviewStore } from '@/mocks/commentNotificationPreviewStore';
import { BAE_PREVIEW_COMMENTS_CHANNEL, createBaePreviewComments } from './previewBaeComments';
import type { BaeCommentsGateway } from './baeCommentsTypes';

declare global {
  interface Window { baeCommentsAPI?: BaeCommentsGateway }
}

export const BAE_COMMENTS_UNAVAILABLE = 'BAE경 코멘트를 쓸 수 없어요. 앱을 새로 업데이트한 뒤 다시 열어 주세요.';

let preview: ReturnType<typeof createBaePreviewComments> | null = null;

function previewComments(): ReturnType<typeof createBaePreviewComments> {
  preview ??= createBaePreviewComments({
    storage: window.localStorage,
    identity: () => {
      const u = useAuthStore.getState().currentUser;
      return u ? { id: u.id, name: u.name, role: u.role ?? 'user' } : null;
    },
    users: () => useAuthStore.getState().users.map((u) => ({ id: u.id, name: u.name, role: u.role ?? 'user' })),
    notifier: createCommentNotificationPreviewStore(),
    channel: typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(BAE_PREVIEW_COMMENTS_CHANNEL),
    newId: () => createUuid(),
  });
  return preview;
}

/** 지금 쓸 통로. 없으면 null(화면은 '쓸 수 없어요'를 보여 준다). */
export function baeCommentsGateway(): BaeCommentsGateway | null {
  if (typeof window !== 'undefined' && window.baeCommentsAPI) return window.baeCommentsAPI;
  if (isExplicitPlaygroundPreviewMode()) return previewComments();
  return null;
}

export function requireBaeCommentsGateway(): BaeCommentsGateway {
  const gateway = baeCommentsGateway();
  if (!gateway) throw new Error(BAE_COMMENTS_UNAVAILABLE);
  return gateway;
}

/**
 * 테스트 모드의 도장 → 코멘트 한 줄(서버에서는 bae_gyeong_stamps 트리거가 한다). 앱(실서버)에서는 아무것도 하지 않는다.
 * 2단계(phase B): 테스트 모드 도장 찍기(previewGateway 의 jobStamp)가 끝난 뒤 이것을 부른다.
 */
export async function recordPreviewStampComment(jobId: string, stamp: string | null, note: string | null, by: string): Promise<void> {
  if (typeof window !== 'undefined' && window.baeCommentsAPI) return;
  if (!isExplicitPlaygroundPreviewMode()) return;
  await previewComments().recordStamp(jobId, stamp, note, by);
}
