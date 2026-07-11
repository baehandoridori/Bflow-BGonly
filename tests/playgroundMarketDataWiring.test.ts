import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import type {
  MarketAdminEvent,
  MarketAdminEventInput,
  MarketCommand,
  MarketRemoteState,
} from '../src/features/playground/market/types.ts';
import { getLivePriceWon } from '../src/features/playground/market/livePriceEngine.ts';

const HANSOL_ID = 'fcc4b438-2696-4e88-a03f-d6f34e73e08f';

function remoteState(overrides: Partial<MarketRemoteState> = {}): MarketRemoteState {
  return {
    revision: 1,
    account: {
      walletPoints: 1_000_000,
      lifetimeEarnedPoints: 1_000_000,
      cashWon: 0,
      realizedPnlThisMonthWon: 0,
      unrealizedPnlAtMonthStartWon: 0,
      holdings: [],
    },
    favoriteStockIds: ['jbbj'],
    beginnerMission: 'reason',
    adminEvents: [],
    ...overrides,
  };
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

test('market service module exposes main-owned queue, safe parser, and service boundary', async () => {
  assert.equal(existsSync('electron/marketAccountService.ts'), true);
  const mod = await import('../electron/marketAccountService.ts');
  assert.equal(typeof mod.createMarketMutationQueue, 'function');
  assert.equal(typeof mod.parseMarketRemoteState, 'function');
  assert.equal(typeof mod.MarketAccountService, 'function');
});

test('per-user market queue serializes one user, lets users run independently, and survives rejection', async () => {
  const { createMarketMutationQueue } = await import('../electron/marketAccountService.ts');
  const queue = createMarketMutationQueue();
  const events: string[] = [];
  let releaseHansol!: () => void;
  const hansolGate = new Promise<void>((resolve) => { releaseHansol = resolve; });

  const first = queue.enqueue('hansol', async () => {
    events.push('hansol:first:start');
    await hansolGate;
    events.push('hansol:first:end');
    return 1;
  });
  const second = queue.enqueue('hansol', async () => {
    events.push('hansol:second');
    return 2;
  });
  const other = queue.enqueue('other', async () => {
    events.push('other');
    return 3;
  });

  assert.equal(await other, 3);
  assert.deepEqual(events, ['hansol:first:start', 'other']);
  releaseHansol();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  await assert.rejects(queue.enqueue('hansol', async () => { throw new Error('expected'); }), /expected/);
  assert.equal(await queue.enqueue('hansol', async () => 4), 4);
});

test('remote parser accepts bigint strings but rejects fractions and unsafe integers', async () => {
  const { parseMarketRemoteState } = await import('../electron/marketAccountService.ts');
  const parsed = parseMarketRemoteState({
    ...remoteState(),
    revision: '2',
    account: {
      ...remoteState().account,
      walletPoints: '1000000',
      lifetimeEarnedPoints: '1000000',
      cashWon: '2500',
      holdings: [{ stockId: 'jbbj', quantityShares: '2', costBasisWon: '3684' }],
    },
  });
  assert.equal(parsed.revision, 2);
  assert.equal(parsed.account.cashWon, 2500);
  assert.equal(parsed.account.holdings[0].quantityShares, 2);

  assert.throws(
    () => parseMarketRemoteState({ ...remoteState(), revision: Number.MAX_SAFE_INTEGER + 1 }),
    /안전|safe/i,
  );
  assert.throws(
    () => parseMarketRemoteState({
      ...remoteState(),
      account: { ...remoteState().account, walletPoints: '9007199254740992' },
    }),
    /안전|safe/i,
  );
  assert.throws(
    () => parseMarketRemoteState({
      ...remoteState(),
      account: { ...remoteState().account, cashWon: 1.5 },
    }),
    /정수|integer/i,
  );
});

test('market service rejects non-Hansol sessions and stale read completion', async () => {
  const { MarketAccountService } = await import('../electron/marketAccountService.ts');
  let session = {
    userId: HANSOL_ID,
    epoch: 1,
    name: '다른 사용자',
    slackId: 'U0000000000',
  };
  let readCalls = 0;
  let releaseRead!: () => void;
  const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
  const persistence = {
    read: async () => { readCalls++; await readGate; return remoteState(); },
    execute: async () => remoteState(),
    createAdminEvent: async () => remoteState(),
    deleteAdminEvent: async () => remoteState(),
  };
  const service = new MarketAccountService({
    getCanonicalSession: () => session,
    getNowMs: Date.now,
    resolveCanonicalQuote: () => { throw new Error('unexpected quote resolution'); },
    persistence,
    logger: { error: () => undefined },
  });

  await assert.rejects(service.read(), /배한솔/);
  assert.equal(readCalls, 0);

  session = { userId: HANSOL_ID, epoch: 1, name: '배한솔', slackId: 'U05DFV9UAN5' };
  const pending = service.read();
  session = { ...session, epoch: 2 };
  releaseRead();
  await assert.rejects(pending, /세션|사용자|이전/);
});

test('market service serializes mutations, rejects stale completion, and logs original DB errors', async () => {
  const { MarketAccountService } = await import('../electron/marketAccountService.ts');
  let session = {
    userId: HANSOL_ID,
    epoch: 7,
    name: '배한솔',
    slackId: 'U05DFV9UAN5',
  };
  const calls: string[] = [];
  const logged: unknown[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const service = new MarketAccountService({
    getCanonicalSession: () => session,
    getNowMs: Date.now,
    resolveCanonicalQuote: () => { throw new Error('unexpected quote resolution'); },
    persistence: {
      read: async () => remoteState(),
      execute: async (_userId: string, command: MarketCommand) => {
        calls.push(`${command.requestId}:start`);
        if (command.requestId === 'first') await firstGate;
        if (command.requestId === 'db-error') throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
        calls.push(`${command.requestId}:end`);
        return remoteState({ revision: 2 });
      },
      createAdminEvent: async () => remoteState(),
      deleteAdminEvent: async () => remoteState(),
    },
    logger: { error: (...args: unknown[]) => { logged.push(args.at(-1)); } },
  });

  const first = service.execute({
    kind: 'favorite', requestId: 'first', stockId: 'jbbj', wished: true,
  });
  const second = service.execute({
    kind: 'read-reason', requestId: 'second', stockId: 'jbbj',
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, ['first:start']);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(calls, ['first:start', 'first:end', 'second:start', 'second:end']);

  const stale = service.execute({
    kind: 'favorite', requestId: 'stale', stockId: 'wacom', wished: true,
  });
  session = { ...session, epoch: 8 };
  await assert.rejects(stale, /세션|사용자|이전/);

  await assert.rejects(
    service.execute({ kind: 'favorite', requestId: 'db-error', stockId: 'wacom', wished: true }),
    /저장|불러오|다시/,
  );
  assert.equal((logged.at(-1) as { code?: string })?.code, 'ECONNREFUSED');
});

test('market service revalidates the full Hansol authorization fingerprint around queued persistence', async () => {
  const { MarketAccountService } = await import('../electron/marketAccountService.ts');
  let session = {
    userId: HANSOL_ID,
    epoch: 11,
    name: '배한솔',
    slackId: 'U05DFV9UAN5',
  };
  const calls: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const service = new MarketAccountService({
    getCanonicalSession: () => session,
    getNowMs: Date.now,
    resolveCanonicalQuote: () => { throw new Error('unexpected quote resolution'); },
    persistence: {
      read: async () => remoteState(),
      execute: async (_userId: string, command: MarketCommand) => {
        calls.push(command.requestId);
        if (command.requestId === 'fingerprint-first') await firstGate;
        return remoteState({ revision: 2 });
      },
      createAdminEvent: async () => remoteState(),
      deleteAdminEvent: async () => remoteState(),
    },
    logger: { error: () => undefined },
  });

  const first = service.execute({
    kind: 'favorite', requestId: 'fingerprint-first', stockId: 'jbbj', wished: true,
  }).then(() => null, (error: unknown) => error);
  const second = service.execute({
    kind: 'read-reason', requestId: 'fingerprint-second', stockId: 'jbbj',
  }).then(() => null, (error: unknown) => error);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, ['fingerprint-first']);

  session = { ...session, slackId: '권한이-바뀐-Slack' };
  releaseFirst();
  const [firstOutcome, secondOutcome] = await Promise.all([first, second]);

  assert.ok(firstOutcome instanceof Error, '진행 중 권한 변경은 완료 응답을 거절해야 한다');
  assert.match(firstOutcome.message, /배한솔|권한|세션|이전/);
  assert.ok(secondOutcome instanceof Error, '대기 중 권한 변경은 DB 호출 전에 거절해야 한다');
  assert.match(secondOutcome.message, /배한솔|권한|세션|이전/);
  assert.deepEqual(calls, ['fingerprint-first']);
});

test('market service rejects non-canonical or oversized request IDs before persistence', async () => {
  const { MarketAccountService } = await import('../electron/marketAccountService.ts');
  const persistedRequestIds: string[] = [];
  const service = new MarketAccountService({
    getCanonicalSession: () => ({
      userId: HANSOL_ID,
      epoch: 1,
      name: '배한솔',
      slackId: 'U05DFV9UAN5',
    }),
    getNowMs: Date.now,
    resolveCanonicalQuote: () => { throw new Error('unexpected quote resolution'); },
    persistence: {
      read: async () => remoteState(),
      execute: async (_userId: string, command: MarketCommand) => {
        persistedRequestIds.push(command.requestId);
        return remoteState({ revision: 2 });
      },
      createAdminEvent: async () => remoteState(),
      deleteAdminEvent: async () => remoteState(),
    },
    logger: { error: () => undefined },
  });

  for (const requestId of ['', ' 앞공백', '뒤공백 ', 'x'.repeat(201)]) {
    await assert.rejects(
      service.execute({ kind: 'favorite', requestId, stockId: 'jbbj', wished: true }),
      /요청.*ID|공백|200/,
    );
  }
  await assert.rejects(
    service.execute({
      kind: 'favorite',
      requestId: 123 as unknown as string,
      stockId: 'jbbj',
      wished: true,
    }),
    /요청.*ID|문자열/,
  );
  assert.deepEqual(persistedRequestIds, []);

  const exactLimit = 'r'.repeat(200);
  await service.execute({ kind: 'favorite', requestId: exactLimit, stockId: 'jbbj', wished: true });
  assert.deepEqual(persistedRequestIds, [exactLimit]);
});

test('market service rejects a manipulated quote before persistence and persists only the canonical quote', async () => {
  const { MarketAccountService } = await import('../electron/marketAccountService.ts');
  const nowMs = Date.parse('2026-07-11T12:00:30Z');
  const clockMs = nowMs + 789;
  const event: MarketAdminEvent = {
    id: 'shock-1',
    stockId: 'jbbj',
    kind: 'shock-up',
    title: '상승 충격',
    impactBps: 1200,
    startsAt: '2026-07-11T12:00:00Z',
    endsAt: '2026-07-11T12:01:00Z',
    revision: 1,
  };
  const profile = {
    stockId: 'jbbj',
    basePriceWon: 1842,
    volatilityBps: 180,
    phase: 0.37,
  };
  const canonicalQuoteWon = getLivePriceWon(profile, nowMs, [event]);
  const persisted: MarketCommand[] = [];
  const service = new MarketAccountService({
    getCanonicalSession: () => ({
      userId: HANSOL_ID,
      epoch: 1,
      name: '배한솔',
      slackId: 'U05DFV9UAN5',
    }),
    getNowMs: () => clockMs,
    resolveCanonicalQuote: (stockId: string, atMs: number, events: readonly MarketAdminEvent[]) => {
      assert.equal(stockId, 'jbbj');
      assert.equal(atMs, nowMs, 'canonical quote clock must use the current UTC second');
      return getLivePriceWon(profile, atMs, events);
    },
    persistence: {
      read: async () => remoteState({ adminEvents: [event] }),
      execute: async (_userId: string, command: MarketCommand) => {
        persisted.push(command);
        return remoteState({ revision: 2, adminEvents: [event] });
      },
      createAdminEvent: async () => remoteState(),
      deleteAdminEvent: async () => remoteState(),
    },
    logger: { error: () => undefined },
  });

  await assert.rejects(
    service.execute({
      kind: 'buy',
      requestId: 'tampered-quote',
      stockId: 'jbbj',
      quantityShares: 1,
      quotedPriceWon: 1,
    }),
    { message: '가격이 바뀌었어요. 현재 가격을 확인하고 다시 주문해 주세요.' },
  );
  assert.equal(persisted.length, 0, '1원 조작 주문은 persistence에 도달하면 안 된다');

  await service.execute({
    kind: 'buy',
    requestId: 'canonical-quote',
    stockId: 'jbbj',
    quantityShares: 1,
    quotedPriceWon: canonicalQuoteWon,
  });
  assert.equal(persisted.length, 1);
  assert.equal(
    (persisted[0] as Extract<MarketCommand, { kind: 'buy' }>).quotedPriceWon,
    canonicalQuoteWon,
  );
});

test('market service revalidates authorization after quote read and immediately before order persistence', async () => {
  const { MarketAccountService } = await import('../electron/marketAccountService.ts');
  const nowMs = Date.parse('2026-07-11T12:00:30Z');
  const profile = {
    stockId: 'jbbj',
    basePriceWon: 1842,
    volatilityBps: 180,
    phase: 0.37,
  };
  const canonicalQuoteWon = getLivePriceWon(profile, nowMs, []);
  let session = {
    userId: HANSOL_ID,
    epoch: 1,
    name: '배한솔',
    slackId: 'U05DFV9UAN5',
  };
  let markReadStarted!: () => void;
  const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve; });
  let releaseRead!: () => void;
  const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
  let executeCalls = 0;
  const service = new MarketAccountService({
    getCanonicalSession: () => session,
    getNowMs: () => nowMs,
    resolveCanonicalQuote: (_stockId: string, atMs: number, events: readonly MarketAdminEvent[]) => (
      getLivePriceWon(profile, atMs, events)
    ),
    persistence: {
      read: async () => {
        markReadStarted();
        await readGate;
        return remoteState();
      },
      execute: async () => {
        executeCalls += 1;
        return remoteState({ revision: 2 });
      },
      createAdminEvent: async () => remoteState(),
      deleteAdminEvent: async () => remoteState(),
    },
    logger: { error: () => undefined },
  });

  const pending = service.execute({
    kind: 'buy',
    requestId: 'permission-change-during-quote',
    stockId: 'jbbj',
    quantityShares: 1,
    quotedPriceWon: canonicalQuoteWon,
  });
  await readStarted;
  session = { ...session, name: '권한이 바뀐 사용자' };
  releaseRead();

  await assert.rejects(pending, /배한솔|권한|세션|이전/);
  assert.equal(executeCalls, 0, '권한이 바뀐 주문은 quote read 뒤 write에 도달하면 안 된다');
});

