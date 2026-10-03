/* ═══════════════════════════════════════════════════════════════
   체크한 카드 잠깐 붙잡아 두기 — 움직임 폴리싱 15번 reflow-on-filter

   '진행 중'만 보며 마지막 단계를 체크하면 카드가 그 순간 목록에서 빠지고 뒤 카드가 당겨져
   마우스 아래에 다른 카드가 온다. '진행률순'이면 체크할 때마다 카드가 순간이동한다.
   그래서 내가 방금 바꾼 카드는 잠깐(기본 1.2초, 완료 축하가 있으면 1.6초) 체크하기 전 자리에 둔다.
   그동안 필터에서 빠질 카드는 살짝 옅게(.65) '곧 빠짐'을 알리고, 시간이 다 되면 0.2초에 사라진 뒤
   나머지 카드가 빈자리로 미끄러진다(useGridFlip). 여러 장을 연달아 체크하면 마지막 체크 기준으로 기다린다.

   node --test 가 그대로 import 하도록 런타임 의존이 없다.
   ═══════════════════════════════════════════════════════════════ */

export const REFLOW_LINGER = Object.freeze({
  /** 기본 머무름. */
  holdMs: 1200,
  /** 완료 축하가 함께 터질 때 — 씬 목록의 축하 표시 시간(1600ms)에 맞춘다. */
  celebrateHoldMs: 1600,
  /** 머무름이 끝난 뒤 빠지는 카드가 사라지는 시간. */
  fadeOutMs: 200,
  /** 머무는 동안 '곧 빠짐' 투명도(CSS 와 같은 값). */
  dimOpacity: 0.65,
});

export type LingerPhase = 'hold' | 'leaving';

export interface LingerEntry {
  /** 체크하기 직전 화면에서의 순서(0부터). */
  order: number;
  /** 이미 사라지던 중(leaving)에 다른 카드가 새로 붙잡혔다 — 다시 나타나지 않고 끝까지 사라진 채로 기다린다. */
  gone?: boolean;
}

/** 붙잡아 둘 필요가 있는 보기인가: 상태 필터가 걸렸거나, 체크로 순서가 바뀌는 정렬(진행률·미완료). */
export function shouldHoldForReflow(statusFilter: string, sortKey: string): boolean {
  return statusFilter !== 'all' || sortKey === 'progress' || sortKey === 'incomplete';
}

export function lingerHoldMs(celebrating: boolean): number {
  return celebrating ? REFLOW_LINGER.celebrateHoldMs : REFLOW_LINGER.holdMs;
}

/** 연속 체크: 마감은 늘리기만 한다(지난 마감이면 지금부터 다시). */
export function extendLingerDeadline(previousDeadline: number, now: number, holdMs: number): number {
  return Math.max(previousDeadline, now + holdMs);
}

/* ─── 붙잡기 상태 흐름 (src/hooks/useReflowLinger.ts 가 타이머로 몬다) ───
   hold(체크) → [마감] expire: 빠질 카드가 0.2초에 사라짐 → clear: 비우고 generation+1(나머지 카드가 미끄러짐).
   scope(파트·필터·정렬·검색 등)가 바뀌면 그 자리에서 버린다(미끄러짐 없음 — 보기 전환은 다른 움직임이 맡는다). */

export interface LingerState {
  scope: string;
  entries: ReadonlyMap<string, LingerEntry>;
  phase: LingerPhase;
  /** 붙잡기를 풀 때마다 1씩 오른다 — 목록 미끄러짐(useGridFlip)의 키. */
  generation: number;
}

export type LingerAction =
  | { type: 'hold'; scope: string; keys: readonly string[]; order: number }
  | { type: 'expire' }
  | { type: 'clear' }
  | { type: 'scope'; scope: string };

export const EMPTY_LINGER_ENTRIES: ReadonlyMap<string, LingerEntry> = new Map();

export function initialLingerState(scope: string): LingerState {
  return { scope, entries: EMPTY_LINGER_ENTRIES, phase: 'hold', generation: 0 };
}

export function lingerReducer(state: LingerState, action: LingerAction): LingerState {
  switch (action.type) {
    case 'hold': {
      if (action.keys.length === 0) return state;
      const sameScope = state.scope === action.scope;
      const next = new Map<string, LingerEntry>();
      if (sameScope) {
        // 이미 사라지던 카드는 다시 나타나지 않게 gone 으로 남긴다(체크 전 순서는 그대로 — 자리가 흔들리지 않게).
        const fading = state.phase === 'leaving';
        for (const [key, entry] of state.entries) next.set(key, fading && !entry.gone ? { ...entry, gone: true } : entry);
      }
      // 이미 붙잡은 키는 처음 순서를 지킨다.
      for (const key of action.keys) if (!next.has(key)) next.set(key, { order: action.order });
      return { scope: action.scope, entries: next, phase: 'hold', generation: state.generation };
    }
    case 'expire':
      return state.entries.size === 0 || state.phase === 'leaving' ? state : { ...state, phase: 'leaving' };
    case 'clear':
      return state.entries.size === 0
        ? state
        : { scope: state.scope, entries: EMPTY_LINGER_ENTRIES, phase: 'hold', generation: state.generation + 1 };
    case 'scope':
      return state.scope === action.scope || state.entries.size === 0
        ? state
        : { scope: action.scope, entries: EMPTY_LINGER_ENTRIES, phase: 'hold', generation: state.generation };
    default:
      return state;
  }
}

