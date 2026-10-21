import test from 'node:test';
import assert from 'node:assert/strict';

import { createIncrementalRowCache } from '../electron/incrementalRowCache.ts';

interface Row { id: string; part: string; updatedAt: number; value: string }

/** 가짜 서버: 행을 들고 있고, 받은 요청을 기록한다. */
function fakeServer(initial: Row[]) {
  const rows = new Map(initial.map((row) => [row.id, { ...row }]));
  const calls: string[] = [];
  let clock = 1_000_000;
  return {
    rows,
    calls,
    tick(ms: number) { clock += ms; return clock; },
    get clock() { return clock; },
    upsert(row: Omit<Row, 'updatedAt'> & { updatedAt?: number }) { rows.set(row.id, { ...row, updatedAt: row.updatedAt ?? clock }); },
    remove(id: string) { rows.delete(id); },
    deps(extra: { fullEveryMs?: number; overlapMs?: number } = {}) {
      return {
        keyOf: (row: Row) => row.id,
        groupOf: (row: Row) => row.part,
        fetchAll: async (groups: string[]) => {
          calls.push(`all:${groups.join(',')}`);
          return [...rows.values()].filter((row) => groups.includes(row.part)).map((row) => ({ ...row }));
        },
        fetchChangedSince: async (groups: string[], sinceIso: string) => {
          calls.push(`since:${groups.join(',')}`);
          const since = Date.parse(sinceIso);
          return [...rows.values()].filter((row) => groups.includes(row.part) && row.updatedAt > since).map((row) => ({ ...row }));
        },
        count: async (groups: string[]) => {
          calls.push('count');
          return [...rows.values()].filter((row) => groups.includes(row.part)).length;
        },
        now: () => clock,
        ...extra,
      };
    },
  };
}

const seed = (): Row[] => [
  { id: 's1', part: 'A', updatedAt: 1_000, value: 'x' },
  { id: 's2', part: 'A', updatedAt: 1_000, value: 'x' },
  { id: 's3', part: 'B', updatedAt: 1_000, value: 'x' },
];

const byId = (rows: Row[]) => Object.fromEntries(rows.map((row) => [row.id, row.value]));

test('처음은 전부, 그다음부터는 바뀐 행만 받는다', async () => {
  const server = fakeServer(seed());
  const cache = createIncrementalRowCache(server.deps());
  const first = await cache.sync(['A', 'B']);
  assert.equal(first.mode, 'full');
  assert.equal(first.fetched, 3);

  server.tick(60_000);
  server.upsert({ id: 's2', part: 'A', value: 'y' });
  server.tick(60_000);
  server.calls.length = 0;
  const second = await cache.sync(['A', 'B']);
  assert.equal(second.mode, 'delta');
  assert.equal(second.fetched, 1, '바뀐 s2 한 줄만 받는다');
  assert.deepEqual(byId(second.rows), { s1: 'x', s2: 'y', s3: 'x' });
  assert.ok(!server.calls.some((call) => call.startsWith('all:')), '전부 받기를 하지 않는다');
});

test('새로 생긴 행도 바뀐 행으로 잡힌다', async () => {
  const server = fakeServer(seed());
  const cache = createIncrementalRowCache(server.deps());
  await cache.sync(['A', 'B']);
  server.tick(30_000);
  server.upsert({ id: 's4', part: 'B', value: 'new' });
  const result = await cache.sync(['A', 'B']);
  assert.equal(result.mode, 'delta');
  assert.equal(byId(result.rows).s4, 'new');
});

test('지운 행은 개수가 안 맞아서 그때만 전부 다시 받는다', async () => {
  const server = fakeServer(seed());
  const cache = createIncrementalRowCache(server.deps());
  await cache.sync(['A', 'B']);
  server.tick(30_000);
  server.remove('s1');
  const result = await cache.sync(['A', 'B']);
  assert.equal(result.mode, 'full');
  assert.deepEqual(Object.keys(byId(result.rows)).sort(), ['s2', 's3']);
  server.tick(30_000);
  const after = await cache.sync(['A', 'B']);
  assert.equal(after.mode, 'delta', '다시 맞춘 뒤에는 바뀐 것만');
});

