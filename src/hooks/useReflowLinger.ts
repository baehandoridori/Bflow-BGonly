import { useCallback, useEffect, useRef, useState } from 'react';

import {
  REFLOW_LINGER,
  extendLingerDeadline,
  initialLingerState,
  lingerPhaseOf,
  lingerReducer,
  lingerView,
  type LingerAction,
  type LingerEntry,
  type LingerPhase,
} from '@/utils/reflowLinger';

/**
 * 방금 체크한 카드를 잠깐 제자리에 붙잡아 두는 상태 (움직임 폴리싱 15번).
 * 상태가 어떻게 바뀌는지는 src/utils/reflowLinger.ts 의 lingerReducer 가 정하고(단위 테스트), 여기는 타이머만 몬다.
 *
 * - hold(keys, order, holdMs): 체크 직전(낙관 갱신 전)에 부른다. 이미 붙잡은 키는 처음 순서를 지킨다.
 *   여러 장을 연달아 체크하면 마감이 늘어나 모두 함께 기다린다.
 * - 마감이 되면 expire('leaving' — 빠질 카드가 0.2초에 사라짐) → clear(비우고 generation 을 올림).
 *   generation 은 목록 미끄러짐(useGridFlip)의 키에 넣어, 비우는 순간 나머지 카드가 빈자리로 미끄러지게 한다.
 * - scope(파트·필터·정렬·검색 등)가 바뀌면 붙잡은 것은 그 자리에서 무효다 — 같은 렌더에서 바로 빠진다.
 */
export interface ReflowLinger {
  entries: ReadonlyMap<string, LingerEntry>;
  phase: LingerPhase;
  generation: number;
  hold: (keys: readonly string[], order: number, holdMs: number) => void;
  /** 카드 하나(키들)의 '곧 빠짐' 단계. */
  phaseOf: (keys: readonly string[]) => LingerPhase;
}

export function useReflowLinger(scope: string): ReflowLinger {
  const [state, setState] = useState(() => initialLingerState(scope));
  const dispatch = useCallback((action: LingerAction) => setState((previous) => lingerReducer(previous, action)), []);
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
    dispatch({ type: 'hold', scope: scopeRef.current, keys, order });
    const now = Date.now();
    deadlineRef.current = extendLingerDeadline(deadlineRef.current, now, holdMs);
    clearTimer();
    timerRef.current = setTimeout(() => {
      dispatch({ type: 'expire' });
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        deadlineRef.current = 0;
        dispatch({ type: 'clear' });
      }, REFLOW_LINGER.fadeOutMs);
    }, Math.max(0, deadlineRef.current - now));
  }, [dispatch]);

  // 보기가 바뀌면 붙잡은 것을 버린다(렌더에서는 이미 무효). 같은 보기로 곧장 돌아와도 되살아나지 않게.
  useEffect(() => {
    dispatch({ type: 'scope', scope });
    if (deadlineRef.current !== 0) {
      clearTimer();
      deadlineRef.current = 0;
    }
  }, [scope, dispatch]);

  useEffect(() => () => clearTimer(), []);

  const view = lingerView(state, scope);
  const phaseOf = useCallback(
    (keys: readonly string[]) => lingerPhaseOf(view.entries, view.phase, keys),
    [view.entries, view.phase],
  );
  return {
    entries: view.entries,
    phase: view.phase,
    generation: state.generation,
    hold,
    phaseOf,
  };
}
