import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createSaveRetryController, type SaveRetryEnv, type SaveRetryJob } from '../../src/utils/saveRetry.ts';
import {
  buildSequentialStagePatch,
  getChangedSequentialStages,
  mergePendingStageWrites,
  withExpectedStages,
  type PendingStageWrites,
} from '../../src/utils/sceneStageProgression.ts';
import {
  advanceAssigneeCarry,
  advancePhaseCarry,
  advanceStageCarry,
  judgePending,
  narrowStageWritesForRetry,
  phaseFieldsOf,
  planPhaseGiveUp,
  planStageGiveUp,
  restoreAssigneeEntry,
  sameAssigneeProgress,
  samePhase,
  stageRepaintPatch,
  type AssigneeSaveSlotCarry,
  type PhaseFields,
  type PhaseSaveSlotCarry,
  type StageSaveSlotCarry,
} from '../../src/utils/sceneSaveCarry.ts';
import { overlayPendingScenes } from '../../src/utils/pendingSceneOverlay.ts';
import { pressStartsOnCardControl } from '../../src/utils/sceneCardSelection.ts';
import { rollbackToastTitle, saveStoppedToastDescription, saveStoppedToastTitle } from '../../src/components/scenes/stageSaveFeedback.ts';
import type { Episode, Scene, Stage } from '../../src/types/index.ts';

/* 움직임 폴리싱 20번 safety-net — 검증 지적 수정(fx-retry 갈래).
   - acc-scene-check-1 · review-correctness-1 · review-data-safety-1 · review-motion-rules-3: 앞 저장이 닿은 뒤 뒤 저장이 실패하면 앞 결과까지만 되돌린다.
   - acc-scene-check-2 · review-data-safety-2: 다시 보내는 동안 받아오기가 옛 서버 값을 읽어 와도 내 값을 다시 얹는다.
   - acc-scene-check-3 · review-motion-rules-2: 남의 값을 지키는 포기·추월 가드를 순수 함수 단위 테스트와 연결 앵커로 고정한다.
   - review-data-safety-4: 늦게 나가는 저장은 보낼 때의 최신 값(씬 UUID·최신 담당자 기록)으로.
   - review-data-safety-5: 앱 종료 직전 기다리던 재전송을 한 번 보낸다. */

const read = (path: string) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
const ipcError = (message: string) => new Error(`Error invoking remote method 'supabase:update-scene-stage': Error: ${message}`);
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/* ─── 시계·연결을 손으로 움직이는 환경 ─── */

function fakeEnv(initiallyOnline = true) {
  let now = 0;
  let seq = 0;
  let online = initiallyOnline;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const onlineListeners = new Set<() => void>();
  const env: SaveRetryEnv = {
    setTimer: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id as number);
    },
    now: () => now,
    isOnline: () => online,
    onOnline: (fn) => {
      onlineListeners.add(fn);
      return () => onlineListeners.delete(fn);
    },
  };
  return {
    env,
    get now() {
      return now;
    },
    get pendingTimers() {
      return timers.size;
    },
    async advance(ms: number) {
      const target = now + ms;
      for (;;) {
        await flush();
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > target) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].fn();
      }
      now = target;
      await flush();
    },
  };
}

