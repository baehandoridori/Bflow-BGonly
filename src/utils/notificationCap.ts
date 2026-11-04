/**
 * 알림 목록 상한(50) — 씬 댓글 B안 §9 (v1.148.0). 순수 함수, node --test 로 검사.
 *
 * 예전엔 오래된 것부터 위치로만 잘라, 아직 안 읽은 멘션도 밀려 사라졌다. 이제 넘칠 때 버리는 순서:
 *   1) 읽은 것(오래된 것부터) 2) 단계 변경(scene_change) 3) 오래된 '댓글'(comment) 4) 그래도 넘치면 나머지 중 오래된 것.
 * 안 읽은 멘션·씬 배정·액팅 피드백은 끝까지 지킨다(그것만으로 넘치면 그 안에서 오래된 것부터).
 * 목록 순서(최신이 앞)는 그대로 둔다.
 */

export interface CappableNotification {
  type: string;
  /** 없으면 안 읽음으로 본다. */
  isRead?: boolean;
}

const PROTECTED_UNREAD = new Set(['mention', 'scene_assignment', 'acting_feedback']);

function evictionRank(n: CappableNotification): number {
  if (n.isRead) return 0;
  if (n.type === 'scene_change') return 1;
  if (n.type === 'comment') return 2;
  if (PROTECTED_UNREAD.has(n.type)) return 4;
  return 3;
}

export function capNotifications<T extends CappableNotification>(list: readonly T[], limit = 50): T[] {
  if (list.length <= limit) return [...list];
  const overflow = list.length - limit;
  // 버릴 후보: 순위가 낮은 것부터, 같은 순위면 오래된 것(목록 뒤쪽)부터.
  const order = list
    .map((n, index) => ({ index, rank: evictionRank(n) }))
    .sort((a, b) => a.rank - b.rank || b.index - a.index);
  const drop = new Set(order.slice(0, overflow).map((entry) => entry.index));
  return list.filter((_, index) => !drop.has(index));
}
