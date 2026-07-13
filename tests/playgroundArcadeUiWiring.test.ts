import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { advanceFixedStep, createFixedStepLoop } from '../src/features/playground/arcade/games/loop.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...seg: string[]) => readFileSync(path.join(root, ...seg), 'utf8');
const chromeSource = read('src', 'views', 'playground', 'arcade', 'ArcadeStageChrome.tsx');
const resultSource = read('src', 'views', 'playground', 'arcade', 'RunResultOverlay.tsx');

test('advanceFixedStep accumulates frames and steps once per crossed interval', () => {
  let steps = 0;
  const getStep = () => 160;
  let acc = 0;
  for (let i = 0; i < 4; i += 1) acc = advanceFixedStep(acc, 33, getStep, () => { steps += 1; });
  assert.equal(steps, 0, '132ms 누적 → 아직 스텝 없음');
  acc = advanceFixedStep(acc, 33, getStep, () => { steps += 1; });
  assert.equal(steps, 1, '165ms 누적 → 1스텝');
  assert.ok(acc >= 0 && acc < 160);
});

test('advanceFixedStep re-reads stepMs each step so acceleration takes effect', () => {
  let stepMs = 100;
  const steps: number[] = [];
  // 200ms 를 한 번에 넣되, 스텝마다 간격이 줄어들어 고정 100ms(2스텝)보다 많이 실행돼야 한다.
  advanceFixedStep(0, 200, () => stepMs, () => { steps.push(stepMs); stepMs = Math.max(20, stepMs - 40); });
  assert.ok(steps.length >= 3, `가변 stepMs 로 3스텝 이상 (실제 ${steps.length})`);
  assert.deepEqual(steps.slice(0, 3), [100, 60, 20]);
});

test('advanceFixedStep caps catch-up steps to avoid the spiral of death', () => {
  let steps = 0;
  advanceFixedStep(0, 100000, () => 16, () => { steps += 1; }, 5);
  assert.equal(steps, 5);
});

test('createFixedStepLoop does not advance simulation while paused', () => {
  const frame: { cb: ((t: number) => void) | null } = { cb: null };
  const requestFrame = (fn: (t: number) => void) => { frame.cb = fn; return 1; };
  const cancelFrame = () => { frame.cb = null; };
  let steps = 0;
  const loop = createFixedStepLoop({
    getStepMs: () => 100,
    onStep: () => { steps += 1; },
    now: () => 1000,
    requestFrame,
    cancelFrame,
  });
  loop.start();
  frame.cb?.(1050); // delta 50 → 0 step
  frame.cb?.(1160); // delta 110 → 1 step
  assert.equal(steps, 1);
  loop.pause();
  assert.equal(loop.isRunning(), false);
  frame.cb?.(2000); // paused: tick 은 early-return 이어야 한다
  assert.equal(steps, 1, '일시정지 중에는 스텝이 늘지 않는다');
});

test('ArcadeStageChrome renders per-phase overlays and guards start/back', () => {
  assert.match(chromeSource, /phase === 'ready'/);
  assert.match(chromeSource, /phase === 'countdown'/);
  assert.match(chromeSource, /phase === 'paused'/);
  assert.match(chromeSource, /phase === 'result'/);
  // 시작 버튼은 사유가 있으면 비활성
  assert.match(chromeSource, /disabled=\{!!startDisabledReason\}/);
  assert.match(chromeSource, /entryFee\}P 내고 시작/);
  // 진행/일시정지/카운트다운에서만 뒤로가기 인터셉트
  assert.match(chromeSource, /phase === 'running' \|\| phase === 'paused' \|\| phase === 'countdown'/);
  assert.match(chromeSource, /usePlaygroundBackInterceptor\(interceptActive/);
  // 종료 확인 문구 + 입장료 안내
  assert.match(chromeSource, /게임을 종료할까요\?/);
  assert.match(chromeSource, /입장료는 돌려받지 못해요/);
  // 상태 aria-live + reduced-motion 대체
  assert.match(chromeSource, /aria-live="polite"/);
  assert.match(chromeSource, /useReducedMotion/);
  assert.match(chromeSource, /if \(prefersReducedMotion\)/);
});

test('RunResultOverlay sequences grade, reward, best banner and achievements', () => {
  assert.match(resultSource, /pg-arcade-result__gauge-fill/);
  assert.match(resultSource, /useCountUp\(result\.rewardPoints/);
  assert.match(resultSource, /result\.rewardCapped/);
  assert.match(resultSource, /오늘 보상 한도에 도달했어요 \(5\/5\)/);
  assert.match(resultSource, /result\.newAlltimeBest/);
  assert.match(resultSource, /result\.unlockedAchievements\.map/);
  assert.match(resultSource, /delay: animate \? index \* 0\.12/); // 스태거
  assert.match(resultSource, /useReducedMotion/);
});