test('Electron gateway hydrates remote account state while preserving static market content', async () => {
  const { createElectronMarketGateway } = await import('../src/features/playground/market/electronGateway.ts');
  const calls: string[] = [];
  const input: MarketAdminEventInput = {
    stockId: 'jbbj', kind: 'news', title: '새 소식', impactBps: 100,
    startsAt: '2026-07-12T00:00:00.000Z', endsAt: null,
  };
  const api = {
    marketRead: async () => { calls.push('read'); return remoteState(); },
    marketExecute: async (_command: MarketCommand) => { calls.push('execute'); return remoteState({ revision: 2 }); },
    marketCreateAdminEvent: async (_input: MarketAdminEventInput) => { calls.push('create'); return remoteState({ revision: 3 }); },
    marketDeleteAdminEvent: async (_eventId: string) => { calls.push('delete'); return remoteState({ revision: 4 }); },
  };
  const gateway = createElectronMarketGateway(api);

  const read = await gateway.read();
  assert.ok(read.stocks.length > 0);
  assert.equal(read.account.walletPoints, 1_000_000);
  await gateway.execute({ kind: 'read-reason', requestId: 'one', stockId: 'jbbj' });
  await gateway.createAdminEvent(input);
  await gateway.deleteAdminEvent('11111111-1111-4111-8111-111111111111');
  assert.deepEqual(calls, ['read', 'execute', 'create', 'delete']);
});

