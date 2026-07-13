import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ArcadeService,
  arcadeExecutePayload,
  type ArcadeActor,
  type ArcadeExecuteCommand,
  type ArcadeExecuteResult,
  type ArcadeServiceDependencies,
  type ArcadeWalletUpdate,
} from '../electron/arcadeService.ts';

const CANONICAL: ArcadeActor = { userId: 'u-canonical', name: '배한솔', slackId: 'U05DFV9UAN5' };
const FIXED_NOW = Date.parse('2026-07-13T12:00:00+09:00');

const mainSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'electron', 'main.ts'),
  'utf8',
);

interface Harness {
  service: ArcadeService;
  executed: ArcadeExecuteCommand[];
  broadcasts: ArcadeWalletUpdate[];
  slacks: Array<{ title: string; detail: string; player: string }>;
  executeCallCount: () => number;
}

function createHarness(config: {
  actor?: ArcadeActor | null;
  execute?: (command: ArcadeExecuteCommand, attempt: number) => Promise<ArcadeExecuteResult>;
  result?: ArcadeExecuteResult;
  getSessionEpoch?: () => number;
} = {}): Harness {
  const executed: ArcadeExecuteCommand[] = [];
  const broadcasts: ArcadeWalletUpdate[] = [];
  const slacks: Array<{ title: string; detail: string; player: string }> = [];
  let calls = 0;

  const deps: ArcadeServiceDependencies = {
    read: async () => ({}),
    execute: async (_userId, command) => {
      calls += 1;
      executed.push(command);
      if (config.execute) return config.execute(command, calls);
      return config.result ?? {};
    },
    resolveActor: () => (config.actor === undefined ? CANONICAL : config.actor),
    broadcastWalletUpdate: (update) => {
      broadcasts.push(update);
    },
    sendSlackRecord: (record) => {
      slacks.push(record);
    },
    getNowMs: () => FIXED_NOW,
    getSessionEpoch: config.getSessionEpoch ?? (() => 1),
    logger: { error: () => {} },
  };

  return {
    service: new ArcadeService(deps),
    executed,
    broadcasts,
    slacks,
    executeCallCount: () => calls,
  };
}

test('awardActivity is a no-op for a non-canonical or missing actor', async () => {
  const nonCanonical = createHarness({ actor: { userId: 'u-x', name: '다른사람', slackId: 'ZZZ' } });
  await nonCanonical.service.awardActivity({ activity: 'comment', refId: 'c-1' });
  assert.equal(nonCanonical.executeCallCount(), 0);

  const noActor = createHarness({ actor: null });
  await noActor.service.awardActivity({ activity: 'comment', refId: 'c-1' });
  assert.equal(noActor.executeCallCount(), 0);
});

test('awardActivity assembles the request id per activity kind', async () => {
  const harness = createHarness({ result: { awarded: true, points: 5, wallet: { walletPoints: 1, lifetimeEarnedPoints: 1 } } });
  await harness.service.awardActivity({ activity: 'scene-stage', refId: 'scene-1', stage: 'lo' });
  await harness.service.awardActivity({ activity: 'scene-phase-done', refId: 'scene-1' });
  await harness.service.awardActivity({ activity: 'comment', refId: 'cmt-9' });
  await harness.service.awardActivity({ activity: 'retake-done', refId: 'rev-7' });
  assert.deepEqual(
    harness.executed.map((command) => command.requestId),
    ['scene-stage:scene-1:lo', 'scene-phase-done:scene-1', 'comment:cmt-9', 'retake-done:rev-7'],
  );
  assert.deepEqual(
    harness.executed.map((command) => command.activity),
    ['scene-stage', 'scene-phase-done', 'comment', 'retake-done'],
  );
});

test('awardActivity without a required stage never reaches execute', async () => {
  const harness = createHarness();
  await harness.service.awardActivity({ activity: 'scene-stage', refId: 'scene-1' });
  assert.equal(harness.executeCallCount(), 0);
});

