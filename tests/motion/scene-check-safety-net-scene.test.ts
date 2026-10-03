import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  SAVE_OFFLINE_WAIT_MAX_MS,
  SAVE_RETRY_DELAYS_MS,
  classifySaveFailure,
  createSaveRetryController,
  type SaveRetryEnv,
  type SaveRetryJob,
} from '../../src/utils/saveRetry.ts';
import { readHttpStatusMark, withHttpStatusMark } from '../../src/shared/saveFailureMark.ts';
import {
  buildSequentialStagePatch,
  getChangedSequentialStages,
  mergePendingStageWrites,
  stagesRevertedToBaseline,
  stagesStillMine,
  withExpectedStages,
} from '../../src/utils/sceneStageProgression.ts';
import {
  ROLLBACK_BORDER_KEYFRAMES,
  ROLLBACK_BORDER_MS,
  ROLLBACK_FLASH_CLEAR_MS,
  ROLLBACK_SHAKE_EASE,
  ROLLBACK_SHAKE_KEYFRAMES,
  ROLLBACK_SHAKE_MS,
  assigneeCellId,
  flattenPendingCells,
  phaseCellId,
  rollbackToastDescription,
  rollbackToastTitle,
  stageCellId,
} from '../../src/components/scenes/stageSaveFeedback.ts';
import { useStageSaveStatusStore } from '../../src/stores/useStageSaveStatusStore.ts';

/* 움직임 폴리싱 20번 safety-net#scene — 단계 체크 저장 실패 시 자동 재전송·도리도리 되돌림(한솔 결정 2026-10-03). */

const read = (path: string) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
const ipcError = (channel: string, message: string) =>
  new Error(`Error invoking remote method '${channel}': Error: ${message}`);

/* ─── 실패 분류 ─── */

test('네트워크·시간 초과·5xx 만 다시 보내고, 권한·검증·알 수 없는 실패는 바로 포기한다', () => {
  const transient = [
    ipcError('supabase:update-scene-stage', 'TypeError: fetch failed'),
    new TypeError('Failed to fetch'),
    ipcError('supabase:update-scene-phase', 'AbortError: This operation was aborted'),
    ipcError('supabase:write-metadata', 'canceling statement due to statement timeout [HTTP 500]'),
    ipcError('supabase:update-scene-stage', 'upstream request timeout [HTTP 504]'),
    ipcError('supabase:update-scene-stage', '<html><head><title>502 Bad Gateway</title></head></html>'),
    ipcError('supabase:update-scene-stage', 'error code: 522'),
    ipcError('supabase:read-metadata', 'Could not query the database for the schema cache. Retrying.'),
    ipcError('supabase:update-scene-stage', 'connect ECONNRESET 1.2.3.4:443'),
    ipcError('supabase:update-scene-stage', 'Request Timeout [HTTP 408]'),
  ];
  for (const error of transient) assert.equal(classifySaveFailure(error), 'transient', String(error));

  const permanent = [
    ipcError('supabase:update-scene-stage', 'permission denied for table scenes [HTTP 401]'),
    ipcError('supabase:update-scene-stage', 'new row violates row-level security policy for table "scenes" [HTTP 403]'),
    ipcError('supabase:update-scene-stage', 'invalid input syntax for type uuid: "x" [HTTP 400]'),
    ipcError('supabase:update-scene-stage', 'Too Many Requests [HTTP 429]'),
    // HTTP 표시가 있으면 문구보다 우선 — 4xx 는 '시간 초과'라는 말이 들어 있어도 다시 보내지 않는다.
    ipcError('supabase:update-scene-stage', 'lock timeout exceeded [HTTP 409]'),
    new Error('씬 UUID를 찾을 수 없음: EP01_A_BG:a001'),
    new Error("No handler registered for 'supabase:update-scene-stage'"),
    new Error(''),
    null,
    undefined,
  ];
  for (const error of permanent) assert.equal(classifySaveFailure(error), 'permanent', String(error));
});