test('gateway requires all four IPC methods and never seeds production when IPC is missing', async () => {
  const { createMarketGateway } = await import('../src/features/playground/market/gateway.ts');
  const completeApi = {
    marketRead: async () => remoteState(),
    marketExecute: async () => remoteState(),
    marketCreateAdminEvent: async () => remoteState(),
    marketDeleteAdminEvent: async () => remoteState(),
  };
  const complete = createMarketGateway({ getElectronAPI: () => completeApi });
  assert.equal((await complete.read()).account.walletPoints, 1_000_000);

  const partial = createMarketGateway({
    getElectronAPI: () => ({ marketRead: completeApi.marketRead }),
  });
  await assert.rejects(partial.read(), /IPC|연결|불러오/);

  const missing = createMarketGateway({ getElectronAPI: () => undefined });
  await assert.rejects(missing.read(), /IPC|연결|불러오/);
});

test('explicit browser preview gateway is localStorage-backed and isolated by authenticated user', async () => {
  const { createMarketGateway } = await import('../src/features/playground/market/gateway.ts');
  const storage = new MemoryStorage();
  let userId = 'preview-hansol';
  const gateway = createMarketGateway({
    getElectronAPI: () => undefined,
    getPreviewContext: () => ({ enabled: true, userId, storage, now: () => 100 }),
  });

  await gateway.execute({
    kind: 'transfer', requestId: 'preview-transfer', direction: 'wallet-to-broker', points: 2500,
  });
  assert.equal((await gateway.read()).account.cashWon, 2500);
  const withEvent = await gateway.createAdminEvent({
    stockId: 'jbbj', kind: 'news', title: '프리뷰 소식', impactBps: 100,
    startsAt: '2026-07-12T00:00:00.000Z', endsAt: null,
  });
  assert.equal(withEvent.adminEvents.length, 1);
  const withoutEvent = await gateway.deleteAdminEvent(withEvent.adminEvents[0].id);
  assert.equal(withoutEvent.adminEvents.length, 0);
  userId = 'preview-other';
  assert.equal((await gateway.read()).account.cashWon, 0);
  userId = 'preview-hansol';
  assert.equal((await gateway.read()).account.cashWon, 2500);
});