test('awardActivity broadcasts a wallet update only when points were actually awarded', async () => {
  const awarded = createHarness({ result: { awarded: true, points: 5, capped: false, wallet: { walletPoints: 105, lifetimeEarnedPoints: 205 } } });
  await awarded.service.awardActivity({ activity: 'comment', refId: 'c-1' });
  assert.equal(awarded.broadcasts.length, 1);
  assert.deepEqual(awarded.broadcasts[0], { wallet: { walletPoints: 105, lifetimeEarnedPoints: 205 }, delta: 5, reason: 'comment' });
});

test('awardActivity does not broadcast when the daily cap was hit', async () => {
  const capped = createHarness({ result: { awarded: false, points: 0, capped: true, wallet: { walletPoints: 100, lifetimeEarnedPoints: 200 } } });
  await capped.service.awardActivity({ activity: 'comment', refId: 'c-2' });
  assert.equal(capped.broadcasts.length, 0);
});

test('a replayed response never broadcasts or notifies slack', async () => {
  const replayed = createHarness({ result: { awarded: true, points: 5, replayed: true, wallet: { walletPoints: 100, lifetimeEarnedPoints: 200 } } });
  await replayed.service.awardActivity({ activity: 'comment', refId: 'c-3' });
  assert.equal(replayed.broadcasts.length, 0);

  const replayedFinish = createHarness({
    result: { newAlltimeBest: true, slackNotifyEnabled: true, replayed: true, prevBestScore: 10, wallet: { walletPoints: 1, lifetimeEarnedPoints: 1 } },
  });
  await replayedFinish.service.execute('u-canonical', {
    kind: 'game-finish',
    requestId: 'game-finish:run-1',
    runId: 'run-1',
    gameId: 'snake',
    score: 40,
    durationMs: 60_000,
    meta: {},
  });
  assert.equal(replayedFinish.slacks.length, 0);
});

test('execute retries a failed request once and reuses the same request id', async () => {
  const harness = createHarness({
    execute: async (_command, attempt) => {
      if (attempt === 1) throw new Error('network blip');
      return { awarded: true, points: 5, wallet: { walletPoints: 10, lifetimeEarnedPoints: 20 } };
    },
  });
  const result = await harness.service.execute('u-canonical', { kind: 'activity', requestId: 'comment:c-1', activity: 'comment' });
  assert.equal(harness.executeCallCount(), 2);
  assert.equal(harness.executed[0]?.requestId, harness.executed[1]?.requestId);
  assert.equal(result.awarded, true);
});

test('grantDailyLogin runs once per day on success and retries after failure', async () => {
  const ok = createHarness({ result: { granted: true, wallet: { walletPoints: 20, lifetimeEarnedPoints: 20 }, attendance: { streakDays: 1, todayGranted: true } } });
  await ok.service.grantDailyLogin();
  await ok.service.grantDailyLogin();
  assert.equal(ok.executeCallCount(), 1, 'a successful grant is remembered for the rest of the day');
  assert.equal(ok.executed[0]?.requestId, 'daily-login:2026-07-13');
  assert.equal(ok.broadcasts.length, 1);
  assert.equal(ok.broadcasts[0]?.reason, 'daily-login');

  const failing = createHarness({ execute: async () => { throw new Error('down'); } });
  await failing.service.grantDailyLogin(); // two attempts (retry), both fail → not remembered
  await failing.service.grantDailyLogin(); // retried on the next trigger
  assert.equal(failing.executeCallCount(), 4);
});

