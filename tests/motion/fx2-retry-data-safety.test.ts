import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createSaveRetryController, type SaveRetryEnv, type SaveRetryJob } from '../../src/utils/saveRetry.ts';
import {
  buildSequentialStagePatch,
  getChangedSequentialStages,
  isSequentialStageComplete,
  mergePendingStageWrites,
  withExpectedStages,
} from '../../src/utils/sceneStageProgression.ts';
import {
  narrowStageWritesForRetry,
  planCompletionStampDrop,
  planStageGiveUp,
  sameAssigneeProgressMap,
  stageRepaintPatch,
  type CompletionStamp,
  type StageSaveSlotCarry,
} from '../../src/utils/sceneSaveCarry.ts';
import { overlayPendingSceneFields, type PendingSceneOverlay } from '../../src/utils/pendingSceneOverlay.ts';
import type { Scene, Stage } from '../../src/types/index.ts';

/* 움직임 폴리싱 20번 safety-net — 2차 수정(fx2-retry 갈래).
   - data-retry-1: 실시간 scenes UPDATE 행(서버 행 전체)도 받아오기와 같은 '다시 얹기' 규칙을 거친다.
   - data-retry-2: 다시 보내기 직전 칸을 빼서 씬이 완료가 아니게 되면 완료 도장을 쓰지 않는다.
   - codex-4171688324: 끝내 실패할 때 완료 기록·액팅 단계·담당자 진행은 지금 값이 이 저장이 만든 값일 때만 되돌린다.
   - codex-4171688328: 앱 종료 직전 정리 중에 같은 칸이 또 바뀌면 정리가 새 저장의 요청까지 기다린다. */

const read = (path: string) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const transient = () => new Error("Error invoking remote method 'supabase:update-scene-stage': Error: TypeError: fetch failed");