test('main, preload, renderer types, dev preview, and store expose ownership-free market wiring', () => {
  const main = readFileSync('electron/main.ts', 'utf8');
  const preload = readFileSync('electron/preload.ts', 'utf8');
  const types = readFileSync('src/types/index.ts', 'utf8');
  const supabase = readFileSync('electron/supabase.ts', 'utf8');
  const livePriceEngine = readFileSync('src/features/playground/market/livePriceEngine.ts', 'utf8');
  const nodeTsconfig = readFileSync('tsconfig.node.json', 'utf8');
  const devApi = readFileSync('src/mocks/devElectronAPI.ts', 'utf8');
  const store = readFileSync('src/features/playground/market/useMarketPreviewStore.ts', 'utf8');
  const playground = readFileSync('src/views/PlaygroundView.tsx', 'utf8');
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };

  for (const channel of [
    'market:read', 'market:execute', 'market:create-admin-event', 'market:delete-admin-event',
  ]) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\('${channel.replace(':', '\\:')}'`));
  }
  assert.match(main, /sessionManager\.ensure\(\)/);
  assert.match(main, /sessionManager\.getCanonicalUserId\(\)/);
  assert.match(main, /sessionManager\.getEpoch\(\)/);
  assert.match(main, /name\s*!==\s*'배한솔'|name\s*===\s*'배한솔'/);
  assert.match(main, /slackId\s*!==\s*'U05DFV9UAN5'|slackId\s*===\s*'U05DFV9UAN5'/);
  assert.doesNotMatch(main, /market:read'\s*,\s*\([^)]*userId/);
  assert.doesNotMatch(main, /market:execute'\s*,\s*\([^)]*userId/);
  assert.match(main, /marketAccountService\.beginSessionTransition/);
  assert.match(main, /marketAccountService\.drainUser/);
  assert.match(main, /marketAccountService\.beginQuitting\(\)/);
  assert.match(main, /marketAccountService\.getPendingCount\(\)/);
  assert.match(main, /marketAccountService\.waitForIdle\(15000\)/);
  assert.match(main, /resolveCanonicalQuote:\s*getCanonicalMarketQuoteWon/);
  assert.match(main, /getNowMs:\s*Date\.now/);
  assert.match(livePriceEngine, /shared\/playgroundMarketPrice\.mjs/);
  assert.doesNotMatch(nodeTsconfig, /"shared"/);
  assert.equal(existsSync('shared/playgroundMarketPrice.mjs'), true);
  assert.equal(existsSync('shared/playgroundMarketPrice.d.mts'), true);

  for (const apiName of ['marketRead', 'marketExecute', 'marketCreateAdminEvent', 'marketDeleteAdminEvent']) {
    assert.match(preload, new RegExp(`${apiName}:`));
    assert.match(types, new RegExp(`${apiName}:`));
    assert.match(devApi, new RegExp(`${apiName}:`));
  }
  assert.doesNotMatch(preload, /marketRead:\s*\(userId/);
  assert.doesNotMatch(preload, /marketExecute:\s*\(userId/);
  assert.doesNotMatch(preload, /marketCreateAdminEvent:\s*\(userId/);
  assert.doesNotMatch(preload, /marketDeleteAdminEvent:\s*\(userId/);
  assert.match(devApi, /U05DFV9UAN5/);
  assert.match(devApi, /createMarketLocalStorageGateway/);

  assert.match(supabase, /playground_market_read/);
  assert.match(supabase, /playground_market_execute/);
  assert.match(supabase, /playground_market_create_event/);
  assert.match(supabase, /playground_market_delete_event/);
  assert.doesNotMatch(supabase, /service[_-]?role/i);

  assert.match(store, /createMarketGateway/);
  assert.doesNotMatch(store, /createMarketPreviewGateway\(\)/);
  assert.match(playground, /currentUser\?\.id/);
  assert.match(packageJson.scripts['test:playground'], /playgroundMarketDatabaseContract\.test\.ts/);
  assert.match(packageJson.scripts['test:playground'], /playgroundMarketDataWiring\.test\.ts/);
});
