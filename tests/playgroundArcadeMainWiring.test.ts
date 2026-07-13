import test from 'node:test';
import assert from 'node:assert/strict';

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
