import { useCallback, useEffect, useRef, useState } from 'react';

import {
  REFLOW_LINGER,
  extendLingerDeadline,
  type LingerEntry,
  type LingerPhase,
} from '@/utils/reflowLinger';

/**
 * 방금 체크한 카드를 잠깐 제자리에 붙잡아 두는 상태 (움직임 폴리싱 15번).
 *
 * - hold(keys, order, holdMs): 체크 직전(낙관 갱신 전)에 부른다. 이미 붙잡은 키는 처음 순서를 지킨다.
 *   여러 장을 연달아 체크하면 마감이 늘어나 모두 함께 기다린다.
 * - 마감이 되면 phase 'leaving'(빠질 카드가 0.2초에 사라짐) → 비우고 generation 을 올린다.
 *   generation 은 목록 미끄러짐(useGridFlip)의 키에 넣어, 비우는 순간 나머지 카드가 빈자리로 미끄러지게 한다.
 * - scope(파트·필터·정렬·검색 등)가 바뀌면 붙잡은 것은 그 자리에서 무효다 — 같은 렌더에서 바로 빠진다.
 */
interface LingerState {
  scope: string;
  entries: ReadonlyMap<string, LingerEntry>;
  phase: LingerPhase;
  generation: number;
}

const EMPTY: ReadonlyMap<string, LingerEntry> = new Map();

export interface ReflowLinger {
  entries: ReadonlyMap<string, LingerEntry>;
  phase: LingerPhase;
  generation: number;
  hold: (keys: readonly string[], order: number, holdMs: number) => void;
}

export function useReflowLinger(scope: string): ReflowLinger {
  const [state, setState] = useState<LingerState>(() => ({ scope, entries: EMPTY, phase: 'hold', generation: 0 }));
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadlineRef = useRef(0);

  const clearTimer = () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const hold = useCallback((keys: readonly string[], order: number, holdMs: number) => {
    if (keys.length === 0) return;
    setState((previous) => {
      const base = previous.scope === scopeRef.current ? previous.entries : EMPTY;
      const next = new Map(base);
      for (const key of keys) if (!next.has(key)) next.set(key, { order });
      return { scope: scopeRef.current, entries: next, phase: 'hold', generation: previous.generation };
    });
    const now = Date.now();
    deadlineRef.current = extendLingerDeadline(deadlineRef.current, now, holdMs);
    clearTimer();
    timerRef.current = setTimeout(() => {
      setState((previous) => (previous.entries.size === 0 ? previous : { ...previous, phase: 'leaving' }));
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        deadlineRef.current = 0;
        setState((previous) => (previous.entries.size === 0
          ? previous
          : { scope: previous.scope, entries: EMPTY, phase: 'hold', generation: previous.generation + 1 }));
      }, REFLOW_LINGER.fadeOutMs);
    }, Math.max(0, deadlineRef.current - now));
  }, []);

  // 보기가 바뀌면 붙잡은 것을 버린다(렌더에서는 이미 무효). 같은 보기로 곧장 돌아와도 되살아나지 않게.
  useEffect(() => {
    setState((previous) => (previous.scope === scope || previous.entries.size === 0
      ? previous
      : { scope, entries: EMPTY, phase: 'hold', generation: previous.generation }));
    if (deadlineRef.current !== 0) {
      clearTimer();
      deadlineRef.current = 0;
    }
  }, [scope]);

  useEffect(() => () => clearTimer(), []);

  const active = state.scope === scope;
  return {
    entries: active ? state.entries : EMPTY,
    phase: active ? state.phase : 'hold',
    generation: state.generation,
    hold,
  };
}
