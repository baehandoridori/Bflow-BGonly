/**
 * v1.26.0 — 댓글 이모지 리액션 집계/표시 헬퍼.
 *
 * - groupReactionsByEmoji: 같은 이모지를 가진 리액션을 묶어 {emoji, count, userIds, userNames, mine}.
 * - formatReactionTooltip: 호버 툴팁 텍스트. 본인은 "나" 강조, 최대 5명 + 외 N명.
 *
 * 격리:
 *  React/Electron 의존성 없이 순수 함수. 타입은 src/types 의 CommentReaction/Group 과
 *  구조적으로 호환 (structural typing).
 */

interface ReactionLike {
  userId: string;
  userName: string;
  emoji: string;
}

interface GroupLike {
  emoji: string;
  count: number;
  userIds: string[];
  userNames: string[];
  mine: boolean;
}

export function groupReactionsByEmoji<T extends ReactionLike>(
  reactions: T[],
  currentUserId: string | null,
): GroupLike[] {
  const map = new Map<string, GroupLike>();
  for (const r of reactions) {
    let g = map.get(r.emoji);
    if (!g) {
      g = { emoji: r.emoji, count: 0, userIds: [], userNames: [], mine: false };
      map.set(r.emoji, g);
    }
    if (g.userIds.includes(r.userId)) continue; // 방어 (UNIQUE 제약으로 사실상 X)
    g.userIds.push(r.userId);
    g.userNames.push(r.userName);
    g.count++;
    if (currentUserId && r.userId === currentUserId) g.mine = true;
  }
  return Array.from(map.values());
}

/** 호버 툴팁 텍스트. 본인 있으면 "나" 로 치환, 최대 5명 + 외 N명. */
export function formatReactionTooltip(group: GroupLike, currentUserId: string | null): string {
  const maxShow = 5;
  const names = group.userIds.map((id, i) => (id === currentUserId ? '나' : group.userNames[i]));
  if (names.length <= maxShow) {
    return `${names.join(', ')} — 누른 사람: ${group.count}명`;
  }
  return `${names.slice(0, maxShow).join(', ')} 외 ${names.length - maxShow}명 — 누른 사람: ${group.count}명`;
}
