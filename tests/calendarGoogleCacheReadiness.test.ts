import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { build } from 'esbuild';

type AuthUserFixture = {
  id: string;
  name: string;
  slackId: string;
  isInitialPassword: boolean;
  createdAt: string;
};

type ServiceModule = {
  loadBflowEvents(): Promise<void>;
  syncAll(options?: { broadcast?: boolean; skipBflowLoad?: boolean }): Promise<unknown>;
  addEvent(event: Record<string, unknown>): Promise<void>;
  updateEvent(eventId: string, updates: Record<string, unknown>): Promise<void>;
  getEvents(): Promise<Array<{
    id: string;
    title: string;
    createdBy: string;
    sourceCalendarId?: string;
  }>>;
  deleteEvent(eventId: string): Promise<void>;
  saveTeamCalendarId(calendarId: string | null): Promise<void>;
  isGoogleCacheReady(): boolean;
  __testUseAuthStore: {
    setState(state: {
      currentUser?: AuthUserFixture | null;
      users?: AuthUserFixture[];
    }): void;
  };
  __testUseCalendarStore: {
    getState(): {
      calendars: Array<{ id: string; ownerId: string }>;
      tags: Array<{ id: string }>;
      loaded: boolean;
    };
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
  createBflowEvent?: (input: Record<string, unknown>) => Promise<BflowEventFixture>;
  updateBflowEvent?: (eventId: string, patch: Record<string, unknown>) => Promise<BflowEventFixture>;
  updateLegacyEvent?: (eventId: string, patch: Record<string, unknown>) => Promise<void>;
  updateGoogleEvent?: (calendarId: string, eventId: string, patch: Record<string, unknown>) => Promise<void>;
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
        "export { useCalendarStore as __testUseCalendarStore } from './src/stores/useCalendarStore.ts';",
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
      calendarEventCreate: async (input: Record<string, unknown>) => {
        if (!options.createBflowEvent) throw new Error('unexpected calendarEventCreate');
        return options.createBflowEvent(input);
      },
      calendarEventUpdate: async (eventId: string, patch: Record<string, unknown>) => {
        if (!options.updateBflowEvent) throw new Error('unexpected calendarEventUpdate');
        return options.updateBflowEvent(eventId, patch);
      },
      calendarEventDelete: async (eventId: string) => {
        deletedBflowEventIds.push(eventId);
        await options.deleteBflowEvent?.(eventId);
      },
      calendarBroadcastChange: async (detail: unknown) => {
        broadcasts.push(detail);
        return { ok: true };
      },
      supabaseReadPrivateEvents: options.readPrivateEvents ?? (async () => []),
      supabaseUpdatePrivateEvent: async (eventId: string, patch: Record<string, unknown>) => {
        if (!options.updateLegacyEvent) throw new Error('unexpected supabaseUpdatePrivateEvent');
        await options.updateLegacyEvent(eventId, patch);
      },
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
      gcalUpdateEvent: async (calendarId: string, eventId: string, patch: Record<string, unknown>) => {
        if (!options.updateGoogleEvent) throw new Error('unexpected gcalUpdateEvent');
        await options.updateGoogleEvent(calendarId, eventId, patch);
      },
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

function authUser(id: string, name = `사용자 ${id}`): AuthUserFixture {
  return {
    id,
    name,
    slackId: '',
    isInitialPassword: false,
    createdAt: '2026-08-24T00:00:00.000Z',
  };
}

function calendarEventInput(id: string, title: string): Record<string, unknown> {
  return {
    id,
    title,
    memo: '',
    color: '#6C5CE7',
    type: 'custom',
    startDate: '2026-08-24',
    endDate: '2026-08-24',
    createdBy: 'user-1',
    createdAt: '2026-08-24T00:00:00.000Z',
    calendarId: 'calendar-1',
  };
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

test('B flow creator UUIDs use loaded user names while unknown IDs remain visible as a fallback', async () => {
  const knownCreator = { ...bflowEvent('known-creator', '알려진 작성자 일정'), created_by: 'user-known' };
  const unknownCreator = { ...bflowEvent('unknown-creator', '알 수 없는 작성자 일정'), created_by: 'user-unknown' };
  const harness = await createHarness({
    currentUserId: 'viewer',
    fullSync: async () => [],
    calendarList: async () => [personalCalendar('viewer')],
    bflowEventsList: async () => [knownCreator, unknownCreator],
  });
  try {
    harness.service.__testUseAuthStore.setState({
      users: [authUser('user-known', '배한솔')],
    });

    await harness.service.loadBflowEvents();

    assert.deepEqual(
      (await harness.service.getEvents()).map(({ id, createdBy }) => ({ id, createdBy })),
      [
        { id: 'known-creator', createdBy: '배한솔' },
        { id: 'unknown-creator', createdBy: 'user-unknown' },
      ],
    );
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
      if (listCalls === 2) {
        staleLoadStarted.resolve();
        return staleRows.promise;
      }
      if (listCalls === 3) return [];
      throw new Error(`unexpected calendarEventsList call: ${listCalls}`);
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

    assert.equal(listCalls, 3);
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
          if (listCalls === 2) {
            staleLoadStarted.resolve();
            return staleRows.promise;
          }
          if (listCalls === 3) return [];
          throw new Error(`unexpected calendarEventsList call: ${listCalls}`);
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
        assert.equal(harness.broadcasts.length, broadcastsAfterOptimisticDelete + 1);
      } finally {
        harness.restore();
      }
    });
  }
});