test('메인이 붙이는 HTTP 상태 표시 — 400~599 만, 두 번 붙이지 않고, 렌더러가 다시 읽는다', () => {
  assert.equal(withHttpStatusMark('boom', 503), 'boom [HTTP 503]');
  assert.equal(withHttpStatusMark('boom', 200), 'boom');
  assert.equal(withHttpStatusMark('boom', 0), 'boom'); // 네트워크 실패는 상태가 0
  assert.equal(withHttpStatusMark('boom', null), 'boom');
  assert.equal(withHttpStatusMark('boom [HTTP 502]', 503), 'boom [HTTP 502]');
  assert.equal(readHttpStatusMark(ipcError('x', withHttpStatusMark('boom', 504)).message), 504);
  assert.equal(readHttpStatusMark('boom'), null);
  assert.equal(classifySaveFailure(ipcError('x', withHttpStatusMark('anything', 503))), 'transient');
  assert.equal(classifySaveFailure(ipcError('x', withHttpStatusMark('anything', 403))), 'permanent');
});

/* ─── 재전송 진행기 ─── */

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

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
    get onlineListeners() {
      return onlineListeners.size;
    },
    setOnline(value: boolean) {
      online = value;
      if (value) [...onlineListeners].forEach((fn) => fn());
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

type Step = 'ok' | 'transient' | 'permanent';

function scriptedJob(clock: { now: number }, steps: Step[], overrides: Partial<SaveRetryJob<string>> = {}) {
  const log = { attempts: [] as number[], retrying: 0, saved: 0, overtaken: 0, giveUp: [] as Array<{ at: number; kind: string }> };
  let index = 0;
  const job: SaveRetryJob<string> = {
    carry: 'carry',
    attempt: async () => {
      log.attempts.push(clock.now);
      const step = steps[Math.min(index, steps.length - 1)];
      index += 1;
      if (step === 'transient') throw ipcError('supabase:update-scene-stage', 'TypeError: fetch failed');
      if (step === 'permanent') throw ipcError('supabase:update-scene-stage', 'permission denied for table scenes [HTTP 403]');
    },
    stillMine: () => true,
    onRetrying: () => {
      log.retrying += 1;
    },
    onSaved: () => {
      log.saved += 1;
    },
    onOvertaken: () => {
      log.overtaken += 1;
    },
    onGiveUp: (_error, kind) => {
      log.giveUp.push({ at: clock.now, kind });
    },
    ...overrides,
  };
  return { job, log };
}

test('수치: 0.8초 → 2초 → 4초 간격 3번, 연결 대기 최대 60초', () => {
  assert.deepEqual([...SAVE_RETRY_DELAYS_MS], [800, 2000, 4000]);
  assert.equal(SAVE_OFFLINE_WAIT_MAX_MS, 60_000);
});

test('첫 저장이 되면 표시 없이 끝난다', async () => {
  const clock = fakeEnv();
  const retry = createSaveRetryController(clock.env);
  const { job, log } = scriptedJob(clock, ['ok']);
  assert.equal(await retry.run('a|stages', job), 'saved');
  assert.deepEqual(log.attempts, [0]);
  assert.equal(log.retrying, 0);
  assert.equal(log.saved, 1);
  assert.equal(retry.pendingCarry('a|stages'), undefined);
});

test('일시적 실패는 켜 둔 채 0.8초 뒤 다시 보내고, 되면 표시만 조용히 지운다', async () => {
  const clock = fakeEnv();
  const retry = createSaveRetryController(clock.env);
  const { job, log } = scriptedJob(clock, ['transient', 'ok']);
  const outcome = retry.run('a|stages', job);
  await clock.advance(0);
  assert.equal(log.retrying, 1);
  assert.equal(retry.isRetrying('a|stages'), true);
  await clock.advance(800);
  assert.equal(await outcome, 'saved');
  assert.deepEqual(log.attempts, [0, 800]);
  assert.equal(log.saved, 1);
  assert.equal(log.giveUp.length, 0);
  assert.equal(retry.isRetrying('a|stages'), false);
});

test('끝내 안 되면 0.8·2·4초 간격으로 세 번 더 보낸 뒤(6.8초) 포기한다', async () => {
  const clock = fakeEnv();
  const retry = createSaveRetryController(clock.env);
  const { job, log } = scriptedJob(clock, ['transient']);
  const outcome = retry.run('a|stages', job);
  await clock.advance(10_000);
  assert.equal(await outcome, 'failed');
  assert.deepEqual(log.attempts, [0, 800, 2800, 6800]);
  assert.equal(log.retrying, 1, '다시 보내는 중 표시는 한 번만 켠다');
  assert.deepEqual(log.giveUp, [{ at: 6800, kind: 'transient' }]);
  assert.equal(clock.pendingTimers, 0);
});

test('권한·검증 거절은 기다리지 않고 바로 포기한다(다시 보내는 중 표시도 없음)', async () => {
  const clock = fakeEnv();
  const retry = createSaveRetryController(clock.env);
  const { job, log } = scriptedJob(clock, ['permanent']);
  assert.equal(await retry.run('a|stages', job), 'failed');
  assert.deepEqual(log.attempts, [0]);
  assert.equal(log.retrying, 0);
  assert.deepEqual(log.giveUp, [{ at: 0, kind: 'permanent' }]);
});

test('일시적 실패 뒤 거절이 오면 그때 바로 포기한다', async () => {
  const clock = fakeEnv();
  const retry = createSaveRetryController(clock.env);
  const { job, log } = scriptedJob(clock, ['transient', 'permanent']);
  const outcome = retry.run('a|stages', job);
  await clock.advance(5000);
  assert.equal(await outcome, 'failed');
  assert.deepEqual(log.attempts, [0, 800]);
  assert.deepEqual(log.giveUp, [{ at: 800, kind: 'permanent' }]);
});

test('인터넷이 끊겨 있으면 다시 연결될 때까지 기다렸다가 바로 보낸다', async () => {
  const clock = fakeEnv(false);
  const retry = createSaveRetryController(clock.env);
  const { job, log } = scriptedJob(clock, ['transient', 'ok']);
  const outcome = retry.run('a|stages', job);
  await clock.advance(20_000);
  assert.deepEqual(log.attempts, [0], '끊긴 동안은 보내지 않는다');
  assert.equal(clock.onlineListeners, 1);
  clock.setOnline(true);
  assert.equal(await outcome, 'saved');
  assert.deepEqual(log.attempts, [0, 20_000]);
  assert.equal(clock.onlineListeners, 0);
  assert.equal(clock.pendingTimers, 0);
});

test('60초를 기다려도 연결이 안 되면 포기한다', async () => {
  const clock = fakeEnv(false);
  const retry = createSaveRetryController(clock.env);
  const { job, log } = scriptedJob(clock, ['transient']);
  const outcome = retry.run('a|stages', job);
  await clock.advance(800 + 60_000 + 10);
  assert.equal(await outcome, 'failed');
  assert.deepEqual(log.attempts, [0]);
  assert.deepEqual(log.giveUp, [{ at: 800 + 60_000, kind: 'transient' }]);
  assert.equal(clock.onlineListeners, 0);
});

test('연결 대기 60초는 한 작업 전체 몫이다(두 번째로 끊겨도 남은 시간만 기다린다)', async () => {
  const clock = fakeEnv(false);
  const retry = createSaveRetryController(clock.env);
  const { job, log } = scriptedJob(clock, ['transient']);
  const outcome = retry.run('a|stages', job);
  await clock.advance(800 + 50_000);
  clock.setOnline(true); // 50초 만에 연결 → 바로 보냄(실패)
  await clock.advance(0);
  clock.setOnline(false);
  await clock.advance(2000 + 10_000 + 1); // 2초 뒤 다시 끊김 → 남은 10초만 기다림
  assert.equal(await outcome, 'failed');
  assert.deepEqual(log.attempts, [0, 50_800]);
  assert.deepEqual(log.giveUp, [{ at: 50_800 + 2000 + 10_000, kind: 'transient' }]);
});

test('다시 보내는 중에 같은 칸을 또 누르면 기다리던 재전송은 취소되고 새 저장만 보낸다', async () => {
  const clock = fakeEnv();
  const retry = createSaveRetryController(clock.env);
  const first = scriptedJob(clock, ['transient', 'ok'], { carry: 'first' });
  const firstOutcome = retry.run('a|stages', first.job);
  await clock.advance(300);
  assert.equal(retry.pendingCarry('a|stages'), 'first', '새 저장이 앞 저장의 되돌릴 값·칸을 넘겨받는다');
  const second = scriptedJob(clock, ['ok'], { carry: 'second' });
  assert.equal(await retry.run('a|stages', second.job), 'saved');
  assert.equal(await firstOutcome, 'superseded');
  await clock.advance(5000);
  assert.deepEqual(first.log.attempts, [0], '앞 저장은 다시 보내지 않는다');
  assert.equal(first.log.saved + first.log.giveUp.length + first.log.overtaken, 0, '앞 저장의 콜백은 더 부르지 않는다');
  assert.deepEqual(second.log.attempts, [300]);
  assert.equal(clock.pendingTimers, 0);
});

test('보내는 중이던 요청이 나중에 실패해도, 새 저장이 넘겨받았으면 되돌리지 않는다', async () => {
  const clock = fakeEnv();
  const retry = createSaveRetryController(clock.env);
  let rejectFirst: (error: unknown) => void = () => {};
  const firstLog = { giveUp: 0, retrying: 0 };
  const firstOutcome = retry.run<string>('a|stages', {
    carry: 'first',
    attempt: () => new Promise<void>((_resolve, reject) => {
      rejectFirst = reject;
    }),
    stillMine: () => true,
    onRetrying: () => {
      firstLog.retrying += 1;
    },
    onGiveUp: () => {
      firstLog.giveUp += 1;
    },
  });
  const second = scriptedJob(clock, ['ok'], { carry: 'second' });
  const secondOutcome = retry.run('a|stages', second.job);
  rejectFirst(ipcError('supabase:update-scene-stage', 'permission denied [HTTP 403]'));
  assert.equal(await firstOutcome, 'superseded');
  assert.equal(await secondOutcome, 'saved');
  assert.deepEqual(firstLog, { giveUp: 0, retrying: 0 });
});

test('넘겨준 뒤 앞 요청이 성공해도 앞 저장의 성공 콜백은 부르지 않는다(새 저장의 표시를 지우지 않게)', async () => {
  const clock = fakeEnv();
  const retry = createSaveRetryController(clock.env);
  let resolveFirst: () => void = () => {};
  let firstSaved = 0;
  const handedOver: unknown[] = [];
  const firstOutcome = retry.run<string>('a|stages', {
    carry: 'first',
    attempt: () => new Promise<void>((resolve) => {
      resolveFirst = resolve;
    }),
    stillMine: () => true,
    onSaved: () => {
      firstSaved += 1;
    },
    onGiveUp: () => {},
    onSupersededSaved: (successor) => {
      handedOver.push(successor);
    },
  });
  const second = scriptedJob(clock, ['transient', 'ok'], { carry: 'second' });
  const secondOutcome = retry.run('a|stages', second.job);
  await clock.advance(0);
  assert.deepEqual(second.log.attempts, [], '같은 key 의 뒤 요청은 앞 요청이 끝날 때까지 기다린다(fx-retry)');
  resolveFirst();
  assert.equal(await firstOutcome, 'superseded');
  assert.equal(firstSaved, 0);
  assert.deepEqual(handedOver, ['second'], '저장됐다는 사실은 지금 넘겨받은 저장에 알린다(fx-retry)');
  await clock.advance(0);
  assert.equal(second.log.retrying, 1);
  assert.equal(retry.isRetrying('a|stages'), true, '새 저장은 계속 다시 보내는 중');
  await clock.advance(800);
  assert.equal(await secondOutcome, 'saved');
});

test('연결 신호가 기다리기 직전에 돌아와 있으면 60초를 기다리지 않는다', async () => {
  const clock = fakeEnv();
  let checks = 0;
  // 첫 확인에선 끊김, 구독한 뒤 다시 보면 연결됨('online' 이벤트는 이미 지나감).
  const env: SaveRetryEnv = { ...clock.env, isOnline: () => (checks++ === 0 ? false : true) };
  const retry = createSaveRetryController(env);
  const { job, log } = scriptedJob(clock, ['transient', 'ok']);
  const outcome = retry.run('a|stages', job);
  await clock.advance(800);
  assert.equal(await outcome, 'saved');
  assert.deepEqual(log.attempts, [0, 800]);
});

test('다시 보내기 직전에 화면 값이 바뀌어 있으면(다른 사람이 바꿈) 덮지 않고 멈춘다', async () => {
  const clock = fakeEnv();
  const retry = createSaveRetryController(clock.env);
  let mine = true;
  const { job, log } = scriptedJob(clock, ['transient'], { stillMine: () => mine });
  const outcome = retry.run('a|stages', job);
  await clock.advance(400);
  mine = false;
  await clock.advance(400);
  assert.equal(await outcome, 'overtaken');
  assert.deepEqual(log.attempts, [0], '남의 값을 덮어쓰지 않는다');
  assert.equal(log.overtaken, 1);
  assert.equal(log.giveUp.length, 0);
});

test('칸 묶음(key)이 다르면 서로 취소하지 않는다', async () => {
  const clock = fakeEnv();
  const retry = createSaveRetryController(clock.env);
  const a = scriptedJob(clock, ['transient', 'ok']);
  const b = scriptedJob(clock, ['transient', 'ok']);
  const outcomes = [retry.run('a|stages', a.job), retry.run('a|phase', b.job)];
  await clock.advance(800);
  assert.deepEqual(await Promise.all(outcomes), ['saved', 'saved']);
});

/* ─── 마지막 값만·되돌릴 값 ─── */

const stages = (key: string) => ({ lo: key[0] === '1', done: key[1] === '1', review: key[2] === '1', png: key[3] === '1' });

test('저장 확인 전에 또 누르면 앞 칸까지 마지막 값으로 함께 보내고, 되돌릴 값은 맨 처음 값을 지킨다', () => {
  // LO 만 켜진 씬에서 PNG 클릭(완료~PNG 켜짐) → 실패 → 다시 PNG 클릭(PNG 만 끔)
  const before = stages('1000');
  const firstPatch = buildSequentialStagePatch(before, 'png');
  const first = mergePendingStageWrites(undefined, before, firstPatch, getChangedSequentialStages(before, firstPatch));
  assert.deepEqual(first.stages, ['done', 'review', 'png']);
  assert.deepEqual(first.baseline, { done: false, review: false, png: false });

  const afterFirst = stages('1111');
  const secondPatch = buildSequentialStagePatch(afterFirst, 'png');
  const second = mergePendingStageWrites(first, afterFirst, secondPatch, getChangedSequentialStages(afterFirst, secondPatch));
  assert.deepEqual(second.stages, ['done', 'review', 'png'], '앞 저장의 칸(완료·검수)도 함께 보낸다');
  assert.deepEqual(second.desired, { done: true, review: true, png: false }, '칸마다 마지막 값');
  assert.deepEqual(second.baseline, { done: false, review: false, png: false }, '되돌릴 값은 첫 클릭 전 값');
});

test('앞 칸이 그 사이 다른 사람 값으로 바뀌었으면 넘겨받지 않는다(덮지 않음)', () => {
  const before = stages('0000');
  const patch = buildSequentialStagePatch(before, 'review');
  const first = mergePendingStageWrites(undefined, before, patch, getChangedSequentialStages(before, patch));
  // 다른 사람이 '검수'를 꺼서 화면이 1100 이 됨 → 내가 PNG... 대신 LO 칸을 다시 눌러 모두 끔
  const remote = stages('1100');
  const nextPatch = buildSequentialStagePatch(remote, 'lo');
  const merged = mergePendingStageWrites(first, remote, nextPatch, getChangedSequentialStages(remote, nextPatch));
  assert.deepEqual(merged.stages, ['lo', 'done'], '검수는 내 값이 아니게 됐으니 빠진다');
  assert.deepEqual(merged.baseline, { lo: false, done: false });
});

test('아직 내 값인 칸 / 처음 값으로 돌아간 칸 — 클릭 직후 화면 값(expected)으로 본다', () => {
  const before = stages('0000');
  const patch = buildSequentialStagePatch(before, 'review');
  let writes = mergePendingStageWrites(undefined, before, patch, getChangedSequentialStages(before, patch));
  writes = withExpectedStages(writes, stages('1110'));
  assert.deepEqual(stagesStillMine(writes, stages('1110')), ['lo', 'done', 'review']);
  // 주기 동기화가 옛 서버 값(0000)을 다시 읽어 왔다 → 모두 처음 값으로 돌아감
  assert.deepEqual(stagesStillMine(writes, stages('0000')), []);
  assert.deepEqual(stagesRevertedToBaseline(writes, stages('0000')), ['lo', 'done', 'review']);

  // 액팅 씬: '대기' 칸만 켜면 단계가 대기라 체크가 모두 꺼진 채 보인다 — 그것도 '내 값'이다.
  const actPatch = buildSequentialStagePatch(before, 'lo');
  let act = mergePendingStageWrites(undefined, before, actPatch, getChangedSequentialStages(before, actPatch));
  act = withExpectedStages(act, stages('0000'));
  assert.deepEqual(act.desired, { lo: true });
  assert.deepEqual(stagesStillMine(act, stages('0000')), ['lo']);
  assert.deepEqual(stagesRevertedToBaseline(act, stages('0000')), []);
});

/* ─── 표시·안내 ─── */

test('되돌림 표시 수치 — 도리도리 0→−3→3→−2→0px 0.24초 ease-out, 빨간 테두리 0→1(15%)→0 0.9초', () => {
  assert.equal(ROLLBACK_SHAKE_MS, 240);
  assert.equal(ROLLBACK_SHAKE_EASE, 'ease-out');
  assert.deepEqual(ROLLBACK_SHAKE_KEYFRAMES.map((frame) => frame.translate), ['0px 0px', '-3px 0px', '3px 0px', '-2px 0px', '0px 0px']);
  // 누름(:active)의 transform 과 겹치지 않게 개별 translate 속성만 쓴다.
  assert.ok(ROLLBACK_SHAKE_KEYFRAMES.every((frame) => !('transform' in frame)));
  assert.equal(ROLLBACK_BORDER_MS, 900);
  assert.deepEqual(ROLLBACK_BORDER_KEYFRAMES.map((frame) => frame.opacity), [0, 1, 0]);
  assert.equal(ROLLBACK_BORDER_KEYFRAMES[1].offset, 0.15);
  assert.ok(ROLLBACK_FLASH_CLEAR_MS > ROLLBACK_BORDER_MS);
});

test('칸 이름 — 씬 칸·액팅 칩·담당자별이 겹치지 않는다', () => {
  assert.equal(stageCellId('review'), 'review');
  assert.equal(phaseCellId('done'), 'phase:done');
  assert.equal(assigneeCellId('김지은', 'lo'), 'a:김지은:lo');
  assert.equal(assigneeCellId('김지은', phaseCellId('work')), 'a:김지은:phase:work');
  assert.deepEqual(
    flattenPendingCells({ stages: ['lo', 'done'], phase: ['phase:work'], 'a:김지은': ['a:김지은:lo', 'lo'] }).sort(),
    ['a:김지은:lo', 'done', 'lo', 'phase:work'],
  );
  assert.deepEqual(flattenPendingCells(undefined), []);
});

test('안내 문구 — 버튼 없이 무엇이 되돌아갔는지와 할 일만', () => {
  assert.equal(rollbackToastTitle('a012', { kind: 'check', label: '검수' }), 'a012 검수 체크를 저장하지 못해 되돌렸어요');
  assert.equal(rollbackToastTitle('a012', { kind: 'phase', label: '완료' }), "a012 '완료' 단계를 저장하지 못해 되돌렸어요");
  assert.equal(rollbackToastTitle('a012', { kind: 'check', label: 'PNG' }, '김지은'), 'a012 김지은 PNG 체크를 저장하지 못해 되돌렸어요');
  assert.equal(rollbackToastTitle('a012', { kind: 'round' }, '김지은'), 'a012 김지은 작업 차수를 저장하지 못해 되돌렸어요');
  assert.equal(rollbackToastDescription('transient'), '인터넷 연결을 확인해 주세요');
  assert.match(rollbackToastDescription('permanent'), /새로고침/);
});

test('저장 상태 저장소 — 묶음마다 따로 켜고 지우고, 되돌림 표시는 테두리가 사라진 뒤 지운다', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    const store = useStageSaveStatusStore;
    store.getState().setRetrying('uuid-1', 'stages', ['lo', 'done']);
    store.getState().setRetrying('uuid-1', 'phase', ['phase:work']);
    const bySlot = store.getState().retrying['uuid-1'];
    assert.deepEqual(flattenPendingCells(bySlot).sort(), ['done', 'lo', 'phase:work']);
    store.getState().setRetrying('uuid-2', 'stages', ['png']);
    assert.equal(store.getState().retrying['uuid-1'], bySlot, '다른 씬이 바뀌어도 이 씬 몫은 같은 객체(다시 그리지 않음)');
    store.getState().clearRetrying('uuid-1', 'stages');
    assert.deepEqual(store.getState().retrying['uuid-1'], { phase: ['phase:work'] });
    store.getState().clearRetrying('uuid-1', 'phase');
    assert.equal(store.getState().retrying['uuid-1'], undefined);
    store.getState().setRetrying('uuid-2', 'stages', []);
    assert.equal(store.getState().retrying['uuid-2'], undefined, '빈 목록은 지우기와 같다');

    store.getState().flashRollback('uuid-1', ['review']);
    const first = store.getState().rollbacks['uuid-1'];
    assert.deepEqual(first.cells, ['review']);
    store.getState().flashRollback('uuid-1', ['review']);
    const second = store.getState().rollbacks['uuid-1'];
    assert.notEqual(second.at, first.at, '같은 칸을 또 되돌려도 표시가 다시 시작된다(key 재마운트)');
    mock.timers.tick(ROLLBACK_FLASH_CLEAR_MS - 1);
    assert.ok(store.getState().rollbacks['uuid-1']);
    mock.timers.tick(1);
    assert.equal(store.getState().rollbacks['uuid-1'], undefined);

    // 앞 표시의 지우기 타이머가 뒤에 다시 시작한 표시를 지우지 않는다.
    store.getState().flashRollback('uuid-3', ['lo']);
    mock.timers.tick(500);
    store.getState().flashRollback('uuid-3', ['done']);
    const restarted = store.getState().rollbacks['uuid-3'];
    mock.timers.tick(ROLLBACK_FLASH_CLEAR_MS - 500);
    assert.equal(store.getState().rollbacks['uuid-3'], restarted);
    mock.timers.tick(500);
    assert.equal(store.getState().rollbacks['uuid-3'], undefined);
  } finally {
    mock.timers.reset();
  }
});

