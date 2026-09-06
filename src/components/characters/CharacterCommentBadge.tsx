import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/useAuthStore';
import { useAppStore } from '@/stores/useAppStore';
import { subscribeCharacterCommentSummary, type CharacterCommentBadgeState } from '@/services/characterCommentSummaryService';
import { RevisionCommentMarker } from '@/views/compositing/RevisionCommentMarker';

/** 카드 전체의 열기 동작을 유지하는 작은 캐릭터 단위 댓글 배지. */
export function CharacterCommentBadge({ characterId }: { characterId: string }) {
  const userId = useAuthStore((state) => state.currentUser?.id ?? '');
  const connected = useAppStore((state) => state.dataConnected);
  const [state, setState] = useState<{ key: string; badge: CharacterCommentBadgeState | null } | null>(null);
  const key = `${characterId}\0${userId}\0${connected}`;
  useEffect(() => subscribeCharacterCommentSummary(characterId, userId, connected, badge => setState({ key, badge })),
    [characterId, userId, connected, key]);
  if (state?.key !== key || !state.badge) return null;
  return <RevisionCommentMarker count={state.badge.count} seen={state.badge.seen} size="compact" className="shrink-0" />;
}
