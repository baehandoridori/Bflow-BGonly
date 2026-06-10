import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';

const modulePath = path.join(process.cwd(), 'src', 'utils', 'notificationCatchupRunner.ts');

test('catch-up guard clears the in-flight user when a run fails so the same session can retry', async () => {
  assert.equal(existsSync(modulePath), true, 'notificationCatchupRunner.ts must exist');
  const { beginCatchupRun, resetCatchupRun, releaseCatchupRunOnError } = await import('../src/utils/notificationCatchupRunner.ts');
  const guard: { current: string | null } = { current: null };

  assert.equal(beginCatchupRun(guard, 'user-1'), true);
  assert.equal(beginCatchupRun(guard, 'user-1'), false);

  releaseCatchupRunOnError(guard, 'user-1');
  assert.equal(guard.current, null);
  assert.equal(beginCatchupRun(guard, 'user-1'), true);

  resetCatchupRun(guard);
  assert.equal(guard.current, null);
});

test('paged catch-up fetcher uses cursor pagination and reports cap without advancing beyond fetched rows', async () => {
  assert.equal(existsSync(modulePath), true, 'notificationCatchupRunner.ts must exist');
  const { fetchCatchupPages } = await import('../src/utils/notificationCatchupRunner.ts');
  const calls: Array<string | undefined> = [];
  const pages = new Map<string | undefined, Array<{ id: string; createdAt: string }>>([
    [undefined, [
      { id: 'n3', createdAt: '2026-06-05T03:00:00.000Z' },
      { id: 'n2', createdAt: '2026-06-05T02:00:00.000Z' },
    ]],
    ['2026-06-05T02:00:00.000Z', [
      { id: 'n1', createdAt: '2026-06-05T01:00:00.000Z' },
      { id: 'n0', createdAt: '2026-06-05T00:00:00.000Z' },
    ]],
  ]);

  const result = await fetchCatchupPages({
    pageSize: 2,
    safeCap: 3,
    fetchPage: async ({ before }) => {
      calls.push(before);
      return pages.get(before) ?? [];
    },
    getCursor: (row) => row.createdAt,
  });

  assert.deepEqual(calls, [undefined, '2026-06-05T02:00:00.000Z']);
  assert.deepEqual(result.rows.map((row) => row.id), ['n3', 'n2', 'n1', 'n0']);
  assert.equal(result.cappedOut, true);
});