/* ─── 연결 가드 ─── */

test('세 버튼 묶음이 저장 상태를 읽어 점선·흐림과 도리도리 표시를 단다', () => {
  for (const file of [
    'src/components/scenes/StageSegmentToggle.tsx',
    'src/components/scenes/ScenePhaseToggle.tsx',
    'src/components/scenes/AssigneeProgressStack.tsx',
  ]) {
    const source = read(file);
    assert.match(source, /useStageSaveStatus\(scene\.id\)/, file);
    assert.match(source, /data-save-pending=\{savePending \|\| undefined\}/, file);
    assert.match(source, /<StageRollbackFlash key=\{rollback\.at\} \/>/, file);
  }
  const flash = read('src/components/scenes/StageSaveStatus.tsx');
  assert.match(flash, /!reduceRef\.current && host/, '동작 줄이기면 흔들림 없이 테두리만');
  assert.doesNotMatch(flash, /classList/, '클래스 토글이 아니라 key 재마운트로 다시 시작');
});

test('씬 목록 저장 경로 세 곳이 자동 재전송을 거치고, 실패 즉시 되돌리던 경로는 없다', () => {
  const view = read('src/views/ScenesView.tsx');
  assert.equal((view.match(/sceneSaveRetry\.run</g) ?? []).length, 3);
  assert.doesNotMatch(view, /persistSequentialStagePatchWithRollback/);
  assert.doesNotMatch(view, /'단계 변경 저장에 실패했습니다\.'/);
  // 다시 보내기·되돌리기 전에 '아직 내 값인가'를 본다.
  assert.match(view, /stillMine: \(\) => \{\n\s+const latest = findSceneForSave/);
  assert.match(view, /stillMine: phaseStillMine/);
  assert.match(view, /stillMine: assigneeStillMine/);
  // 끝내 실패하면 축하를 끈다.
  assert.match(view, /celebrationWithout\(current, sheetName, sceneId, sceneUuid\)/);
});

test('메인은 단계·단계 상태·담당자별 저장 오류에 HTTP 상태를 싣는다', () => {
  const main = read('electron/supabase.ts');
  const body = (name: string) => {
    const start = main.indexOf(`export async function ${name}(`);
    assert.ok(start >= 0, name);
    return main.slice(start, main.indexOf('\n}\n', start));
  };
  for (const name of ['updateSceneStage', 'updateScenePhase', 'readMetadata', 'writeMetadata']) {
    assert.match(body(name), /throwIfErrorWithStatus\(error, status\)/, name);
  }
});

test('CSS — 다시 보내는 중은 opacity·점선 층, 되돌림 테두리는 #E17055 1.5px, 무한 반복·바탕 전환 없음', () => {
  const css = read('src/styles/motion-scene-check.css');
  const block = css.slice(css.indexOf('═══ 20.'));
  assert.ok(block.length > 0);
  assert.match(block, /\.stage-seg\[data-save-pending='true'\],\n\.stage-seg-pill\[data-save-pending='true'\] \{\n\s+opacity: 0\.72;/);
  assert.match(block, /border: 1px dashed currentColor;/);
  assert.match(block, /\.stage-seg-rollback \{[^}]*border: 1\.5px solid #E17055;[^}]*opacity: 0;/);
  assert.doesNotMatch(block, /infinite/);
  assert.doesNotMatch(block, /animation:\s*none/);
  assert.doesNotMatch(block, /transition[^;]*(background|box-shadow|width|height)/);
  // 평소 칸에는 점선 층이 없다(일괄 작업 실패 '!' 표시 ::after 와 겹치지 않게).
  assert.doesNotMatch(css, /\.stage-seg::after/);
});
