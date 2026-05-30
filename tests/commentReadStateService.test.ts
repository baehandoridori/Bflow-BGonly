import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  COMMENT_READ_STATE_EVENT,
  __flushPendingCommentReadStateForTests,
  __getPendingCommentReadStateForTests,
  __hasCommentReadStatePersistenceOverrideForTests,
  __resetCommentReadStateServiceForTests,
  __setCommentReadStatePersistenceForTests,
  getCommentReadStateForUser,
  getLatestOtherUserCommentCreatedAt,
  isCommentKeyUnread,
  markSceneThreadReadForUser,
  primeCommentReadStateForUser,
} from '../src/services/commentReadStateService.ts';
import type { CommentReadStatePersistence } from '../src/services/commentReadStateService.ts';

const originalWindow = (globalThis as { window?: unknown }).window;

type UpsertCall = {
  userId: string;
  sceneThreadKey: string;
  lastReadAt: string;
};

afterEach(() => {
  __resetCommentReadStateServiceForTests();

  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});

function installFakePersistence(
  overrides: Partial<CommentReadStatePersistence> = {},
): { upserts: UpsertCall[] } {
  const upserts: UpsertCall[] = [];
  __setCommentReadStatePersistenceForTests({
    read: async () => [],
    upsert: async (userId, sceneThreadKey, lastReadAt) => {
      upserts.push({ userId, sceneThreadKey, lastReadAt });
    },
    ...overrides,
  });
  return { upserts };
}

async function withMutedWarnings<T>(run: () => Promise<T>): Promise<T> {
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    return await run();
  } finally {
    console.warn = originalWarn;
  }
}

test('comment read state treats comments newer than the seen timestamp as unread', () => {
  const latest = '2026-05-29T09:30:00.000Z';

  assert.equal(isCommentKeyUnread(latest, undefined), true);
  assert.equal(isCommentKeyUnread(latest, '2026-05-29T09:29:59.000Z'), true);
  assert.equal(isCommentKeyUnread(latest, '2026-05-29T09:30:00.000Z'), false);
  assert.equal(isCommentKeyUnread(latest, '2026-05-29T09:31:00.000Z'), false);
});

test('latest other-user comment ignores invalid, empty, and own rows', () => {
  const latest = getLatestOtherUserCommentCreatedAt([
    { userId: 'me', createdAt: '2026-05-29T11:00:00.000Z' },
    { userId: 'other', createdAt: 'bad-date' },
    { userId: 'other', createdAt: '2026-05-29T09:00:00.000Z' },
    { userId: 'other', createdAt: '2026-05-29T10:00:00.000Z' },
    { userId: 'other', createdAt: '' },
  ], 'me');

  assert.equal(latest, '2026-05-29T10:00:00.000Z');
});

test('mark read calls upsert with a normalized ISO timestamp', async () => {
  const { upserts } = installFakePersistence();

  await markSceneThreadReadForUser({
    userId: 'me',
    sceneThreadKey: 'EP05:A:a001',
    readAt: '2026-05-29T18:30:00+09:00',
  });

  assert.deepEqual(upserts, [{
    userId: 'me',
    sceneThreadKey: 'EP05:A:a001',
    lastReadAt: '2026-05-29T09:30:00.000Z',
  }]);
});

test('prime and mark update the per-user cache optimistically', async () => {
  installFakePersistence();
  primeCommentReadStateForUser('me', { 'EP05:A:a001': '2026-05-29T09:00:00.000Z' });

  await markSceneThreadReadForUser({
    userId: 'me',
    sceneThreadKey: 'EP05:A:a001',
    readAt: '2026-05-29T10:00:00.000Z',
  });

  const state = await getCommentReadStateForUser('me');
  assert.equal(state['EP05:A:a001'], '2026-05-29T10:00:00.000Z');
});

test('mark ignores older read timestamps', async () => {
  const { upserts } = installFakePersistence();
  primeCommentReadStateForUser('me', { 'EP05:A:a001': '2026-05-29T10:00:00.000Z' });

  await markSceneThreadReadForUser({
    userId: 'me',
    sceneThreadKey: 'EP05:A:a001',
    readAt: '2026-05-29T09:59:00.000Z',
  });

  const state = await getCommentReadStateForUser('me');
  assert.equal(state['EP05:A:a001'], '2026-05-29T10:00:00.000Z');
  assert.equal(upserts.length, 0);
});

test('save failure keeps optimistic cache and queues pending write', async () => {
  await withMutedWarnings(async () => {
    installFakePersistence({
      upsert: async () => {
        throw new Error('offline');
      },
    });

    await markSceneThreadReadForUser({
      userId: 'me',
      sceneThreadKey: 'EP05:A:a001',
      readAt: '2026-05-29T10:00:00.000Z',
    });

    const state = await getCommentReadStateForUser('me');
    const pending = __getPendingCommentReadStateForTests('me', 'EP05:A:a001');

    assert.equal(state['EP05:A:a001'], '2026-05-29T10:00:00.000Z');
    assert.equal(pending?.readAt, '2026-05-29T10:00:00.000Z');
    assert.equal(pending?.hasTimer, true);
  });
});

