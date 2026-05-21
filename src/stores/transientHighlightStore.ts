/**
 * 컴포지팅 대시보드 — 단계 변경 시 잠깐 표시되는 highlight 상태.
 *
 * 다른 사용자의 단계 변경이 Realtime 으로 들어왔을 때:
 *   1. 해당 씬 카드에 색 펄스 (background flash)
 *   2. 보낸 사람 아바타 배지 (작은 동그라미)
 * 이 둘을 2.5초 동안 표시 후 자동으로 사라진다.
 *
 * 본인의 변경(낙관적 토글)은 highlight 대상이 아니다 — 수신측에서 본인 ID 비교 후 add 호출 여부 결정.
 *
 * spec: docs/superpowers/specs/2026-05-21-compositing-dashboard-design.md (11.3)
 */

import { create } from 'zustand';

/** highlight 표시 지속 시간 (ms). spec: 2.5초. */
export const HIGHLIGHT_DURATION_MS = 2500;

export interface TransientHighlight {
  /** 변경을 일으킨 사용자 ID (아바타 표시용). null 이면 시스템 변경. */
  by: string | null;

  /** 시작 시각 (Date.now). 동일 키에 대해 재발생 시 갱신. */
  startedAt: number;
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
  add: (key: string, by: string | null, durationMs?: number) => void;

  /** 강제 제거 (예: EP 전환 시 cleanup). */
  clear: (key: string) => void;

  /** 모든 highlight 제거 + 모든 타이머 cancel. unmount 시 호출. */
  clearAll: () => void;
}

export const useTransientHighlightStore = create<TransientHighlightState>((set, get) => ({
  highlights: new Map(),
  _timers: new Map(),

  add: (key, by, durationMs = HIGHLIGHT_DURATION_MS) => {
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
      const nextHi = new Map(state.highlights);
      nextHi.set(key, { by, startedAt: Date.now() });
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