test('a concurrent B flow mutation follows a discarded load with one authoritative reload', async (t) => {
  for (const mutationKind of ['add', 'update', 'delete'] as const) {
    for (const mutationOutcome of ['success', 'failure'] as const) {
      for (const completionOrder of ['load-first', 'mutation-first'] as const) {
        await t.test(`${mutationKind} ${mutationOutcome} ${completionOrder}`, async () => {
          const target = bflowEvent('target', '변경 전 일정');
          const unrelated = bflowEvent('unrelated-a', '함께 보존할 일정 A');
          const created = bflowEvent('created-server', '새 일정');
          const updated = bflowEvent('target', '변경 후 일정');
          let authoritative = [target];
          let listCalls = 0;
          const pendingRows = deferred<BflowEventFixture[]>();
          const pendingLoadStarted = deferred<void>();
          const mutationStarted = deferred<void>();
          const mutationGate = deferred<void>();

          const settleMutation = async () => {
            mutationStarted.resolve();
            await mutationGate.promise;
          };

          const harness = await createHarness({
            currentUserId: 'user-1',
            calendarList: async () => [personalCalendar('user-1')],
            fullSync: async () => [],
            bflowEventsList: async () => {
              listCalls += 1;
              if (listCalls === 1) return [target];
              if (listCalls === 2) {
                pendingLoadStarted.resolve();
                return pendingRows.promise;
              }
              if (listCalls === 3) return authoritative;
              throw new Error(`unexpected calendarEventsList call: ${listCalls}`);
            },
            createBflowEvent: async () => {
              await settleMutation();
              if (mutationOutcome === 'failure') {
                authoritative = [unrelated, target];
                throw new Error(`${mutationKind} failed`);
              }
              authoritative = [unrelated, target, created];
              return created;
            },
            updateBflowEvent: async () => {
              await settleMutation();
              if (mutationOutcome === 'failure') {
                authoritative = [unrelated, target];
                throw new Error(`${mutationKind} failed`);
              }
              authoritative = [unrelated, updated];
              return updated;
            },
            deleteBflowEvent: async () => {
              await settleMutation();
              if (mutationOutcome === 'failure') {
                authoritative = [unrelated, target];
                throw new Error(`${mutationKind} failed`);
              }
              authoritative = [unrelated];
            },
          });

          try {
            await harness.service.loadBflowEvents();
            const pendingLoad = harness.service.loadBflowEvents();
            await pendingLoadStarted.promise;

            const mutationPromise = mutationKind === 'add'
              ? harness.service.addEvent(calendarEventInput('local-created', '새 일정'))
              : mutationKind === 'update'
                ? harness.service.updateEvent(target.id, { title: updated.title })
                : harness.service.deleteEvent(target.id);
            const mutationResult = mutationPromise.then(
              () => ({ error: null as unknown }),
              (error: unknown) => ({ error }),
            );
            await mutationStarted.promise;

            if (completionOrder === 'load-first') {
              const beforeStaleCompletion = harness.broadcasts.length;
              pendingRows.resolve([unrelated, target]);
              await pendingLoad;
              assert.equal(
                harness.broadcasts.length,
                beforeStaleCompletion,
                'discarded load must not broadcast',
              );
              mutationGate.resolve();
              await mutationResult;
            } else {
              mutationGate.resolve();
              await mutationResult;
              const beforeStaleCompletion = harness.broadcasts.length;
              pendingRows.resolve([unrelated, target]);
              await pendingLoad;
              assert.equal(
                harness.broadcasts.length,
                beforeStaleCompletion,
                'late discarded load must not broadcast',
              );
            }

            const { error } = await mutationResult;
            if (mutationOutcome === 'failure') assert.ok(error instanceof Error);
            else assert.equal(error, null);

            const expected = mutationOutcome === 'failure'
              ? [unrelated, target]
              : mutationKind === 'add'
                ? [unrelated, target, created]
                : mutationKind === 'update'
                  ? [unrelated, updated]
                  : [unrelated];
            assert.deepEqual(
              (await harness.service.getEvents()).map(({ id, title }) => ({ id, title })),
              expected.map(({ id, title }) => ({ id, title })),
            );
            assert.equal(listCalls, 3, 'the discarded snapshot is followed by exactly one canonical reload');
          } finally {
            harness.restore();
          }
        });
      }
    }
  }
});

