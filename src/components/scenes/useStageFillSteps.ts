import { useEffect, useState } from 'react';
import { stageFillSettleMs, stageFillSteps, stageOnFromKey, stageOnKey } from './stageToggleMotion';

interface StageFillState {
  key: string;
  steps: number[];
}

const zeros = (length: number) => new Array<number>(length).fill(0);

/**
 * 칸 켜짐이 바뀐 렌더에서 칸마다 이어서 바뀔 순서(--stage-step)를 돌려준다.
 * 이전 값은 '바뀐 props 로 state 맞추기' 패턴으로 기억한다(커밋 전에 한 번 더 렌더 — 효과 없이 같은 프레임에 반영).
 * 움직임이 끝나면 순서를 0 으로 돌린다 — 남아 있으면 나중에 마우스를 올렸을 때 글자색이 늦게 따라온다.
 */
export function useStageFillSteps(on: readonly boolean[]): number[] {
  const key = stageOnKey(on);
  const [state, setState] = useState<StageFillState>(() => ({ key, steps: zeros(on.length) }));
  let current = state;
  if (state.key !== key) {
    current = { key, steps: stageFillSteps(stageOnFromKey(state.key), on) };
    setState(current);
  }

  useEffect(() => {
    if (!state.steps.some((step) => step > 0)) return;
    const timer = window.setTimeout(() => {
      setState((latest) => (latest === state ? { key: latest.key, steps: zeros(latest.steps.length) } : latest));
    }, stageFillSettleMs(state.steps));
    return () => window.clearTimeout(timer);
  }, [state]);

  return current.steps;
}
