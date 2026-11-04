/**
 * 알림 목록 상한(50) — 씬 댓글 B안 §9 (v1.148.0). 순수 함수, node --test 로 검사.
 *
 * 예전엔 오래된 것부터 위치로만 잘라, 아직 안 읽은 멘션도 밀려 사라졌다. 이제 넘칠 때 버리는 순서:
 *   1) 읽은 것(오래된 것부터) 2) 단계 변경(scene_change) 3) 오래된 '댓글'(comment) 4) 그래도 넘치면 나머지 중 오래된 것.
 * 안 읽은 멘션·씬 배정·액팅 피드백은 끝까지 지킨다(그것만으로 넘치면 그 안에서 오래된 것부터).
 * 목록 순서(최신이 앞)는 그대로 둔다. 같은 순위 안에서는 만든 시각이 오래된 것부터 — 제자리에서 합쳐진 단계 변경이나
 * 놓친 알림 복원으로 앞에 붙은 오래된 줄처럼 목록 위치가 시각 순서와 다를 수 있다(시각을 못 읽으면 위치로).
 */

export interface CappableNotification {
  type: string;
  /** 없으면 안 읽음으로 본다. */
  isRead?: boolean;
  createdAt?: string;
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
  // 버릴 후보: 순위가 낮은 것부터, 같은 순위면 만든 시각이 오래된 것부터(시각이 같거나 없으면 목록 뒤쪽부터).
  const order = list
    .map((n, index) => {
      const time = n.createdAt ? Date.parse(n.createdAt) : NaN;
      return { index, rank: evictionRank(n), time: Number.isFinite(time) ? time : null };
    })
    .sort((a, b) => a.rank - b.rank
      || (a.time !== null && b.time !== null ? a.time - b.time : 0)
      || b.index - a.index);
  const drop = new Set(order.slice(0, overflow).map((entry) => entry.index));
  return list.filter((_, index) => !drop.has(index));
}