test('next get flushes pending write and deletes it on success', async () => {
  let shouldFail = true;
  const { upserts } = installFakePersistence({
    upsert: async (userId, sceneThreadKey, lastReadAt) => {
      upserts.push({ userId, sceneThreadKey, lastReadAt });
      if (shouldFail) throw new Error('offline');
    },
  });

  await withMutedWarnings(async () => {
    await markSceneThreadReadForUser({
      userId: 'me',
      sceneThreadKey: 'EP05:A:a001',
      readAt: '2026-05-29T10:00:00.000Z',
    });
  });

  assert.equal(__getPendingCommentReadStateForTests('me', 'EP05:A:a001')?.readAt, '2026-05-29T10:00:00.000Z');

  shouldFail = false;
  const state = await getCommentReadStateForUser('me');

  assert.equal(state['EP05:A:a001'], '2026-05-29T10:00:00.000Z');
  assert.equal(upserts.length, 2);
  assert.equal(__getPendingCommentReadStateForTests('me', 'EP05:A:a001'), null);
});

test('older pending save completing after newer queued value keeps the newer pending write', async () => {
  const olderReadAt = '2026-05-29T09:00:00.000Z';
  const newerReadAt = '2026-05-29T10:00:00.000Z';
  let firstOlderCall = true;
  let olderFlushStarted = false;
  let resolveOlderFlush!: () => void;
  const olderFlushPromise = new Promise<void>((resolve) => {
    resolveOlderFlush = resolve;
  });

  installFakePersistence({
    upsert: async (_userId, _sceneThreadKey, lastReadAt) => {
      if (lastReadAt === olderReadAt) {
        if (firstOlderCall) {
          firstOlderCall = false;
          throw new Error('initial older save failed');
        }

        olderFlushStarted = true;
        await olderFlushPromise;
        return;
      }

      if (lastReadAt === newerReadAt) {
        throw new Error('newer save failed');
      }
    },
  });

  await withMutedWarnings(async () => {
    await markSceneThreadReadForUser({
      userId: 'me',
      sceneThreadKey: 'EP05:A:a001',
      readAt: olderReadAt,
    });
  });

  const flushPromise = withMutedWarnings(() => __flushPendingCommentReadStateForTests('me'));
  await Promise.resolve();
  assert.equal(olderFlushStarted, true);

  await withMutedWarnings(async () => {
    await markSceneThreadReadForUser({
      userId: 'me',
      sceneThreadKey: 'EP05:A:a001',
      readAt: newerReadAt,
    });
  });

  resolveOlderFlush();
  await flushPromise;

  const pending = __getPendingCommentReadStateForTests('me', 'EP05:A:a001');
  assert.equal(pending?.readAt, newerReadAt);
  assert.equal(pending?.autoRetryAttempts, 1);
});

test('changed timestamp dispatches once and older timestamp does not dispatch', async () => {
  const events: Event[] = [];
  (globalThis as { window?: unknown }).window = {
    dispatchEvent: (event: Event) => {
      events.push(event);
      return true;
    },
  };
  const { upserts } = installFakePersistence();

  await markSceneThreadReadForUser({
    userId: 'me',
    sceneThreadKey: 'EP05:A:a001',
    readAt: '2026-05-29T10:00:00.000Z',
  });
  await markSceneThreadReadForUser({
    userId: 'me',
    sceneThreadKey: 'EP05:A:a001',
    readAt: '2026-05-29T09:59:00.000Z',
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].type, COMMENT_READ_STATE_EVENT);
  assert.equal(upserts.length, 1);
});

test('reset clears timers, pending writes, and persistence override', async () => {
  let staleUpsertCalls = 0;
  installFakePersistence({
    upsert: async () => {
      staleUpsertCalls += 1;
      throw new Error('offline');
    },
  });

  await withMutedWarnings(async () => {
    await markSceneThreadReadForUser({
      userId: 'me',
      sceneThreadKey: 'EP05:A:a001',
      readAt: '2026-05-29T10:00:00.000Z',
    });
  });

  assert.equal(__hasCommentReadStatePersistenceOverrideForTests(), true);
  assert.equal(__getPendingCommentReadStateForTests('me', 'EP05:A:a001')?.hasTimer, true);

  __resetCommentReadStateServiceForTests();

  assert.equal(__hasCommentReadStatePersistenceOverrideForTests(), false);
  assert.equal(__getPendingCommentReadStateForTests('me', 'EP05:A:a001'), null);

  await withMutedWarnings(async () => {
    await markSceneThreadReadForUser({
      userId: 'me',
      sceneThreadKey: 'EP05:A:a001',
      readAt: '2026-05-29T11:00:00.000Z',
    });
  });

  assert.equal(staleUpsertCalls, 1);
});