function deferred() {
  let resolve: () => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function baseJob<C>(carry: C, overrides: Partial<SaveRetryJob<C>> = {}): SaveRetryJob<C> {
  return { carry, attempt: async () => {}, stillMine: () => true, onGiveUp: () => {}, ...overrides };
}

/* ─── 진행기: 같은 key 는 차례로, 넘겨준 뒤 저장되면 알린다 ─── */

test('같은 key 의 요청은 차례로 나간다 — 뒤 요청은 앞 요청이 끝난 뒤에 보낸다', async () => {
  const clock = fakeEnv();
  const retry = createSaveRetryController(clock.env);
  const first = deferred();
  const order: string[] = [];
  const a = retry.run('s|phase', baseJob('A', {
    attempt: () => {
      order.push('A start');
      return first.promise.then(() => {
        order.push('A end');
      });
    },
  }));
  const b = retry.run('s|phase', baseJob('B', {
    attempt: async () => {
      order.push('B start');
    },
  }));
  const other = retry.run('t|phase', baseJob('T', {
    attempt: async () => {
      order.push('T start');
    },
  }));
  await clock.advance(0);
  assert.deepEqual(order, ['A start', 'T start'], '다른 key 는 기다리지 않는다');
  first.resolve();
  assert.equal(await a, 'superseded');
  assert.equal(await b, 'saved');
  assert.equal(await other, 'saved');
  assert.deepEqual(order, ['A start', 'T start', 'A end', 'B start']);
});

test('넘겨준 앞 요청이 저장되면 지금 key 를 맡은 저장의 carry 를 넘겨준다 — 실패했으면 부르지 않는다', async () => {
  const clock = fakeEnv();
  const retry = createSaveRetryController(clock.env);
  const firstA = deferred();
  const firstB = deferred();
  const told: Array<[string, unknown]> = [];
  const a = retry.run('k', baseJob('A', { attempt: () => firstA.promise, onSupersededSaved: (next) => told.push(['A', next]) }));
  const b = retry.run('k', baseJob('B', { attempt: () => firstB.promise, onSupersededSaved: (next) => told.push(['B', next]) }));
  const c = retry.run('k', baseJob('C'));
  firstA.resolve();
  assert.equal(await a, 'superseded');
  assert.deepEqual(told, [['A', 'C']], 'B 도 넘겨줬으니 지금 맡은 저장(C)의 기준을 앞당긴다');
  firstB.reject(ipcError('fetch failed'));
  assert.equal(await b, 'superseded');
  assert.deepEqual(told, [['A', 'C']], '실패한 앞 요청은 앞당기지 않는다');
  assert.equal(await c, 'saved');
});

test('앱 종료 직전: 재전송을 기다리던 저장을 깨워 바로 보내고, 그 요청이 끝나면 끝난다', async () => {
  const clock = fakeEnv();
  const retry = createSaveRetryController(clock.env);
  const attempts: number[] = [];
  let failNext = true;
  const outcome = retry.run('k', baseJob('A', {
    attempt: async () => {
      attempts.push(clock.now);
      if (failNext) {
        failNext = false;
        throw ipcError('TypeError: fetch failed');
      }
    },
  }));
  await clock.advance(300);
  assert.deepEqual(attempts, [0], '0.8초 재전송을 기다리는 중');
  let flushed = false;
  const flushing = retry.flushNow().then(() => {
    flushed = true;
  });
  await flushing;
  assert.equal(flushed, true);
  assert.deepEqual(attempts, [0, 300], '기다리지 않고 지금 보낸다');
  assert.equal(await outcome, 'saved');
  assert.equal(clock.pendingTimers, 0);
});

test('앱 종료 직전: 연결이 끊겨 기다리던 저장도 한 번 보내 본다 · 보내는 중이던 요청은 끝날 때까지 기다린다', async () => {
  const clock = fakeEnv(false);
  const retry = createSaveRetryController(clock.env);
  const attempts: number[] = [];
  const outcome = retry.run('offline', baseJob('A', {
    attempt: async () => {
      attempts.push(clock.now);
      throw ipcError('TypeError: fetch failed');
    },
  }));
  await clock.advance(5000);
  assert.deepEqual(attempts, [0], '연결을 기다리는 중');
  const inFlight = deferred();
  const busy = retry.run('busy', baseJob('B', { attempt: () => inFlight.promise }));
  let flushed = false;
  const flushing = retry.flushNow().then(() => {
    flushed = true;
  });
  await clock.advance(0);
  assert.deepEqual(attempts, [0, 5000], '연결 신호를 기다리지 않고 보낸다');
  assert.equal(flushed, false, '보내는 중이던 요청이 아직 안 끝났다');
  inFlight.resolve();
  await flushing;
  assert.equal(await busy, 'saved');
  assert.equal(flushed, true);
  assert.equal(await Promise.race([outcome, Promise.resolve('pending')]), 'pending', '실패한 저장은 평소처럼 다음 재전송을 이어 간다');
});

test('앱 종료 직전: 연결이 끊긴 채 0.8초 재전송을 기다리던 저장도 연결을 기다리지 않고 바로 보낸다', async () => {
  const clock = fakeEnv(false);
  const retry = createSaveRetryController(clock.env);
  const attempts: number[] = [];
  const outcome = retry.run('k', baseJob('A', {
    attempt: async () => {
      attempts.push(clock.now);
      if (attempts.length === 1) throw ipcError('TypeError: fetch failed');
    },
  }));
  await clock.advance(300);
  await retry.flushNow();
  assert.deepEqual(attempts, [0, 300]);
  assert.equal(await outcome, 'saved');
});

test('앱 종료 직전: 넘겨준 뒤 보내는 중인 앞 요청이 있어도, 넘겨받은 저장의 요청까지 끝나야 끝난다', async () => {
  const clock = fakeEnv();
  const retry = createSaveRetryController(clock.env);
  const first = deferred();
  const order: string[] = [];
  const a = retry.run('k', baseJob('A', { attempt: () => first.promise.then(() => { order.push('A'); }) }));
  const b = retry.run('k', baseJob('B', { attempt: async () => { order.push('B'); } }));
  const flushing = retry.flushNow().then(() => order.push('flushed'));
  await clock.advance(0);
  assert.deepEqual(order, []);
  first.resolve();
  await flushing;
  assert.deepEqual(order, ['A', 'B', 'flushed']);
  assert.equal(await a, 'superseded');
  assert.equal(await b, 'saved');
});

test('앱 종료 직전: 기다리는 저장이 없으면 바로 끝난다', async () => {
  const retry = createSaveRetryController(fakeEnv().env);
  await retry.flushNow();
});

/* ─── 씬 단위 칸: 앞 저장이 닿은 뒤 뒤 저장이 끝내 실패하면 앞 결과까지만 되돌린다 ─── */

const stages = (key: string) => ({ lo: key[0] === '1', done: key[1] === '1', review: key[2] === '1', png: key[3] === '1' });

function stageCarry(writes: PendingStageWrites, extra: Partial<StageSaveSlotCarry> = {}): StageSaveSlotCarry {
  return {
    writes,
    baseCompletion: { completedBy: '', completedAt: '' },
    basePhase: null,
    baseAssigneeProgress: undefined,
    completion: null,
    minePhase: null,
    assigneeTouched: false,
    mineAssigneeProgress: undefined,
    ...extra,
  };
}

/** 화면 쪽 단계 칸 경로를 그대로 흉내 낸다: 클릭 → 낙관적 반영 → carry 이어받기 → 진행기. */
function stageHarness(retry: ReturnType<typeof createSaveRetryController>, start: string) {
  let screen = stages(start);
  const serverWrites: Array<[Stage, boolean]> = [];
  const shown: Stage[][] = [];
  const click = (stage: Stage, attempt: () => Promise<void>) => {
    const patch = buildSequentialStagePatch(screen, stage);
    const changed = getChangedSequentialStages(screen, patch);
    const carried = retry.pendingCarry<StageSaveSlotCarry>('s|stages');
    const before = screen;
    screen = { ...screen, ...Object.fromEntries(changed.map((s) => [s, patch[s]])) };
    const carry = stageCarry(withExpectedStages(mergePendingStageWrites(carried?.writes, before, patch, changed), screen));
    let saved: { stages: Stage[]; desired: PendingStageWrites['desired'] } | null = null;
    return retry.run<StageSaveSlotCarry>('s|stages', {
      carry,
      attempt: async () => {
        saved = null;
        const { writes } = carry;
        await attempt();
        writes.stages.forEach((s) => serverWrites.push([s, writes.desired[s] === true]));
        saved = { stages: writes.stages, desired: writes.desired };
      },
      stillMine: () => true,
      onGiveUp: () => {
        const plan = planStageGiveUp(carry, screen);
        if (!plan) return;
        screen = { ...screen, ...(plan.patch as Partial<typeof screen>) };
        plan.rolled.forEach((s) => serverWrites.push([s, carry.writes.baseline[s] === true]));
        shown.push(plan.shown);
      },
      onSupersededSaved: (next) => {
        if (next && saved) advanceStageCarry(next, { ...saved, completion: null, phase: null, assigneeProgress: null });
      },
    });
  };
  return {
    click,
    get screen() {
      return screen;
    },
    serverWrites,
    shown,
  };
}

test('[단계 칸] LO 저장이 닿은 뒤 넘겨받은 완료 저장이 거절되면 완료만 되돌리고 LO 는 남긴다(화면·서버 모두)', async () => {
  const clock = fakeEnv();
  const retry = createSaveRetryController(clock.env);
  const h = stageHarness(retry, '0000');
  const loSaved = deferred();
  const a = h.click('lo', () => loSaved.promise);
  const b = h.click('done', async () => {
    throw ipcError('new row violates row-level security policy for table "scenes" [HTTP 403]');
  });
  assert.deepEqual(h.screen, stages('1100'));
  loSaved.resolve();
  assert.equal(await a, 'superseded');
  assert.equal(await b, 'failed');
  assert.deepEqual(h.screen, stages('1000'), 'LO 는 저장됐으니 그대로');
  assert.deepEqual(h.shown, [['done']], '흔들고 안내하는 칸은 실제로 되돌린 완료뿐');
  const finalServer = Object.fromEntries(h.serverWrites);
  assert.equal(finalServer.lo, true, '서버의 LO 도 지우지 않는다');
  assert.equal(finalServer.done, false);
});

test('[단계 칸] 앞 저장도 실패했으면 둘 다 맨 처음 값으로 되돌린다', async () => {
  const clock = fakeEnv();
  const retry = createSaveRetryController(clock.env);
  const h = stageHarness(retry, '0000');
  const loFails = deferred();
  const a = h.click('lo', () => loFails.promise);
  const b = h.click('done', async () => {
    throw ipcError('permission denied [HTTP 403]');
  });
  loFails.reject(ipcError('permission denied [HTTP 403]'));
  assert.equal(await a, 'superseded');
  assert.equal(await b, 'failed');
  assert.deepEqual(h.screen, stages('0000'));
  assert.deepEqual(h.shown, [['lo', 'done']]);
});

test('advanceStageCarry — 뒤 저장이 함께 보내는 칸의 기준만 앞당기고, 완료 기록·액팅 단계·담당자 진행도 저장된 값으로', () => {
  const before = stages('0000');
  const patch = buildSequentialStagePatch(before, 'review');
  const writes = withExpectedStages(mergePendingStageWrites(undefined, before, patch, getChangedSequentialStages(before, patch)), stages('1110'));
  const narrowed = { ...writes, stages: ['lo', 'done'] as Stage[] };
  const next = stageCarry(narrowed, {
    basePhase: { sceneState: 'wait', workRound: 0, feedbackRound: 0 },
    baseCompletion: { completedBy: '', completedAt: '' },
    assigneeTouched: true,
    baseAssigneeProgress: { 김: { lo: false } },
  });
  advanceStageCarry(next, {
    stages: ['lo', 'review'],
    desired: { lo: true, review: true },
    completion: { completedBy: '배한솔', completedAt: '2026-10-03T00:00:00Z' },
    phase: { sceneState: 'work', workRound: 1, feedbackRound: 0 },
    assigneeProgress: { 김: { lo: true } },
  });
  assert.deepEqual(next.writes.baseline, { lo: true, done: false, review: false }, '뒤 저장이 빼 버린 검수는 건드리지 않는다');
  assert.notEqual(next.writes.baseline, writes.baseline, '기준값 객체를 새로 만든다(앞 저장과 공유하지 않음)');
  assert.deepEqual(next.baseCompletion, { completedBy: '배한솔', completedAt: '2026-10-03T00:00:00Z' });
  assert.deepEqual(next.basePhase, { sceneState: 'work', workRound: 1, feedbackRound: 0 });
  assert.deepEqual(next.baseAssigneeProgress, { 김: { lo: true } });

  const bgNext = stageCarry(narrowed);
  advanceStageCarry(bgNext, { stages: ['lo'], desired: { lo: true }, completion: null, phase: { sceneState: 'work', workRound: 1, feedbackRound: 0 }, assigneeProgress: { 김: {} } });
  assert.equal(bgNext.basePhase, null, 'BG 씬(액팅 단계 없음)에는 단계를 만들지 않는다');
  assert.equal(bgNext.baseAssigneeProgress, undefined, '담당자 진행을 건드리지 않은 저장에는 얹지 않는다');
  assert.deepEqual(bgNext.baseCompletion, { completedBy: '', completedAt: '' }, '완료 기록을 쓰지 않았으면 그대로');
});

/* ─── 끝내 실패: 아직 내 값일 때만 되돌린다 ─── */

test('planStageGiveUp — 아직 내 값인 칸만 되돌리고, 하나도 없으면 아무것도 건드리지 않는다(남의 값 지키기)', () => {
  const before = stages('1000');
  const patch = buildSequentialStagePatch(before, 'png');
  const writes = withExpectedStages(mergePendingStageWrites(undefined, before, patch, getChangedSequentialStages(before, patch)), stages('1111'));
  const carry = stageCarry(writes, {
    completion: { completedBy: '배한솔', completedAt: 't' },
    baseCompletion: { completedBy: '', completedAt: '' },
    basePhase: { sceneState: 'work', workRound: 2, feedbackRound: 0 },
    minePhase: { sceneState: 'done', workRound: 0, feedbackRound: 0 },
    assigneeTouched: true,
    baseAssigneeProgress: { 김: { lo: true } },
    mineAssigneeProgress: { 김: { ...stages('1111'), sceneState: null } },
  });
  // 이 저장이 만든 곁 값(완료 도장·단계·담당자 진행)이 그대로인 화면.
  const mineNow = {
    ...stages('1111'),
    completedBy: '배한솔',
    completedAt: 't',
    sceneState: 'done' as const,
    workRound: 0,
    feedbackRound: 0,
    assigneeProgress: { 김: { ...stages('1111'), sceneState: null, updatedAt: 'later' } },
  };

  assert.equal(planStageGiveUp(carry, { ...mineNow, ...stages('1000') }), null, '팀원이 모두 되돌렸으면 완료 기록·단계·담당자 진행도 덮지 않는다');

  const all = planStageGiveUp(carry, mineNow);
  assert.ok(all);
  assert.deepEqual(all.rolled, ['done', 'review', 'png']);
  assert.deepEqual(all.patch, {
    done: false,
    review: false,
    png: false,
    completedBy: '',
    completedAt: '',
    sceneState: 'work',
    workRound: 2,
    feedbackRound: 0,
    assigneeProgress: { 김: { lo: true } },
  });

  const partly = planStageGiveUp(carry, { ...mineNow, ...stages('1110') });
  assert.ok(partly);
  assert.deepEqual(partly.rolled, ['done', 'review'], 'PNG 는 그 사이 다른 값이 됐으니 그대로');
  assert.equal('png' in partly.patch, false);

  const noExtras = planStageGiveUp(stageCarry(writes), stages('1111'));
  assert.ok(noExtras);
  assert.deepEqual(Object.keys(noExtras.patch).sort(), ['done', 'png', 'review'], '완료 기록을 바꾸지 않은 저장은 완료 기록을 건드리지 않는다');
});

test('planStageGiveUp — 화면이 바뀌지 않는 칸은 흔들지 않는다(바뀌는 칸이 없으면 누른 칸을 그대로)', () => {
  const writes: PendingStageWrites = {
    stages: ['lo', 'done'],
    desired: { lo: true, done: true },
    baseline: { lo: true, done: false },
    expected: { lo: true, done: true },
  };
  assert.deepEqual(planStageGiveUp(stageCarry(writes), stages('1100'))?.shown, ['done']);
  const invisible: PendingStageWrites = { stages: ['lo'], desired: { lo: true }, baseline: { lo: false }, expected: { lo: false } };
  assert.deepEqual(planStageGiveUp(stageCarry(invisible), stages('0000'))?.shown, ['lo']);
});

test('narrowStageWritesForRetry — 다시 보내기 직전에 다른 값이 된 칸은 빼고 덮지 않는다', () => {
  const before = stages('0000');
  const patch = buildSequentialStagePatch(before, 'review');
  const writes = withExpectedStages(mergePendingStageWrites(undefined, before, patch, getChangedSequentialStages(before, patch)), stages('1110'));
  const same = narrowStageWritesForRetry(writes, stages('1110'));
  assert.equal(same.writes, writes, '모두 내 값이면 그대로');
  assert.deepEqual(same.dropped, []);
  const narrowed = narrowStageWritesForRetry(writes, stages('1100'));
  assert.deepEqual(narrowed.writes.stages, ['lo', 'done']);
  assert.deepEqual(narrowed.dropped, ['review']);
  assert.deepEqual(writes.stages, ['lo', 'done', 'review'], '원래 묶음은 바꾸지 않는다');
});

/* ─── 받아오기 덮기 막기 ─── */

const scene = (key: string, extra: Partial<Scene> = {}): Scene => ({
  id: 'uuid-a',
  no: 1,
  sceneId: 'a004',
  memo: '',
  storyboardUrl: '',
  guideUrl: '',
  assignee: '',
  layoutId: '',
  ...stages(key),
  ...extra,
});

test('stageRepaintPatch — 받아오기가 처음 값을 읽어 와도 아직 내 값이던 칸은 다시 얹고, 다른 값이면 두지 않는다', () => {
  const before = stages('0000');
  const patch = buildSequentialStagePatch(before, 'lo');
  const writes = withExpectedStages(mergePendingStageWrites(undefined, before, patch, getChangedSequentialStages(before, patch)), stages('1000'));
  const carry = stageCarry(writes);
  assert.deepEqual(stageRepaintPatch(carry, scene('0000'), stages('1000'), null), { lo: true }, '옛 서버 값 → 내 값을 다시 얹는다');
  assert.equal(stageRepaintPatch(carry, scene('1000'), stages('1000'), null), null, '이미 내 값이면 얹을 것 없음');
  assert.equal(stageRepaintPatch(carry, scene('0000'), stages('0000'), null), null, '화면에서 이미 바뀐 칸(내 다른 버튼·팀원)은 얹지 않는다');
});

test('stageRepaintPatch — 같은 클릭이 함께 바꾼 완료 기록·액팅 단계도 처음 값으로 돌아가 있을 때만 다시 얹는다', () => {
  const before = stages('1110');
  const patch = buildSequentialStagePatch(before, 'png');
  const writes = withExpectedStages(mergePendingStageWrites(undefined, before, patch, getChangedSequentialStages(before, patch)), stages('1111'));
  const done: PhaseFields = { sceneState: 'done', workRound: 0, feedbackRound: 0 };
  const carry = stageCarry(writes, {
    completion: { completedBy: '배한솔', completedAt: 't1' },
    baseCompletion: { completedBy: '', completedAt: '' },
    basePhase: { sceneState: 'feedback', workRound: 0, feedbackRound: 1 },
  });
  const stale = scene('1110', { sceneState: 'feedback', workRound: 0, feedbackRound: 1 });
  assert.deepEqual(stageRepaintPatch(carry, stale, stages('1111'), done), {
    png: true,
    completedBy: '배한솔',
    completedAt: 't1',
    sceneState: 'done',
    workRound: 0,
    feedbackRound: 0,
  });
  const otherStamp = scene('1110', { completedBy: '김지은', completedAt: 't0', sceneState: 'work', workRound: 2 });
  assert.deepEqual(stageRepaintPatch(carry, otherStamp, stages('1111'), done), { png: true }, '다른 완료 기록·단계는 덮지 않는다');
});

test('overlayPendingScenes — 맡긴 씬에만 얹고, 바뀐 가지만 새로 만든다', () => {
  const episodes: Episode[] = [
    { episodeNumber: 1, title: 'EP01', parts: [
      { partId: 'A', sheetName: 'EP01_A_BG', scenes: [scene('0000'), scene('0000', { id: 'uuid-b', sceneId: 'a005' })] },
      { partId: 'B', sheetName: 'EP01_B_BG', scenes: [scene('0000', { id: 'uuid-c', sceneId: 'b001' })] },
    ] } as Episode,
    { episodeNumber: 2, title: 'EP02', parts: [] } as unknown as Episode,
  ];
  assert.equal(overlayPendingScenes(episodes, []), episodes);
  assert.equal(overlayPendingScenes(episodes, [{ sceneUuid: 'uuid-a', reapply: () => null }]), episodes, '얹을 것이 없으면 같은 배열');
  const out = overlayPendingScenes(episodes, [
    { sceneUuid: 'uuid-a', reapply: (incoming) => (incoming.lo ? null : { lo: true }) },
    { sceneUuid: 'uuid-a', reapply: (incoming) => (incoming.lo ? { done: true } : null) },
  ]);
  assert.notEqual(out, episodes);
  assert.equal(out[0].parts[0].scenes[0].lo, true);
  assert.equal(out[0].parts[0].scenes[0].done, true, '같은 씬의 여러 묶음은 앞 묶음이 얹은 값 위에 차례로');
  assert.equal(out[0].parts[0].scenes[1], episodes[0].parts[0].scenes[1], '다른 씬은 같은 객체');
  assert.equal(out[0].parts[1], episodes[0].parts[1], '다른 파트는 같은 객체');
  assert.equal(out[1], episodes[1], '다른 에피소드는 같은 객체');
  assert.equal(episodes[0].parts[0].scenes[0].lo, false, '받은 배열은 고치지 않는다');
});

/* ─── 액팅 단계 칩 ─── */

test('[액팅 단계] 작업중 저장이 닿은 뒤 넘겨받은 완료 저장이 거절되면 작업중 1차로 되돌린다(대기 아님)', async () => {
  const clock = fakeEnv();
  const retry = createSaveRetryController(clock.env);
  let current: PhaseFields = { sceneState: 'wait', workRound: 0, feedbackRound: 0 };
  const legacyOf = (state: PhaseFields['sceneState']) => ({ lo: state !== 'wait', done: state !== 'wait', review: state === 'feedback' || state === 'done', png: state === 'done' });
  const click = (mine: PhaseFields, attempt: () => Promise<void>) => {
    const carried = retry.pendingCarry<PhaseSaveSlotCarry>('s|phase');
    const carry: PhaseSaveSlotCarry = {
      base: carried?.base ?? { ...current, ...legacyOf(current.sceneState), completedBy: '', completedAt: '', assigneeProgress: undefined },
      completion: null,
    };
    current = mine;
    return retry.run<PhaseSaveSlotCarry>('s|phase', {
      carry,
      attempt,
      stillMine: () => samePhase(current, mine),
      onGiveUp: () => {
        const restore = planPhaseGiveUp(current, mine, carry.base);
        if (restore) current = phaseFieldsOf(restore);
      },
      onSupersededSaved: (next) => {
        if (next) advancePhaseCarry(next, { ...mine, ...legacyOf(mine.sceneState) });
      },
    });
  };
  const workSaved = deferred();
  const a = click({ sceneState: 'work', workRound: 1, feedbackRound: 0 }, () => workSaved.promise);
  const b = click({ sceneState: 'done', workRound: 0, feedbackRound: 0 }, async () => {
    throw ipcError('permission denied [HTTP 403]');
  });
  await clock.advance(0);
  workSaved.resolve();
  assert.equal(await a, 'superseded');
  assert.equal(await b, 'failed');
  assert.deepEqual(current, { sceneState: 'work', workRound: 1, feedbackRound: 0 });
});

test('planPhaseGiveUp — 지금 단계가 내 값일 때만 되돌린다(처음 값·다른 값이면 그대로)', () => {
  const mine: PhaseFields = { sceneState: 'done', workRound: 0, feedbackRound: 0 };
  const base = { sceneState: 'work' as const, workRound: 1, feedbackRound: 0, lo: true, done: true, review: false, png: false, completedBy: '', completedAt: '' };
  assert.equal(planPhaseGiveUp({ sceneState: 'done', workRound: 0, feedbackRound: 0 }, mine, base), base);
  assert.equal(planPhaseGiveUp({ sceneState: 'feedback', workRound: 0, feedbackRound: 1 }, mine, base), null, '팀원이 바꾼 값은 둔다');
  assert.equal(planPhaseGiveUp({ sceneState: 'work', workRound: 1, feedbackRound: 0 }, mine, base), null);
  assert.equal(planPhaseGiveUp(undefined, mine, base), null, '씬이 사라졌으면 아무것도 하지 않는다');
  assert.equal(planPhaseGiveUp({ sceneState: 'done', workRound: 2, feedbackRound: 0 }, mine, base), null, '차수까지 같아야 내 값');
});

test('advancePhaseCarry — 단계·차수·체크 4개만 앞당기고 완료 기록·담당자 진행은 그대로(앞 저장이 쓰지 않았다)', () => {
  const next: PhaseSaveSlotCarry = {
    base: { sceneState: 'wait', workRound: 0, feedbackRound: 0, lo: false, done: false, review: false, png: false, completedBy: 'x', completedAt: 'y', assigneeProgress: { 김: {} } },
    completion: null,
  };
  advancePhaseCarry(next, { sceneState: 'work', workRound: 1, feedbackRound: 0, lo: true, done: true, review: false, png: false });
  assert.deepEqual(next.base, { sceneState: 'work', workRound: 1, feedbackRound: 0, lo: true, done: true, review: false, png: false, completedBy: 'x', completedAt: 'y', assigneeProgress: { 김: {} } });
});

test('judgePending — 내 값 / 처음 값으로 돌아감 / 그 밖', () => {
  const mine: PhaseFields = { sceneState: 'work', workRound: 1, feedbackRound: 0 };
  const base: PhaseFields = { sceneState: 'wait', workRound: 0, feedbackRound: 0 };
  assert.equal(judgePending(mine, mine, base, samePhase), 'mine');
  assert.equal(judgePending({ ...base }, mine, base, samePhase), 'reverted');
  assert.equal(judgePending({ sceneState: 'feedback', workRound: 0, feedbackRound: 1 }, mine, base, samePhase), 'other');
  assert.equal(judgePending(undefined, mine, base, samePhase), 'other');
  assert.equal(judgePending({ ...base }, mine, undefined, samePhase), 'other', '처음 값을 모르면 되돌아간 것으로 보지 않는다');
});

/* ─── 담당자별 버튼 ─── */

test('restoreAssigneeEntry — 이 담당자 몫만 처음 값으로, 그 사이 저장된 다른 담당자 값은 그대로', () => {
  const latest = { 김: { lo: true, done: true }, 이: { lo: true } };
  assert.deepEqual(restoreAssigneeEntry(latest, '김', { lo: false }), { 김: { lo: false }, 이: { lo: true } });
  assert.deepEqual(restoreAssigneeEntry(undefined, '김', undefined), { 김: {} });
  assert.deepEqual(latest, { 김: { lo: true, done: true }, 이: { lo: true } }, '받은 맵은 고치지 않는다');
});

test('advanceAssigneeCarry — 되돌릴 기준의 이 담당자 몫·완료 기록을 저장된 값으로, 다른 담당자는 그대로', () => {
  const next: AssigneeSaveSlotCarry = {
    prevScene: scene('0000', { assignee: '김, 이', assigneeProgress: { 김: { lo: false }, 이: { lo: true } }, completedBy: '', completedAt: '' }),
    completion: null,
    cells: [],
  };
  const before = next.prevScene;
  advanceAssigneeCarry(next, '김', { lo: true }, { completedBy: '배한솔', completedAt: 't' });
  assert.deepEqual(next.prevScene.assigneeProgress, { 김: { lo: true }, 이: { lo: true } });
  assert.equal(next.prevScene.completedBy, '배한솔');
  assert.equal(before.assigneeProgress?.김?.lo, false, '앞 기준 객체는 고치지 않는다');
  advanceAssigneeCarry(next, '이', { lo: false }, null);
  assert.equal(next.prevScene.completedBy, '배한솔', '완료 기록을 쓰지 않았으면 그대로');
  assert.equal(sameAssigneeProgress({ lo: true, updatedAt: 'a' }, { lo: true, updatedAt: 'b' }), true, '저장 시각은 비교하지 않는다');
});

/* ─── 안내 문구 ─── */

test('멈춤 안내는 원인을 짐작하지 않는다(인터넷 탓·팀원 탓 아님)', () => {
  const title = saveStoppedToastTitle('a004', { kind: 'check', label: 'LO' });
  assert.equal(title, 'a004 LO 체크 저장을 멈췄어요');
  assert.equal(saveStoppedToastTitle('a004', { kind: 'phase', label: '완료' }, '김지은'), "a004 김지은 '완료' 단계 저장을 멈췄어요");
  assert.equal(saveStoppedToastTitle('a004', { kind: 'round' }, '김지은'), 'a004 김지은 작업 차수 저장을 멈췄어요');
  const description = saveStoppedToastDescription();
  assert.doesNotMatch(`${title} ${description}`, /인터넷|연결|팀원|되돌렸/);
  assert.notEqual(title, rollbackToastTitle('a004', { kind: 'check', label: 'LO' }));
});

/* ─── 연결 앵커: 화면 코드가 위 판단을 실제로 쓰는가 ─── */

test('세 경로가 포기·추월 때 남의 값을 지키는 판단을 거친다', () => {
  const view = read('src/views/ScenesView.tsx');
  // 단계 칸: 끝내 실패 — 내 칸이 없으면 아무것도 하지 않고, 있으면 계획대로 화면·서버를 되돌리고 바뀐 칸만 알린다.
  assert.match(view, /const plan = latest \? planStageGiveUp\(saveCarry, latest\) : null;\n\s+if \(!plan\) return;/);
  assert.match(view, /updateSceneByUuid\(sceneUuid, plan\.patch\);/);
  assert.match(view, /await Promise\.allSettled\(plan\.rolled\.map\(\(s\) => writeStage\(s, baseline\[s\] === true\)\)\);/);
  assert.match(view, /announceStageLoss\(plan\.shown, kind\);/);
  // 단계 칸: 다시 보내기 직전 — 다른 값이 된 칸은 빼고 보낸다.
  assert.match(view, /const narrowed = narrowStageWritesForRetry\(saveCarry\.writes, latest\);\n\s+saveCarry\.writes = narrowed\.writes;/);
  assert.match(view, /return saveCarry\.writes\.stages\.length > 0;/);
  // 액팅 단계: 내 값일 때만 되돌리고, 저장이 안 됐으면 담당자 기록·완료 기록을 쓰지 않는다.
  assert.match(view, /const restore = planPhaseGiveUp\(useDataStore\.getState\(\)\.findSceneByUuid\(sceneUuid\), minePhase, saveCarry\.base\);\n\s+if \(!restore\) return;/);
  assert.match(view, /updateSceneByUuid\(sceneUuid, restore\);/);
  assert.match(view, /if \(outcome !== 'saved'\) return;/);
  // 담당자별: 내 값일 때만, 이 담당자 몫만 되돌린다.
  assert.match(view, /if \(!assigneeStillMine\(\)\) return;\n\s+const latest = useDataStore\.getState\(\)\.findSceneByUuid\(sceneUuid\);/);
  assert.match(view, /restoreAssigneeEntry\(\n\s+latest\.assigneeProgress,\n\s+assigneeName,\n\s+normalizeAssigneeProgressMap\(base\)\[assigneeName\],/);
  assert.match(view, /const base = saveCarry\.prevScene;/, '되돌릴 기준은 그때의 carry 에서 읽는다(앞당긴 값)');
  // 멈춤은 되돌림이 아니라 원인 중립 안내.
  assert.equal((view.match(/announceSaveStopped\(\{/g) ?? []).length, 3);
  assert.doesNotMatch(view, /announcePhaseLoss\('transient'\)|announceAssigneeLoss\('transient'\)|announceStageLoss\(reverted/);
});

test('세 경로가 넘겨준 뒤 저장되면 다음 저장의 되돌릴 기준을 앞당긴다', () => {
  const view = read('src/views/ScenesView.tsx');
  assert.match(view, /onSupersededSaved: \(next\) => \{\n\s+if \(next && savedResult\) advanceStageCarry\(next, savedResult\);/);
  assert.match(view, /onSupersededSaved: \(next\) => \{\n\s+if \(next\) advancePhaseCarry\(next, \{ \.\.\.minePhase, \.\.\.legacyStagesFor\(newState\) \}\);/);
  assert.match(view, /onSupersededSaved: \(next\) => \{\n\s+if \(next && savedEntry\) advanceAssigneeCarry\(next, assigneeName, savedEntry, savedCompletion\);/);
  // 서버에 쓴 값만 기록한다(칸을 다 쓴 뒤에야 저장됨으로 본다).
  assert.match(view, /await writeStage\(changedStage, writes\.desired\[changedStage\] === true\);\n\s+\}\n\s+const saved: SavedStageResult = \{ stages: writes\.stages, desired: writes\.desired,/);
  assert.match(view, /saved\.phase = actingPhaseFields;/);
  assert.match(view, /saved\.assigneeProgress = progress;/);
  assert.match(view, /saved\.completion = saveCarry\.completion;/);
});

test('세 경로가 저장을 기다리는 동안 받아오기 위에 내 값을 다시 얹고, 끝나면 푼다', () => {
  const view = read('src/views/ScenesView.tsx');
  assert.equal((view.match(/holdPendingSceneValues\(saveSlotKey, \{/g) ?? []).length, 3);
  assert.match(view, /\}\)\.finally\(releasePendingCells\);/);
  assert.match(view, /\} finally \{\n\s+releasePendingPhase\(\);\n\s+\}/);
  assert.match(view, /\} finally \{\n\s+releasePendingEntry\(\);\n\s+\}/);
  // 화면에서 이미 다른 값이 된 뒤면 얹지 않는다.
  assert.match(view, /const repaint = current \? stageRepaintPatch\(saveCarry, incoming, current, actingPhaseFields\) : null;/);
  assert.match(view, /if \(!phaseStillMine\(\)\) return null;\n\s+if \(judgePending\(phaseFieldsOf\(incoming\), minePhase, phaseFieldsOf\(saveCarry\.base\), samePhase\) !== 'reverted'\) return null;/);
  assert.match(view, /if \(!assigneeStillMine\(\) \|\| !hasMultiAssigneeProgress\(incoming\)\) return null;/);
  assert.match(view, /if \(judgePending\(incomingMap\[assigneeName\], mine, baseEntry, sameAssigneeProgress\) !== 'reverted'\) return null;/);

  const store = read('src/stores/useDataStore.ts');
  assert.match(store, /setEpisodes: \(episodes\) => set\(applyUpdate\(get, keepPendingSceneValues\(episodes\)\)\),/);
  const service = read('src/services/sceneSaveRetry.ts');
  assert.match(service, /return pendingOverlays\.size === 0 \? episodes : overlayPendingScenes\(episodes, pendingOverlays\.values\(\)\);/);
  assert.match(service, /if \(pendingOverlays\.get\(key\) === overlay\) pendingOverlays\.delete\(key\);/, '뒤 저장이 맡긴 것은 앞 저장이 풀지 않는다');
});

test('늦게 나가는 저장은 보낼 때의 값으로 — 완료 기록은 씬 UUID, 담당자 기록은 최신 값 위에 같은 변경', () => {
  const view = read('src/views/ScenesView.tsx');
  assert.equal((view.match(/updateSceneCompletionMetaByUuid\(\n?\s*sceneUuid,/g) ?? []).length, 3);
  assert.match(view, /const progress = updateAllAssigneeProgressEntries\(latestForProgress, assigneeUpdate, currentUser\?\.name\);/);
  assert.match(view, /const progress = updateAllAssigneeProgressEntries\(latestScene, phaseProgressUpdate, currentUser\?\.name\);/);
  assert.doesNotMatch(view, /writeAssigneeProgressMetadata\(sceneUuid, nextAssigneeProgress,/);
  const service = read('src/services/supabaseService.ts');
  assert.match(service, /export async function updateSceneCompletionMetaByUuid\(/);
});

test('앱 종료 직전 신호에 재전송 진행기를 건다', () => {
  const service = read('src/services/sceneSaveRetry.ts');
  assert.match(service, /window\.electronAPI\?\.onBeforeQuitFlush\?\.\(\(\) => controller\.flushNow\(\)\)/);
  assert.match(service, /run<C>\(key: string, job: SaveRetryJob<C>\) \{\n\s+hookQuitFlush\(\);/);
});

/* ─── 파트의 마지막 씬 완료 순간(acc-scene-check-4) ─── */

test('누름이 카드 안 버튼에서 시작했으면 카드 click 을 선택으로 보지 않는다', () => {
  const at = (matches: boolean) => ({ closest: (selector: string) => (matches && selector.includes('[data-stage-key]') ? {} : null) });
  assert.equal(pressStartsOnCardControl(at(true)), true);
  assert.equal(pressStartsOnCardControl(at(false)), false, '그림·빈 곳에서 시작한 누름은 선택');
  assert.equal(pressStartsOnCardControl(null), false);
  assert.equal(pressStartsOnCardControl({} as EventTarget), false, 'closest 가 없는 대상(글자 노드 등)');

  for (const [file, count] of [['src/views/ScenesView.tsx', 1], ['src/components/scenes/UnifiedSceneCard.tsx', 1]] as const) {
    const source = read(file);
    assert.equal((source.match(/onPointerDownCapture=\{handlePointerDownCapture\}/g) ?? []).length, count, file);
    assert.match(source, /pressStartedOnControlRef\.current = pressStartsOnCardControl\(e\.target\);/, file);
    assert.match(source, /const handleCardClick = \(e: React\.MouseEvent\) => \{\n\s+if \(pressStartedOnControlRef\.current\) \{\n\s+pressStartedOnControlRef\.current = false;\n(?:\s+e\.preventDefault\(\);\n)?\s+return;\n\s+\}\n\s+handleClick\(e\);/, file);
    assert.match(source, /onClick=\{handleCardClick\}/, file);
  }
});

test('선택 일괄 바가 떠 있으면 같은 자리의 \'완료 안내 다시 보기\' 알약은 잠시 숨는다', () => {
  const view = read('src/views/ScenesView.tsx');
  assert.equal((view.match(/\{showCompletionRestoreButton && selectedSceneIds\.size === 0 && \(/g) ?? []).length, 2);
  assert.doesNotMatch(view, /\{showCompletionRestoreButton && \(\n\s+<CompletionRestoreButton/);
});

/* ─── 단계 클릭 비용(perf-6) ─── */

test('숫자 굴림은 띠를 읽어 레이아웃을 강제로 다시 계산하지 않는다 — 멈춰 있으면 목표 자리, 굴러가면 진행도로', () => {
  const src = read('src/components/ui/RollingNumber.tsx');
  assert.match(src, /const visual = targetRef\.current === null \|\| !running\n\s+\? prevTarget\n\s+: rollingCellNow\(animRef\.current, rollRef\.current\) \?\? readStripCell\(strip, prevTarget\);/);
  assert.match(src, /const running = animRef\.current\?\.playState === 'running';/);
  assert.match(src, /rollRef\.current = \{ from: plan\.from, to: plan\.to \};/);
  assert.match(src, /const progress = anim\.effect\?\.getComputedTiming\(\)\.progress;/);
});