function fakeEnv() {
  let now = 0;
  let seq = 0;
  let online = true;
  const timers = new Map<number, { at: number; fn: () => void }>();
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
    onOnline: () => () => {},
  };
  return {
    env,
    setOnline(value: boolean) {
      online = value;
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

const stages = (key: string) => ({ lo: key[0] === '1', done: key[1] === '1', review: key[2] === '1', png: key[3] === '1' });

const scene = (key: string, extra: Partial<Scene> = {}): Scene => ({
  id: 'uuid-a',
  no: 1,
  sceneId: 'a002',
  memo: '',
  storyboardUrl: '',
  guideUrl: '',
  assignee: '',
  layoutId: '',
  completedBy: '',
  completedAt: '',
  ...stages(key),
  ...extra,
});

/** 실시간 scenes UPDATE 가 싣는 모양(extractSceneDelta) — 서버 행 전체의 단계·메모 등. 완료 기록·단계 상태는 싣지 않는다. */
const realtimeRow = (server: string, extra: Partial<Scene> = {}): Partial<Scene> => ({
  ...stages(server),
  assignee: '',
  memo: '',
  sceneId: 'a002',
  no: 1,
  ...extra,
});

const STAMP: CompletionStamp = { completedBy: '배한솔', completedAt: '2026-10-03T04:32:54.510Z' };
const NO_STAMP: CompletionStamp = { completedBy: '', completedAt: '' };

/**
 * 화면 쪽 씬 단위 칸 경로를 흉내 낸다: 클릭 → 낙관적 반영 → carry → '다시 얹을 내 값' 맡김 → 진행기.
 * stillMine 은 ScenesView 와 같이 칸을 줄이고 완료 도장을 다시 판단한다.
 */
function stageLane(start: string) {
  const retry = createSaveRetryController(clockEnv.env);
  let screen: Scene = scene(start);
  const server: Record<string, unknown> = { ...stages(start), ...NO_STAMP };
  const calls: string[] = [];
  const overlays = new Map<string, PendingSceneOverlay>();
  let failPlan: Array<'ok' | 'transient'> = [];
  const click = (stage: Stage) => {
    const before = screen;
    const patch = buildSequentialStagePatch(before, stage);
    const changed = getChangedSequentialStages(before, patch);
    const completes = isSequentialStageComplete(patch) && !isSequentialStageComplete(before);
    screen = { ...screen, ...Object.fromEntries(changed.map((s) => [s, patch[s]])), ...(completes ? STAMP : {}) };
    const carry: StageSaveSlotCarry = {
      writes: withExpectedStages(mergePendingStageWrites(undefined, before, patch, changed), screen),
      baseCompletion: { completedBy: before.completedBy ?? '', completedAt: before.completedAt ?? '' },
      basePhase: null,
      baseAssigneeProgress: undefined,
      completion: completes ? STAMP : null,
      minePhase: null,
      assigneeTouched: false,
      mineAssigneeProgress: undefined,
    };
    overlays.set('uuid-a|stages', {
      sceneUuid: 'uuid-a',
      reapply: (incoming) => stageRepaintPatch(carry, incoming, screen, null),
    });
    return retry.run<StageSaveSlotCarry>('uuid-a|stages', {
      carry,
      attempt: async () => {
        for (const s of carry.writes.stages) {
          const plan = failPlan.shift() ?? 'ok';
          calls.push(`${s}:${plan}`);
          if (plan === 'transient') throw transient();
          server[s] = carry.writes.desired[s] === true;
        }
        if (carry.completion) {
          calls.push('completion');
          Object.assign(server, carry.completion);
        }
      },
      stillMine: () => {
        const narrowed = narrowStageWritesForRetry(carry.writes, screen);
        carry.writes = narrowed.writes;
        const drop = planCompletionStampDrop(carry, screen);
        if (drop) {
          carry.completion = null;
          if (drop.screen) screen = { ...screen, ...drop.screen };
        }
        return carry.writes.stages.length > 0;
      },
      onGiveUp: () => {},
    }).finally(() => overlays.delete('uuid-a|stages'));
  };
  return {
    click,
    fail(plan: Array<'ok' | 'transient'>) {
      failPlan = plan;
    },
    /** App 의 실시간 처리와 같이: 받은 행에 내 값을 다시 얹은 뒤 화면에 반영한다. */
    realtime(fields: Partial<Scene>) {
      screen = { ...screen, ...overlayPendingSceneFields('uuid-a', screen, fields, overlays.values()) };
    },
    /** 팀원이 칸 하나만 바꾸는 방송 — 다시 얹지 않고 그대로 반영한다. */
    broadcast(fields: Partial<Scene>) {
      screen = { ...screen, ...fields };
    },
    get screen() {
      return screen;
    },
    server,
    calls,
  };
}

let clockEnv = fakeEnv();

/* ─── data-retry-1: 실시간 행도 '다시 얹기'를 거친다 ─── */

test('overlayPendingSceneFields — 내 저장의 일부만 닿은 뒤 온 메아리 행에도, 처음 값으로 돌아간 내 칸을 다시 얹는다', () => {
  const before = stages('0000');
  const patch = buildSequentialStagePatch(before, 'png');
  const writes = withExpectedStages(mergePendingStageWrites(undefined, before, patch, getChangedSequentialStages(before, patch)), stages('1111'));
  const carry: StageSaveSlotCarry = {
    writes,
    baseCompletion: NO_STAMP,
    basePhase: null,
    baseAssigneeProgress: undefined,
    completion: STAMP,
    minePhase: null,
    assigneeTouched: false,
    mineAssigneeProgress: undefined,
  };
  const current = scene('1111', STAMP);
  const overlay: PendingSceneOverlay = { sceneUuid: 'uuid-a', reapply: (incoming) => stageRepaintPatch(carry, incoming, current, null) };
  const echo = realtimeRow('1000');
  const out = overlayPendingSceneFields('uuid-a', current, echo, [overlay]);
  assert.deepEqual({ lo: out.lo, done: out.done, review: out.review, png: out.png }, stages('1111'));
  assert.equal(out.memo, '', '행의 다른 값은 그대로 싣는다');
  assert.equal('completedBy' in out, false, '행에 없는 완료 기록은 건드리지 않는다(화면의 내 도장이 그대로)');
  assert.deepEqual(echo, realtimeRow('1000'), '받은 행은 고치지 않는다');
});

test('overlayPendingSceneFields — 팀원이 메모만 고친 행: 메모는 받고, 기다리던 내 LO 는 다시 얹는다', () => {
  const before = stages('0000');
  const patch = buildSequentialStagePatch(before, 'lo');
  const writes = withExpectedStages(mergePendingStageWrites(undefined, before, patch, getChangedSequentialStages(before, patch)), stages('1000'));
  const carry: StageSaveSlotCarry = {
    writes,
    baseCompletion: NO_STAMP,
    basePhase: null,
    baseAssigneeProgress: undefined,
    completion: null,
    minePhase: null,
    assigneeTouched: false,
    mineAssigneeProgress: undefined,
  };
  const current = scene('1000');
  const overlay: PendingSceneOverlay = { sceneUuid: 'uuid-a', reapply: (incoming) => stageRepaintPatch(carry, incoming, current, null) };
  const out = overlayPendingSceneFields('uuid-a', current, realtimeRow('0000', { memo: '팀원 메모' }), [overlay]);
  assert.equal(out.lo, true);
  assert.equal(out.memo, '팀원 메모');

  // 화면에서 이미 다른 값이 된 칸(팀원의 한 칸 방송)은 얹지 않는다 — 받은 행을 그대로.
  const already = scene('0000');
  const overlayNow: PendingSceneOverlay = { sceneUuid: 'uuid-a', reapply: (incoming) => stageRepaintPatch(carry, incoming, already, null) };
  const row = realtimeRow('0000');
  assert.equal(overlayPendingSceneFields('uuid-a', already, row, [overlayNow]), row);
});

test('overlayPendingSceneFields — 다른 씬의 묶음·화면에 없는 씬은 건드리지 않고, 같은 씬의 묶음은 차례로 얹는다', () => {
  const row = realtimeRow('0000');
  const other: PendingSceneOverlay = { sceneUuid: 'uuid-b', reapply: () => ({ lo: true }) };
  assert.equal(overlayPendingSceneFields('uuid-a', scene('1000'), row, [other]), row, '다른 씬의 묶음은 부르지 않는다');
  const mine: PendingSceneOverlay = { sceneUuid: 'uuid-a', reapply: () => ({ lo: true }) };
  assert.equal(overlayPendingSceneFields('uuid-a', undefined, row, [mine]), row, '화면에 없는 씬이면 그대로');
  const out = overlayPendingSceneFields('uuid-a', scene('1100'), row, [
    { sceneUuid: 'uuid-a', reapply: (incoming) => (incoming.lo ? null : { lo: true }) },
    { sceneUuid: 'uuid-a', reapply: (incoming) => (incoming.lo && !incoming.done ? { done: true } : null) },
  ]);
  assert.equal(out.lo, true);
  assert.equal(out.done, true, '앞 묶음이 얹은 값 위에서 다음 묶음을 판단한다');
});

test('[실시간 행] 부분 저장 뒤 내 쓰기의 메아리가 와도 체크가 풀리지 않고, 다시 보내 끝까지 저장한다(완료 도장도)', async () => {
  clockEnv = fakeEnv();
  const lane = stageLane('0000');
  lane.fail(['ok', 'transient']);
  const outcome = lane.click('png');
  await clockEnv.advance(0);
  assert.deepEqual(lane.calls, ['lo:ok', 'done:transient']);
  lane.realtime(realtimeRow('1000')); // LO 쓰기의 메아리 — 서버 행 전체(done/review/png=false)
  assert.equal(lane.screen.done && lane.screen.review && lane.screen.png, true, '기다리던 칸이 화면에서 풀리지 않는다');
  await clockEnv.advance(800);
  assert.equal(await outcome, 'saved');
  assert.deepEqual(lane.calls.slice(2), ['lo:ok', 'done:ok', 'review:ok', 'png:ok', 'completion']);
  assert.deepEqual({ ...stages('1111'), ...STAMP }, { lo: lane.server.lo, done: lane.server.done, review: lane.server.review, png: lane.server.png, completedBy: lane.server.completedBy, completedAt: lane.server.completedAt });
});

test('[실시간 행] LO 저장을 기다리는 사이 팀원이 메모만 고친 행이 와도 LO 를 다시 보낸다', async () => {
  clockEnv = fakeEnv();
  const lane = stageLane('0000');
  lane.fail(['transient']);
  const outcome = lane.click('lo');
  await clockEnv.advance(0);
  lane.realtime(realtimeRow('0000', { memo: '팀원 메모' }));
  assert.equal(lane.screen.lo, true);
  assert.equal(lane.screen.memo, '팀원 메모');
  await clockEnv.advance(800);
  assert.equal(await outcome, 'saved');
  assert.deepEqual(lane.calls, ['lo:transient', 'lo:ok']);
  assert.equal(lane.server.lo, true);
});

/* ─── data-retry-2: 칸을 빼고 다시 보낼 때 완료 도장 ─── */

test('planCompletionStampDrop — 지금 씬이 완료가 아닐 때만 도장을 거두고, 화면은 아직 내 도장일 때만 처음 값으로', () => {
  const carry = (completion: CompletionStamp | null, base: CompletionStamp = NO_STAMP): StageSaveSlotCarry => ({
    writes: { stages: ['lo', 'done', 'review'], desired: { lo: true, done: true, review: true }, baseline: { lo: false, done: false, review: false }, expected: { lo: true, done: true, review: true } },
    baseCompletion: base,
    basePhase: null,
    baseAssigneeProgress: undefined,
    completion,
    minePhase: null,
    assigneeTouched: false,
    mineAssigneeProgress: undefined,
  });
  assert.deepEqual(planCompletionStampDrop(carry(STAMP), scene('1110', STAMP)), { screen: NO_STAMP });
  const old = { completedBy: '김지은', completedAt: 't0' };
  assert.deepEqual(planCompletionStampDrop(carry(STAMP, old), scene('1110', STAMP)), { screen: old }, '처음 값으로(앞 저장이 쓴 값이면 그 값)');
  assert.deepEqual(planCompletionStampDrop(carry(STAMP), scene('1110', old)), { screen: null }, '화면의 남의 기록은 건드리지 않는다');
  assert.equal(planCompletionStampDrop(carry(STAMP), scene('1111', STAMP)), null, '아직 완료면 도장을 쓴다');
  assert.equal(planCompletionStampDrop(carry(NO_STAMP), scene('1110')), null, '완료 해제는 그대로 보낸다');
  assert.equal(planCompletionStampDrop(carry(null), scene('1110')), null);
  assert.equal(planCompletionStampDrop(carry({ completedBy: '배한솔', completedAt: '' }), scene('1110')), null, '반쪽 기록은 도장이 아니다');
});

test('[칸 빼기] 완료를 만드는 클릭이 다시 보내기를 기다리는 사이 PNG 가 다른 값이 되면, 남은 칸만 보내고 완료 도장은 쓰지 않는다', async () => {
  clockEnv = fakeEnv();
  const lane = stageLane('0000');
  lane.fail(['ok', 'transient']);
  const outcome = lane.click('png');
  await clockEnv.advance(0);
  assert.deepEqual({ by: lane.screen.completedBy, at: lane.screen.completedAt }, { by: STAMP.completedBy, at: STAMP.completedAt });
  lane.broadcast({ png: false }); // 팀원이 PNG 한 칸만 해제
  await clockEnv.advance(800);
  assert.equal(await outcome, 'saved');
  assert.deepEqual(lane.calls.slice(2), ['lo:ok', 'done:ok', 'review:ok'], 'PNG 는 덮지 않고, 완료 도장도 보내지 않는다');
  assert.equal(lane.server.completedBy, '', '완료되지 않은 씬에 완료 도장을 남기지 않는다');
  assert.equal(lane.screen.completedBy, '', '화면의 내 도장도 처음 값으로');
  assert.equal(lane.screen.completedAt, '');
});

/* ─── codex-4171688324: 끝내 실패할 때 곁 값은 이 저장이 만든 값일 때만 되돌린다 ─── */

test('planStageGiveUp — 완료 기록·액팅 단계·담당자 진행은 지금 값이 이 저장이 만든 값일 때만 되돌린다', () => {
  const before = stages('1110');
  const patch = buildSequentialStagePatch(before, 'png');
  const writes = withExpectedStages(mergePendingStageWrites(undefined, before, patch, getChangedSequentialStages(before, patch)), stages('1111'));
  const mineProgress = { 김: { ...stages('1111'), sceneState: 'done' as const, workRound: 0, feedbackRound: 0 } };
  const carry: StageSaveSlotCarry = {
    writes,
    baseCompletion: NO_STAMP,
    basePhase: { sceneState: 'feedback', workRound: 0, feedbackRound: 1 },
    baseAssigneeProgress: { 김: { ...stages('1110'), sceneState: 'feedback', feedbackRound: 1 } },
    completion: STAMP,
    minePhase: { sceneState: 'done', workRound: 0, feedbackRound: 0 },
    assigneeTouched: true,
    mineAssigneeProgress: mineProgress,
  };
  const mineNow = scene('1111', { ...STAMP, sceneState: 'done', workRound: 0, feedbackRound: 0, assigneeProgress: { 김: { ...mineProgress.김, updatedAt: 'x', updatedBy: '배한솔' } } });
  const all = planStageGiveUp(carry, mineNow);
  assert.ok(all);
  assert.deepEqual(all.patch, {
    png: false,
    ...NO_STAMP,
    sceneState: 'feedback',
    workRound: 0,
    feedbackRound: 1,
    assigneeProgress: carry.baseAssigneeProgress,
  }, '모두 내 값이면 함께 되돌린다(저장 시각은 비교하지 않는다)');

  const newerStamp = planStageGiveUp(carry, { ...mineNow, completedBy: '김지은', completedAt: 't9' });
  assert.ok(newerStamp);
  assert.equal('completedBy' in newerStamp.patch, false, '그 사이 온 완료 기록은 덮지 않는다');
  assert.equal(newerStamp.patch.sceneState, 'feedback');

  const newerPhase = planStageGiveUp(carry, { ...mineNow, sceneState: 'done', workRound: 0, feedbackRound: 2 });
  assert.ok(newerPhase);
  assert.equal('sceneState' in newerPhase.patch, false, '그 사이 바뀐 단계·차수는 덮지 않는다');
  assert.equal(newerPhase.patch.completedBy, '');

  const newerProgress = planStageGiveUp(carry, { ...mineNow, assigneeProgress: { ...mineNow.assigneeProgress, 이: { lo: true } } });
  assert.ok(newerProgress);
  assert.equal('assigneeProgress' in newerProgress.patch, false, '그 사이 바뀐 담당자별 진행은 덮지 않는다');

  const noMinePhase = planStageGiveUp({ ...carry, minePhase: null }, mineNow);
  assert.equal(noMinePhase && 'sceneState' in noMinePhase.patch, false, '맞춘 단계를 모르면 단계는 되돌리지 않는다');
});

test('sameAssigneeProgressMap — 담당자마다 진행 값만 비교하고(저장 시각 빼고), 한쪽에만 있는 담당자는 다르다', () => {
  assert.equal(sameAssigneeProgressMap({ 김: { lo: true, updatedAt: 'a' } }, { 김: { lo: true, updatedAt: 'b' } }), true);
  assert.equal(sameAssigneeProgressMap({ 김: { lo: true } }, { 김: { lo: true }, 이: { lo: true } }), false);
  assert.equal(sameAssigneeProgressMap({ 김: { lo: true } }, { 김: { lo: false } }), false);
  assert.equal(sameAssigneeProgressMap(undefined, undefined), true);
  assert.equal(sameAssigneeProgressMap(undefined, { 김: {} }), false);
});

/* ─── codex-4171688328: 앱 종료 직전 정리 중에 같은 칸이 또 바뀌면 ─── */

test('앱 종료 직전: 정리 중에 같은 칸을 또 누르면, 정리는 넘겨받은 새 저장의 요청이 끝나야 끝난다', async () => {
  const clock = fakeEnv();
  const retry = createSaveRetryController(clock.env);
  const first = deferred();
  const second = deferred();
  const order: string[] = [];
  const a = retry.run('k', baseJob('A', { attempt: () => first.promise.then(() => { order.push('A'); }) }));
  const flushing = retry.flushNow().then(() => order.push('flushed'));
  const b = retry.run('k', baseJob('B', { attempt: () => second.promise.then(() => { order.push('B'); }) }));
  first.resolve();
  await clock.advance(0);
  assert.equal(await a, 'superseded');
  assert.deepEqual(order, ['A'], '앞 저장이 끝났다고 정리가 끝나지 않는다');
  second.resolve();
  await flushing;
  assert.deepEqual(order, ['A', 'B', 'flushed']);
  assert.equal(await b, 'saved');
});

test('앱 종료 직전: 깨워 다시 보내던 저장이 넘겨지면 그 새 저장까지 기다린다', async () => {
  const clock = fakeEnv();
  const retry = createSaveRetryController(clock.env);
  const order: string[] = [];
  let failFirst = true;
  const resend = deferred();
  const a = retry.run('k', baseJob('A', {
    attempt: () => {
      if (failFirst) {
        failFirst = false;
        order.push('A fail');
        return Promise.reject(transient());
      }
      order.push('A resend');
      return resend.promise;
    },
  }));
  await clock.advance(100); // 0.8초 재전송을 기다리는 중
  const flushing = retry.flushNow().then(() => order.push('flushed'));
  await clock.advance(0);
  assert.deepEqual(order, ['A fail', 'A resend'], '깨워 지금 보낸다');
  const bSent = deferred();
  const b = retry.run('k', baseJob('B', { attempt: () => bSent.promise.then(() => { order.push('B'); }) }));
  resend.resolve();
  await clock.advance(0);
  assert.equal(await a, 'superseded');
  assert.deepEqual(order, ['A fail', 'A resend'], '깨운 앞 저장이 끝나도 새 저장의 요청이 남아 있으면 정리는 끝나지 않는다');
  bSent.resolve();
  await flushing;
  assert.deepEqual(order, ['A fail', 'A resend', 'B', 'flushed']);
  assert.equal(await b, 'saved');
});

test('앱 종료 직전 정리가 이미 끝난 뒤의 새 저장은 정리 상태를 물려받지 않는다(연결이 끊기면 평소처럼 기다린다)', async () => {
  const clock = fakeEnv();
  const retry = createSaveRetryController(clock.env);
  const a = retry.run('k', baseJob('A', { attempt: async () => { throw transient(); } }));
  await clock.advance(0); // 첫 실패 → 0.8초 기다림
  await retry.flushNow(); // 깨워 한 번 더 보냄(실패) → 정리 끝. A 는 다음 재전송을 기다린다.
  clock.setOnline(false);
  const attempts: number[] = [];
  const c = retry.run('k', baseJob('C', {
    attempt: async () => {
      attempts.push(1);
      throw transient();
    },
  }));
  assert.equal(await a, 'superseded');
  await clock.advance(5000);
  assert.equal(attempts.length, 1, '연결이 돌아올 때까지 기다린다(0.8초 뒤 바로 다시 보내지 않는다)');
  assert.equal(await Promise.race([c, Promise.resolve('pending')]), 'pending');
});

/* ─── 연결 앵커: 화면 코드가 위 판단을 실제로 쓰는가 ─── */

test('실시간 scenes UPDATE 행은 반영·반짝임 판단 전에 저장을 기다리는 내 값을 다시 얹고, 팀원 한 칸 방송은 그대로 반영한다', () => {
  const app = read('src/App.tsx');
  assert.match(
    app,
    /const fields = keepPendingSceneFields\(delta\.uuid, useDataStore\.getState\(\)\.findSceneByUuid\(delta\.uuid\), delta\.fields\);\n(?:\s+\/\/.*\n)*\s+const flash = remoteStageFlash\(\n\s+remoteSceneFlashContext\(\),\n\s+delta\.uuid,\n\s+\(payload\.new as \{ updated_by\?: unknown \}\)\.updated_by,\n\s+fields as Record<string, unknown>,\n\s+\);\n\s+const applied = useDataStore\.getState\(\)\.updateSceneByUuid\(delta\.uuid, fields\);/,
  );
  assert.doesNotMatch(app, /updateSceneByUuid\(delta\.uuid, delta\.fields\)/);
  assert.match(app, /useDataStore\.getState\(\)\.updateSceneByUuid\(sceneUuid, \{ \[stage\]: value \}\);/, '한 칸 방송은 팀원이 정말 바꾼 값 — 다시 얹지 않는다');
  assert.equal((app.match(/keepPendingSceneFields\(/g) ?? []).length, 1);

  const service = read('src/services/sceneSaveRetry.ts');
  assert.match(service, /return pendingOverlays\.size === 0 \? fields : overlayPendingSceneFields\(sceneUuid, current, fields, pendingOverlays\.values\(\)\);/);
});

test('다시 보내기 직전에 완료 도장을 다시 판단하고, 끝내 실패하면 지금 값이 내 것일 때만 곁 값을 되돌린다', () => {
  const view = read('src/views/ScenesView.tsx');
  assert.match(
    view,
    /saveCarry\.writes = narrowed\.writes;\n(?:\s+\/\/.*\n)*\s+const stampDrop = planCompletionStampDrop\(saveCarry, latest\);\n\s+if \(stampDrop\) \{\n\s+saveCarry\.completion = null;\n\s+if \(stampDrop\.screen\) showCompletion\(stampDrop\.screen\);/,
  );
  // 이 저장이 만든 곁 값을 carry 에 남긴다(넘겨받으면 앞 저장 것을 잇는다).
  assert.match(view, /minePhase: actingPhaseSync\n\s+\? \{ sceneState: actingPhaseSync\.state, workRound: actingPhaseSync\.workRound, feedbackRound: actingPhaseSync\.feedbackRound \}\n\s+: carried\?\.minePhase \?\? null,/);
  assert.match(view, /mineAssigneeProgress: nextAssigneeProgress \?\? carried\?\.mineAssigneeProgress,/);
  // 줄 번호로 쓰는 옛 씬도 계획에 든 완료 기록만 되돌린다.
  assert.match(view, /if \('completedBy' in plan\.patch\) showCompletion\(saveCarry\.baseCompletion\);/);
  assert.doesNotMatch(view, /if \(saveCarry\.completion\) \{\n\s+updateSceneFieldOptimistic\(sheetName, sceneIndexNow\(\), 'completedBy', saveCarry\.baseCompletion\.completedBy\);/);
});

test('앱 종료 직전 정리 상태·대기자는 같은 칸의 새 저장에 넘긴다', () => {
  const src = read('src/utils/saveRetry.ts');
  assert.match(src, /if \(previous\.attemptWaiters\.length > 0\) \{\n\s+entry\.flushing = true;\n\s+entry\.attemptWaiters = previous\.attemptWaiters\.splice\(0\);\n\s+\}\n\s+previous\.cancelWait\?\.\(\);/);
});
