import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/useAuthStore';
import { buildCharacterCommentKey, getCommentsForCharacter, type SceneComment } from '@/services/commentService';
import {
  COMMENT_READ_STATE_EVENT,
  getCommentReadStateForUser,
  getLatestOtherUserCommentCreatedAt,
  isCommentKeyUnread,
} from '@/services/commentReadStateService';
import { RevisionCommentMarker } from '@/views/compositing/RevisionCommentMarker';

// 같은 캐릭터가 여러 탭 그룹에 보여도 진행 중인 조회를 공유한다.
// 읽음 정보는 사용자 전체를 조회하므로 카드 수만큼 같은 요청을 보내지 않는다.
const commentReads = new Map<string, Promise<SceneComment[]>>();
const readStateReads = new Map<string, Promise<Record<string, string>>>();

function sharedRead<T>(pending: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  const existing = pending.get(key);
  if (existing) return existing;
  const request = load().finally(() => {
    if (pending.get(key) === request) pending.delete(key);
  });
  pending.set(key, request);
  return request;
}

interface BadgeState {
  characterId: string;
  userId: string;
  count: number;
  seen: boolean;
}

/** 카드 전체의 열기 동작을 유지하는 작은 캐릭터 단위 댓글 배지. */
export function CharacterCommentBadge({ characterId }: { characterId: string }) {
  const userId = useAuthStore((state) => state.currentUser?.id ?? '');
  const [state, setState] = useState<BadgeState | null>(null);

  useEffect(() => {
    let cancelled = false;
    let generation = 0;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    const reload = async () => {
      const requestGeneration = ++generation;
      const [comments, readState] = await Promise.all([
        sharedRead(commentReads, characterId, () => getCommentsForCharacter(characterId)),
        sharedRead(readStateReads, userId, () => getCommentReadStateForUser(userId)),
      ]);
      if (cancelled || requestGeneration !== generation) return;
      const uniqueComments = [...new Map(comments.map((comment) => [comment.id, comment])).values()];
      const latestOtherCommentAt = getLatestOtherUserCommentCreatedAt(uniqueComments, userId);
      setState({
        characterId,
        userId,
        count: uniqueComments.length,
        seen: !isCommentKeyUnread(latestOtherCommentAt, readState[buildCharacterCommentKey(characterId)]),
      });
    };

    const scheduleReload = () => {
      ++generation;
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        // 변경 전부터 진행 중이던 요청을 재사용하면 새 댓글을 놓칠 수 있다.
        // 먼저 끝낸 뒤 다시 읽고, 그 사이의 추가 변경은 generation으로 구분한다.
        const scheduledGeneration = generation;
        void Promise.all([commentReads.get(characterId), readStateReads.get(userId)]).then(() => {
          if (!cancelled && scheduledGeneration === generation) void reload();
        });
      }, 150);
    };

    const onCommentsChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ characterId?: string; sheetName?: string }>).detail;
      if (detail?.characterId && detail.characterId !== characterId) return;
      if (detail?.sheetName && !detail.characterId) return;
      scheduleReload();
    };
    const onReadStateChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string }>).detail;
      if (detail?.userId && detail.userId !== userId) return;
      scheduleReload();
    };

    void reload();
    window.addEventListener('bflow:comments-invalidated', onCommentsChanged);
    window.addEventListener(COMMENT_READ_STATE_EVENT, onReadStateChanged);
    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      window.removeEventListener('bflow:comments-invalidated', onCommentsChanged);
      window.removeEventListener(COMMENT_READ_STATE_EVENT, onReadStateChanged);
    };
  }, [characterId, userId]);

  if (!state || state.characterId !== characterId || state.userId !== userId) return null;
  return <RevisionCommentMarker count={state.count} seen={state.seen} size="compact" className="shrink-0" />;
}