test('overlapping updates reconcile every calendar source to the authoritative completion order', async (t) => {
  const scenarios = [
    {
      name: 'B succeeds before A fails',
      first: 1,
      outcomes: ['failure', 'success'] as const,
      expectedTitle: '수정 B',
    },
    {
      name: 'A fails before B succeeds',
      first: 0,
      outcomes: ['failure', 'success'] as const,
      expectedTitle: '수정 B',
    },
    {
      name: 'both fail',
      first: 1,
      outcomes: ['failure', 'failure'] as const,
      expectedTitle: '수정 전',
    },
    {
      name: 'both succeed in reverse completion order',
      first: 1,
      outcomes: ['success', 'success'] as const,
      expectedTitle: '수정 A',
    },
  ];

  for (const source of ['bflow', 'legacy', 'google'] as const) {
    for (const scenario of scenarios) {
      await t.test(`${source}: ${scenario.name}`, async () => {
        const eventId = `${source}-overlap`;
        let authoritativeBflow = { ...bflowEvent(eventId, '수정 전') };
        let authoritativeLegacy = { ...legacyPrivateEvent(eventId, 'user-1'), title: '수정 전' };
        let authoritativeGoogle = { ...googleEvent(eventId, '수정 전') };
        let updateCallCount = 0;
        let canonicalReadCount = 0;
        const started = [deferred<void>(), deferred<void>()];
        const gates = [deferred<void>(), deferred<void>()];

        const waitForTurn = async (): Promise<number> => {
          const index = updateCallCount;
          updateCallCount += 1;
          assert.ok(index < 2, `unexpected update call: ${updateCallCount}`);
          started[index].resolve();
          await gates[index].promise;
          if (scenario.outcomes[index] === 'failure') throw new Error(`update ${index} failed`);
          return index;
        };

        const harness = await createHarness({
          currentUserId: 'user-1',
          personalCalendarId: 'primary',
          calendarList: async () => [personalCalendar('user-1')],
          bflowEventsList: async () => {
            if (source !== 'bflow') return [];
            canonicalReadCount += 1;
            return [authoritativeBflow];
          },
          readPrivateEvents: async () => {
            if (source !== 'legacy') return [];
            canonicalReadCount += 1;
            return [authoritativeLegacy];
          },
          fullSync: async () => {
            if (source !== 'google') return [];
            canonicalReadCount += 1;
            return [authoritativeGoogle];
          },
          updateBflowEvent: async (_id, patch) => {
            await waitForTurn();
            authoritativeBflow = {
              ...authoritativeBflow,
              title: String(patch.title),
            };
            return authoritativeBflow;
          },
          updateLegacyEvent: async (_id, patch) => {
            await waitForTurn();
            authoritativeLegacy = {
              ...authoritativeLegacy,
              title: String(patch.title),
            };
          },
          updateGoogleEvent: async (_calendarId, _id, patch) => {
            await waitForTurn();
            authoritativeGoogle = {
              ...authoritativeGoogle,
              summary: String(patch.summary),
            };
          },
        });

        try {
          if (source === 'google') await harness.service.syncAll({ skipBflowLoad: true });
          else await harness.service.loadBflowEvents();

          const updates = [
            harness.service.updateEvent(eventId, { title: '수정 A' }),
            undefined as Promise<void> | undefined,
          ];
          await started[0].promise;
          updates[1] = harness.service.updateEvent(eventId, { title: '수정 B' });
          await started[1].promise;
          assert.equal(
            (await harness.service.getEvents()).find(({ id }) => id === eventId)?.title,
            '수정 B',
            'the second edit is visible before either write settles',
          );

          const settled = updates.map((promise) => promise!.then(
            () => null,
            (error: unknown) => error,
          ));
          const second = scenario.first === 0 ? 1 : 0;
          gates[scenario.first].resolve();
          await settled[scenario.first];
          gates[second].resolve();
          const results = await Promise.all(settled);

          assert.equal(results[0] instanceof Error, scenario.outcomes[0] === 'failure');
          assert.equal(results[1] instanceof Error, scenario.outcomes[1] === 'failure');
          assert.equal(
            (await harness.service.getEvents()).find(({ id }) => id === eventId)?.title,
            scenario.expectedTitle,
          );
          assert.equal(canonicalReadCount, 2, 'one initial load plus one coalesced reconciliation');
        } finally {
          harness.restore();
        }
      });
    }
  }
});

