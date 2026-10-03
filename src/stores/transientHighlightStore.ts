/**
 * 컴포지팅 대시보드 — 단계 변경 시 잠깐 표시되는 highlight 상태.
 *
 * 다른 사용자의 변경이 Realtime 으로 들어왔을 때:
 *   1. 단계(status)가 실제로 바뀌었으면 카드 앞면이 새 단계 색으로 한 번 물들었다 빠진다 (wash, 0.9초)
 *   2. 보낸 사람 아바타 배지 (작은 동그라미) — '톡' 나타났다 조용히 사라진다
 * highlight 는 2.5초 동안 유지된 뒤 자동으로 사라진다.
 *
 * 본인의 변경(낙관적 토글)은 highlight 대상이 아니다 — 수신측에서 본인 ID 비교 후 add 호출 여부 결정.
 * EP 전환·첫 로드는 Realtime 이벤트가 아니므로 카드 수십 장이 한꺼번에 물드는 일은 없다.
 *
 * spec: docs/superpowers/specs/2026-05-21-compositing-dashboard-design.md (11.3)
 *       docs/superpowers/specs/2026-10-03-motion-polish-design.md (5. compositing-card-fixes)
 */

import { create } from 'zustand';

/** highlight 표시 지속 시간 (ms). spec: 2.5초. 아바타 배지의 퇴장 시점(CSS)도 이 값에 맞춘다. */
export const HIGHLIGHT_DURATION_MS = 2500;

export interface TransientHighlight {
  /** 변경을 일으킨 사용자 ID (아바타 표시용). null 이면 시스템 변경. */
  by: string | null;

  /** 시작 시각 (Date.now). 동일 키에 대해 재발생 시 갱신. */
  startedAt: number;

  /** add 할 때마다 커지는 번호 — 아바타 배지를 처음부터 다시 틀 React key. */
  seq: number;

  /**
   * 마지막으로 단계가 실제로 바뀐 add 의 seq — 카드 앞면 물듦(wash)의 React key.
   * 단계가 그대로인 변경(오류 사유·메모만 바뀜)은 물들이지 않고, 이미 돌고 있는 물듦도 끊지 않는다.
   * null 이면 이번 highlight 동안 단계 변화가 없었다.
   */
  washSeq: number | null;
}

export interface AddHighlightOptions {
  /** 표시 시간(ms). 기본 HIGHLIGHT_DURATION_MS. */
  durationMs?: number;
  /** 단계가 실제로 바뀐 변경인지 — true 일 때만 카드 앞면이 물든다. */
  wash?: boolean;
}

interface TransientHighlightState {
  /** key = compositingKey(episodeNumber, sceneId). */
  highlights: Map<string, TransientHighlight>;

  /** 키 단위 자동 제거 타이머 (외부 노출하지 않음) */
  _timers: Map<string, ReturnType<typeof setTimeout>>;

  /**
   * highlight 추가/갱신. duration 이후 자동 제거.
   * 동일 키 재호출 시 기존 타이머 cancel → 새 타이머로 reset.
   */
  add: (key: string, by: string | null, options?: AddHighlightOptions) => void;

  /** 강제 제거 (예: EP 전환 시 cleanup). */
  clear: (key: string) => void;

  /** 모든 highlight 제거 + 모든 타이머 cancel. unmount 시 호출. */
  clearAll: () => void;
}

/** 단계가 실제로 바뀌었는지. 행이 없던 씬은 '배치'로 보이므로 'batch' 와 비교한다. */
export function compositingStatusChanged(
  previous: { status: string } | null | undefined,
  next: { status: string },
): boolean {
  return (previous?.status ?? 'batch') !== next.status;
}

let highlightSeq = 0;

export const useTransientHighlightStore = create<TransientHighlightState>((set, get) => ({
  highlights: new Map(),
  _timers: new Map(),

  add: (key, by, options = {}) => {
    const { durationMs = HIGHLIGHT_DURATION_MS, wash = false } = options;
    const { _timers } = get();
    // 동일 키에 활성 타이머가 있으면 cancel — 새 타이머가 timeout 책임을 인계받는다
    const existing = _timers.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      // setTimeout 안에서 다시 get() — 그 사이에 add 가 다시 호출돼 새 타이머가 들어왔다면
      // _timers.get(key) !== timer 가 돼 자동 제거를 건너뛴다.
      const state = get();
      if (state._timers.get(key) !== timer) return;
      const nextHi = new Map(state.highlights);
      nextHi.delete(key);
      const nextTimers = new Map(state._timers);
      nextTimers.delete(key);
      set({ highlights: nextHi, _timers: nextTimers });
    }, durationMs);

    set((state) => {
      const seq = ++highlightSeq;
      const previous = state.highlights.get(key);
      const nextHi = new Map(state.highlights);
      nextHi.set(key, { by, startedAt: Date.now(), seq, washSeq: wash ? seq : (previous?.washSeq ?? null) });
      const nextTimers = new Map(state._timers);
      nextTimers.set(key, timer);
      return { highlights: nextHi, _timers: nextTimers };
    });
  },

  clear: (key) => {
    const { _timers, highlights } = get();
    const timer = _timers.get(key);
    if (timer) clearTimeout(timer);
    if (!highlights.has(key) && !_timers.has(key)) return;
    const nextHi = new Map(highlights);
    nextHi.delete(key);
    const nextTimers = new Map(_timers);
    nextTimers.delete(key);
    set({ highlights: nextHi, _timers: nextTimers });
  },

  clearAll: () => {
    const { _timers } = get();
    for (const timer of _timers.values()) clearTimeout(timer);
    set({ highlights: new Map(), _timers: new Map() });
  },
}));

/**
 * 컴포넌트 셀렉터 헬퍼 — 단일 키에 대한 highlight 반환.
 * Map 자체를 selector 결과로 쓰면 매번 새 ref 라 re-render 가 많이 일어나므로
 * 키 단위로 직접 꺼내쓰도록 유도.
 */
export function selectHighlight(
  state: { highlights: Map<string, TransientHighlight> },
  key: string,
): TransientHighlight | undefined {
  return state.highlights.get(key);
}