/** 지금 보기(scope)에서 쓸 값 — 다른 보기에서 붙잡은 것은 렌더에서 바로 무효(effect 가 곧 비운다). */
export function lingerView(state: LingerState, scope: string): { entries: ReadonlyMap<string, LingerEntry>; phase: LingerPhase } {
  return state.scope === scope
    ? { entries: state.entries, phase: state.phase }
    : { entries: EMPTY_LINGER_ENTRIES, phase: 'hold' };
}

/** 카드 하나(키 여러 개일 수 있음)의 '곧 빠짐' 단계 — 사라지던 중이던 카드(gone)는 계속 사라진 채. */
export function lingerPhaseOf(entries: ReadonlyMap<string, LingerEntry>, phase: LingerPhase, keys: readonly string[]): LingerPhase {
  if (phase === 'leaving') return 'leaving';
  return keys.some((key) => entries.get(key)?.gone) ? 'leaving' : 'hold';
}

export interface HeldItems<T> {
  items: T[];
  /** 필터에서 빠질 예정이라 '곧 빠짐'으로 보일 항목. */
  leaving: Set<T>;
}

/**
 * 지금 필터·정렬 결과(visible)에 붙잡아 둔 항목을 체크 전 순서 자리에 끼워 넣는다.
 * - pool: 상태 필터 전 후보(검색·담당자 필터는 지난 목록). 같은 항목의 최신 객체를 여기서 가져온다.
 * - keysOf: 항목이 가진 붙잡기 키들(통합 카드는 BG·액팅 씬 키 두 개).
 * - 붙잡은 항목이 pool 에 없으면(검색에서 빠짐·삭제) 끼워 넣지 않는다.
 * 순서는 기록한 순서가 작은 것부터 끼운다 — 붙잡은 항목만 움직였다면 체크 전 순서가 그대로 돌아온다.
 */
export function holdLingeringItems<T>(
  visible: readonly T[],
  pool: readonly T[],
  keysOf: (item: T) => readonly string[],
  entries: ReadonlyMap<string, LingerEntry>,
): HeldItems<T> {
  if (entries.size === 0) return { items: visible as T[], leaving: new Set() };

  const orderOf = (item: T): number | null => {
    let best: number | null = null;
    for (const key of keysOf(item)) {
      const entry = entries.get(key);
      if (entry && (best === null || entry.order < best)) best = entry.order;
    }
    return best;
  };

  const visibleKeys = new Set<string>();
  for (const item of visible) for (const key of keysOf(item)) visibleKeys.add(key);

  const held: Array<{ item: T; order: number; out: boolean }> = [];
  const seen = new Set<T>();
  for (const item of pool) {
    if (seen.has(item)) continue;
    const order = orderOf(item);
    if (order === null) continue;
    seen.add(item);
    held.push({ item, order, out: !keysOf(item).some((key) => visibleKeys.has(key)) });
  }
  if (held.length === 0) return { items: visible as T[], leaving: new Set() };

  const items = visible.filter((item) => orderOf(item) === null);
  held.sort((a, b) => a.order - b.order);
  const leaving = new Set<T>();
  for (const { item, order, out } of held) {
    items.splice(Math.min(Math.max(0, order), items.length), 0, item);
    if (out) leaving.add(item);
  }
  return { items, leaving };
}

/* ─── 열린 상세 창의 이전/다음 목록 (검증 지적 acc-scene-flow-5) ─── */

/** 열린 상세 창이 마지막으로 목록에서 보였던 자리. */
export interface OpenDetailSlot {
  key: string;
  index: number;
}

export interface OpenDetailNav<T> {
  /** 이전/다음·'n / m'·점(도트)에 쓰는 목록 — 열린 씬이 빠졌으면 그 자리에 끼워 둔 사본. */
  list: readonly T[];
  /** 열린 씬의 순번. 목록에서 찾지 못하고 기억한 자리도 없으면 -1. */
  index: number;
  /** 다음 렌더에 넘길 기억(slot). */
  slot: OpenDetailSlot | null;
}

/**
 * 상세 창이 보여 주는 씬은 창이 닫힐 때까지 이전/다음 목록에 남긴다.
 * 필터를 켠 채 창 안에서 체크하면 그 씬은 머무름이 끝나는 순간(또는 단일 창이면 체크하는 순간) 필터 목록에서 빠진다.
 * 그러면 순번이 -1 이 되어 화살표·'n / m'·점이 사라지고(단일 창은 ←/→ 먹통) 사용자가 아무것도 안 했는데 창이 바뀌었다.
 * 마지막으로 보였던 자리(slot)에 그 씬을 끼워 두면 → 는 원래 다음 씬, ← 는 원래 이전 씬으로 간다.
 * - 처음부터 목록에 없던 씬(알림으로 연 필터 밖 씬 등)은 기억한 자리가 없으니 예전처럼 -1.
 * - 다른 씬으로 넘기면 그 씬 기준으로 다시 기억한다(빠졌던 씬은 목록에서 자연히 사라진다).
 */
export function keepOpenDetailInList<T>(
  list: readonly T[],
  openItem: T | null,
  keyOf: (item: T) => string,
  slot: OpenDetailSlot | null,
): OpenDetailNav<T> {
  if (openItem === null) return { list, index: -1, slot: null };
  const key = keyOf(openItem);
  const index = list.findIndex((item) => keyOf(item) === key);
  if (index >= 0) return { list, index, slot: { key, index } };
  if (!slot || slot.key !== key) return { list, index: -1, slot: null };
  const at = Math.min(Math.max(0, slot.index), list.length);
  return { list: [...list.slice(0, at), openItem, ...list.slice(at)], index: at, slot };
}
