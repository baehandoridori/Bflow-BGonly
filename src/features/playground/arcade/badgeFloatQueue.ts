// 헤더 포인트 배지의 "+N P" 획득 플로팅 큐 — 순수 모듈(React/DOM 비의존, node:test 로 직접 검증).
// 적립이 몰려도 한 번에 최대 3개만 떠 있게 하고, 초과분은 마지막 항목에 합산해
// 화면이 라벨로 뒤덮이지 않게 한다. 각 항목은 애니메이션이 끝나면 pop 으로 앞에서 빠진다.

export interface BadgeFloatItem {
  readonly id: number;
  readonly delta: number;
}

export interface BadgeFloatQueueState {
  readonly items: readonly BadgeFloatItem[];
  readonly nextId: number;
}

const MAX_ITEMS = 3;

export function createBadgeFloatQueue(): BadgeFloatQueueState {
  return { items: [], nextId: 1 };
}

// 양의 유한한 적립만 표시한다. 큐가 가득 차면(3개) 새 id 를 만들지 않고 마지막 항목에 합산한다.
export function enqueueBadgeFloat(state: BadgeFloatQueueState, delta: number): BadgeFloatQueueState {
  if (!Number.isFinite(delta) || delta <= 0) return state;
  if (state.items.length < MAX_ITEMS) {
    return {
      items: [...state.items, { id: state.nextId, delta }],
      nextId: state.nextId + 1,
    };
  }
  const lastIndex = state.items.length - 1;
  const items = state.items.map((item, index) =>
    index === lastIndex ? { id: item.id, delta: item.delta + delta } : item,
  );
  return { items, nextId: state.nextId };
}

// 애니메이션이 끝난 앞 항목을 FIFO 로 제거한다.
export function popBadgeFloat(state: BadgeFloatQueueState): BadgeFloatQueueState {
  if (state.items.length === 0) return state;
  return { items: state.items.slice(1), nextId: state.nextId };
}
