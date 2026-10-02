/**
 * 단계 버튼 손맛 (움직임 폴리싱 6번 stage-toggle-feel) — 순서 계산만 담은 순수 모듈.
 *
 * LO/완료/검수/PNG 칸은 앞 단계까지 한꺼번에 켜지고 꺼진다(sceneStageProgression.buildSequentialStagePatch).
 * 화면에서는 그 변화를 한 칸씩 이어서 보여 준다 — 켜질 때는 왼쪽(LO)부터, 꺼질 때는 오른쪽(PNG)부터 40ms 간격.
 * 실제 지연은 CSS 가 `--stage-step × 40ms` 로 건다(src/styles/motion-scene-check.css).
 *
 * node --test 가 그대로 import 하도록 런타임 의존이 없다(@/ 별칭·외부 패키지 X).
 */

/** 이어서 차오르는 칸 사이 간격(ms). CSS 의 `calc(var(--stage-step) * 40ms)` 와 같은 값. */
export const STAGE_FILL_STEP_MS = 40;

/** 칸 채움(scaleX 0→1) 길이(ms). */
export const STAGE_FILL_MS = 220;

/** '현재 단계' 칸: 켜져 있고 바로 다음 칸이 꺼져 있다(마지막 칸은 켜져 있기만 하면 된다). StageSegmentToggle 의 isCurrent 와 같은 규칙. */
export function stageCurrentFlags(on: readonly boolean[]): boolean[] {
  return on.map((value, index) => Boolean(value) && (index === on.length - 1 || !on[index + 1]));
}

/**
 * 이전·다음 켜짐 상태로 칸마다 '몇 번째로 바뀌는지'(0부터)를 돌려준다.
 * - 켜지는 칸: 왼쪽부터 0, 1, 2… (LO→완료→검수→PNG)
 * - 꺼지는 칸: 오른쪽부터 0, 1, 2… (PNG→검수→완료→LO)
 * - 켜짐은 그대로인데 '현재 단계' 표시만 옮겨 오거나 떠나는 칸: 이번 변화의 마지막 순서
 *   (새 현재 칸이 다 차오를 때, 또는 마지막 칸이 빠질 때 함께 바뀐다)
 * - 그 밖의 칸: 0
 * 누른 칸은 항상 사슬의 마지막이라(앞 단계까지 켜기 / 뒤 단계까지 끄기) 누른 곳을 향해 이어진다.
 */
export function stageFillSteps(prev: readonly boolean[], next: readonly boolean[]): number[] {
  const length = next.length;
  const steps = new Array<number>(length).fill(0);
  let onRank = 0;
  for (let index = 0; index < length; index += 1) {
    if (!prev[index] && next[index]) steps[index] = onRank++;
  }
  let offRank = 0;
  for (let index = length - 1; index >= 0; index -= 1) {
    if (prev[index] && !next[index]) steps[index] = offRank++;
  }
  const lastStep = Math.max(0, onRank - 1, offRank - 1);
  const prevCurrent = stageCurrentFlags(Array.from({ length }, (_, index) => Boolean(prev[index])));
  const nextCurrent = stageCurrentFlags(next);
  for (let index = 0; index < length; index += 1) {
    if (Boolean(prev[index]) === Boolean(next[index]) && prevCurrent[index] !== nextCurrent[index]) {
      steps[index] = lastStep;
    }
  }
  return steps;
}

/** 이어지는 움직임이 모두 끝나는 시점(ms). 그 뒤에는 순서를 0 으로 돌려 hover 색이 늦게 따라오지 않게 한다. */
export function stageFillSettleMs(steps: readonly number[]): number {
  const last = steps.reduce((max, step) => Math.max(max, step), 0);
  return last * STAGE_FILL_STEP_MS + STAGE_FILL_MS + 40;
}

/** 켜짐 상태를 '1010' 같은 열쇠로 — 렌더 사이에 바뀌었는지 비교할 때 쓴다. */
export function stageOnKey(on: readonly boolean[]): string {
  return on.map((value) => (value ? '1' : '0')).join('');
}

export function stageOnFromKey(key: string): boolean[] {
  return Array.from(key, (char) => char === '1');
}