test('범위에서 빠진 묶음(보관한 에피소드의 파트)은 버리고, 새로 들어온 묶음은 그것만 전부 받는다', async () => {
  const server = fakeServer([...seed(), { id: 'c1', part: 'C', updatedAt: 1_000, value: 'old' }]);
  const cache = createIncrementalRowCache(server.deps());
  await cache.sync(['A', 'B']);
  server.tick(30_000);
  const narrowed = await cache.sync(['A']);
  assert.equal(narrowed.mode, 'delta');
  assert.deepEqual(Object.keys(byId(narrowed.rows)).sort(), ['s1', 's2']);

  server.tick(30_000);
  server.calls.length = 0;
  const widened = await cache.sync(['A', 'C']);
  assert.equal(widened.mode, 'delta');
  assert.equal(byId(widened.rows).c1, 'old', '수정 시각이 오래된 행도 새로 들어온 묶음이면 받는다');
  assert.ok(server.calls.includes('all:C'), '새 묶음 C 만 전부');
  assert.ok(server.calls.includes('since:A'));
});

test('다른 PC 시계가 조금 늦어도(10분 안) 놓치지 않는다', async () => {
  const server = fakeServer(seed());
  const cache = createIncrementalRowCache(server.deps());
  await cache.sync(['A', 'B']);
  server.tick(120_000);
  // 다른 PC 가 5분 늦은 시계로 적은 수정
  server.upsert({ id: 's3', part: 'B', value: 'late', updatedAt: server.clock - 5 * 60_000 });
  const result = await cache.sync(['A', 'B']);
  assert.equal(byId(result.rows).s3, 'late');
});

test('한 시간이 지나면, 그리고 직접 새로고침이면 전부 다시 받는다', async () => {
  const server = fakeServer(seed());
  const cache = createIncrementalRowCache(server.deps());
  await cache.sync(['A', 'B']);
  server.tick(10 * 60_000);
  assert.equal((await cache.sync(['A', 'B'])).mode, 'delta');
  assert.equal((await cache.sync(['A', 'B'], { force: true })).mode, 'full', '직접 새로고침');
  server.tick(61 * 60_000);
  assert.equal((await cache.sync(['A', 'B'])).mode, 'full', '한 시간마다 한 번은 전부');
});

test('같은 때 여러 창이 불러도 서버에는 한 번만 묻는다', async () => {
  const server = fakeServer(seed());
  const cache = createIncrementalRowCache(server.deps());
  await cache.sync(['A', 'B']);
  server.tick(30_000);
  server.calls.length = 0;
  const [a, b] = await Promise.all([cache.sync(['A', 'B']), cache.sync(['B', 'A'])]);
  assert.equal(a, b);
  assert.equal(server.calls.filter((call) => call === 'count').length, 1);
});

test('받다가 실패하면 기억을 고치지 않고, 다음에 다시 시도한다', async () => {
  const server = fakeServer(seed());
  let fail = false;
  const deps = server.deps();
  const cache = createIncrementalRowCache({
    ...deps,
    fetchChangedSince: async (groups, since) => {
      if (fail) throw new Error('offline');
      return deps.fetchChangedSince(groups, since);
    },
  });
  await cache.sync(['A', 'B']);
  server.tick(30_000);
  server.upsert({ id: 's1', part: 'A', value: 'z' });
  fail = true;
  await assert.rejects(cache.sync(['A', 'B']));
  fail = false;
  server.tick(30_000);
  const result = await cache.sync(['A', 'B']);
  assert.equal(byId(result.rows).s1, 'z', '실패한 동안의 수정도 다음에 받는다(마지막 성공 시각부터)');
});
