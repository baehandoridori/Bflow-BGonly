import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createSaveRetryController, type SaveRetryEnv } from '../../src/utils/saveRetry.ts';
import {
  buildSequentialStagePatch,
  deriveActingPhaseFromStages,
  getChangedSequentialStages,
  isSequentialStageComplete,
  mergePendingStageWrites,
  withExpectedStages,
} from '../../src/utils/sceneStageProgression.ts';
import {
  carriedSideBases,
  completionOvertaken,
  inheritAssigneeBase,
  inheritCompletion,
  inheritPhaseBase,
  judgeAssigneeProgressMap,
  narrowStageWritesForRetry,
  phaseFieldsOf,
  phaseGiveUpBase,
  planCompletionStampDrop,
  planPhaseGiveUp,
  planSideFieldDrop,
  planStageGiveUp,
  samePhase,
  stageRepaintPatch,
  type AssigneeSaveSlotCarry,
  type CompletionStamp,
  type PhaseFields,
  type PhaseSaveSlotCarry,
  type StageSaveSlotCarry,
} from '../../src/utils/sceneSaveCarry.ts';
import type { Scene, SceneAssigneeProgressMap, ScenePhaseState, Stage } from '../../src/types/index.ts';

/* 움직임 폴리싱 20번 safety-net — 3차 수정(fx3-retry 갈래), 코덱스 2차 지적 4172094264 + 같은 종류 훑기.
   다시 보내기는 단계 칸만이 아니라 액팅 단계·차수·완료 기록·담당자별 진행도 늘 다시 쓴다. 칸 패턴이 그대로여도 그 사이
   팀원이 작업·피드백 차수를 올렸거나 완료 기록을 새로 찍었으면, 그 곁 값은 다시 쓰지 않는다(재전송에서 뺀다).
   담당자가 여럿인 씬은 담당자별 진행이 다음 받아오기 때 모두에게 보일 값을 정하므로, 그것을 그대로 얹을 수 없으면 저장을 멈춘다.
   넘겨받을 때·끝내 실패할 때·뒤늦게 따르는 기록도 같은 원칙(남이 바꾼 곁 값은 잇지도, 쓰지도, 되돌리지도 않는다). */

const read = (path: string) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const transient = () => new Error("Error invoking remote method 'supabase:update-scene-stage': Error: TypeError: fetch failed");

