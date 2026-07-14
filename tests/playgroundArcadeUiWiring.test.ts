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
const snakeStageSource = read('src', 'views', 'playground', 'arcade', 'SnakeStage.tsx');
const loopSource = read('src', 'features', 'playground', 'arcade', 'games', 'loop.ts');
const arcadeCssSource = read('src', 'views', 'playground', 'arcade', 'arcade.css');

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
  // 시작 버튼은 사유가 있거나 입장 요청 진행 중이면 비활성(입장료 중복 차감 방지)
  assert.match(chromeSource, /disabled=\{!!startDisabledReason \|\| !!startPending\}/);
  assert.match(chromeSource, /entryFee\}P 내고 시작/);
  // 진행/일시정지/카운트다운 + 입장료 정산 중(startPending)에도 뒤로가기 인터셉트
  assert.match(chromeSource, /phase === 'running' \|\| phase === 'paused' \|\| phase === 'countdown' \|\| !!startPending/);
  assert.match(chromeSource, /usePlaygroundBackInterceptor\(interceptActive/);
  // 정산·저장 중에는 이탈만 막고(모달 없이), 진행 중이면 확인 전에 먼저 멈춘다
  assert.match(chromeSource, /if \(startPending \|\| phase === 'finishing'\) return;/);
  assert.match(chromeSource, /if \(phase === 'running'\) \{ onPause\(\)/);
  // 확인 모달 중에는 카운트다운도 멈춘다
  assert.match(chromeSource, /phase !== 'countdown' \|\| confirmingQuit/);
  // 결과 저장 중(에러 전)에도 뒤로가기를 가로채 유료 판 유실을 막는다
  assert.match(chromeSource, /const savingResult = phase === 'finishing' && !finishError;/);
  assert.match(chromeSource, /if \(startPending \|\| phase === 'finishing'\) return;/);
  // 종료 확인 문구 + 입장료 안내
  assert.match(chromeSource, /게임을 종료할까요\?/);
  assert.match(chromeSource, /입장료는 돌려받지 못해요/);
  // 상태 aria-live + reduced-motion 대체
  assert.match(chromeSource, /aria-live="polite"/);
  assert.match(chromeSource, /useReducedMotion/);
  assert.match(chromeSource, /if \(prefersReducedMotion\)/);
});

test('the loop auto-pauses on hidden/blur and resumes on focus', () => {
  assert.match(loopSource, /addEventListener\('visibilitychange'/);
  assert.match(loopSource, /addEventListener\('blur'/);
  assert.match(loopSource, /addEventListener\('focus'/);
  // active(사용자 의도) + visible(창 상태) 둘 다일 때만 프레임을 돌린다
  assert.match(loopSource, /if \(!active \|\| !visible\) return;/);
  assert.match(loopSource, /!document\.hidden && document\.hasFocus\(\)/);
});

test('arcade.css wraps --pg tokens in rgb() (they are raw triplets)', () => {
  assert.match(arcadeCssSource, /rgb\(var\(--pg-panel\)\)/);
  assert.match(arcadeCssSource, /rgb\(var\(--pg-bg\) \/ 0\.82\)/);
  assert.doesNotMatch(arcadeCssSource, /background: var\(--pg-/); // 감싸지 않은 직접 사용 없음
});

test('SnakeStage keeps a retry state when finishRun fails and normalizes canvas colors', () => {
  // finishRun 실패 시 이탈하지 않고 재시도 상태 유지
  assert.match(snakeStageSource, /setFinishError\(true\)/);
  assert.match(snakeStageSource, /onRetryFinish=\{\(\) => void finalize\(\)\}/);
  assert.match(snakeStageSource, /deadStateRef/);
  // 죽은 뒤 catch-up 스텝이 finalize 를 중복 호출하지 않도록 가드
  assert.match(snakeStageSource, /if \(!s \|\| s\.status !== 'running'\) return;/);
  // 종료 payload 를 1회 고정하고, finalize·재시도가 그대로 재사용(멱등 request_id·내용)
  assert.match(snakeStageSource, /finishInputRef\.current = \{/);
  assert.match(snakeStageSource, /const input = finishInputRef\.current;/);
  // duration 은 wall-clock 이 아니라 활성 플레이 시간(스텝 tickMs 합)을 4시간 상한으로 클램프
  assert.match(snakeStageSource, /activePlayMsRef\.current \+= s\.tickMs;/);
  assert.match(snakeStageSource, /Math\.min\(14_400_000, Math\.max\(1000, Math\.round\(activePlayMsRef\.current\)\)\)/);
  assert.doesNotMatch(snakeStageSource, /performance\.now\(\) - startedAtRef/); // wall-clock duration 제거
  // 캔버스도 토큰을 rgb(...) 로 감싼다
  assert.match(snakeStageSource, /`rgb\(\$\{triplet\}\)`/);
  // 크롬은 finishError 시 재시도 오버레이를 띄운다
  assert.match(chromeSource, /finishError \?/);
  assert.match(chromeSource, /결과를 저장하지 못했어요/);
});

test('SnakeStage guards against duplicate entry charges and exits directly', () => {
  // 입장 요청 진행 중이면 재시작 무시(동기 ref 가드) + 버튼 비활성 전달
  assert.match(snakeStageSource, /if \(startingRef\.current\) return;/);
  assert.match(snakeStageSource, /startingRef\.current = true;/);
  assert.match(snakeStageSource, /startPending=\{starting\}/);
  // 확인 전 일시정지용 onPause 전달(루프만 멈춤)
  assert.match(snakeStageSource, /onPause=\{\(\) => loopRef\.current\?\.pause\(\)\}/);
  // 종료 확인 모달이 뜨면 게임 키 입력을 막는다(모달 뒤 방향 큐잉 방지)
  assert.match(snakeStageSource, /if \(confirmOpen\) return;/);
  assert.match(snakeStageSource, /onConfirmingChange=\{setConfirmOpen\}/);
  // 결과·종료 라벨은 소스 서페이스 라벨을 쓴다(하우스에서 진입 시 '로비로' 오표기 방지)
  assert.match(snakeStageSource, /returnLabel=\{returnLabel\}/);
  assert.match(resultSource, /\{returnLabel\}/);
  assert.match(chromeSource, /onConfirmingChange\?\.\(confirmingQuit\)/);
  // 종료는 루프를 멈추고 onExit(직접 이탈)로 나간다
  assert.match(snakeStageSource, /loopRef\.current\?\.stop\(\);\s*onExit\(\);/);
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