test('a replayed result after a retry (commit-then-lost response) still broadcasts', async () => {
  // 첫 시도가 커밋됐지만 응답이 유실 → 재시도가 replayed 를 받는다. 이 프로세스는 원 성공을
  // 못 봤으므로 지갑을 반영·broadcast 해야 한다.
  const harness = createHarness({
    execute: async (_command, attempt) => {
      if (attempt === 1) throw new Error('response lost');
      return {
        granted: true, replayed: true,
        wallet: { walletPoints: 20, lifetimeEarnedPoints: 20 },
        attendance: { streakDays: 1, todayGranted: true },
      };
    },
  });
  await harness.service.grantDailyLogin();
  assert.equal(harness.executeCallCount(), 2);
  assert.equal(harness.broadcasts.length, 1);
  assert.equal(harness.broadcasts[0]?.reason, 'daily-login');
});

test('a fresh all-time best sends a slack record when notifications are enabled', async () => {
  const harness = createHarness({
    result: { newAlltimeBest: true, slackNotifyEnabled: true, replayed: false, prevBestScore: 34, wallet: { walletPoints: 1, lifetimeEarnedPoints: 1 } },
  });
  await harness.service.execute('u-canonical', {
    kind: 'game-finish',
    requestId: 'game-finish:run-2',
    runId: 'run-2',
    gameId: 'snake',
    score: 41,
    durationMs: 60_000,
    meta: {},
  });
  assert.equal(harness.slacks.length, 1);
  assert.match(harness.slacks[0]?.detail ?? '', /34/);
  assert.equal(harness.slacks[0]?.player, '배한솔');
});

test('a best without slack notifications enabled stays silent', async () => {
  const harness = createHarness({
    result: { newAlltimeBest: true, slackNotifyEnabled: false, replayed: false, prevBestScore: null, wallet: { walletPoints: 1, lifetimeEarnedPoints: 1 } },
  });
  await harness.service.execute('u-canonical', {
    kind: 'game-finish',
    requestId: 'game-finish:run-3',
    runId: 'run-3',
    gameId: 'tetris',
    score: 3200,
    durationMs: 60_000,
    meta: {},
  });
  assert.equal(harness.slacks.length, 0);
});

test('execute does not run the RPC when the session already changed before the queued op', async () => {
  let epoch = 1;
  const executed: ArcadeExecuteCommand[] = [];
  const service = new ArcadeService({
    read: async () => ({}),
    execute: async (_userId, command) => {
      executed.push(command);
      return { awarded: true, points: 5, wallet: { walletPoints: 1, lifetimeEarnedPoints: 1 } };
    },
    resolveActor: () => CANONICAL,
    broadcastWalletUpdate: () => {},
    sendSlackRecord: () => {},
    getNowMs: () => FIXED_NOW,
    getSessionEpoch: () => epoch,
    logger: { error: () => {} },
  });
  const pending = service.execute('u-canonical', { kind: 'activity', requestId: 'comment:c', activity: 'comment' });
  epoch = 2; // 큐 op 이 실행되기 전에 세션 전환
  await assert.rejects(pending, /세션이 바뀌/);
  assert.equal(executed.length, 0, '세션이 바뀌면 RPC 를 아예 실행하지 않는다');
});

test('execute discards its result and skips the broadcast when the session changes mid-flight', async () => {
  let epoch = 1;
  const executed: ArcadeExecuteCommand[] = [];
  const broadcasts: ArcadeWalletUpdate[] = [];
  const service = new ArcadeService({
    read: async () => ({}),
    execute: async (_userId, command) => {
      executed.push(command);
      epoch = 2; // RPC 진행 중 로그아웃/사용자 전환 발생
      return { awarded: true, points: 5, wallet: { walletPoints: 1, lifetimeEarnedPoints: 1 } };
    },
    resolveActor: () => CANONICAL,
    broadcastWalletUpdate: (update) => broadcasts.push(update),
    sendSlackRecord: () => {},
    getNowMs: () => FIXED_NOW,
    getSessionEpoch: () => epoch,
    logger: { error: () => {} },
  });
  await assert.rejects(
    service.execute('u-canonical', { kind: 'activity', requestId: 'comment:c', activity: 'comment' }),
    /세션이 바뀌/,
  );
  assert.equal(executed.length, 1);
  assert.equal(broadcasts.length, 0);
});