function fakeEnv() {
  let now = 0;
  let seq = 0;
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
    isOnline: () => true,
    onOnline: () => () => {},
  };
  return {
    env,
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

const stages = (key: string) => ({ lo: key[0] === '1', done: key[1] === '1', review: key[2] === '1', png: key[3] === '1' });
const legacyOf = (state: ScenePhaseState) => stages(state === 'wait' ? '0000' : state === 'work' ? '1100' : state === 'feedback' ? '1110' : '1111');
const phase = (sceneState: ScenePhaseState, workRound = 0, feedbackRound = 0): PhaseFields => ({ sceneState, workRound, feedbackRound });

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

const STAMP: CompletionStamp = { completedBy: '배한솔', completedAt: '2026-10-03T04:32:54.510Z' };
const TEAM_STAMP: CompletionStamp = { completedBy: '김지은', completedAt: '2026-10-03T04:33:10.000Z' };
const NO_STAMP: CompletionStamp = { completedBy: '', completedAt: '' };

function carryOf(extra: Partial<StageSaveSlotCarry> = {}): StageSaveSlotCarry {
  return {
    writes: { stages: ['png'], desired: { png: true }, baseline: { png: false }, expected: { png: true } },
    baseCompletion: NO_STAMP,
    basePhase: null,
    baseAssigneeProgress: undefined,
    completion: null,
    minePhase: null,
    assigneeTouched: false,
    mineAssigneeProgress: undefined,
    ...extra,
  };
}

const entry = (key: string, extra: Record<string, unknown> = {}) => ({ ...stages(key), sceneState: null, workRound: 0, feedbackRound: 0, ...extra });
const actEntry = (state: ScenePhaseState, workRound = 0, feedbackRound = 0) => ({ ...legacyOf(state), sceneState: state, workRound, feedbackRound });

/* ─── 순수 판단 ─── */

test('planCompletionStampDrop — 그 사이 남의 완료 기록이 왔으면 씬이 아직 완료여도 내 기록(도장·지우기)을 쓰지 않고 화면도 그대로', () => {
  assert.deepEqual(planCompletionStampDrop(carryOf({ completion: STAMP }), scene('1111', TEAM_STAMP)), { screen: null }, '완료여도 남의 도장은 덮지 않는다');
  assert.equal(planCompletionStampDrop(carryOf({ completion: STAMP }), scene('1111', STAMP)), null, '내 도장 그대로면 쓴다');
  assert.equal(planCompletionStampDrop(carryOf({ completion: STAMP }), scene('1111')), null, '처음 값으로 돌아감(받아오기)이면 쓴다');
  const old = { completedBy: '이혜민', completedAt: 't0' };
  assert.deepEqual(planCompletionStampDrop(carryOf({ completion: NO_STAMP, baseCompletion: old }), scene('1110', TEAM_STAMP)), { screen: null }, '지우기도 남의 새 기록은 지우지 않는다');
  assert.equal(planCompletionStampDrop(carryOf({ completion: NO_STAMP, baseCompletion: old }), scene('1110', old)), null, '아직 서버가 내 지우기를 모르는 값이면 지운다');
  assert.deepEqual(planCompletionStampDrop(carryOf({ completion: NO_STAMP, baseCompletion: old }), scene('1111')), { screen: null }, '다시 완료된 씬은 지우지 않는다');
  // 원래 규칙은 그대로.
  assert.deepEqual(planCompletionStampDrop(carryOf({ completion: STAMP }), scene('1110', STAMP)), { screen: NO_STAMP });
  assert.equal(planCompletionStampDrop(carryOf({ completion: { completedBy: '배한솔', completedAt: '' } }), scene('1110')), null);
});

test('planSideFieldDrop — 액팅 단계·차수는 남의 값이면 뺀다(칸 패턴이 그대로여도), 내 값·처음 값이면 그대로 보낸다', () => {
  const carry = carryOf({ basePhase: phase('work', 1), minePhase: phase('feedback', 0, 1) });
  const now = (p: PhaseFields) => scene('1110', p);
  assert.deepEqual(planSideFieldDrop(carry, now(phase('feedback', 0, 2)), null), { phase: true, assigneeProgress: false }, '팀원이 피드백 차수만 올림');
  assert.deepEqual(planSideFieldDrop(carry, now(phase('feedback', 0, 1)), null), { phase: false, assigneeProgress: false });
  assert.deepEqual(planSideFieldDrop(carry, now(phase('work', 1)), null), { phase: false, assigneeProgress: false }, '받아오기가 처음 값을 읽어 옴 — 다시 보낸다');
  assert.deepEqual(planSideFieldDrop(carry, now(phase('work', 2)), null), { phase: true, assigneeProgress: false }, '작업 차수를 올림');
  assert.deepEqual(planSideFieldDrop({ ...carry, minePhase: null }, now(phase('feedback', 0, 9)), null), { phase: false, assigneeProgress: false }, '이미 뺀 단계는 다시 판단하지 않는다');
  assert.deepEqual(planSideFieldDrop(carryOf(), scene('1110'), null), { phase: false, assigneeProgress: false }, 'BG 씬은 단계가 없다');
});

test('planSideFieldDrop — 담당자별 진행: 남이 바꿨거나, 액팅 단계를 뺐거나, BG 칸 패턴이 달라지면 그대로 얹을 수 없다', () => {
  const mine: SceneAssigneeProgressMap = { 김: entry('1100'), 이: entry('1100') };
  const base: SceneAssigneeProgressMap = { 김: entry('1000'), 이: entry('1000') };
  const bg = carryOf({ assigneeTouched: true, mineAssigneeProgress: mine, baseAssigneeProgress: base });
  const pattern = stages('1100');
  assert.deepEqual(planSideFieldDrop(bg, scene('1100', { assigneeProgress: mine }), pattern), { phase: false, assigneeProgress: false });
  assert.deepEqual(planSideFieldDrop(bg, scene('1100', { assigneeProgress: base }), pattern), { phase: false, assigneeProgress: false }, '받아오기가 처음 값을 읽어 옴');
  assert.deepEqual(
    planSideFieldDrop(bg, scene('1100', { assigneeProgress: { ...mine, 이: entry('1110') } }), pattern),
    { phase: false, assigneeProgress: true },
    '팀원이 한 담당자 진행을 바꿈',
  );
  assert.deepEqual(planSideFieldDrop(bg, scene('1101', { assigneeProgress: mine }), pattern), { phase: false, assigneeProgress: true }, '이 클릭이 보내지 않는 칸(PNG)을 팀원이 켬');
  assert.deepEqual(planSideFieldDrop(bg, scene('1000', { assigneeProgress: mine }), pattern), { phase: false, assigneeProgress: true }, '내 칸을 팀원이 바꿈');
  assert.deepEqual(
    planSideFieldDrop({ ...bg, assigneeTouched: false }, scene('1101', { assigneeProgress: { 김: entry('1111') } }), pattern),
    { phase: false, assigneeProgress: false },
    '담당자 진행을 건드리지 않은 저장',
  );

  const actMine: SceneAssigneeProgressMap = { 김: actEntry('feedback', 0, 1), 이: actEntry('feedback', 0, 1) };
  const acting = carryOf({
    basePhase: phase('work', 1),
    minePhase: phase('feedback', 0, 1),
    assigneeTouched: true,
    mineAssigneeProgress: actMine,
    baseAssigneeProgress: { 김: actEntry('work', 1), 이: actEntry('work', 1) },
  });
  assert.deepEqual(planSideFieldDrop(acting, scene('1110', { ...phase('feedback', 0, 2), assigneeProgress: actMine }), null), { phase: true, assigneeProgress: true }, '단계를 빼면 진행도');
  assert.deepEqual(planSideFieldDrop({ ...acting, minePhase: null }, scene('1110', { ...phase('feedback', 0, 1), assigneeProgress: actMine }), null), { phase: false, assigneeProgress: true }, '이미 뺀 단계');
  assert.deepEqual(planSideFieldDrop(acting, scene('1110', { ...phase('feedback', 0, 1), assigneeProgress: actMine }), null), { phase: false, assigneeProgress: false });
});

test('judgeAssigneeProgressMap · completionOvertaken — 내 값 / 처음 값 / 남의 값', () => {
  const mine = { 김: entry('1100') };
  const base = { 김: entry('1000') };
  assert.equal(judgeAssigneeProgressMap({ 김: { ...entry('1100'), updatedAt: 'x' } }, mine, base), 'mine', '저장 시각은 보지 않는다');
  assert.equal(judgeAssigneeProgressMap(base, mine, base), 'reverted');
  assert.equal(judgeAssigneeProgressMap({ 김: entry('1110') }, mine, base), 'other');
  assert.equal(judgeAssigneeProgressMap(undefined, mine, undefined), 'reverted', '진행이 아직 없던 씬');
  assert.equal(judgeAssigneeProgressMap(undefined, mine, base), 'other');

  assert.equal(completionOvertaken(scene('1111', STAMP), STAMP, NO_STAMP), false);
  assert.equal(completionOvertaken(scene('1111'), STAMP, NO_STAMP), false, '처음 값');
  assert.equal(completionOvertaken(scene('1111', TEAM_STAMP), STAMP, NO_STAMP), true);
  assert.equal(completionOvertaken(undefined, STAMP, NO_STAMP), true, '씬이 사라짐');
});

test('inheritCompletion — 넘겨받을 완료 기록은 남의 기록이 왔거나 이 클릭 뒤 완료 여부와 맞지 않으면 잇지 않는다', () => {
  assert.equal(inheritCompletion(STAMP, NO_STAMP, scene('1111', STAMP), true), STAMP);
  assert.equal(inheritCompletion(STAMP, NO_STAMP, scene('1111'), true), STAMP, '처음 값으로 돌아감');
  assert.equal(inheritCompletion(STAMP, NO_STAMP, scene('1111', TEAM_STAMP), true), null, '남의 도장');
  assert.equal(inheritCompletion(STAMP, NO_STAMP, scene('0000'), false), null, '도장인데 이 클릭 뒤 완료가 아님(그 사이 남이 완료를 풀었음)');
  assert.equal(inheritCompletion(NO_STAMP, TEAM_STAMP, scene('1110'), false), NO_STAMP);
  assert.equal(inheritCompletion(NO_STAMP, TEAM_STAMP, scene('1111', TEAM_STAMP), true), null, '지우기인데 이 클릭 뒤 완료');
  assert.equal(inheritCompletion(null, NO_STAMP, scene('1111'), true), null);
});

test('carriedSideBases — 앞 저장의 곁 값이 아직 화면에 있으면 앞 저장의 기준을 잇고, 남이 바꿨으면 지금 값이 새 기준이다', () => {
  const mineMap = { 김: entry('1110'), 이: entry('1110') };
  const carried = carryOf({
    baseCompletion: NO_STAMP,
    completion: STAMP,
    basePhase: phase('work', 1),
    minePhase: phase('feedback', 0, 1),
    assigneeTouched: true,
    baseAssigneeProgress: { 김: entry('1100'), 이: entry('1100') },
    mineAssigneeProgress: mineMap,
  });
  const still = scene('1111', { ...STAMP, ...phase('feedback', 0, 1), assigneeProgress: mineMap });
  assert.deepEqual(carriedSideBases(carried, still, { acting: true, completeAfterClick: true }), {
    baseCompletion: NO_STAMP,
    basePhase: phase('work', 1),
    baseAssigneeProgress: carried.baseAssigneeProgress,
    completion: STAMP,
  });
  const teamMap = { ...mineMap, 이: entry('1111') };
  const changed = scene('1111', { ...TEAM_STAMP, ...phase('feedback', 0, 2), assigneeProgress: teamMap });
  assert.deepEqual(carriedSideBases(carried, changed, { acting: true, completeAfterClick: true }), {
    baseCompletion: TEAM_STAMP,
    basePhase: phase('feedback', 0, 2),
    baseAssigneeProgress: teamMap,
    completion: null,
  }, '끝내 실패해도 남의 새 값으로 되돌아가고, 옛 도장을 잇지 않는다');
  assert.deepEqual(carriedSideBases(undefined, scene('1000', { assigneeProgress: teamMap }), { acting: false, completeAfterClick: false }), {
    baseCompletion: NO_STAMP,
    basePhase: null,
    baseAssigneeProgress: teamMap,
    completion: null,
  });
});

test('inheritPhaseBase · phaseGiveUpBase — 액팅 칩: 앞 칩의 단계가 남아 있을 때만 잇고, 끝내 실패는 아직 내 곁 값만 되돌린다', () => {
  const base: PhaseSaveSlotCarry['base'] = { ...phase('work', 1), ...legacyOf('work'), completedBy: '', completedAt: '', assigneeProgress: { 김: actEntry('work', 1) } };
  const carried: PhaseSaveSlotCarry = { base, completion: STAMP, mine: phase('done'), mineAssigneeProgress: { 김: actEntry('done') } };
  assert.equal(inheritPhaseBase(carried, phase('done')), base);
  assert.equal(inheritPhaseBase(carried, phase('feedback', 0, 1)), null, '그 사이 남이 단계를 바꿈');
  assert.equal(inheritPhaseBase({ base, completion: null }, phase('feedback', 0, 1)), base, '맞춘 단계를 모르면(예전 carry) 그대로 잇는다');
  assert.equal(inheritPhaseBase(undefined, phase('done')), null);

  const mineNow = { ...STAMP, assigneeProgress: { 김: actEntry('done') } };
  assert.deepEqual(phaseGiveUpBase(carried, mineNow), base, '모두 내 값이면 모두 되돌린다');
  const teamNow = { ...TEAM_STAMP, assigneeProgress: { 김: actEntry('feedback', 0, 2) } };
  const kept = phaseGiveUpBase(carried, teamNow);
  assert.equal('completedBy' in kept || 'completedAt' in kept, false, '남의 완료 기록은 되돌리지 않는다');
  assert.equal('assigneeProgress' in kept, false, '남의 담당자별 진행은 되돌리지 않는다');
  assert.deepEqual(phaseFieldsOf(kept), phase('work', 1));
  const untouched = phaseGiveUpBase({ base, completion: null }, mineNow);
  assert.equal('completedBy' in untouched || 'assigneeProgress' in untouched, false, '이 저장이 바꾸지 않은 곁 값은 건드리지 않는다');
  // planPhaseGiveUp 은 단계가 내 값일 때 이 되돌릴 값을 그대로 쓴다.
  assert.deepEqual(planPhaseGiveUp({ ...phase('done'), ...teamNow }, phase('done'), kept), kept);
});

test('inheritAssigneeBase — 담당자 버튼: 앞 버튼의 이 담당자 값이 남아 있을 때만 앞 저장의 처음 값을 잇는다', () => {
  const prevScene = scene('1000');
  const carried: AssigneeSaveSlotCarry = { prevScene, completion: null, cells: ['a:김:done'], mineEntry: entry('1100') };
  assert.equal(inheritAssigneeBase(carried, { ...entry('1100'), updatedAt: 'later' }), prevScene);
  assert.equal(inheritAssigneeBase(carried, entry('1110')), null, '그 사이 남이 이 담당자 값을 바꿈');
  assert.equal(inheritAssigneeBase(carried, undefined), null);
  assert.equal(inheritAssigneeBase({ prevScene, completion: null, cells: [] }, entry('1110')), prevScene, '예전 carry 는 그대로 잇는다');
  assert.equal(inheritAssigneeBase(undefined, entry('1100')), null);
});

test('stageRepaintPatch — 다시 보내기 직전에 액팅 단계를 뺐으면(minePhase=null) 받아오기 위에 단계를 다시 얹지 않는다', () => {
  const before = stages('1100');
  const patch = buildSequentialStagePatch(before, 'review');
  const writes = withExpectedStages(mergePendingStageWrites(undefined, before, patch, getChangedSequentialStages(before, patch)), stages('1110'));
  const carry = carryOf({ writes, basePhase: phase('work', 1), minePhase: phase('feedback', 0, 1) });
  const stale = scene('1100', phase('work', 1));
  assert.deepEqual(stageRepaintPatch(carry, stale, stages('1110'), phase('feedback', 0, 1)), { review: true, ...phase('feedback', 0, 1) });
  assert.deepEqual(stageRepaintPatch({ ...carry, minePhase: null }, stale, stages('1110'), phase('feedback', 0, 1)), { review: true });
});

/* ─── 화면 쪽 단계 칸 경로 흉내: 클릭 → carry → 진행기(다시 보내기 직전 판단은 ScenesView 와 같은 순서) ─── */

const KEY = 'uuid-a|stages';
type FailPlan = 'ok' | 'transient' | 'permanent';

function stageLane(clock: ReturnType<typeof fakeEnv>, start: Scene, options: { acting?: boolean; assignees?: string[] } = {}) {
  const retry = createSaveRetryController(clock.env);
  const state = { screen: start, server: { ...start } as Scene };
  const calls: string[] = [];
  const events: string[] = [];
  let failPlan: FailPlan[] = [];
  const click = (stage: Stage) => {
    const before = state.screen;
    const stagePatch = buildSequentialStagePatch(before, stage);
    const changed = getChangedSequentialStages(before, stagePatch);
    const willComplete = isSequentialStageComplete(stagePatch);
    const wasComplete = isSequentialStageComplete(before);
    const completionMeta = willComplete && !wasComplete
      ? STAMP
      : wasComplete && !willComplete && (before.completedBy || before.completedAt) ? NO_STAMP : null;
    const acting = options.acting ? deriveActingPhaseFromStages(before, stagePatch) : null;
    let after: Scene = { ...before, ...Object.fromEntries(changed.map((s) => [s, stagePatch[s]])), ...(completionMeta ?? {}) };
    if (acting) after = { ...after, sceneState: acting.state, workRound: acting.workRound, feedbackRound: acting.feedbackRound, ...legacyOf(acting.state) };
    const nextMap: SceneAssigneeProgressMap | null = options.assignees
      ? Object.fromEntries(options.assignees.map((name) => [
          name,
          acting ? actEntry(acting.state, acting.workRound, acting.feedbackRound) : { ...stagePatch, sceneState: null, workRound: 0, feedbackRound: 0 },
        ]))
      : null;
    if (nextMap) after = { ...after, assigneeProgress: nextMap };
    state.screen = after;
    const carried = retry.pendingCarry<StageSaveSlotCarry>(KEY);
    const sides = carriedSideBases(carried, before, { acting: Boolean(acting), completeAfterClick: willComplete });
    const carry: StageSaveSlotCarry = {
      writes: withExpectedStages(mergePendingStageWrites(carried?.writes, before, stagePatch, changed), after),
      baseCompletion: sides.baseCompletion,
      basePhase: sides.basePhase,
      baseAssigneeProgress: sides.baseAssigneeProgress,
      completion: completionMeta ?? sides.completion,
      minePhase: acting ? phase(acting.state, acting.workRound, acting.feedbackRound) : carried?.minePhase ?? null,
      assigneeTouched: Boolean(nextMap) || Boolean(carried?.assigneeTouched),
      mineAssigneeProgress: nextMap ?? carried?.mineAssigneeProgress,
    };
    return retry.run<StageSaveSlotCarry>(KEY, {
      carry,
      attempt: async () => {
        for (const s of carry.writes.stages) {
          const plan = failPlan.shift() ?? 'ok';
          calls.push(`${s}:${plan}`);
          if (plan === 'transient') throw transient();
          if (plan === 'permanent') throw new Error('new row violates row-level security policy [HTTP 403]');
          state.server = { ...state.server, [s]: carry.writes.desired[s] === true };
        }
        if (acting && carry.minePhase) {
          calls.push(`phase:${acting.state}/${acting.workRound}/${acting.feedbackRound}`);
          state.server = { ...state.server, sceneState: acting.state, workRound: acting.workRound, feedbackRound: acting.feedbackRound };
        }
        if (nextMap && carry.assigneeTouched) {
          calls.push('progress');
          state.server = { ...state.server, assigneeProgress: nextMap };
        }
        if (carry.completion) {
          calls.push(`completion:${carry.completion.completedBy || '-'}`);
          state.server = { ...state.server, ...carry.completion };
        }
      },
      // ScenesView 의 단계 칸 stillMine 과 같은 순서: 칸 빼기 → 완료 기록 → 곁 값(단계·담당자별 진행).
      stillMine: () => {
        const latest = state.screen;
        const narrowed = narrowStageWritesForRetry(carry.writes, latest);
        carry.writes = narrowed.writes;
        const stampDrop = planCompletionStampDrop(carry, latest);
        if (stampDrop) {
          carry.completion = null;
          if (stampDrop.screen) state.screen = { ...state.screen, ...stampDrop.screen };
        }
        const sideDrop = planSideFieldDrop(carry, latest, nextMap && !acting ? stagePatch : null);
        if (sideDrop.phase) carry.minePhase = null;
        const stoppedCells = sideDrop.assigneeProgress ? [...carry.writes.stages, ...narrowed.dropped] : narrowed.dropped;
        if (sideDrop.assigneeProgress) {
          carry.assigneeTouched = false;
          carry.writes = { ...carry.writes, stages: [] };
        }
        if (stoppedCells.length > 0) events.push(`stopped:${stoppedCells.join(',')}`);
        return carry.writes.stages.length > 0;
      },
      onOvertaken: () => events.push('overtaken'),
      onGiveUp: () => {
        const plan = planStageGiveUp(carry, state.screen);
        if (plan) state.screen = { ...state.screen, ...plan.patch };
        events.push('giveUp');
      },
    });
  };
  return {
    state,
    calls,
    events,
    click,
    fail(plan: FailPlan[]) {
      failPlan = plan;
    },
  };
}

test('[코덱스 4172094264] 액팅 씬: 다시 보내기를 기다리는 사이 팀원이 피드백 차수를 올리면(칸 패턴 그대로) 칸만 보내고 차수는 덮지 않는다', async () => {
  const clock = fakeEnv();
  const lane = stageLane(clock, scene('1100', phase('work', 1)), { acting: true });
  lane.fail(['transient']);
  const outcome = lane.click('review');
  await clock.advance(0);
  assert.deepEqual(phaseFieldsOf(lane.state.screen), phase('feedback', 0, 1));
  assert.deepEqual(lane.calls, ['review:transient']);
  // 팀원의 차수 올리기(단계 방송 + 서버) — 피드백 단계라 검수까지 켜진 칸 패턴은 그대로다.
  lane.state.screen = { ...lane.state.screen, feedbackRound: 2 };
  lane.state.server = { ...lane.state.server, ...phase('feedback', 0, 2), ...legacyOf('feedback') };
  await clock.advance(800);
  assert.equal(await outcome, 'saved');
  assert.deepEqual(lane.calls, ['review:transient', 'review:ok'], '단계·차수는 다시 쓰지 않는다');
  assert.deepEqual(phaseFieldsOf(lane.state.server), phase('feedback', 0, 2), '서버의 2차가 1차로 돌아가지 않는다');
  assert.deepEqual(phaseFieldsOf(lane.state.screen), phase('feedback', 0, 2));
  assert.deepEqual(lane.events, [], '칸은 저장됐으니 멈춤 안내도 없다');
});

test('[코덱스 4172094264] 액팅 씬: 단계를 뺀 뒤 끝내 실패해도 팀원의 차수는 되돌리지 않는다', async () => {
  const clock = fakeEnv();
  const lane = stageLane(clock, scene('1100', phase('work', 1)), { acting: true });
  lane.fail(['transient', 'permanent']);
  const outcome = lane.click('review');
  await clock.advance(0);
  lane.state.screen = { ...lane.state.screen, workRound: 0, feedbackRound: 2 };
  await clock.advance(800);
  assert.equal(await outcome, 'failed');
  assert.deepEqual(phaseFieldsOf(lane.state.screen), phase('feedback', 0, 2), '작업중 1차로 되돌리지 않는다');
  assert.deepEqual(lane.calls, ['review:transient', 'review:permanent']);
});

test('[코덱스 4172094264] 완료 도장: 다시 보내기를 기다리는 사이 팀원이 완료를 풀었다 다시 찍으면(씬은 여전히 완료) 내 도장으로 덮지 않는다', async () => {
  const clock = fakeEnv();
  const lane = stageLane(clock, scene('1110'));
  lane.fail(['transient']);
  const outcome = lane.click('png');
  await clock.advance(0);
  assert.equal(lane.state.screen.completedBy, STAMP.completedBy);
  // 팀원의 새 완료 기록이 받아오기로 들어왔다(칸은 그대로 완료).
  lane.state.screen = { ...lane.state.screen, ...TEAM_STAMP };
  lane.state.server = { ...lane.state.server, ...stages('1111'), ...TEAM_STAMP };
  await clock.advance(800);
  assert.equal(await outcome, 'saved');
  assert.deepEqual(lane.calls, ['png:transient', 'png:ok'], '완료 기록은 다시 쓰지 않는다');
  assert.equal(lane.state.server.completedBy, TEAM_STAMP.completedBy);
  assert.equal(lane.state.screen.completedBy, TEAM_STAMP.completedBy, '화면의 남의 기록도 그대로');
});

test('[담당자 여럿] 다시 보내기를 기다리는 사이 팀원이 한 담당자 진행을 바꾸면, 칸만 따로 쓰지 않고 저장을 멈춘다', async () => {
  const clock = fakeEnv();
  const start = scene('1000', { assignee: '김,이', assigneeProgress: { 김: entry('1000'), 이: entry('1000') } });
  const lane = stageLane(clock, start, { assignees: ['김', '이'] });
  lane.fail(['transient']);
  const outcome = lane.click('done');
  await clock.advance(0);
  lane.state.screen = { ...lane.state.screen, assigneeProgress: { ...lane.state.screen.assigneeProgress, 이: entry('1110') } };
  await clock.advance(800);
  assert.equal(await outcome, 'overtaken');
  assert.deepEqual(lane.calls, ['done:transient'], '칸도 담당자별 진행도 다시 쓰지 않는다');
  assert.deepEqual(lane.events, ['stopped:done', 'overtaken'], '저장을 멈췄다고만 알린다');
  assert.deepEqual(lane.state.server.assigneeProgress, start.assigneeProgress);
});

test('[담당자 여럿] 이 클릭이 보내지 않는 칸을 팀원이 바꿔 칸 패턴이 달라지면 담당자별 진행을 옛 패턴으로 덮지 않는다', async () => {
  const clock = fakeEnv();
  const start = scene('1000', { assignee: '김,이', assigneeProgress: { 김: entry('1000'), 이: entry('1000') } });
  const lane = stageLane(clock, start, { assignees: ['김', '이'] });
  lane.fail(['transient']);
  const outcome = lane.click('done');
  await clock.advance(0);
  lane.state.screen = { ...lane.state.screen, png: true }; // 팀원의 한 칸 방송(담당자별 진행은 아직 오지 않음)
  await clock.advance(800);
  assert.equal(await outcome, 'overtaken');
  assert.deepEqual(lane.calls, ['done:transient']);
});

test('[담당자 여럿] 아무도 바꾸지 않았으면 예전처럼 칸·담당자별 진행을 함께 다시 보낸다', async () => {
  const clock = fakeEnv();
  const start = scene('1000', { assignee: '김,이', assigneeProgress: { 김: entry('1000'), 이: entry('1000') } });
  const lane = stageLane(clock, start, { assignees: ['김', '이'] });
  lane.fail(['transient']);
  const outcome = lane.click('done');
  await clock.advance(800);
  assert.equal(await outcome, 'saved');
  assert.deepEqual(lane.calls, ['done:transient', 'done:ok', 'progress']);
});

test('[넘겨받기] 앞 클릭 뒤 팀원이 완료를 풀었는데 내가 다시 누르면, 새 저장이 옛 완료 도장을 확인 없이 쓰지 않는다', async () => {
  const clock = fakeEnv();
  const lane = stageLane(clock, scene('1110'));
  lane.fail(['transient']);
  const first = lane.click('png'); // 완료 + 내 도장
  await clock.advance(0);
  // 팀원이 LO 를 풀어 완료를 해제(칸 방송 + 완료 기록 지우기).
  lane.state.screen = { ...lane.state.screen, ...stages('0000'), ...NO_STAMP };
  const second = lane.click('done');
  assert.equal(await first, 'superseded');
  assert.equal(await second, 'saved');
  assert.deepEqual(lane.calls, ['png:transient', 'lo:ok', 'done:ok'], '완료 기록을 쓰지 않는다(미완료 씬에 내 이름이 남지 않게)');
  assert.equal(lane.state.server.completedBy, '');
});

/* ─── 화면 쪽 액팅 칩 경로 흉내: 담당자가 여럿이면 담당자별 진행까지 내 값이어야 다시 보낸다 ─── */

test('[액팅 칩 · 담당자 여럿] 단계는 그대로여도 팀원이 다른 담당자 진행을 바꿨으면 다시 보내지 않고, 뒤따르는 진행 기록도 쓰지 않는다', async () => {
  const clock = fakeEnv();
  const retry = createSaveRetryController(clock.env);
  const baseMap = { 김: actEntry('wait'), 이: actEntry('wait') };
  let screen = scene('0000', { ...phase('wait'), assignee: '김,이', assigneeProgress: baseMap });
  const minePhase = phase('work', 1);
  const nextProgress = { 김: actEntry('work', 1), 이: actEntry('work', 1) };
  screen = { ...screen, ...minePhase, ...legacyOf('work'), assigneeProgress: nextProgress };
  const carry: PhaseSaveSlotCarry = {
    base: { ...phase('wait'), ...legacyOf('wait'), completedBy: '', completedAt: '', assigneeProgress: baseMap },
    completion: null,
    mine: minePhase,
    mineAssigneeProgress: nextProgress,
  };
  // ScenesView 의 phaseStillMine 과 같은 판단.
  const phaseStillMine = () => samePhase(phaseFieldsOf(screen), minePhase)
    && judgeAssigneeProgressMap(screen.assigneeProgress, nextProgress, carry.base.assigneeProgress) !== 'other';
  const calls: string[] = [];
  let fail = true;
  const outcome = retry.run<PhaseSaveSlotCarry>('uuid-a|phase', {
    carry,
    attempt: async () => {
      calls.push(fail ? 'phase:transient' : 'phase:ok');
      if (fail) {
        fail = false;
        throw transient();
      }
    },
    stillMine: phaseStillMine,
    onGiveUp: () => {},
  });
  await clock.advance(0);
  // 팀원이 '이' 를 피드백으로 올렸다 — 가장 낮은 단계는 여전히 '김'의 작업중 1차라 씬 단계는 그대로다.
  screen = { ...screen, assigneeProgress: { ...nextProgress, 이: actEntry('feedback', 0, 1) } };
  assert.deepEqual(phaseFieldsOf(screen), minePhase);
  await clock.advance(800);
  assert.equal(await outcome, 'overtaken');
  assert.deepEqual(calls, ['phase:transient'], '이 단계로 덮지 않는다(뒤따르는 담당자별 진행 기록도 없음)');
});

/* ─── 연결 앵커: 화면 코드가 위 판단을 실제로 쓰는가 ─── */

test('단계 칸: 다시 보내기 직전에 곁 값을 다시 판단하고, 뺀 단계·담당자별 진행은 보내지도 다시 얹지도 않는다', () => {
  const view = read('src/views/ScenesView.tsx');
  assert.match(
    view,
    /const sideDrop = planSideFieldDrop\(saveCarry, latest, assigneeUpdate\?\.kind === 'stagePatch' \? assigneeUpdate\.patch : null\);\n\s+if \(sideDrop\.phase\) saveCarry\.minePhase = null;\n\s+const stoppedCells = sideDrop\.assigneeProgress \? \[\.\.\.saveCarry\.writes\.stages, \.\.\.narrowed\.dropped\] : narrowed\.dropped;\n\s+if \(sideDrop\.assigneeProgress\) \{\n\s+saveCarry\.assigneeTouched = false;\n\s+saveCarry\.writes = \{ \.\.\.saveCarry\.writes, stages: \[\] \};/,
  );
  // 완료 기록 판단(stampDrop) 다음, 칸 멈춤 안내 앞에서.
  assert.ok(view.indexOf('const stampDrop = planCompletionStampDrop(saveCarry, latest);') < view.indexOf('const sideDrop = planSideFieldDrop('));
  assert.match(view, /if \(actingPhaseSync && sceneUuid && saveCarry\.minePhase\) \{/);
  assert.match(view, /const latestForProgress = sceneUuid && assigneeUpdate && saveCarry\.assigneeTouched\n\s+\? findSceneForSave\(sheetName, sceneId, sceneUuid\)/);
  assert.match(view, /if \(repaint && assigneeUpdate && saveCarry\.assigneeTouched && hasMultiAssigneeProgress\(incoming\)\) \{/);
  // 넘겨받기: 앞 클릭의 곁 값이 아직 화면에 있을 때만 잇는다.
  assert.match(view, /const carriedSides = carriedSideBases\(carried, scene, \{\n\s+acting: Boolean\(actingPhaseSync\),\n\s+completeAfterClick: isSequentialStageComplete\(stagePatch\),\n\s+\}\);/);
  assert.match(view, /: carriedSides\.completion,/);
  assert.doesNotMatch(view, /: carried\?\.completion \?\? null,/, '앞 저장의 완료 기록을 확인 없이 잇지 않는다');
});

test('액팅 칩: 담당자별 진행까지 내 값일 때만 다시 보내고, 뒤따르는 기록·끝내 실패도 남의 곁 값을 덮지 않는다', () => {
  const view = read('src/views/ScenesView.tsx');
  assert.match(view, /return !nextProgress \|\| judgeAssigneeProgressMap\(latest\.assigneeProgress, nextProgress, saveCarry\.base\.assigneeProgress\) !== 'other';/);
  assert.match(view, /base: inheritPhaseBase\(carried, scene\) \?\? \{/);
  assert.match(view, /: inheritCompletion\(carried\?\.completion, completionOf\(carried\?\.base \?\? scene\), scene, willBeFullyDone\),\n\s+mine: minePhase,\n\s+mineAssigneeProgress: nextProgress \?\? undefined,/);
  assert.match(view, /&& judgeAssigneeProgressMap\(latestScene\.assigneeProgress, nextProgress, saveCarry\.base\.assigneeProgress\) !== 'other'\n\s+\) \{\n\s+const progress = updateAllAssigneeProgressEntries\(latestScene, phaseProgressUpdate, currentUser\?\.name\);/);
  assert.match(view, /&& !completionOvertaken\(useDataStore\.getState\(\)\.findSceneByUuid\(sceneUuid\), saveCarry\.completion, completionOf\(saveCarry\.base\)\)/);
  assert.match(view, /const restore = planPhaseGiveUp\(latest, minePhase, phaseGiveUpBase\(saveCarry, latest\)\);/);
});

test('담당자 버튼: 넘겨받기·뒤늦은 완료 기록·끝내 실패 모두 남의 완료 기록을 덮거나 되돌리지 않는다', () => {
  const view = read('src/views/ScenesView.tsx');
  assert.match(view, /const baseScene = inheritAssigneeBase\(carried, scene\.assigneeProgress\?\.\[assigneeName\]\) \?\? prevScene;/);
  assert.match(view, /completionOf\(carried\.prevScene\),\n\s+scene,\n\s+willBeFullyDone,/);
  assert.match(view, /mineEntry: mine,/);
  assert.match(view, /const stampOvertaken = completionOvertaken\(\n\s+useDataStore\.getState\(\)\.findSceneByUuid\(sceneUuid\),\n\s+completion,\n\s+completionOf\(saveCarry\.prevScene\),\n\s+\);\n\s+if \(!stampOvertaken\) \{/);
  assert.match(view, /if \(effectiveCompletion && !completionStillHolds && mineStamp && sameCompletion\(completionOf\(latest \?\? \{\}\), mineStamp\)\) \{/);
  assert.match(view, /if \(mineStamp && sameCompletion\(completionOf\(latest\), mineStamp\)\) \{\n\s+restorePatch\.completedBy = base\.completedBy \?\? '';/);
  assert.doesNotMatch(view, /if \(effectiveCompletion\) \{\n\s+restorePatch\.completedBy/);
});
