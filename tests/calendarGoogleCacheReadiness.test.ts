import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { build } from 'esbuild';

type ServiceModule = {
  loadBflowEvents(): Promise<void>;
  syncAll(options?: { broadcast?: boolean; skipBflowLoad?: boolean }): Promise<unknown>;
  getEvents(): Promise<Array<{
    id: string;
    title: string;
    sourceCalendarId?: string;
  }>>;
  deleteEvent(eventId: string): Promise<void>;
  saveTeamCalendarId(calendarId: string | null): Promise<void>;
  isGoogleCacheReady(): boolean;
  __testUseAuthStore: {
    setState(state: { currentUser: {
      id: string;
      name: string;
      slackId: string;
      isInitialPassword: boolean;
      createdAt: string;
    } }): void;
  };
};

type GoogleEventFixture = {
  id: string;
  summary: string;
  start: { date: string };
  end: { date: string };
  created: string;
  extendedProperties: { private: { bflow_type: 'custom' } };
};

type BflowEventFixture = {
  id: string;
  calendar_id: string;
  title: string;
  memo: string | null;
  tag_id: string | null;
  all_day: boolean;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  linked_episode: number | null;
  linked_part: string | null;
  linked_sheet_name: string | null;
  linked_scene_id: string | null;
  linked_department: string | null;
  linked_todo_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type BflowCalendarFixture = {
  id: string;
  name: string;
  color: string;
  visibility: 'private' | 'members' | 'team';
  owner_id: string;
  is_personal: boolean;
  created_at: string;
  updated_at: string;
  members: Array<{ user_id: string; can_edit: boolean }>;
  can_edit: boolean;
  can_manage: boolean;
};

type LegacyPrivateEventFixture = {
  id: string;
  user_id: string;
  title: string;
  memo: string | null;
  color: string | null;
  type: string | null;
  start_date: string;
  end_date: string;
  linked_episode: number | null;
  linked_part: string | null;
  linked_sheet_name: string | null;
  linked_scene_id: string | null;
  linked_department: string | null;
  linked_todo_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type HarnessOptions = {
  fullSync(calendarId: string): Promise<GoogleEventFixture[]>;
  calendarList?: () => Promise<BflowCalendarFixture[]>;
  bflowEventsList?: () => Promise<BflowEventFixture[]>;
  deleteBflowEvent?: (eventId: string) => Promise<void>;
  readPrivateEvents?: (userId: string) => Promise<LegacyPrivateEventFixture[]>;
  currentUserId?: string;
  teamCalendarId?: string | null;
  personalCalendarId?: string | null;
  failSettingsWrite?: () => boolean;
};

let bundleSource: Promise<string> | undefined;
let bundleNonce = 0;

async function bundledServiceSource(): Promise<string> {
  bundleSource ??= build({
    stdin: {
      contents: [
        "export * from './src/services/calendarService.ts';",
        "export { useAuthStore as __testUseAuthStore } from './src/stores/useAuthStore.ts';",
      ].join('\n'),
      resolveDir: process.cwd(),
      sourcefile: 'calendar-google-cache-readiness-entry.ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
  }).then((result) => result.outputFiles[0].text);
  return bundleSource;
}

function googleEvent(id: string, summary: string): GoogleEventFixture {
  return {
    id,
    summary,
    start: { date: '2026-08-24' },
    end: { date: '2026-08-25' },
    created: '2026-08-24T00:00:00.000Z',
    extendedProperties: { private: { bflow_type: 'custom' } },
  };
}

function bflowEvent(id: string, title: string): BflowEventFixture {
  return {
    id,
    calendar_id: 'calendar-1',
    title,
    memo: null,
    tag_id: null,
    all_day: true,
    start_date: '2026-08-24',
    end_date: '2026-08-24',
    start_time: null,
    end_time: null,
    linked_episode: null,
    linked_part: null,
    linked_sheet_name: null,
    linked_scene_id: null,
    linked_department: null,
    linked_todo_id: null,
    created_by: null,
    created_at: '2026-08-24T00:00:00.000Z',
    updated_at: '2026-08-24T00:00:00.000Z',
  };
}

function personalCalendar(userId: string): BflowCalendarFixture {
  return {
    id: 'calendar-1',
    name: '내 캘린더',
    color: '#6C5CE7',
    visibility: 'private',
    owner_id: userId,
    is_personal: true,
    created_at: '2026-08-24T00:00:00.000Z',
    updated_at: '2026-08-24T00:00:00.000Z',
    members: [],
    can_edit: true,
    can_manage: true,
  };
}

function legacyPrivateEvent(id: string, userId: string): LegacyPrivateEventFixture {
  return {
    id,
    user_id: userId,
    title: '이관 전 개인 일정',
    memo: null,
    color: '#6C5CE7',
    type: 'custom',
    start_date: '2026-08-24',
    end_date: '2026-08-24',
    linked_episode: null,
    linked_part: null,
    linked_sheet_name: null,
    linked_scene_id: null,
    linked_department: null,
    linked_todo_id: null,
    created_by: userId,
    created_at: '2026-08-24T00:00:00.000Z',
    updated_at: '2026-08-24T00:00:00.000Z',
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function createHarness(
  input: HarnessOptions | HarnessOptions['fullSync'],
): Promise<{
  service: ServiceModule;
  broadcasts: unknown[];
  watchedCalendarIds: string[];
  deletedBflowEventIds: string[];
  deletedLegacyEventIds: string[];
  restore(): void;
}> {
  const options: HarnessOptions = typeof input === 'function' ? { fullSync: input } : input;
  const globalScope = globalThis as Record<string, unknown>;
  const prior = new Map<string, { exists: boolean; value: unknown }>();
  for (const key of ['window', 'localStorage', 'CustomEvent']) {
    prior.set(key, { exists: Object.prototype.hasOwnProperty.call(globalScope, key), value: globalScope[key] });
  }

  const values = new Map<string, string>();
  const broadcasts: unknown[] = [];
  const watchedCalendarIds: string[] = [];
  const deletedBflowEventIds: string[] = [];
  const deletedLegacyEventIds: string[] = [];
  if (options.personalCalendarId !== undefined) {
    values.set('bflow_gcal_local_settings', JSON.stringify({
      personalCalendarId: options.personalCalendarId,
      lastSyncAt: null,
    }));
  }
  globalScope.localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (key === 'bflow_gcal_local_settings' && options.failSettingsWrite?.()) {
        throw new Error('settings unavailable');
      }
      values.set(key, value);
    },
    removeItem: (key: string) => { values.delete(key); },
  };
  globalScope.CustomEvent = class extends Event {
    detail: unknown;
    constructor(type: string, init?: { detail?: unknown }) {
      super(type);
      this.detail = init?.detail;
    }
  };
  globalScope.window = Object.assign(new EventTarget(), {
    electronAPI: {
      calendarList: options.calendarList ?? (async () => []),
      calendarTagsList: async () => [],
      calendarEventsList: options.bflowEventsList ?? (async () => []),
      calendarEventDelete: async (eventId: string) => {
        deletedBflowEventIds.push(eventId);
        await options.deleteBflowEvent?.(eventId);
      },
      calendarBroadcastChange: async (detail: unknown) => {
        broadcasts.push(detail);
        return { ok: true };
      },
      supabaseReadPrivateEvents: options.readPrivateEvents ?? (async () => []),
      supabaseDeletePrivateEvent: async (eventId: string) => {
        deletedLegacyEventIds.push(eventId);
      },
      supabaseWriteMetadata: async () => {},
      supabaseReadMetadata: async () => options.teamCalendarId
        ? {
            type: 'gcal',
            key: 'teamCalendarId',
            value: options.teamCalendarId,
            updatedAt: '2026-08-24T00:00:00.000Z',
          }
        : null,
      gcalFullSync: options.fullSync,
      gcalEnsureWatch: async (calendarId: string) => {
        watchedCalendarIds.push(calendarId);
      },
    },
  });

  try {
    const encoded = Buffer.from(await bundledServiceSource()).toString('base64');
    const service = await import(`data:text/javascript;base64,${encoded}#calendar-google-ready-${bundleNonce++}`) as unknown as ServiceModule;
    if (options.currentUserId) {
      service.__testUseAuthStore.setState({
        currentUser: {
          id: options.currentUserId,
          name: '테스트 사용자',
          slackId: '',
          isInitialPassword: false,
          createdAt: '2026-08-24T00:00:00.000Z',
        },
      });
    }
    return {
      service,
      broadcasts,
      watchedCalendarIds,
      deletedBflowEventIds,
      deletedLegacyEventIds,
      restore() {
        for (const [key, value] of prior) {
          if (value.exists) globalScope[key] = value.value;
          else delete globalScope[key];
        }
      },
    };
  } catch (error) {
    for (const [key, value] of prior) {
      if (value.exists) globalScope[key] = value.value;
      else delete globalScope[key];
    }
    throw error;
  }
}

test('an empty successful Google full sync is tracked independently from B flow event count', async () => {
  const harness = await createHarness(async () => []);
  try {
    assert.equal(typeof harness.service.isGoogleCacheReady, 'function');
    await harness.service.loadBflowEvents();
    assert.equal(harness.service.isGoogleCacheReady(), false);
    await harness.service.syncAll({ skipBflowLoad: true });
    assert.equal(harness.service.isGoogleCacheReady(), true);
  } finally {
    harness.restore();
  }
});

test('a failed Google full sync remains not ready so Schedule can retry it', async () => {
  const harness = await createHarness(async () => { throw new Error('Google unavailable'); });
  const originalWarn = console.warn;
  try {
    assert.equal(typeof harness.service.isGoogleCacheReady, 'function');
    console.warn = () => {};
    await harness.service.syncAll({ skipBflowLoad: true });
    assert.equal(harness.service.isGoogleCacheReady(), false);
  } finally {
    console.warn = originalWarn;
    harness.restore();
  }
});

test('a later all-calendar failure preserves the last successful Google cache and marks it stale', async () => {
  let attempt = 0;
  const harness = await createHarness(async () => {
    attempt += 1;
    if (attempt === 1) return [googleEvent('cached', '마지막 성공 일정')];
    throw new Error('Google unavailable');
  });
  const originalWarn = console.warn;
  try {
    console.warn = () => {};
    await harness.service.syncAll({ skipBflowLoad: true });
    assert.equal(harness.service.isGoogleCacheReady(), true);

    await harness.service.syncAll({ skipBflowLoad: true });

    assert.equal(harness.service.isGoogleCacheReady(), false);
    const events = await harness.service.getEvents();
    assert.deepEqual(
      events.map(({ id, title, sourceCalendarId }) => ({ id, title, sourceCalendarId })),
      [{ id: 'cached', title: '마지막 성공 일정', sourceCalendarId: 'primary' }],
    );
  } finally {
    console.warn = originalWarn;
    harness.restore();
  }
});

test('a settings lookup failure preserves the last successful Google cache and marks it stale', async () => {
  let failSettingsWrite = false;
  const harness = await createHarness({
    fullSync: async () => [googleEvent('cached', '설정 오류 전 일정')],
    failSettingsWrite: () => failSettingsWrite,
  });
  const originalWarn = console.warn;
  try {
    console.warn = () => {};
    await harness.service.syncAll({ skipBflowLoad: true });
    failSettingsWrite = true;

    await harness.service.syncAll({ skipBflowLoad: true });

    assert.equal(harness.service.isGoogleCacheReady(), false);
    const events = await harness.service.getEvents();
    assert.deepEqual(
      events.map(({ id, title }) => ({ id, title })),
      [{ id: 'cached', title: '설정 오류 전 일정' }],
    );
  } finally {
    console.warn = originalWarn;
    harness.restore();
  }
});

test('a partial sync replaces successful calendars, retains failed calendars, and lets fresh duplicate IDs win', async () => {
  let attempt = 1;
  const harness = await createHarness({
    teamCalendarId: 'team',
    personalCalendarId: 'primary',
    fullSync: async (calendarId) => {
      if (attempt === 1) {
        return calendarId === 'team'
          ? [
              googleEvent('shared', '팀의 이전 중복 일정'),
              googleEvent('team-only', '유지할 팀 일정'),
            ]
          : [googleEvent('primary-old', '교체할 개인 일정')];
      }
      if (calendarId === 'team') throw new Error('team unavailable');
      return [
        googleEvent('shared', '개인의 새 중복 일정'),
        googleEvent('primary-new', '새 개인 일정'),
      ];
    },
  });
  const originalWarn = console.warn;
  try {
    console.warn = () => {};
    await harness.service.syncAll({ skipBflowLoad: true });
    attempt = 2;

    await harness.service.syncAll({ skipBflowLoad: true });

    assert.equal(harness.service.isGoogleCacheReady(), false);
    const events = await harness.service.getEvents();
    assert.deepEqual(
      events.map(({ id, title, sourceCalendarId }) => ({ id, title, sourceCalendarId })),
      [
        { id: 'shared', title: '개인의 새 중복 일정', sourceCalendarId: 'primary' },
        { id: 'primary-new', title: '새 개인 일정', sourceCalendarId: 'primary' },
        { id: 'team-only', title: '유지할 팀 일정', sourceCalendarId: 'team' },
      ],
    );
  } finally {
    console.warn = originalWarn;
    harness.restore();
  }
});

test('a configured-calendar failure retains only that calendar after another calendar is removed from settings', async () => {
  let firstSync = true;
  const harness = await createHarness({
    teamCalendarId: 'team',
    personalCalendarId: 'primary',
    fullSync: async (calendarId) => {
      if (firstSync) {
        return calendarId === 'team'
          ? [googleEvent('team-old', '설정에서 제거할 팀 일정')]
          : [googleEvent('primary-old', '유지할 개인 일정')];
      }
      throw new Error('primary unavailable');
    },
  });
  const originalWarn = console.warn;
  try {
    console.warn = () => {};
    await harness.service.syncAll({ skipBflowLoad: true });
    await harness.service.saveTeamCalendarId(null);
    firstSync = false;

    await harness.service.syncAll({ skipBflowLoad: true });

    assert.equal(harness.service.isGoogleCacheReady(), false);
    const events = await harness.service.getEvents();
    assert.deepEqual(
      events.map(({ id, title, sourceCalendarId }) => ({ id, title, sourceCalendarId })),
      [{ id: 'primary-old', title: '유지할 개인 일정', sourceCalendarId: 'primary' }],
    );
  } finally {
    console.warn = originalWarn;
    harness.restore();
  }
});

test('an older concurrent sync cannot overwrite or rebroadcast a newer completed sync', async () => {
  const firstResult = deferred<GoogleEventFixture[]>();
  const secondResult = deferred<GoogleEventFixture[]>();
  const firstStarted = deferred<void>();
  const secondStarted = deferred<void>();
  let callCount = 0;
  const harness = await createHarness(async () => {
    callCount += 1;
    if (callCount === 1) {
      firstStarted.resolve();
      return firstResult.promise;
    }
    secondStarted.resolve();
    return secondResult.promise;
  });
  try {
    const firstSync = harness.service.syncAll({ skipBflowLoad: true });
    await firstStarted.promise;
    const secondSync = harness.service.syncAll({ skipBflowLoad: true });
    await secondStarted.promise;

    secondResult.resolve([googleEvent('new', '나중 요청의 최신 일정')]);
    await secondSync;
    firstResult.resolve([googleEvent('old', '먼저 요청한 오래된 일정')]);
    await firstSync;

    const events = await harness.service.getEvents();
    assert.deepEqual(
      events.map(({ id, title, sourceCalendarId }) => ({ id, title, sourceCalendarId })),
      [{ id: 'new', title: '나중 요청의 최신 일정', sourceCalendarId: 'primary' }],
    );
    assert.equal(harness.service.isGoogleCacheReady(), true);
    assert.equal(harness.broadcasts.length, 1);
    assert.deepEqual(harness.watchedCalendarIds, ['primary']);
  } finally {
    harness.restore();
  }
});

test('an older default sync cannot overwrite or rebroadcast a newer B flow load', async () => {
  const firstRows = deferred<BflowEventFixture[]>();
  const secondRows = deferred<BflowEventFixture[]>();
  const firstStarted = deferred<void>();
  const secondStarted = deferred<void>();
  let listCallCount = 0;
  const harness = await createHarness({
    fullSync: async () => [],
    bflowEventsList: async () => {
      listCallCount += 1;
      if (listCallCount === 1) {
        firstStarted.resolve();
        return firstRows.promise;
      }
      secondStarted.resolve();
      return secondRows.promise;
    },
  });
  try {
    const firstSync = harness.service.syncAll();
    await firstStarted.promise;
    const secondSync = harness.service.syncAll();
    await secondStarted.promise;

    secondRows.resolve([bflowEvent('new-bflow', '나중 요청의 최신 B flow 일정')]);
    await secondSync;
    const broadcastsAfterNewerSync = harness.broadcasts.length;

    firstRows.resolve([bflowEvent('old-bflow', '먼저 요청한 오래된 B flow 일정')]);
    await firstSync;

    const events = await harness.service.getEvents();
    const expected = [{
      id: 'new-bflow',
      title: '나중 요청의 최신 B flow 일정',
      sourceCalendarId: 'bflow:calendar-1',
    }];
    assert.deepEqual(
      events.map(({ id, title, sourceCalendarId }) => ({ id, title, sourceCalendarId })),
      expected,
    );
    assert.equal(harness.service.isGoogleCacheReady(), true);
    assert.ok(broadcastsAfterNewerSync > 0, 'the current sync still broadcasts its committed changes');
    assert.equal(harness.broadcasts.length, broadcastsAfterNewerSync, 'the stale sync must not rebroadcast');
  } finally {
    harness.restore();
  }
});

test('a newer syncAll B flow load wins against an older standalone load without a stale broadcast', async () => {
  const olderRows = deferred<BflowEventFixture[]>();
  const olderStarted = deferred<void>();
  let listCalls = 0;
  const harness = await createHarness({
    fullSync: async () => [],
    bflowEventsList: async () => {
      listCalls += 1;
      if (listCalls === 1) {
        olderStarted.resolve();
        return olderRows.promise;
      }
      return [bflowEvent('sync-new', '나중 전체 동기화 일정')];
    },
  });
  try {
    const olderStandalone = harness.service.loadBflowEvents();
    await olderStarted.promise;
    await harness.service.syncAll();
    const broadcastsAfterNewerSync = harness.broadcasts.length;

    olderRows.resolve([bflowEvent('standalone-old', '먼저 시작한 단독 로드 일정')]);
    await olderStandalone;

    assert.deepEqual(
      (await harness.service.getEvents()).map(({ id, title }) => ({ id, title })),
      [{ id: 'sync-new', title: '나중 전체 동기화 일정' }],
    );
    assert.ok(broadcastsAfterNewerSync > 0);
    assert.equal(harness.broadcasts.length, broadcastsAfterNewerSync);
  } finally {
    harness.restore();
  }
});

test('a completed B flow delete invalidates an older pending standalone load', async () => {
  const staleRows = deferred<BflowEventFixture[]>();
  const staleLoadStarted = deferred<void>();
  let listCalls = 0;
  const seeded = bflowEvent('delete-me', '삭제할 일정');
  const harness = await createHarness({
    fullSync: async () => [],
    bflowEventsList: async () => {
      listCalls += 1;
      if (listCalls === 1) return [seeded];
      staleLoadStarted.resolve();
      return staleRows.promise;
    },
  });
  try {
    await harness.service.loadBflowEvents();
    const staleLoad = harness.service.loadBflowEvents();
    await staleLoadStarted.promise;

    await harness.service.deleteEvent(seeded.id);
    const broadcastsAfterDelete = harness.broadcasts.length;

    staleRows.resolve([seeded]);
    await staleLoad;

    assert.equal(listCalls, 2);
    assert.deepEqual(await harness.service.getEvents(), []);
    assert.deepEqual(harness.deletedBflowEventIds, [seeded.id]);
    assert.equal(harness.broadcasts.length, broadcastsAfterDelete, 'the stale load must not rebroadcast after delete');
  } finally {
    harness.restore();
  }
});

test('a pending B flow delete rejects a later stale load on both completion orders', async (t) => {
  for (const completionOrder of ['load-first', 'delete-first'] as const) {
    await t.test(completionOrder, async () => {
      const seeded = bflowEvent('pending-delete', '삭제 진행 중인 일정');
      const staleRows = deferred<BflowEventFixture[]>();
      const staleLoadStarted = deferred<void>();
      const deleteStarted = deferred<void>();
      const deleteIpc = deferred<void>();
      let listCalls = 0;
      const harness = await createHarness({
        fullSync: async () => [],
        bflowEventsList: async () => {
          listCalls += 1;
          if (listCalls === 1) return [seeded];
          staleLoadStarted.resolve();
          return staleRows.promise;
        },
        deleteBflowEvent: async () => {
          deleteStarted.resolve();
          await deleteIpc.promise;
        },
      });
      try {
        await harness.service.loadBflowEvents();
        const pendingDelete = harness.service.deleteEvent(seeded.id);
        await deleteStarted.promise;
        assert.deepEqual(await harness.service.getEvents(), [], 'delete is optimistic while IPC is pending');

        const pendingLoad = harness.service.loadBflowEvents();
        await staleLoadStarted.promise;
        const broadcastsAfterOptimisticDelete = harness.broadcasts.length;

        if (completionOrder === 'load-first') {
          staleRows.resolve([seeded]);
          await pendingLoad;
          deleteIpc.resolve();
          await pendingDelete;
        } else {
          deleteIpc.resolve();
          await pendingDelete;
          staleRows.resolve([seeded]);
          await pendingLoad;
        }

        assert.deepEqual(await harness.service.getEvents(), []);
        assert.deepEqual(harness.deletedBflowEventIds, [seeded.id]);
        assert.equal(harness.broadcasts.length, broadcastsAfterOptimisticDelete);
      } finally {
        harness.restore();
      }
    });
  }
});

test('B flow optimistic inserts do not bypass the cache-writer invalidation helper', () => {
  const source = readFileSync('src/services/calendarService.ts', 'utf8');
  assert.doesNotMatch(source, /\bbflowEvents\.push\(/);
});

test('a stale default sync cannot replace the latest legacy-copy tracking used by delete', async (t) => {
  for (const staleOutcome of ['success', 'failure'] as const) {
    await t.test(`stale legacy ${staleOutcome}`, async () => {
      const userId = 'user-1';
      const staleLegacyRows = deferred<LegacyPrivateEventFixture[]>();
      const staleLegacyStarted = deferred<void>();
      let bflowListCalls = 0;
      let legacyReadCalls = 0;
      const harness = await createHarness({
        currentUserId: userId,
        calendarList: async () => [personalCalendar(userId)],
        fullSync: async () => [],
        bflowEventsList: async () => {
          bflowListCalls += 1;
          if (bflowListCalls === 1) return [bflowEvent('old-bflow', '먼저 시작한 예전 개인 일정')];
          return [bflowEvent('new-bflow', '최신 개인 일정')];
        },
        readPrivateEvents: async () => {
          legacyReadCalls += 1;
          if (legacyReadCalls === 1) {
            staleLegacyStarted.resolve();
            return staleLegacyRows.promise;
          }
          if (legacyReadCalls === 2) return [legacyPrivateEvent('new-bflow', userId)];
          throw new Error(`unexpected legacy read: ${legacyReadCalls}`);
        },
      });
      const originalWarn = console.warn;
      try {
        console.warn = () => {};
        const staleSync = harness.service.syncAll();
        await staleLegacyStarted.promise;
        await harness.service.loadBflowEvents();

        if (staleOutcome === 'success') staleLegacyRows.resolve([]);
        else staleLegacyRows.reject(new Error('stale legacy read failed'));
        await staleSync;
        await harness.service.deleteEvent('new-bflow');

        assert.equal(legacyReadCalls, 2, 'delete trusts the latest known legacy snapshot without a stale refresh');
        assert.deepEqual(harness.deletedLegacyEventIds, ['new-bflow']);
        assert.deepEqual(harness.deletedBflowEventIds, ['new-bflow']);
      } finally {
        console.warn = originalWarn;
        harness.restore();
      }
    });
  }
});

test('syncAll broadcast false suppresses both B flow and Google change broadcasts', async () => {
  const harness = await createHarness({
    fullSync: async () => [],
    bflowEventsList: async () => [bflowEvent('quiet-bflow', '알림 없이 반영할 일정')],
  });
  try {
    await harness.service.syncAll({ broadcast: false });

    assert.deepEqual(
      (await harness.service.getEvents()).map(({ id, title }) => ({ id, title })),
      [{ id: 'quiet-bflow', title: '알림 없이 반영할 일정' }],
    );
    assert.deepEqual(harness.broadcasts, []);
  } finally {
    harness.restore();
  }
});

test('a fully successful empty sync clears prior Google rows and marks the cache ready', async () => {
  let returnRows = true;
  const harness = await createHarness(async () => (
    returnRows ? [googleEvent('cached', '지워질 일정')] : []
  ));
  try {
    await harness.service.syncAll({ skipBflowLoad: true });
    returnRows = false;

    await harness.service.syncAll({ skipBflowLoad: true });

    assert.equal(harness.service.isGoogleCacheReady(), true);
    assert.deepEqual(await harness.service.getEvents(), []);
  } finally {
    harness.restore();
  }
});

test('Schedule checks Google readiness after B flow loading and keeps the B flow skip flag', () => {
  const source = readFileSync('src/views/ScheduleView.tsx', 'utf8');
  const effect = source.slice(source.indexOf('// 이벤트 로드 + 외부 변경 구독'), source.indexOf('// 휴가 이벤트 로드'));
  assert.match(effect, /await loadBflowEvents\(\);[\s\S]*if \(!isGoogleCacheReady\(\)\)/);
  assert.match(effect, /isAuthenticated\(\)[\s\S]*syncAll\(\{ skipBflowLoad: true \}\)/);
});