test('awardActivity swallows a mid-flight session change without broadcasting', async () => {
  let epoch = 1;
  const broadcasts: ArcadeWalletUpdate[] = [];
  const service = new ArcadeService({
    read: async () => ({}),
    execute: async () => {
      epoch = 2;
      return { awarded: true, points: 5, wallet: { walletPoints: 1, lifetimeEarnedPoints: 1 } };
    },
    resolveActor: () => CANONICAL,
    broadcastWalletUpdate: (update) => broadcasts.push(update),
    sendSlackRecord: () => {},
    getNowMs: () => FIXED_NOW,
    getSessionEpoch: () => epoch,
    logger: { error: () => {} },
  });
  await service.awardActivity({ activity: 'comment', refId: 'c-1' }); // 예외를 삼켜야 한다
  assert.equal(broadcasts.length, 0);
});

test('a mutation started during a session transition (before the epoch bumps) never reaches the RPC', async () => {
  const executed: ArcadeExecuteCommand[] = [];
  const service = new ArcadeService({
    read: async () => ({}),
    execute: async (_userId, command) => { executed.push(command); return {}; },
    resolveActor: () => CANONICAL,
    broadcastWalletUpdate: () => {},
    sendSlackRecord: () => {},
    getNowMs: () => FIXED_NOW,
    getSessionEpoch: () => 1, // 전환 중 epoch 은 아직 발행되지 않아 그대로다
    logger: { error: () => {} },
  });
  service.beginSessionTransition('u-canonical', 1);
  await assert.rejects(
    service.execute('u-canonical', { kind: 'activity', requestId: 'comment:c', activity: 'comment' }),
    /세션이 바뀌/,
  );
  assert.equal(executed.length, 0, '전환 창에서는 epoch 이 그대로여도 RPC 를 실행하지 않는다');

  // 전환이 끝나면 다시 실행된다.
  service.endSessionTransition('u-canonical', 1);
  await service.execute('u-canonical', { kind: 'activity', requestId: 'comment:c2', activity: 'comment' });
  assert.equal(executed.length, 1, '전환이 끝나면 같은 epoch 에서 다시 RPC 를 실행한다');
});

test('a transition that begins mid-flight (epoch unchanged) suppresses the broadcast', async () => {
  const broadcasts: ArcadeWalletUpdate[] = [];
  let service!: ArcadeService;
  service = new ArcadeService({
    read: async () => ({}),
    execute: async () => {
      service.beginSessionTransition('u-canonical', 1); // RPC 진행 중 전환 시작 (epoch 은 그대로)
      return { awarded: true, points: 5, wallet: { walletPoints: 1, lifetimeEarnedPoints: 1 } };
    },
    resolveActor: () => CANONICAL,
    broadcastWalletUpdate: (update) => broadcasts.push(update),
    sendSlackRecord: () => {},
    getNowMs: () => FIXED_NOW,
    getSessionEpoch: () => 1,
    logger: { error: () => {} },
  });
  await assert.rejects(
    service.execute('u-canonical', { kind: 'activity', requestId: 'comment:c', activity: 'comment' }),
    /세션이 바뀌/,
  );
  assert.equal(broadcasts.length, 0, '전환이 시작되면 커밋된 결과라도 새 세션 renderer 로 broadcast 하지 않는다');
});