test('switching users clears B flow cache and metadata before the new user load can fail', async () => {
  let activeUserId = 'user-a';
  let failLoads = false;
  const harness = await createHarness({
    currentUserId: activeUserId,
    calendarList: async () => {
      if (failLoads) throw new Error('calendar list unavailable');
      return [personalCalendar(activeUserId)];
    },
    fullSync: async () => [],
    bflowEventsList: async () => {
      if (failLoads) throw new Error('event list unavailable');
      return [bflowEvent(`event-${activeUserId}`, `개인 일정 ${activeUserId}`)];
    },
  });
  const originalWarn = console.warn;
  try {
    await harness.service.loadBflowEvents();
    assert.deepEqual((await harness.service.getEvents()).map(({ id }) => id), ['event-user-a']);
    assert.deepEqual(harness.service.__testUseCalendarStore.getState().calendars.map(({ ownerId }) => ownerId), ['user-a']);

    activeUserId = 'user-b';
    failLoads = true;
    harness.service.__testUseAuthStore.setState({ currentUser: authUser(activeUserId) });

    assert.deepEqual(await harness.service.getEvents(), [], 'A rows are hidden synchronously on auth switch');
    assert.deepEqual(
      harness.service.__testUseCalendarStore.getState().calendars,
      [],
      'A calendar metadata is hidden synchronously on auth switch',
    );

    console.warn = () => {};
    await harness.service.loadBflowEvents();
    assert.deepEqual(await harness.service.getEvents(), []);
    assert.deepEqual(harness.service.__testUseCalendarStore.getState().calendars, []);
  } finally {
    console.warn = originalWarn;
    harness.restore();
  }
});

test('a stale user A load cannot commit or broadcast after auth switches to user B', async () => {
  const staleRows = deferred<BflowEventFixture[]>();
  const staleEventsStarted = deferred<void>();
  const harness = await createHarness({
    currentUserId: 'user-a',
    calendarList: async () => [personalCalendar('user-a')],
    fullSync: async () => [],
    bflowEventsList: async () => {
      staleEventsStarted.resolve();
      return staleRows.promise;
    },
  });
  try {
    const staleLoad = harness.service.loadBflowEvents();
    await staleEventsStarted.promise;
    harness.service.__testUseAuthStore.setState({ currentUser: authUser('user-b') });
    const broadcastsAfterSwitch = harness.broadcasts.length;

    assert.deepEqual(await harness.service.getEvents(), []);
    assert.deepEqual(harness.service.__testUseCalendarStore.getState().calendars, []);

    staleRows.resolve([bflowEvent('user-a-private', 'A의 개인 일정')]);
    await staleLoad;

    assert.deepEqual(await harness.service.getEvents(), []);
    assert.deepEqual(harness.service.__testUseCalendarStore.getState().calendars, []);
    assert.equal(harness.broadcasts.length, broadcastsAfterSwitch);
  } finally {
    harness.restore();
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