test('drainUser waits for an in-flight arcade mutation to settle before resolving', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let settled = false;
  const service = new ArcadeService({
    read: async () => ({}),
    execute: async () => {
      await gate;
      settled = true;
      return { awarded: true, points: 5, wallet: { walletPoints: 1, lifetimeEarnedPoints: 1 } };
    },
    resolveActor: () => CANONICAL,
    broadcastWalletUpdate: () => {},
    sendSlackRecord: () => {},
    getNowMs: () => FIXED_NOW,
    getSessionEpoch: () => 1,
    logger: { error: () => {} },
  });
  const pending = service.execute('u-canonical', { kind: 'activity', requestId: 'comment:c', activity: 'comment' });
  let drained = false;
  const drain = service.drainUser('u-canonical').then(() => { drained = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(drained, false, '진행 중 뮤테이션이 끝나기 전에는 drainUser 가 resolve 되지 않는다');
  release();
  await pending;
  await drain;
  assert.equal(settled, true);
  assert.equal(drained, true, 'drainUser 는 진행 중 뮤테이션이 끝난 뒤에 resolve 된다');
});

test('main wires the four activity accrual hooks with the correct conditions', () => {
  // 단계 체크(value===true)만 적립, 해제는 미적립
  assert.match(
    mainSource,
    /if \(value === true\) \{\s*void arcadeService\.awardActivity\(\{ activity: 'scene-stage', refId: sceneUuid, stage \}\);/,
  );
  // 액팅 단계는 실제 완료 전이(이전 상태 ≠ done)에서만 적립 — 이미 done 인 씬의 라운드 변경 제외
  assert.match(
    mainSource,
    /if \(sceneState === 'done' && previousState !== 'done'\) \{\s*void arcadeService\.awardActivity\(\{ activity: 'scene-phase-done', refId: sceneUuid \}\);/,
  );
  // 씬/파트 댓글 적립 (commentId 사용)
  assert.match(mainSource, /void arcadeService\.awardActivity\(\{ activity: 'comment', refId: commentId \}\);/);
  // 리테이크 담당 완료 전이에서만 적립 (revisionId 사용)
  assert.match(
    mainSource,
    /if \(statusActionType === 'revision_assignee_done'\) \{\s*void arcadeService\.awardActivity\(\{ activity: 'retake-done', refId: id \}\);/,
  );
});

test('the bulk stage update handler never awards activity points', () => {
  const bulkStart = mainSource.indexOf("ipcMain.handle('supabase:bulk-update-scene-stages'");
  assert.ok(bulkStart > 0, 'bulk 스테이지 업데이트 핸들러가 존재해야 한다');
  const nextHandler = mainSource.indexOf('ipcMain.handle(', bulkStart + 1);
  const bulkBlock = mainSource.slice(bulkStart, nextHandler > 0 ? nextHandler : undefined);
  assert.doesNotMatch(bulkBlock, /awardActivity/, '일괄 단계 변경은 활동 포인트를 적립하지 않는다');
});

test('arcadeExecutePayload strips the requestId and keeps only the kind fields', () => {
  assert.deepEqual(arcadeExecutePayload({ kind: 'daily-login', requestId: 'daily-login:2026-07-13' }), {});
  assert.deepEqual(arcadeExecutePayload({ kind: 'activity', requestId: 'comment:c1', activity: 'comment' }), { activity: 'comment' });
  assert.deepEqual(
    arcadeExecutePayload({ kind: 'game-start', requestId: 'game-entry:r1', runId: 'r1', gameId: 'snake' }),
    { runId: 'r1', gameId: 'snake' },
  );
  assert.deepEqual(
    arcadeExecutePayload({ kind: 'game-finish', requestId: 'game-finish:r1', runId: 'r1', gameId: 'snake', score: 40, durationMs: 1000, meta: { golden: 1 } }),
    { runId: 'r1', gameId: 'snake', score: 40, durationMs: 1000, meta: { golden: 1 } },
  );
  assert.deepEqual(arcadeExecutePayload({ kind: 'achievement-unlock', requestId: 'ach:x', achievementId: 'x' }), { achievementId: 'x' });
  assert.deepEqual(arcadeExecutePayload({ kind: 'config-set', requestId: 'config:1', slackNotifyEnabled: true }), { slackNotifyEnabled: true });
});
