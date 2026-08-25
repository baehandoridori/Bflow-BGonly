import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { build, type Plugin } from 'esbuild';
import {
  broadcastCommittedCalendarDeleteToWindows,
  isCommittedCalendarDeleteMarker,
  relayIncomingCommittedCalendarDeleteToWindows,
} from '../electron/calendarWindowFanout.ts';
import { deleteGoogleEventWithCommittedMarker } from '../electron/googleCalendarDeleteBoundary.ts';

type Handler = (_event: unknown, ...args: unknown[]) => Promise<unknown>;

type IpcHarnessState = {
  handlers: Map<string, Handler>;
  store: Record<string, (...args: unknown[]) => unknown>;
  broadcasts: Array<{ kind: 'data' | 'calendar'; args: unknown[] }>;
  committedDeleteMarkers: unknown[];
  broadcastFailure: { data: boolean; calendar: boolean };
};

type CalendarIpcExternalDeps = {
  createLegacyPrivateEvent?: (input: Record<string, unknown>, actorId: string) => Promise<{ id: string }>;
  deleteLegacyPrivateEvent?: (eventId: string, actorId: string) => Promise<void>;
  deleteLegacyPrivateSourceEvent?: (
    eventId: string,
    actorId: string,
  ) => Promise<'deleted' | 'missing'>;
  getLegacyPrivateEventOwner?: (eventId: string) => Promise<string | null>;
  createGoogleEvent?: (calendarId: string, input: unknown, actorId: string) => Promise<string>;
  deleteGoogleEvent?: (calendarId: string, eventId: string, actorId: string) => Promise<void>;
  getGoogleEvent?: (calendarId: string, eventId: string, actorId: string) => Promise<{ id: string } | null>;
  onCommittedReplacementDelete?: (payload: unknown) => void;
};

const IPC_HARNESS_KEY = '__calendarIpcBehaviorHarness';
const STORE_HARNESS_KEY = '__calendarStoreStrictReadHarness';
const SUPABASE_PRIVATE_HARNESS_KEY = '__calendarSupabasePrivateHarness';
let ipcBundle: Promise<string> | undefined;
let ipcNonce = 0;
let storeBundle: Promise<string> | undefined;
let storeNonce = 0;
let supabasePrivateBundle: Promise<string> | undefined;
let supabasePrivateNonce = 0;

const storeFunctionNames = [
  'getUserRole',
  'ensurePersonalCalendar',
  'listCalendarsWithMembers',
  'getCalendarWithMembers',
  'createCalendar',
  'updateCalendar',
  'deleteCalendar',
  'replaceMembers',
  'listEventsInRange',
  'getEventById',
  'getEventByIdForWrite',
  'createEvent',
  'updateEvent',
  'deleteEvent',
  'deletePrivacyReplacementEvent',
  'listTags',
  'saveTags',
  'listUnreadNotifications',
  'markNotificationsRead',
] as const;

function calendarIpcTestPlugin(): Plugin {
  return {
    name: 'calendar-ipc-test-dependencies',
    setup(builder) {
      builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'calendar-ipc-test' }));
      builder.onResolve({ filter: /^\.\/calendarStore$/ }, () => ({ path: 'store', namespace: 'calendar-ipc-test' }));
      builder.onResolve({ filter: /^\.\/broadcast$/ }, () => ({ path: 'broadcast', namespace: 'calendar-ipc-test' }));
      builder.onLoad({ filter: /^electron$/, namespace: 'calendar-ipc-test' }, () => ({
        contents: `export const ipcMain = { handle(channel, handler) { globalThis.${IPC_HARNESS_KEY}.handlers.set(channel, handler); } };`,
      }));
      builder.onLoad({ filter: /^store$/, namespace: 'calendar-ipc-test' }, () => ({
        contents: storeFunctionNames.map((name) => (
          `export const ${name} = (...args) => globalThis.${IPC_HARNESS_KEY}.store.${name}(...args);`
        )).join('\n'),
      }));
      builder.onLoad({ filter: /^broadcast$/, namespace: 'calendar-ipc-test' }, () => ({
        contents: [
          `export const broadcastDataChange = (...args) => { const state = globalThis.${IPC_HARNESS_KEY}; if (state.broadcastFailure.data) throw new Error('data broadcast channel closed'); state.broadcasts.push({ kind: 'data', args }); };`,
          `export const broadcastCalendarChanged = (...args) => { const state = globalThis.${IPC_HARNESS_KEY}; if (state.broadcastFailure.calendar) throw new Error('calendar broadcast channel closed'); state.broadcasts.push({ kind: 'calendar', args }); };`,
          `export const broadcastCalendarCommittedDelete = (...args) => globalThis.${IPC_HARNESS_KEY}.broadcasts.push({ kind: 'calendar', args });`,
        ].join('\n'),
      }));
    },
  };
}

async function bundledCalendarIpcSource(): Promise<string> {
  ipcBundle ??= build({
    stdin: {
      contents: "export { registerCalendarIpc } from './electron/calendarIpc.ts';",
      resolveDir: process.cwd(),
      sourcefile: 'calendar-ipc-behavior-entry.ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    plugins: [calendarIpcTestPlugin()],
    write: false,
  }).then((result) => result.outputFiles[0].text);
  return ipcBundle;
}

function calendarSupabasePrivateTestPlugin(): Plugin {
  return {
    name: 'calendar-supabase-private-test-dependencies',
    setup(builder) {
      builder.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({
        path: 'supabase-client',
        namespace: 'calendar-supabase-private-test',
      }));
      builder.onResolve({ filter: /^ws$/ }, () => ({
        path: 'ws',
        namespace: 'calendar-supabase-private-test',
      }));
      builder.onResolve({ filter: /^\.\/broadcast$/ }, () => ({
        path: 'broadcast',
        namespace: 'calendar-supabase-private-test',
      }));
      builder.onResolve({ filter: /^\.\/storage$/ }, () => ({
        path: 'storage',
        namespace: 'calendar-supabase-private-test',
      }));
      builder.onResolve({ filter: /^\.\/retry-utils$/ }, () => ({
        path: 'retry-utils',
        namespace: 'calendar-supabase-private-test',
      }));
      builder.onLoad({ filter: /^supabase-client$/, namespace: 'calendar-supabase-private-test' }, () => ({
        contents: `export const createClient = () => globalThis.${SUPABASE_PRIVATE_HARNESS_KEY}.client;`,
      }));
      builder.onLoad({ filter: /^ws$/, namespace: 'calendar-supabase-private-test' }, () => ({
        contents: 'export default class WebSocket {}',
      }));
      builder.onLoad({ filter: /^broadcast$/, namespace: 'calendar-supabase-private-test' }, () => ({
        contents: [
          'broadcastSceneUpdate',
          'broadcastSceneFieldUpdate',
          'broadcastScenePhaseUpdate',
          'broadcastDataChange',
          'broadcastCommentAdded',
          'broadcastCalendarChanged',
          'broadcastCommentReactionChanged',
          'broadcastCommentReactionNotification',
          'broadcastCommentReactionNotificationRemoved',
          'broadcastActivityRemoved',
        ].map((name) => `export const ${name} = () => {};`).join('\n'),
      }));
      builder.onLoad({ filter: /^storage$/, namespace: 'calendar-supabase-private-test' }, () => ({
        contents: 'export const deleteImage = async () => {};',
      }));
      builder.onLoad({ filter: /^retry-utils$/, namespace: 'calendar-supabase-private-test' }, () => ({
        contents: 'export const createRetryManager = () => ({ run: async (fn) => fn(), reset: () => {} });',
      }));
    },
  };
}

async function bundledCalendarSupabasePrivateSource(): Promise<string> {
  supabasePrivateBundle ??= build({
    stdin: {
      contents: "export * from './electron/supabase.ts';",
      resolveDir: process.cwd(),
      sourcefile: 'calendar-supabase-private-entry.ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    plugins: [calendarSupabasePrivateTestPlugin()],
    write: false,
  }).then((result) => result.outputFiles[0].text);
  return supabasePrivateBundle;
}

async function loadCalendarSupabasePrivateModule(client: unknown): Promise<{
  addPrivateEvent(input: Record<string, unknown>): Promise<unknown>;
  updatePrivateEvent(eventId: string, updates: Record<string, unknown>): Promise<void>;
  deletePrivateEventForOwner?: (eventId: string, ownerId: string) => Promise<void>;
  deletePrivateEventForOwnerIfPresent?: (
    eventId: string,
    ownerId: string,
  ) => Promise<'deleted' | 'missing'>;
}> {
  const globalScope = globalThis as Record<string, unknown>;
  globalScope[SUPABASE_PRIVATE_HARNESS_KEY] = { client };
  const encoded = Buffer.from(await bundledCalendarSupabasePrivateSource()).toString('base64');
  return import(
    `data:text/javascript;base64,${encoded}#calendar-supabase-private-${supabasePrivateNonce++}`
  ) as Promise<{
    addPrivateEvent(input: Record<string, unknown>): Promise<unknown>;
    updatePrivateEvent(eventId: string, updates: Record<string, unknown>): Promise<void>;
    deletePrivateEventForOwner?: (eventId: string, ownerId: string) => Promise<void>;
    deletePrivateEventForOwnerIfPresent?: (
      eventId: string,
      ownerId: string,
    ) => Promise<'deleted' | 'missing'>;
  }>;
}

function defaultStore(): IpcHarnessState['store'] {
  const unexpected = (name: string) => async () => { throw new Error(`unexpected store call: ${name}`); };
  return Object.fromEntries(storeFunctionNames.map((name) => [name, unexpected(name)]));
}

async function createIpcHarness(
  overrides: Partial<IpcHarnessState['store']> = {},
  userId: string | (() => string) = 'user-1',
  externalDeps: CalendarIpcExternalDeps = {},
): Promise<IpcHarnessState & {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  invokeAs(senderId: number, channel: string, ...args: unknown[]): Promise<unknown>;
  restore(): void;
}> {
  const globalScope = globalThis as Record<string, unknown>;
  const hadPrior = Object.prototype.hasOwnProperty.call(globalScope, IPC_HARNESS_KEY);
  const prior = globalScope[IPC_HARNESS_KEY];
  const state: IpcHarnessState = {
    handlers: new Map(),
    store: { ...defaultStore(), ...overrides },
    broadcasts: [],
    committedDeleteMarkers: [],
    broadcastFailure: { data: false, calendar: false },
  };
  globalScope[IPC_HARNESS_KEY] = state;
  try {
    const encoded = Buffer.from(await bundledCalendarIpcSource()).toString('base64');
    const module = await import(`data:text/javascript;base64,${encoded}#calendar-ipc-${ipcNonce++}`) as {
      registerCalendarIpc(deps: { getSessionUserIdOrThrow(): string }): void;
    };
    module.registerCalendarIpc({
      getSessionUserIdOrThrow: () => typeof userId === 'function' ? userId() : userId,
      createLegacyPrivateEvent: externalDeps.createLegacyPrivateEvent ?? (async () => {
        throw new Error('unexpected legacy private replacement create');
      }),
      deleteLegacyPrivateEvent: externalDeps.deleteLegacyPrivateEvent ?? (async () => {
        throw new Error('unexpected legacy private replacement delete');
      }),
      deleteLegacyPrivateSourceEvent: externalDeps.deleteLegacyPrivateSourceEvent ?? (async () => {
        throw new Error('unexpected legacy private source delete');
      }),
      getLegacyPrivateEventOwner: externalDeps.getLegacyPrivateEventOwner ?? (async () => {
        throw new Error('unexpected legacy private source read');
      }),
      createGoogleEvent: externalDeps.createGoogleEvent ?? (async () => {
        throw new Error('unexpected Google replacement create');
      }),
      deleteGoogleEvent: externalDeps.deleteGoogleEvent ?? (async () => {
        throw new Error('unexpected Google replacement delete');
      }),
      getGoogleEvent: externalDeps.getGoogleEvent ?? (async () => {
        throw new Error('unexpected Google source read');
      }),
      onCommittedReplacementDelete: (payload: unknown) => {
        state.committedDeleteMarkers.push(payload);
        externalDeps.onCommittedReplacementDelete?.(payload);
      },
    });
    const invokeAs = async (senderId: number, channel: string, ...args: unknown[]) => {
      const handler = state.handlers.get(channel);
      assert.ok(handler, `missing IPC handler: ${channel}`);
      return handler({ sender: { id: senderId } }, ...args);
    };
    return {
      ...state,
      async invoke(channel, ...args) {
        return invokeAs(101, channel, ...args);
      },
      invokeAs,
      restore() {
        if (hadPrior) globalScope[IPC_HARNESS_KEY] = prior;
        else delete globalScope[IPC_HARNESS_KEY];
      },
    };
  } catch (error) {
    if (hadPrior) globalScope[IPC_HARNESS_KEY] = prior;
    else delete globalScope[IPC_HARNESS_KEY];
    throw error;
  }
}

function calendarRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'calendar-1',
    name: '테스트 캘린더',
    color: '#6C5CE7',
    visibility: 'private',
    owner_id: 'user-1',
    is_personal: false,
    created_at: '2026-08-24T00:00:00.000Z',
    updated_at: '2026-08-24T00:00:00.000Z',
    ...overrides,
  };
}

function calendarEventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    calendar_id: 'calendar-1',
    title: '테스트 일정',
    memo: null,
    tag_id: null,
    all_day: true,
    start_date: '2026-08-25',
    end_date: '2026-08-25',
    start_time: null,
    end_time: null,
    linked_episode: null,
    linked_part: null,
    linked_sheet_name: null,
    linked_scene_id: null,
    linked_department: null,
    linked_todo_id: null,
    created_by: 'user-1',
    created_at: '2026-08-24T00:00:00.000Z',
    updated_at: '2026-08-24T00:00:00.000Z',
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

test('deleted session users cannot reach any actor-bound calendar IPC operation', async (t) => {
  const eventInput = {
    calendar_id: 'calendar-1', title: '삭제 사용자 일정', memo: null, tag_id: null,
    all_day: true, start_date: '2026-08-26', end_date: '2026-08-26',
    start_time: null, end_time: null, linked_episode: null, linked_part: null,
    linked_sheet_name: null, linked_scene_id: null, linked_department: null,
    linked_todo_id: null,
  };
  const legacyInput = {
    title: '삭제 사용자 비공개 일정', memo: '', color: '#6C5CE7', type: 'custom',
    start_date: '2026-08-26', end_date: '2026-08-26', linked_episode: null,
    linked_part: null, linked_sheet_name: null, linked_scene_id: null,
    linked_department: null, linked_todo_id: null, created_by: '표시 이름',
  };
  const googleInput = {
    summary: '삭제 사용자 구글 일정', description: '', startDate: '2026-08-26',
    endDate: '2026-08-27', extendedProperties: { bflow_type: 'custom' },
    visibility: 'default',
  };
  const scenarios = [
    { name: 'calendar list', channel: 'calendar:list', args: [] },
    {
      name: 'calendar create',
      channel: 'calendar:create',
      args: [{ name: '공유', color: '#6C5CE7', visibility: 'members' }],
    },
    { name: 'calendar update', channel: 'calendar:update', args: ['calendar-1', { name: '수정' }] },
    { name: 'calendar delete', channel: 'calendar:delete', args: ['calendar-1'] },
    { name: 'calendar members write', channel: 'calendar:set-members', args: ['calendar-1', []] },
    { name: 'event list', channel: 'calendar:events:list', args: [{}] },
    { name: 'event create', channel: 'calendar:events:create', args: [eventInput] },
    { name: 'event update', channel: 'calendar:events:update', args: ['event-1', { title: '수정' }] },
    { name: 'event delete', channel: 'calendar:events:delete', args: ['event-1'] },
    {
      name: 'privacy source delete',
      channel: 'calendar:privacy-migration:delete-source',
      args: ['event-1'],
    },
    { name: 'tag list', channel: 'calendar:tags:list', args: [] },
    { name: 'tag write', channel: 'calendar:tags:save', args: [[]] },
    { name: 'notification catchup', channel: 'calendar:notifications:catchup', args: [] },
    { name: 'notification mark read', channel: 'calendar:notifications:mark-read', args: [[]] },
    {
      name: 'B flow privacy replacement create',
      channel: 'calendar:privacy-migration:create-replacement',
      args: [{ storage: 'bflow', event: eventInput }],
    },
    {
      name: 'legacy privacy replacement create',
      channel: 'calendar:privacy-migration:create-replacement',
      args: [{ storage: 'legacy-private', event: legacyInput }],
    },
    {
      name: 'Google privacy replacement create',
      channel: 'calendar:privacy-migration:create-replacement',
      args: [{ storage: 'google', calendar_id: 'primary', event: googleInput }],
    },
  ] as const;
  const originalError = console.error;
  try {
    console.error = () => {};
    for (const scenario of scenarios) {
      await t.test(scenario.name, async () => {
        let downstreamCalls = 0;
        let replacementCreateCalls = 0;
        const downstream = async () => {
          downstreamCalls += 1;
          throw new Error('actor-bound downstream was reached');
        };
        const harness = await createIpcHarness({
          getUserRole: async () => {
            throw new Error('캘린더 사용자 세션이 더 이상 유효하지 않습니다');
          },
          ensurePersonalCalendar: downstream,
          listCalendarsWithMembers: downstream,
          getCalendarWithMembers: downstream,
          createCalendar: downstream,
          updateCalendar: downstream,
          deleteCalendar: downstream,
          replaceMembers: downstream,
          listEventsInRange: downstream,
          getEventByIdForWrite: downstream,
          createEvent: downstream,
          updateEvent: downstream,
          deleteEvent: downstream,
          listTags: downstream,
          saveTags: downstream,
          listUnreadNotifications: downstream,
          markNotificationsRead: downstream,
        }, 'deleted-user', {
          createLegacyPrivateEvent: async () => {
            replacementCreateCalls += 1;
            return { id: 'orphan-legacy-event' };
          },
          createGoogleEvent: async () => {
            replacementCreateCalls += 1;
            return 'orphan-google-event';
          },
        });
        try {
          await assert.rejects(
            harness.invoke(scenario.channel, ...scenario.args),
            /캘린더 사용자 세션이 더 이상 유효하지 않습니다/,
          );
          assert.equal(downstreamCalls, 0);
          assert.equal(replacementCreateCalls, 0);
          assert.deepEqual(harness.broadcasts, []);
        } finally {
          harness.restore();
        }
      });
    }
  } finally {
    console.error = originalError;
  }
});

test('calendar:list waits for personal calendar ensure before listing calendars', async () => {
  let releaseEnsure!: () => void;
  const ensureGate = new Promise<void>((resolve) => { releaseEnsure = resolve; });
  const order: string[] = [];
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
    ensurePersonalCalendar: async () => {
      order.push('ensure');
      await ensureGate;
    },
    listCalendarsWithMembers: async () => {
      order.push('list');
      return { calendars: [calendarRow({ is_personal: true })], members: [] };
    },
  });
  try {
    const listing = harness.invoke('calendar:list');
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(order, ['ensure']);

    releaseEnsure();
    const rows = await listing as Array<{ id: string; is_personal: boolean }>;
    assert.deepEqual(order, ['ensure', 'list']);
    assert.equal(rows[0]?.is_personal, true);
  } finally {
    harness.restore();
  }
});

test('calendar:list propagates personal calendar provisioning failures before listing', async () => {
  let listCalls = 0;
  const originalError = console.error;
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
    ensurePersonalCalendar: async () => { throw new Error('temporary personal calendar insert failure'); },
    listCalendarsWithMembers: async () => {
      listCalls += 1;
      return { calendars: [], members: [] };
    },
  });
  try {
    console.error = () => {};
    await assert.rejects(
      harness.invoke('calendar:list'),
      /temporary personal calendar insert failure/,
    );
    assert.equal(listCalls, 0);
  } finally {
    console.error = originalError;
    harness.restore();
  }
});

test('event listing delegates actor visibility and the date range to one atomic store read', async () => {
  const listEventCalls: unknown[][] = [];
  let calendarListCalls = 0;
  const calendars = [
    calendarRow({ id: 'team-calendar', visibility: 'team', owner_id: 'admin-1' }),
    calendarRow({ id: 'private-other', visibility: 'private', owner_id: 'other-user' }),
  ];
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
    ensurePersonalCalendar: async () => {},
    listCalendarsWithMembers: async () => {
      calendarListCalls += 1;
      return { calendars, members: [] };
    },
    listEventsInRange: async (...args) => {
      listEventCalls.push(args);
      return [calendarEventRow({ calendar_id: 'team-calendar' })];
    },
  }, 'real-user');
  try {
    const visibleCalendars = await harness.invoke('calendar:list') as Array<{ id: string }>;
    assert.deepEqual(visibleCalendars.map(({ id }) => id), ['team-calendar']);

    const events = await harness.invoke('calendar:events:list', {
      from: '2026-08-01',
      to: '2026-08-31',
    }) as Array<{ calendar_id: string }>;
    assert.deepEqual(events.map(({ calendar_id }) => calendar_id), ['team-calendar']);
    assert.equal(calendarListCalls, 1, 'event reads must not precompute visibility in a separate request');
    assert.deepEqual(listEventCalls, [[{
      actorId: 'real-user',
      from: '2026-08-01',
      to: '2026-08-31',
    }]]);
  } finally {
    harness.restore();
  }
});

test('calendar:create rejects invalid or boxed visibility before persistence', async () => {
  let createCalls = 0;
  const originalError = console.error;
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
    createCalendar: async () => {
      createCalls += 1;
      return calendarRow();
    },
  });
  try {
    console.error = () => {};
    for (const visibility of ['bogus', new String('team')]) {
      await assert.rejects(
        harness.invoke('calendar:create', { name: 'X', color: '#000000', visibility }),
        /공개 범위|visibility/i,
      );
    }
    assert.equal(createCalls, 0);
  } finally {
    console.error = originalError;
    harness.restore();
  }
});

test('calendar:update rejects invalid or boxed visibility before persistence', async () => {
  let updateCalls = 0;
  const originalError = console.error;
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
    getCalendarWithMembers: async () => ({ calendar: calendarRow(), members: [] }),
    updateCalendar: async () => { updateCalls += 1; },
  });
  try {
    console.error = () => {};
    for (const visibility of ['bogus', new String('team')]) {
      await assert.rejects(
        harness.invoke('calendar:update', 'calendar-1', { visibility }),
        /공개 범위|visibility/i,
      );
    }
    assert.equal(updateCalls, 0);
  } finally {
    console.error = originalError;
    harness.restore();
  }
});

test('calendar:set-members rejects non-arrays and non-primitive member fields without side effects', async () => {
  let replaceCalls = 0;
  const originalError = console.error;
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
    getCalendarWithMembers: async () => ({
      calendar: calendarRow({ visibility: 'members' }),
      members: [],
    }),
    replaceMembers: async () => { replaceCalls += 1; },
  });
  try {
    console.error = () => {};
    const invalidMembers = [
      null,
      {},
      [null],
      [{ user_id: '', can_edit: true }],
      [{ user_id: new String('user-2'), can_edit: true }],
      [{ user_id: 'user-2', can_edit: new Boolean(true) }],
    ];
    for (const members of invalidMembers) {
      await assert.rejects(
        harness.invoke('calendar:set-members', 'calendar-1', members),
        /캘린더 멤버 입력이 올바르지 않습니다/,
      );
    }
    assert.equal(replaceCalls, 0);
    assert.deepEqual(harness.broadcasts, []);
  } finally {
    console.error = originalError;
    harness.restore();
  }
});

test('calendar:set-members filters the owner and strips extra fields before replacement', async () => {
  const replacements: unknown[][] = [];
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
    getCalendarWithMembers: async () => ({
      calendar: calendarRow({ visibility: 'members' }),
      members: [],
    }),
    replaceMembers: async (...args) => { replacements.push(args); },
  });
  try {
    await harness.invoke('calendar:set-members', 'calendar-1', [
      { user_id: 'user-1', can_edit: true, role: 'owner-spoof' },
      { user_id: 'user-2', can_edit: false, role: 'admin-spoof' },
    ]);
    assert.deepEqual(replacements, [[
      'calendar-1',
      [{ user_id: 'user-2', can_edit: false }],
      'user-1',
    ]]);
    assert.deepEqual(harness.broadcasts, [
      { kind: 'data', args: ['calendar_members', 'UPDATE'] },
      { kind: 'calendar', args: ['UPDATE'] },
    ]);
  } finally {
    harness.restore();
  }
});

test('calendar management writes bind update and delete to the main session actor', async () => {
  const updates: unknown[][] = [];
  const deletions: unknown[][] = [];
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
    getCalendarWithMembers: async () => ({
      calendar: calendarRow({ visibility: 'members', owner_id: 'session-user' }),
      members: [],
    }),
    updateCalendar: async (...args) => { updates.push(args); },
    deleteCalendar: async (...args) => { deletions.push(args); },
  }, 'session-user');
  try {
    await harness.invoke('calendar:update', 'calendar-1', { name: '새 이름' });
    await harness.invoke('calendar:delete', 'calendar-1');

    assert.deepEqual(updates, [[
      'calendar-1',
      { name: '새 이름' },
      'session-user',
    ]]);
    assert.deepEqual(deletions, [['calendar-1', 'session-user']]);
  } finally {
    harness.restore();
  }
});

test('calendar management RPC permission and missing-row errors never broadcast success', async () => {
  const originalError = console.error;
  const scenarios = [
    {
      channel: 'calendar:update',
      args: ['calendar-1', { name: '거부됨' }],
      override: { updateCalendar: async () => { throw new Error('42501 update denied'); } },
      expected: /42501 update denied/,
    },
    {
      channel: 'calendar:delete',
      args: ['calendar-1'],
      override: { deleteCalendar: async () => { throw new Error('23503 calendar missing'); } },
      expected: /23503 calendar missing/,
    },
    {
      channel: 'calendar:set-members',
      args: ['calendar-1', [{ user_id: 'user-2', can_edit: false }]],
      override: { replaceMembers: async () => { throw new Error('42501 members denied'); } },
      expected: /42501 members denied/,
    },
  ] as const;
  try {
    console.error = () => {};
    for (const scenario of scenarios) {
      const harness = await createIpcHarness({
        getUserRole: async () => 'user',
        getCalendarWithMembers: async () => ({
          calendar: calendarRow({ visibility: 'members' }),
          members: [],
        }),
        ...scenario.override,
      });
      try {
        await assert.rejects(
          harness.invoke(scenario.channel, ...scenario.args),
          scenario.expected,
        );
        assert.deepEqual(harness.broadcasts, []);
      } finally {
        harness.restore();
      }
    }
  } finally {
    console.error = originalError;
  }
});

test('calendar:create keeps omitted members equivalent to an empty member list', async () => {
  const createCalls: unknown[][] = [];
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
    createCalendar: async (...args) => {
      createCalls.push(args);
      return calendarRow({ visibility: 'members' });
    },
  });
  try {
    await harness.invoke('calendar:create', {
      name: '공유 캘린더',
      color: '#6C5CE7',
      visibility: 'members',
    });
    assert.deepEqual(createCalls, [[
      { name: '공유 캘린더', color: '#6C5CE7', visibility: 'members' },
      [],
      'user-1',
    ]]);
    assert.deepEqual(harness.broadcasts, [
      { kind: 'data', args: ['calendars', 'INSERT'] },
      { kind: 'calendar', args: ['INSERT'] },
    ]);
  } finally {
    harness.restore();
  }
});

test('calendar:create atomically passes only safe calendar fields, members, and the session actor', async () => {
  const createCalls: unknown[][] = [];
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
    createCalendar: async (...args) => {
      createCalls.push(args);
      return calendarRow({ visibility: 'members' });
    },
  });
  try {
    await harness.invoke('calendar:create', {
      id: 'spoofed-calendar',
      name: '원자 생성',
      color: '#74B9FF',
      visibility: 'members',
      owner_id: 'spoofed-owner',
      actor_id: 'spoofed-actor',
      is_personal: true,
      members: [
        { user_id: 'user-1', can_edit: true, role: 'owner-spoof' },
        { user_id: 'user-2', can_edit: false, role: 'admin-spoof' },
      ],
    });

    assert.deepEqual(createCalls, [[
      { name: '원자 생성', color: '#74B9FF', visibility: 'members' },
      [{ user_id: 'user-2', can_edit: false }],
      'user-1',
    ]]);
    assert.deepEqual(harness.broadcasts, [
      { kind: 'data', args: ['calendars', 'INSERT'] },
      { kind: 'calendar', args: ['INSERT'] },
    ]);
  } finally {
    harness.restore();
  }
});

test('calendar:create does not broadcast when the atomic create RPC rejects', async () => {
  const originalError = console.error;
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
    createCalendar: async () => { throw new Error('23503 initial member does not exist'); },
  });
  try {
    console.error = () => {};
    await assert.rejects(
      harness.invoke('calendar:create', {
        name: '실패 캘린더',
        color: '#6C5CE7',
        visibility: 'members',
        members: [{ user_id: 'missing-user', can_edit: true }],
      }),
      /23503 initial member does not exist/,
    );
    assert.deepEqual(harness.broadcasts, []);
  } finally {
    console.error = originalError;
    harness.restore();
  }
});

test('calendar:tags:save binds the final list to the session actor and broadcasts only after success', async () => {
  const saveCalls: unknown[][] = [];
  const tags = [{ id: 'tag-1', name: '회의', color: '#A29BFE', sort_order: 0 }];
  const harness = await createIpcHarness({
    getUserRole: async () => 'admin',
    saveTags: async (...args) => {
      saveCalls.push(args);
      return tags;
    },
  }, 'session-admin');
  try {
    assert.deepEqual(await harness.invoke('calendar:tags:save', [
      { ...tags[0], actor_id: 'spoofed-admin', ignored: true },
    ]), tags);
    assert.deepEqual(saveCalls, [[tags, 'session-admin']]);
    assert.deepEqual(harness.broadcasts, [
      { kind: 'data', args: ['calendar_tags', 'UPDATE'] },
      { kind: 'calendar', args: ['UPDATE'] },
    ]);

    harness.broadcasts.length = 0;
    harness.store.saveTags = async () => { throw new Error('tag actor was demoted'); };
    const originalError = console.error;
    try {
      console.error = () => {};
      await assert.rejects(
        harness.invoke('calendar:tags:save', tags),
        /tag actor was demoted/,
      );
    } finally {
      console.error = originalError;
    }
    assert.deepEqual(harness.broadcasts, []);
  } finally {
    harness.restore();
  }
});

test('ElectronAPI calendar event write inputs expose only fields accepted by IPC', () => {
  const fixturePath = join(process.cwd(), 'tests', `.calendar-ipc-type-contract-${process.pid}.ts`);
  const tscPath = join(process.cwd(), 'node_modules', 'typescript', 'bin', 'tsc');
  writeFileSync(fixturePath, `
import type { ElectronAPI } from '../src/types/index.ts';

type CreateInput = Parameters<ElectronAPI['calendarEventCreate']>[0];
declare const createInput: CreateInput;
// @ts-expect-error IPC generates event ids instead of accepting renderer-supplied ids.
createInput.id = 'spoofed-id';
// @ts-expect-error IPC derives the creator from the authenticated session.
createInput.created_by = 'spoofed-user';

type UpdateInput = Parameters<ElectronAPI['calendarEventUpdate']>[1];
declare const updateInput: UpdateInput;
// @ts-expect-error IPC never accepts a renderer-supplied creator.
updateInput.created_by = 'spoofed-user';
// @ts-expect-error IPC owns the update timestamp.
updateInput.updated_at = '2099-01-01T00:00:00.000Z';

type ReplacementInput = Parameters<ElectronAPI['calendarPrivacyReplacementCreate']>[0];
declare const replacementInput: ReplacementInput;
// @ts-expect-error Main derives the replacement actor from its authenticated session.
replacementInput.actor_id = 'spoofed-user';
// @ts-expect-error Main, not the renderer, binds the receipt to the returned event id.
replacementInput.event.id = 'other-event';

type ReplacementDisposition = Parameters<ElectronAPI['calendarPrivacyReplacementSettle']>[1];
// @ts-expect-error A receipt can only be kept or used for exact compensation deletion.
const invalidDisposition: ReplacementDisposition = 'replace';
`);
  try {
    const result = spawnSync(process.execPath, [
      tscPath,
      '--noEmit',
      '--strict',
      '--skipLibCheck',
      '--target', 'ES2020',
      '--module', 'ESNext',
      '--moduleResolution', 'bundler',
      '--allowImportingTsExtensions',
      fixturePath,
    ], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  } finally {
    unlinkSync(fixturePath);
  }
});

test('preload calendar bridge parameters stay linked to the public ElectronAPI contract', () => {
  const source = readFileSync('electron/preload.ts', 'utf8');
  const publicTypes = readFileSync('src/types/index.ts', 'utf8');
  assert.match(
    source,
    /import type \{ CalendarApiInputContract \} from '\.\.\/src\/shared\/calendarApiContract';/,
  );
  assert.match(
    publicTypes,
    /export interface ElectronAPI extends CalendarApiInputContract/,
  );
  const methodParameterIndexes: Record<string, number[]> = {
    calendarCreate: [0],
    calendarUpdate: [0, 1],
    calendarSetMembers: [0, 1],
    calendarEventsList: [0],
    calendarEventCreate: [0],
    calendarPrivacyMigrationSourceDelete: [0],
    calendarPrivacyReplacementCreate: [0],
    calendarPrivacyReplacementSettle: [0, 1],
    calendarEventUpdate: [0, 1],
    calendarTagsSave: [0],
  };
  for (const [method, parameterIndexes] of Object.entries(methodParameterIndexes)) {
    for (const parameterIndex of parameterIndexes) {
      const contractParameter = new RegExp(
        `${method}:[\\s\\S]{0,320}Parameters<CalendarApiInputContract\\['${method}'\\]>\\[${parameterIndex}\\]`,
      );
      assert.match(
        source,
        contractParameter,
        `${method} preload parameter ${parameterIndex} must derive from the shared calendar contract`,
      );
      assert.match(
        publicTypes,
        contractParameter,
        `${method} ElectronAPI parameter ${parameterIndex} must derive from the shared calendar contract`,
      );
    }
  }
});

test('calendar:events:delete rejects a missing-table pre-read but keeps a genuinely missing row idempotent', async () => {
  let deleteCalls = 0;
  const originalError = console.error;
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
    getEventById: async () => null,
    getEventByIdForWrite: async () => { throw new Error('calendar_events table is missing'); },
    deleteEvent: async () => { deleteCalls += 1; },
  });
  try {
    console.error = () => {};
    await assert.rejects(
      harness.invoke('calendar:events:delete', 'event-1'),
      /calendar_events table is missing/,
    );
    assert.equal(deleteCalls, 0);

    harness.store.getEventByIdForWrite = async () => null;
    assert.equal(await harness.invoke('calendar:events:delete', 'already-gone'), undefined);
    assert.equal(
      await harness.invoke('calendar:privacy-migration:delete-source', 'already-gone'),
      'missing',
      'privacy migration must distinguish an externally deleted source from an ordinary idempotent delete',
    );
    assert.equal(deleteCalls, 0);
    assert.deepEqual(harness.broadcasts, []);
  } finally {
    console.error = originalError;
    harness.restore();
  }
});

test('strict migration delete classifies only a confirmed source-conflict disappearance as missing', async () => {
  const previous = calendarEventRow();
  let current: ReturnType<typeof calendarEventRow> | null = previous;
  let deleteOutcome: 'missing-race' | 'permission-error' = 'missing-race';
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
    getEventByIdForWrite: async () => current,
    getCalendarWithMembers: async () => ({ calendar: calendarRow(), members: [] }),
    deleteEvent: async () => {
      if (deleteOutcome === 'missing-race') {
        current = null;
        throw new Error('40001 Calendar event source changed; refresh and retry');
      }
      throw new Error('42501 Calendar event delete permission denied');
    },
  });
  const originalError = console.error;
  try {
    console.error = () => {};
    assert.equal(
      await harness.invoke('calendar:privacy-migration:delete-source', previous.id),
      'missing',
      'the strict path confirms the row disappeared after its pre-read',
    );
    assert.deepEqual(harness.committedDeleteMarkers, [{
      eventId: previous.id,
      action: 'delete',
      storage: 'bflow',
      calendarId: previous.calendar_id,
      committedPrivacyReplacementDelete: true,
    }], 'a post-pre-read authoritative absence is propagated independently of replacement compensation');

    current = previous;
    deleteOutcome = 'permission-error';
    harness.broadcasts.length = 0;
    harness.committedDeleteMarkers.length = 0;
    await assert.rejects(
      harness.invoke('calendar:privacy-migration:delete-source', previous.id),
      /42501.*permission denied/,
    );
    assert.deepEqual(harness.broadcasts, []);
    assert.deepEqual(harness.committedDeleteMarkers, []);
  } finally {
    console.error = originalError;
    harness.restore();
  }
});

test('strict migration delete preserves a replacement for response-loss and readback ambiguity', async (t) => {
  for (const outcome of ['commit-then-error', 'readback-fails', 'row-retained'] as const) {
    await t.test(outcome, async () => {
      const previous = calendarEventRow();
      let current: ReturnType<typeof calendarEventRow> | null = previous;
      let reads = 0;
      const responseError = new Error(`ECONNRESET ${outcome}`);
      const harness = await createIpcHarness({
        getUserRole: async () => 'user',
        getEventByIdForWrite: async () => {
          reads += 1;
          if (outcome === 'readback-fails' && reads > 1) {
            throw new Error('authoritative readback unavailable');
          }
          return current;
        },
        getCalendarWithMembers: async () => ({ calendar: calendarRow(), members: [] }),
        deleteEvent: async () => {
          if (outcome === 'commit-then-error') current = null;
          throw responseError;
        },
      });
      const originalError = console.error;
      try {
        console.error = () => {};
        if (outcome === 'row-retained') {
          await assert.rejects(
            harness.invoke('calendar:privacy-migration:delete-source', previous.id),
            /ECONNRESET row-retained/,
          );
        } else {
          assert.equal(
            await harness.invoke('calendar:privacy-migration:delete-source', previous.id),
            'ambiguous',
            'a possibly committed delete must keep the replacement instead of compensating it',
          );
        }
        assert.deepEqual(
          harness.committedDeleteMarkers,
          outcome === 'commit-then-error'
            ? [{
                eventId: previous.id,
                action: 'delete',
                storage: 'bflow',
                calendarId: previous.calendar_id,
                committedPrivacyReplacementDelete: true,
              }]
            : [],
          'only authoritative source absence emits an exact marker',
        );
      } finally {
        console.error = originalError;
        harness.restore();
      }
    });
  }
});

test('a committed strict B flow source delete publishes its exact main-process marker', async () => {
  const previous = calendarEventRow({ id: 'bflow-source', calendar_id: 'calendar-1' });
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
    getEventByIdForWrite: async () => previous,
    getCalendarWithMembers: async () => ({ calendar: calendarRow(), members: [] }),
    deleteEvent: async () => {},
  });
  try {
    assert.equal(
      await harness.invoke('calendar:privacy-migration:delete-source', {
        storage: 'bflow',
        event_id: previous.id,
      }),
      'deleted',
    );
    const marker = {
      eventId: previous.id,
      action: 'delete',
      storage: 'bflow',
      calendarId: previous.calendar_id,
      committedPrivacyReplacementDelete: true,
    };
    assert.deepEqual(harness.committedDeleteMarkers, [marker]);
    assert.equal(
      harness.broadcasts.some(({ kind, args }) => (
        kind === 'calendar' && args.length === 1 && args[0] === harness.committedDeleteMarkers[0]
      )),
      true,
    );
  } finally {
    harness.restore();
  }
});

test('strict B flow source deletion keeps its committed outcome when post-commit broadcasts throw', async (t) => {
  for (const failingSideEffect of ['data', 'calendar'] as const) {
    await t.test(failingSideEffect, async () => {
      const previous = calendarEventRow({ id: `strict-postcommit-${failingSideEffect}` });
      const harness = await createIpcHarness({
        getUserRole: async () => 'user',
        getEventByIdForWrite: async () => previous,
        getCalendarWithMembers: async () => ({ calendar: calendarRow(), members: [] }),
        deleteEvent: async () => {},
      });
      const originalWarn = console.warn;
      try {
        console.warn = () => {};
        harness.broadcastFailure[failingSideEffect] = true;
        assert.equal(
          await harness.invoke('calendar:privacy-migration:delete-source', {
            storage: 'bflow',
            event_id: previous.id,
          }),
          'deleted',
          'post-commit delivery failure cannot ask the renderer to compensate its replacement',
        );
        assert.deepEqual(harness.committedDeleteMarkers, [{
          eventId: previous.id,
          action: 'delete',
          storage: 'bflow',
          calendarId: previous.calendar_id,
          committedPrivacyReplacementDelete: true,
        }]);
        assert.deepEqual(
          harness.broadcasts[0]?.args[0],
          harness.committedDeleteMarkers[0],
          'the exact committed marker is emitted before fallible generic post-commit side effects',
        );
        assert.equal(
          harness.broadcasts.some(({ kind, args }) => (
            failingSideEffect === 'data'
              ? kind === 'calendar' && args[0] === 'DELETE'
              : kind === 'data' && args[0] === 'calendar_events' && args[1] === 'DELETE'
          )),
          true,
          'each generic side effect is isolated so the other one still runs',
        );
      } finally {
        console.warn = originalWarn;
        harness.restore();
      }
    });
  }
});

test('strict legacy source deletion classifies missing, committed-response-loss, definitive failure, and readback failure', async (t) => {
  for (const outcome of [
    'pre-missing',
    'deleted',
    'concurrent-zero-row',
    'zero-row-other-owner',
    'zero-row-same-owner',
    'zero-row-readback-fails',
    'commit-then-error',
    'response-loss-other-owner',
    'row-retained',
    'readback-fails',
  ] as const) {
    await t.test(outcome, async () => {
      let owner: string | null = outcome === 'pre-missing' ? null : 'legacy-user';
      let ownerReads = 0;
      const deleteCalls: unknown[][] = [];
      const deleteError = new Error(`legacy delete ${outcome}`);
      const harness = await createIpcHarness({
        getUserRole: async () => 'user',
      }, 'legacy-user', {
        getLegacyPrivateEventOwner: async () => {
          ownerReads += 1;
          if (
            (outcome === 'readback-fails' || outcome === 'zero-row-readback-fails')
            && ownerReads > 1
          ) {
            throw new Error('legacy authoritative readback unavailable');
          }
          return owner;
        },
        deleteLegacyPrivateSourceEvent: async (...args) => {
          deleteCalls.push(args);
          if (outcome === 'deleted') {
            owner = null;
            return 'deleted';
          }
          if (outcome === 'concurrent-zero-row') {
            owner = null;
            return 'missing';
          }
          if (outcome === 'zero-row-other-owner') {
            owner = 'legacy-user-b';
            return 'missing';
          }
          if (outcome === 'zero-row-same-owner' || outcome === 'zero-row-readback-fails') {
            return 'missing';
          }
          if (outcome === 'commit-then-error') owner = null;
          if (outcome === 'response-loss-other-owner') owner = 'legacy-user-b';
          throw deleteError;
        },
      });
      const originalError = console.error;
      try {
        console.error = () => {};
        const request = { storage: 'legacy-private', event_id: 'legacy-source' };
        if (outcome === 'row-retained' || outcome === 'zero-row-same-owner') {
          await assert.rejects(
            harness.invoke('calendar:privacy-migration:delete-source', request),
            outcome === 'row-retained'
              ? /legacy delete row-retained/
              : /삭제가 완료되지 않았습니다/,
          );
        } else {
          assert.equal(
            await harness.invoke('calendar:privacy-migration:delete-source', request),
            outcome === 'pre-missing'
              || outcome === 'concurrent-zero-row'
              || outcome === 'zero-row-other-owner'
              || outcome === 'zero-row-same-owner'
              || outcome === 'zero-row-readback-fails'
              ? 'missing'
              : outcome === 'deleted'
                ? 'deleted'
                : 'ambiguous',
          );
        }
        assert.deepEqual(
          deleteCalls,
          outcome === 'pre-missing' ? [] : [['legacy-source', 'legacy-user']],
          'the delete is bound to the authoritative owner captured by main',
        );
        assert.deepEqual(
          harness.committedDeleteMarkers,
          outcome === 'deleted'
            || outcome === 'concurrent-zero-row'
            || outcome === 'zero-row-other-owner'
            || outcome === 'commit-then-error'
            || outcome === 'response-loss-other-owner'
            ? [{
                eventId: 'legacy-source',
                action: 'delete',
                storage: 'legacy-private',
                ownerId: 'legacy-user',
                committedPrivacyReplacementDelete: true,
              }]
            : [],
        );
      } finally {
        console.error = originalError;
        harness.restore();
      }
    });
  }
});

test('strict Google source deletion classifies 404 and uncertain API outcomes without risking zero rows', async (t) => {
  const notFound = Object.assign(new Error('Google event not found'), { code: 404 });
  for (const outcome of [
    'pre-missing',
    'deleted',
    'commit-retry-404',
    'commit-then-network-error',
    'row-retained',
    'readback-fails',
  ] as const) {
    await t.test(outcome, async () => {
      let exists = outcome !== 'pre-missing';
      let reads = 0;
      const deleteCalls: unknown[][] = [];
      const responseError = new Error(`Google delete ${outcome}`);
      const harness = await createIpcHarness({
        getUserRole: async () => 'user',
      }, 'google-user', {
        getGoogleEvent: async () => {
          reads += 1;
          if (outcome === 'readback-fails' && reads > 1) {
            throw new Error('Google authoritative readback unavailable');
          }
          return exists ? { id: 'google-source' } : null;
        },
        deleteGoogleEvent: async (...args) => {
          deleteCalls.push(args);
          if (outcome === 'deleted') {
            exists = false;
            return;
          }
          if (outcome === 'commit-retry-404') {
            exists = false;
            throw notFound;
          }
          if (outcome === 'commit-then-network-error') exists = false;
          throw responseError;
        },
      });
      const originalError = console.error;
      try {
        console.error = () => {};
        const request = {
          storage: 'google',
          calendar_id: 'primary',
          event_id: 'google-source',
        };
        if (outcome === 'row-retained') {
          await assert.rejects(
            harness.invoke('calendar:privacy-migration:delete-source', request),
            /Google delete row-retained/,
          );
        } else {
          const expected = outcome === 'pre-missing'
            ? 'missing'
            : outcome === 'deleted'
              ? 'deleted'
              : 'ambiguous';
          assert.equal(
            await harness.invoke('calendar:privacy-migration:delete-source', request),
            expected,
          );
        }
        assert.deepEqual(
          deleteCalls,
          outcome === 'pre-missing' ? [] : [['primary', 'google-source', 'google-user']],
        );
        assert.deepEqual(
          harness.committedDeleteMarkers,
          outcome === 'deleted' || outcome === 'commit-retry-404' || outcome === 'commit-then-network-error'
            ? [{
                eventId: 'google-source',
                action: 'delete',
                calendarId: 'primary',
                committedGoogleDelete: true,
              }]
            : [],
        );
      } finally {
        console.error = originalError;
        harness.restore();
      }
    });
  }
});

test('calendar event update and delete bind the write to the calendar authorized by the pre-read', async () => {
  const updateCalls: unknown[][] = [];
  const deleteCalls: unknown[][] = [];
  const previous = calendarEventRow();
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
    getEventById: async () => previous,
    getEventByIdForWrite: async () => previous,
    getCalendarWithMembers: async () => ({ calendar: calendarRow(), members: [] }),
    updateEvent: async (...args) => {
      updateCalls.push(args);
      return { ...previous, title: '수정됨' };
    },
    deleteEvent: async (...args) => { deleteCalls.push(args); },
  });
  try {
    await harness.invoke('calendar:events:update', 'event-1', { title: '수정됨' });
    await harness.invoke('calendar:events:delete', 'event-1');
    assert.deepEqual(updateCalls, [[
      'event-1',
      { title: '수정됨' },
      'calendar-1',
      'user-1',
    ]]);
    assert.deepEqual(deleteCalls, [['event-1', 'calendar-1', 'user-1']]);
  } finally {
    harness.restore();
  }
});

test('calendar event create passes the session actor and strips renderer-controlled fields', async () => {
  const createCalls: unknown[][] = [];
  const input = {
    calendar_id: 'calendar-1',
    title: '새 일정',
    memo: null,
    tag_id: null,
    all_day: true,
    start_date: '2026-08-26',
    end_date: '2026-08-26',
    start_time: null,
    end_time: null,
    linked_episode: null,
    linked_part: null,
    linked_sheet_name: null,
    linked_scene_id: null,
    linked_department: null,
    linked_todo_id: null,
    id: 'spoofed-id',
    created_by: 'spoofed-actor',
    created_at: '2099-01-01T00:00:00.000Z',
    updated_at: '2099-01-01T00:00:00.000Z',
    owner_id: 'spoofed-owner',
  };
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
    getCalendarWithMembers: async () => ({
      calendar: calendarRow({ owner_id: 'session-user' }),
      members: [],
    }),
    createEvent: async (...args) => {
      createCalls.push(args);
      return calendarEventRow({ title: '새 일정', created_by: 'session-user' });
    },
  }, 'session-user');
  try {
    await harness.invoke('calendar:events:create', input);
    assert.deepEqual(createCalls, [[{
      calendar_id: 'calendar-1',
      title: '새 일정',
      memo: null,
      tag_id: null,
      all_day: true,
      start_date: '2026-08-26',
      end_date: '2026-08-26',
      start_time: null,
      end_time: null,
      linked_episode: null,
      linked_part: null,
      linked_sheet_name: null,
      linked_scene_id: null,
      linked_department: null,
      linked_todo_id: null,
    }, 'session-user']]);
  } finally {
    harness.restore();
  }
});

test('privacy replacement receipt deletes its exact B flow create after ordinary permission is revoked', async () => {
  let currentUserId = 'user-a';
  let actorExists = true;
  const createCalls: unknown[][] = [];
  const receiptDeleteCalls: unknown[][] = [];
  const created = calendarEventRow({
    id: 'replacement-user-a',
    calendar_id: 'personal-user-a',
    created_by: 'user-a',
    created_at: '2026-08-25T01:02:03.456Z',
  });
  const harness = await createIpcHarness({
    getUserRole: async () => {
      if (!actorExists) throw new Error('캘린더 사용자 세션이 더 이상 유효하지 않습니다');
      return 'user';
    },
    getCalendarWithMembers: async () => ({
      calendar: calendarRow({ id: 'personal-user-a', owner_id: 'user-a', is_personal: true }),
      members: [],
    }),
    createEvent: async (...args) => {
      createCalls.push(args);
      return created;
    },
    deleteEvent: async () => {
      throw new Error('42501 permission revoked after replacement create');
    },
    deletePrivacyReplacementEvent: async (...args) => { receiptDeleteCalls.push(args); },
  }, () => currentUserId);
  const request = {
    storage: 'bflow',
    event: {
      calendar_id: 'personal-user-a', title: 'A 비공개 일정', memo: null, tag_id: null,
      all_day: true, start_date: '2026-08-26', end_date: '2026-08-26',
      start_time: null, end_time: null, linked_episode: null, linked_part: null,
      linked_sheet_name: null, linked_scene_id: null, linked_department: null,
      linked_todo_id: null,
    },
  };
  try {
    const result = await harness.invokeAs(
      501,
      'calendar:privacy-migration:create-replacement',
      request,
    ) as { actual_id: string; receipt: string; storage: string };
    assert.equal(result.actual_id, 'replacement-user-a');
    assert.equal(result.storage, 'bflow');
    assert.equal(typeof result.receipt, 'string');
    assert.equal(result.receipt.includes('replacement-user-a'), false, 'receipt stays opaque');
    assert.deepEqual(createCalls, [[request.event, 'user-a']]);

    currentUserId = 'user-b';
    actorExists = false;
    const originalError = console.error;
    try {
      console.error = () => {};
      await assert.rejects(
        harness.invokeAs(777, 'calendar:privacy-migration:settle-replacement', result.receipt, 'delete'),
        /receipt|보상|발급/i,
        'another renderer cannot spend the receipt',
      );
      assert.deepEqual(receiptDeleteCalls, []);

      await harness.invokeAs(
        501,
        'calendar:privacy-migration:settle-replacement',
        result.receipt,
        'delete',
      );
      assert.deepEqual(receiptDeleteCalls, [[
        'replacement-user-a',
        'personal-user-a',
        '2026-08-25T01:02:03.456Z',
      ]]);

      await assert.rejects(
        harness.invokeAs(501, 'calendar:privacy-migration:settle-replacement', result.receipt, 'delete'),
        /receipt|보상|사용/i,
        'a consumed receipt cannot be reused',
      );
      await assert.rejects(
        harness.invokeAs(501, 'calendar:privacy-migration:settle-replacement', 'forged-receipt', 'delete'),
        /receipt|보상/i,
        'a renderer cannot forge an event id into a receipt',
      );
      assert.equal(receiptDeleteCalls.length, 1);
    } finally {
      console.error = originalError;
    }
  } finally {
    harness.restore();
  }
});

test('privacy replacement receipt is a single-success capability that blocks an in-flight duplicate', async () => {
  const deleteStarted = deferred<void>();
  const deleteGate = deferred<void>();
  let deleteCalls = 0;
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
    getCalendarWithMembers: async () => ({ calendar: calendarRow(), members: [] }),
    createEvent: async () => calendarEventRow({
      id: 'single-success-replacement',
      created_at: '2026-08-25T01:02:03.456Z',
    }),
    deletePrivacyReplacementEvent: async () => {
      deleteCalls += 1;
      deleteStarted.resolve();
      await deleteGate.promise;
    },
  });
  const originalError = console.error;
  try {
    console.error = () => {};
    const created = await harness.invokeAs(
      501,
      'calendar:privacy-migration:create-replacement',
      {
        storage: 'bflow',
        event: {
          calendar_id: 'calendar-1', title: '단일 성공 receipt', memo: null, tag_id: null,
          all_day: true, start_date: '2026-08-26', end_date: '2026-08-26',
          start_time: null, end_time: null, linked_episode: null, linked_part: null,
          linked_sheet_name: null, linked_scene_id: null, linked_department: null,
          linked_todo_id: null,
        },
      },
    ) as { receipt: string };
    const firstSettle = harness.invokeAs(
      501,
      'calendar:privacy-migration:settle-replacement',
      created.receipt,
      'delete',
    );
    await deleteStarted.promise;

    await assert.rejects(
      harness.invokeAs(
        501,
        'calendar:privacy-migration:settle-replacement',
        created.receipt,
        'delete',
      ),
      /처리 중/,
      'the same sender cannot spend a receipt twice while its exact delete is pending',
    );
    assert.equal(deleteCalls, 1, 'the duplicate never reaches persistence');

    deleteGate.resolve();
    assert.equal(await firstSettle, undefined);
    assert.equal(harness.committedDeleteMarkers.length, 1);
    await assert.rejects(
      harness.invokeAs(
        501,
        'calendar:privacy-migration:settle-replacement',
        created.receipt,
        'delete',
      ),
      /receipt|보상|사용/i,
      'the first confirmed success consumes the capability permanently',
    );
    assert.equal(deleteCalls, 1);
  } finally {
    console.error = originalError;
    harness.restore();
  }
});

test('ordinary legacy private create strips renderer-controlled identifiers at the final DB boundary', async () => {
  const globalScope = globalThis as Record<string, unknown>;
  const priorHarness = globalScope[SUPABASE_PRIVATE_HARNESS_KEY];
  const hadHarness = Object.prototype.hasOwnProperty.call(globalScope, SUPABASE_PRIVATE_HARNESS_KEY);
  const priorWebSocket = globalScope.WebSocket;
  const hadWebSocket = Object.prototype.hasOwnProperty.call(globalScope, 'WebSocket');
  let inserted: Record<string, unknown> | undefined;
  const client = {
    from(table: string) {
      assert.equal(table, 'private_calendar_events');
      return {
        insert(input: Record<string, unknown>) {
          inserted = input;
          return {
            select() {
              return {
                async single() {
                  return { data: { id: 'server-generated-id', ...input }, error: null };
                },
              };
            },
          };
        },
      };
    },
  };

  try {
    const module = await loadCalendarSupabasePrivateModule(client);
    await module.addPrivateEvent({
      id: 'renderer-injected-id',
      user_id: 'session-user',
      title: '안전한 일정',
      memo: '',
      color: '#6C5CE7',
      type: 'custom',
      start_date: '2026-08-26',
      end_date: '2026-08-26',
      linked_episode: null,
      linked_part: null,
      linked_sheet_name: null,
      linked_scene_id: null,
      linked_department: null,
      linked_todo_id: null,
      created_by: 'session-user',
      created_at: 'renderer-controlled',
      updated_at: 'renderer-controlled',
    });
    assert.deepEqual(inserted, {
      user_id: 'session-user',
      title: '안전한 일정',
      memo: '',
      color: '#6C5CE7',
      type: 'custom',
      start_date: '2026-08-26',
      end_date: '2026-08-26',
      linked_episode: null,
      linked_part: null,
      linked_sheet_name: null,
      linked_scene_id: null,
      linked_department: null,
      linked_todo_id: null,
      created_by: 'session-user',
    });
  } finally {
    if (hadHarness) globalScope[SUPABASE_PRIVATE_HARNESS_KEY] = priorHarness;
    else delete globalScope[SUPABASE_PRIVATE_HARNESS_KEY];
    if (hadWebSocket) globalScope.WebSocket = priorWebSocket;
    else delete globalScope.WebSocket;
  }
});

test('ordinary legacy private update strips owner and immutable fields at the final DB boundary', async () => {
  const globalScope = globalThis as Record<string, unknown>;
  const priorHarness = globalScope[SUPABASE_PRIVATE_HARNESS_KEY];
  const hadHarness = Object.prototype.hasOwnProperty.call(globalScope, SUPABASE_PRIVATE_HARNESS_KEY);
  const priorWebSocket = globalScope.WebSocket;
  const hadWebSocket = Object.prototype.hasOwnProperty.call(globalScope, 'WebSocket');
  let updated: Record<string, unknown> | undefined;
  const client = {
    from(table: string) {
      assert.equal(table, 'private_calendar_events');
      return {
        update(patch: Record<string, unknown>) {
          updated = patch;
          return {
            async eq(field: string, value: unknown) {
              assert.equal(field, 'id');
              assert.equal(value, 'legacy-event');
              return { error: null };
            },
          };
        },
      };
    },
  };

  try {
    const module = await loadCalendarSupabasePrivateModule(client);
    await module.updatePrivateEvent('legacy-event', {
      id: 'replacement-id',
      user_id: 'attacker',
      title: '허용된 제목',
      memo: '허용된 메모',
      linked_todo_id: null,
      created_by: 'attacker',
      created_at: 'renderer-created-at',
      updated_at: 'renderer-updated-at',
    });
    assert.ok(updated);
    assert.equal(updated.title, '허용된 제목');
    assert.equal(updated.memo, '허용된 메모');
    assert.equal(updated.linked_todo_id, null);
    assert.equal(typeof updated.updated_at, 'string');
    assert.notEqual(updated.updated_at, 'renderer-updated-at');
    assert.deepEqual(Object.keys(updated).sort(), [
      'linked_todo_id',
      'memo',
      'title',
      'updated_at',
    ]);
  } finally {
    if (hadHarness) globalScope[SUPABASE_PRIVATE_HARNESS_KEY] = priorHarness;
    else delete globalScope[SUPABASE_PRIVATE_HARNESS_KEY];
    if (hadWebSocket) globalScope.WebSocket = priorWebSocket;
    else delete globalScope.WebSocket;
  }
});

test('legacy receipt compensation atomically preserves a same-id row replaced by another owner', async () => {
  const globalScope = globalThis as Record<string, unknown>;
  const priorHarness = globalScope[SUPABASE_PRIVATE_HARNESS_KEY];
  const hadHarness = Object.prototype.hasOwnProperty.call(globalScope, SUPABASE_PRIVATE_HARNESS_KEY);
  const priorWebSocket = globalScope.WebSocket;
  const hadWebSocket = Object.prototype.hasOwnProperty.call(globalScope, 'WebSocket');
  const deleteStarted = deferred<void>();
  const deleteGate = deferred<void>();
  let row: { id: string; user_id: string } | null = {
    id: 'legacy-replacement-a',
    user_id: 'legacy-user-a',
  };
  const client = {
    from(table: string) {
      assert.equal(table, 'private_calendar_events');
      const predicates = new Map<string, unknown>();
      const builder = {
        eq(field: string, value: unknown) {
          predicates.set(field, value);
          return builder;
        },
        async select() {
          deleteStarted.resolve();
          await deleteGate.promise;
          if (
            row
            && [...predicates].every(([field, value]) => row?.[field as 'id' | 'user_id'] === value)
          ) {
            const deleted = row;
            row = null;
            return { data: [{ id: deleted.id }], error: null };
          }
          return { data: [], error: null };
        },
      };
      return { delete: () => builder };
    },
  };

  try {
    const module = await loadCalendarSupabasePrivateModule(client);
    assert.ok(
      module.deletePrivateEventForOwner,
      'legacy compensation must use one id+captured-owner delete statement',
    );
    const deletion = module.deletePrivateEventForOwner(
      'legacy-replacement-a',
      'legacy-user-a',
    );
    await deleteStarted.promise;
    row = { id: 'legacy-replacement-a', user_id: 'legacy-user-b' };
    deleteGate.resolve();

    await assert.rejects(deletion, /owner|소유|보상|일치|찾을 수/i);
    assert.deepEqual(row, {
      id: 'legacy-replacement-a',
      user_id: 'legacy-user-b',
    });
  } finally {
    if (hadHarness) globalScope[SUPABASE_PRIVATE_HARNESS_KEY] = priorHarness;
    else delete globalScope[SUPABASE_PRIVATE_HARNESS_KEY];
    if (hadWebSocket) globalScope.WebSocket = priorWebSocket;
    else delete globalScope.WebSocket;
  }
});

test('legacy source conditional delete returns missing for a normal zero-row race', async () => {
  const globalScope = globalThis as Record<string, unknown>;
  const priorHarness = globalScope[SUPABASE_PRIVATE_HARNESS_KEY];
  const hadHarness = Object.prototype.hasOwnProperty.call(globalScope, SUPABASE_PRIVATE_HARNESS_KEY);
  const priorWebSocket = globalScope.WebSocket;
  const hadWebSocket = Object.prototype.hasOwnProperty.call(globalScope, 'WebSocket');
  let row: { id: string; user_id: string } | null = {
    id: 'legacy-source-a',
    user_id: 'legacy-user-b',
  };
  let returnMalformedResult = false;
  const client = {
    from(table: string) {
      assert.equal(table, 'private_calendar_events');
      const predicates = new Map<string, unknown>();
      const builder = {
        eq(field: string, value: unknown) {
          predicates.set(field, value);
          return builder;
        },
        async select() {
          if (
            row
            && [...predicates].every(([field, value]) => row?.[field as 'id' | 'user_id'] === value)
          ) {
            const deleted = row;
            row = null;
            if (returnMalformedResult) return { data: null, error: null };
            return { data: [{ id: deleted.id }], error: null };
          }
          return { data: [], error: null };
        },
      };
      return { delete: () => builder };
    },
  };

  try {
    const module = await loadCalendarSupabasePrivateModule(client);
    assert.ok(module.deletePrivateEventForOwnerIfPresent);
    assert.equal(
      await module.deletePrivateEventForOwnerIfPresent('legacy-source-a', 'legacy-user-a'),
      'missing',
      'a concurrent ordinary delete/owner replacement zero-row is a definitive missing outcome',
    );
    assert.deepEqual(row, { id: 'legacy-source-a', user_id: 'legacy-user-b' });
    assert.equal(
      await module.deletePrivateEventForOwnerIfPresent('legacy-source-a', 'legacy-user-b'),
      'deleted',
    );
    assert.equal(row, null);

    row = { id: 'legacy-source-response-loss', user_id: 'legacy-user-a' };
    returnMalformedResult = true;
    await assert.rejects(
      module.deletePrivateEventForOwnerIfPresent(
        'legacy-source-response-loss',
        'legacy-user-a',
      ),
      /결과|result|확인/i,
      'a null DELETE representation is not a definitive zero-row missing outcome',
    );
    assert.equal(row, null, 'the fixture models commit followed by a malformed/lost response');
  } finally {
    if (hadHarness) globalScope[SUPABASE_PRIVATE_HARNESS_KEY] = priorHarness;
    else delete globalScope[SUPABASE_PRIVATE_HARNESS_KEY];
    if (hadWebSocket) globalScope.WebSocket = priorWebSocket;
    else delete globalScope.WebSocket;
  }
});

test('privacy replacement receipt binds legacy deletion to the create actor and exact returned id', async () => {
  let currentUserId = 'legacy-user-a';
  const legacyCreates: unknown[][] = [];
  const legacyDeletes: unknown[][] = [];
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
  }, () => currentUserId, {
    createLegacyPrivateEvent: async (...args) => {
      legacyCreates.push(args);
      return { id: 'legacy-replacement-a' };
    },
    deleteLegacyPrivateEvent: async (...args) => { legacyDeletes.push(args); },
  });
  const event = {
    title: '레거시 비공개 일정', memo: '', color: '#6C5CE7', type: 'custom',
    start_date: '2026-08-26', end_date: '2026-08-26', linked_episode: null,
    linked_part: null, linked_sheet_name: null, linked_scene_id: null,
    linked_department: null, linked_todo_id: null, created_by: '표시 이름',
  };
  try {
    const result = await harness.invokeAs(
      601,
      'calendar:privacy-migration:create-replacement',
      { storage: 'legacy-private', event },
    ) as { actual_id: string; receipt: string };
    assert.equal(result.actual_id, 'legacy-replacement-a');
    assert.deepEqual(legacyCreates, [[event, 'legacy-user-a']]);

    currentUserId = 'legacy-user-b';
    await harness.invokeAs(
      601,
      'calendar:privacy-migration:settle-replacement',
      result.receipt,
      'delete',
    );
    assert.deepEqual(legacyDeletes, [['legacy-replacement-a', 'legacy-user-a']]);
  } finally {
    harness.restore();
  }
});

test('privacy replacement receipt binds Google deletion to the exact calendar, event, and create actor', async () => {
  let currentUserId = 'google-user-a';
  const googleCreates: unknown[][] = [];
  const googleDeletes: unknown[][] = [];
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
  }, () => currentUserId, {
    createGoogleEvent: async (...args) => {
      googleCreates.push(args);
      return 'google-replacement-a';
    },
    deleteGoogleEvent: async (...args) => { googleDeletes.push(args); },
  });
  const event = {
    summary: '공개 전환 일정',
    description: '메모',
    startDate: '2026-08-26',
    endDate: '2026-08-27',
    extendedProperties: { bflow_type: 'custom' },
    visibility: 'default',
  };
  try {
    const result = await harness.invokeAs(
      701,
      'calendar:privacy-migration:create-replacement',
      { storage: 'google', calendar_id: 'primary', event, actor_id: 'spoofed-user' },
    ) as { actual_id: string; receipt: string };
    assert.equal(result.actual_id, 'google-replacement-a');
    assert.deepEqual(googleCreates, [[
      'primary',
      { ...event, colorId: undefined },
      'google-user-a',
    ]]);

    currentUserId = 'google-user-b';
    await harness.invokeAs(
      701,
      'calendar:privacy-migration:settle-replacement',
      result.receipt,
      'delete',
    );
    assert.deepEqual(googleDeletes, [[
      'primary',
      'google-replacement-a',
      'google-user-a',
    ]]);
  } finally {
    harness.restore();
  }
});

test('settled replacement deletes publish an exact main-process marker before a simulated IPC response loss', async (t) => {
  const bflowEventInput = {
    calendar_id: 'personal-user', title: 'B flow 보상 일정', memo: null, tag_id: null,
    all_day: true, start_date: '2026-08-26', end_date: '2026-08-26',
    start_time: null, end_time: null, linked_episode: null, linked_part: null,
    linked_sheet_name: null, linked_scene_id: null, linked_department: null,
    linked_todo_id: null,
  };
  const legacyEventInput = {
    title: '레거시 보상 일정', memo: '', color: '#6C5CE7', type: 'custom',
    start_date: '2026-08-26', end_date: '2026-08-26', linked_episode: null,
    linked_part: null, linked_sheet_name: null, linked_scene_id: null,
    linked_department: null, linked_todo_id: null, created_by: '사용자',
  };
  const googleEventInput = {
    summary: 'Google 보상 일정', description: '', startDate: '2026-08-26',
    endDate: '2026-08-27', extendedProperties: { bflow_type: 'custom' },
    visibility: 'default',
  };

  const scenarios = [
    {
      name: 'B flow',
      request: { storage: 'bflow', event: bflowEventInput },
      expected: {
        eventId: 'replacement-bflow',
        action: 'delete',
        storage: 'bflow',
        calendarId: 'personal-user',
        committedPrivacyReplacementDelete: true,
      },
      overrides: {
        getUserRole: async () => 'user',
        getCalendarWithMembers: async () => ({
          calendar: calendarRow({ id: 'personal-user', owner_id: 'user-1', is_personal: true }),
          members: [],
        }),
        createEvent: async () => calendarEventRow({
          id: 'replacement-bflow',
          calendar_id: 'personal-user',
          created_at: '2026-08-25T01:00:00.000Z',
        }),
        deletePrivacyReplacementEvent: async () => {},
      },
      external: {},
    },
    {
      name: 'legacy private',
      request: { storage: 'legacy-private', event: legacyEventInput },
      expected: {
        eventId: 'replacement-legacy',
        action: 'delete',
        storage: 'legacy-private',
        ownerId: 'user-1',
        committedPrivacyReplacementDelete: true,
      },
      overrides: { getUserRole: async () => 'user' },
      external: {
        createLegacyPrivateEvent: async () => ({ id: 'replacement-legacy' }),
        deleteLegacyPrivateEvent: async () => {},
      },
    },
    {
      name: 'Google',
      request: { storage: 'google', calendar_id: 'primary', event: googleEventInput },
      expected: {
        eventId: 'replacement-google',
        action: 'delete',
        calendarId: 'primary',
        committedGoogleDelete: true,
      },
      overrides: { getUserRole: async () => 'user' },
      external: {
        createGoogleEvent: async () => 'replacement-google',
        deleteGoogleEvent: async () => {},
      },
    },
  ] as const;

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const harness = await createIpcHarness(
        scenario.overrides,
        'user-1',
        scenario.external,
      );
      try {
        const created = await harness.invokeAs(
          801,
          'calendar:privacy-migration:create-replacement',
          scenario.request,
        ) as { receipt: string };
        harness.broadcasts.length = 0;
        harness.committedDeleteMarkers.length = 0;

        await assert.rejects(
          harness.invokeAs(
            801,
            'calendar:privacy-migration:settle-replacement',
            created.receipt,
            'delete',
          ).then(() => { throw new Error('simulated renderer response loss'); }),
          /simulated renderer response loss/,
        );

        assert.deepEqual(
          harness.committedDeleteMarkers,
          [scenario.expected],
          'the main boundary informs every local BrowserWindow independently of invoke delivery',
        );
        assert.equal(
          harness.broadcasts.some(({ kind, args }) => (
            kind === 'calendar'
            && args.length === 1
            && (() => {
              try {
                assert.deepEqual(args[0], scenario.expected);
                return true;
              } catch {
                return false;
              }
            })()
          )),
          true,
          'the exact committed marker is also sent through the cross-client calendar broadcast',
        );
      } finally {
        harness.restore();
      }
    });
  }
});

test('a throwing local-window marker fanout cannot turn a committed replacement delete into failure', async () => {
  const survivingWindowDeliveries: Array<{ channel: string; payload: unknown }> = [];
  const fanoutErrors: unknown[] = [];
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
    getCalendarWithMembers: async () => ({
      calendar: calendarRow({ id: 'personal-user', owner_id: 'user-1', is_personal: true }),
      members: [],
    }),
    createEvent: async () => calendarEventRow({
      id: 'replacement-after-window-close',
      calendar_id: 'personal-user',
      created_at: '2026-08-25T01:00:00.000Z',
    }),
    deletePrivacyReplacementEvent: async () => {},
  }, 'user-1', {
    onCommittedReplacementDelete: (payload) => {
      broadcastCommittedCalendarDeleteToWindows(
        {
          isDestroyed: () => false,
          webContents: {
            send: () => { throw new Error('main window closed during webContents.send'); },
          },
        },
        [{
          isDestroyed: () => false,
          webContents: {
            send: (channel, deliveredPayload) => {
              survivingWindowDeliveries.push({ channel, payload: deliveredPayload });
            },
          },
        }],
        payload,
        (error) => { fanoutErrors.push(error); },
      );
    },
  });
  const originalWarn = console.warn;
  const originalError = console.error;
  try {
    console.warn = () => {};
    console.error = () => {};
    const created = await harness.invokeAs(
      901,
      'calendar:privacy-migration:create-replacement',
      {
        storage: 'bflow',
        event: {
          calendar_id: 'personal-user', title: '창 종료 경합', memo: null, tag_id: null,
          all_day: true, start_date: '2026-08-26', end_date: '2026-08-26',
          start_time: null, end_time: null, linked_episode: null, linked_part: null,
          linked_sheet_name: null, linked_scene_id: null, linked_department: null,
          linked_todo_id: null,
        },
      },
    ) as { receipt: string };
    harness.broadcasts.length = 0;

    assert.equal(
      await harness.invokeAs(
        901,
        'calendar:privacy-migration:settle-replacement',
        created.receipt,
        'delete',
      ),
      undefined,
      'post-commit local fanout is best-effort and cannot reject the persistence result',
    );
    assert.equal(
      harness.broadcasts.some(({ kind, args }) => (
        kind === 'calendar'
        && args.length === 1
        && (args[0] as { eventId?: string }).eventId === 'replacement-after-window-close'
      )),
      true,
      'cross-client fanout still runs after local-window delivery throws',
    );
    assert.deepEqual(survivingWindowDeliveries, [{
      channel: 'calendar:changed',
      payload: harness.committedDeleteMarkers[0],
    }], 'a first-window send failure does not skip the next local BrowserWindow');
    assert.equal(fanoutErrors.length, 1);
    await assert.rejects(
      harness.invokeAs(
        901,
        'calendar:privacy-migration:settle-replacement',
        created.receipt,
        'delete',
      ),
      /receipt|보상|사용/i,
      'the successful persistence attempt consumed the receipt exactly once',
    );
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
    harness.restore();
  }
});

test('a remote Supabase exact marker still reaches later windows when the first send throws', () => {
  const delivered: Array<{ channel: string; payload: unknown }> = [];
  const errors: unknown[] = [];
  const marker = {
    eventId: 'remote-legacy-owner-a',
    action: 'delete',
    storage: 'legacy-private',
    ownerId: 'user-a',
    committedPrivacyReplacementDelete: true,
  };
  const handled = relayIncomingCommittedCalendarDeleteToWindows(
    'calendar-changed',
    marker,
    {
      isDestroyed: () => false,
      webContents: { send: () => { throw new Error('main closed during remote relay'); } },
    },
    [{
      isDestroyed: () => false,
      webContents: {
        send: (channel, payload) => { delivered.push({ channel, payload }); },
      },
    }],
    (error) => { errors.push(error); },
  );

  assert.equal(handled, true);
  assert.deepEqual(delivered, [{ channel: 'calendar:changed', payload: marker }]);
  assert.equal(errors.length, 1);
  assert.equal(
    relayIncomingCommittedCalendarDeleteToWindows(
      'scene-update',
      marker,
      null,
      [],
    ),
    false,
    'non-calendar broadcasts keep the existing generic delivery path',
  );
  const mainSource = readFileSync(join(process.cwd(), 'electron/main.ts'), 'utf8');
  assert.match(
    mainSource,
    /setupBroadcast\(\(event, payload\) => \{\s*if \(relayIncomingCommittedCalendarDeleteToWindows\(/,
    'the production Supabase receiver routes exact calendar markers through this hardened fanout',
  );
});

test('generic renderer calendar relay rejects forged committed markers for every storage', () => {
  for (const marker of [
    {
      eventId: 'forged-bflow', action: 'delete', storage: 'bflow', calendarId: 'calendar-1',
      committedPrivacyReplacementDelete: true,
    },
    {
      eventId: 'forged-legacy', action: 'delete', storage: 'legacy-private', ownerId: 'user-a',
      committedPrivacyReplacementDelete: true,
    },
    {
      eventId: 'forged-google', action: 'delete', calendarId: 'primary',
      committedGoogleDelete: true,
    },
  ]) {
    assert.equal(isCommittedCalendarDeleteMarker(marker), true);
  }
  assert.equal(
    isCommittedCalendarDeleteMarker({ eventId: 'ordinary', action: 'delete' }),
    false,
  );
  const mainSource = readFileSync(join(process.cwd(), 'electron/main.ts'), 'utf8');
  assert.match(
    mainSource,
    /ipcMain\.handle\('calendar:broadcast-change',[\s\S]*?isCommittedCalendarDeleteMarker\(payload\)[\s\S]*?return \{ ok: false \}/,
    'the generic renderer IPC must stop forged commit markers before any window relay',
  );
});

test('ordinary Google delete boundary classifies commit loss and emits only after confirmed absence', async (t) => {
  for (const outcome of ['success', 'commit-response-loss', 'retained', 'readback-fails'] as const) {
    await t.test(outcome, async () => {
      let exists = true;
      let readCalls = 0;
      const deleteError = new Error(`Google ordinary delete ${outcome}`);
      const localMarkers: unknown[] = [];
      const crossClientMarkers: unknown[] = [];
      const boundary = deleteGoogleEventWithCommittedMarker(
        'primary',
        'ordinary-google-event',
        {
          deleteEvent: async () => {
            if (outcome === 'success') {
              exists = false;
              return;
            }
            if (outcome === 'commit-response-loss') exists = false;
            throw deleteError;
          },
          getEvent: async () => {
            readCalls += 1;
            if (outcome === 'readback-fails') throw new Error('Google ordinary readback unavailable');
            return exists ? { id: 'ordinary-google-event' } : null;
          },
          emitLocal: (marker) => {
            localMarkers.push(marker);
            if (outcome === 'success') throw new Error('first local window closed');
          },
          emitCrossClient: (marker) => { crossClientMarkers.push(marker); },
          onFanoutError: () => {},
        },
      );

      if (outcome === 'retained') {
        await assert.rejects(boundary, (error: unknown) => error === deleteError);
      } else if (outcome === 'readback-fails') {
        await assert.rejects(boundary, /readback|확인|unavailable/i);
      } else {
        assert.equal(await boundary, undefined);
      }
      assert.equal(readCalls, outcome === 'success' ? 0 : 1);
      const shouldEmit = outcome === 'success' || outcome === 'commit-response-loss';
      assert.equal(localMarkers.length, shouldEmit ? 1 : 0);
      assert.equal(crossClientMarkers.length, shouldEmit ? 1 : 0);
      if (shouldEmit) {
        assert.deepEqual(crossClientMarkers[0], {
          eventId: 'ordinary-google-event',
          action: 'delete',
          calendarId: 'primary',
          committedGoogleDelete: true,
        });
      }
    });
  }
});

test('replacement settlement distinguishes commit-response-loss from a row-preserving failure for every storage', async (t) => {
  for (const storage of ['bflow', 'legacy-private', 'google'] as const) {
    for (const firstOutcome of ['commit-then-throw', 'throw-before-commit', 'readback-fails'] as const) {
      await t.test(`${storage} ${firstOutcome}`, async () => {
        let exists = true;
        let deleteCalls = 0;
        let readCalls = 0;
        let retrySucceeds = false;
        const deleteError = new Error(`${storage} replacement delete response lost`);
        const readbackError = new Error(`${storage} replacement readback unavailable`);
        const eventId = `settle-${storage}-${firstOutcome}`;
        const calendarId = storage === 'bflow' ? 'personal-user' : 'primary';
        const createdAt = '2026-08-25T01:00:00.000Z';

        const deleteAttempt = async () => {
          deleteCalls += 1;
          if (retrySucceeds) {
            exists = false;
            return;
          }
          if (firstOutcome === 'commit-then-throw') exists = false;
          throw deleteError;
        };
        const harness = await createIpcHarness({
          getUserRole: async () => 'user',
          getCalendarWithMembers: async () => ({
            calendar: calendarRow({ id: calendarId, owner_id: 'user-1', is_personal: true }),
            members: [],
          }),
          createEvent: async () => calendarEventRow({
            id: eventId,
            calendar_id: calendarId,
            created_at: createdAt,
          }),
          deletePrivacyReplacementEvent: storage === 'bflow'
            ? deleteAttempt
            : async () => { throw new Error('unexpected B flow delete'); },
          getEventByIdForWrite: async () => {
            readCalls += 1;
            if (firstOutcome === 'readback-fails' && !retrySucceeds) throw readbackError;
            return exists
              ? calendarEventRow({ id: eventId, calendar_id: calendarId, created_at: createdAt })
              : null;
          },
        }, 'user-1', {
          createLegacyPrivateEvent: async () => ({ id: eventId }),
          deleteLegacyPrivateEvent: storage === 'legacy-private'
            ? deleteAttempt
            : async () => { throw new Error('unexpected legacy delete'); },
          getLegacyPrivateEventOwner: async () => {
            readCalls += 1;
            if (firstOutcome === 'readback-fails' && !retrySucceeds) throw readbackError;
            return exists ? 'user-1' : null;
          },
          createGoogleEvent: async () => eventId,
          deleteGoogleEvent: storage === 'google'
            ? deleteAttempt
            : async () => { throw new Error('unexpected Google delete'); },
          getGoogleEvent: async () => {
            readCalls += 1;
            if (firstOutcome === 'readback-fails' && !retrySucceeds) throw readbackError;
            return exists ? { id: eventId } : null;
          },
        });

        const request = storage === 'bflow'
          ? {
              storage,
              event: {
                calendar_id: calendarId, title: 'B flow', memo: null, tag_id: null,
                all_day: true, start_date: '2026-08-26', end_date: '2026-08-26',
                start_time: null, end_time: null, linked_episode: null, linked_part: null,
                linked_sheet_name: null, linked_scene_id: null, linked_department: null,
                linked_todo_id: null,
              },
            }
          : storage === 'legacy-private'
            ? {
                storage,
                event: {
                  title: 'legacy', start_date: '2026-08-26', end_date: '2026-08-26',
                },
              }
            : {
                storage,
                calendar_id: calendarId,
                event: {
                  summary: 'Google', startDate: '2026-08-26', endDate: '2026-08-27',
                },
              };
        const originalError = console.error;
        try {
          console.error = () => {};
          const created = await harness.invokeAs(
            902,
            'calendar:privacy-migration:create-replacement',
            request,
          ) as { receipt: string };
          harness.broadcasts.length = 0;
          harness.committedDeleteMarkers.length = 0;

          const first = harness.invokeAs(
            902,
            'calendar:privacy-migration:settle-replacement',
            created.receipt,
            'delete',
          );
          if (firstOutcome === 'commit-then-throw') {
            assert.equal(await first, undefined);
            assert.equal(readCalls, 1);
            assert.equal(harness.committedDeleteMarkers.length, 1);
            await assert.rejects(
              harness.invokeAs(
                902,
                'calendar:privacy-migration:settle-replacement',
                created.receipt,
                'delete',
              ),
              /receipt|보상|사용/i,
              'a confirmed absent replacement consumes its receipt',
            );
          } else {
            await assert.rejects(
              first,
              firstOutcome === 'readback-fails'
                ? /readback|재조회|확인|unavailable/i
                : /response lost/,
            );
            assert.deepEqual(harness.committedDeleteMarkers, []);
            assert.equal(exists, true);

            retrySucceeds = true;
            assert.equal(
              await harness.invokeAs(
                902,
                'calendar:privacy-migration:settle-replacement',
                created.receipt,
                'delete',
              ),
              undefined,
              'a non-committed or unclassified failure releases the receipt for an exact retry',
            );
            assert.equal(harness.committedDeleteMarkers.length, 1);
          }
          assert.equal(deleteCalls, firstOutcome === 'commit-then-throw' ? 1 : 2);
        } finally {
          console.error = originalError;
          harness.restore();
        }
      });
    }
  }
});

test('privacy replacement receipt is consumed on keep but released after a confirmed failed delete', async () => {
  let deleteCalls = 0;
  let replacementExists = true;
  let deleteFails = true;
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
    getCalendarWithMembers: async () => ({ calendar: calendarRow(), members: [] }),
    createEvent: async () => calendarEventRow({ id: `replacement-${deleteCalls}` }),
    getEventByIdForWrite: async () => (
      replacementExists ? calendarEventRow({ id: 'replacement-0' }) : null
    ),
    deletePrivacyReplacementEvent: async () => {
      deleteCalls += 1;
      if (deleteFails) throw new Error('privacy replacement row identity no longer matches');
      replacementExists = false;
    },
  });
  const event = {
    calendar_id: 'calendar-1', title: '일정', memo: null, tag_id: null,
    all_day: true, start_date: '2026-08-26', end_date: '2026-08-26',
    start_time: null, end_time: null, linked_episode: null, linked_part: null,
    linked_sheet_name: null, linked_scene_id: null, linked_department: null,
    linked_todo_id: null,
  };
  const originalError = console.error;
  try {
    console.error = () => {};
    const kept = await harness.invoke(
      'calendar:privacy-migration:create-replacement',
      { storage: 'bflow', event },
    ) as { receipt: string };
    await harness.invoke('calendar:privacy-migration:settle-replacement', kept.receipt, 'keep');
    assert.deepEqual(harness.committedDeleteMarkers, [], 'keep is not a committed delete');
    await assert.rejects(
      harness.invoke('calendar:privacy-migration:settle-replacement', kept.receipt, 'delete'),
      /receipt|보상|사용/i,
    );
    assert.equal(deleteCalls, 0);

    const failing = await harness.invoke(
      'calendar:privacy-migration:create-replacement',
      { storage: 'bflow', event },
    ) as { receipt: string };
    await assert.rejects(
      harness.invoke('calendar:privacy-migration:settle-replacement', failing.receipt, 'delete'),
      /identity no longer matches/,
    );
    assert.deepEqual(harness.committedDeleteMarkers, [], 'failed persistence emits no committed marker');
    deleteFails = false;
    assert.equal(
      await harness.invoke('calendar:privacy-migration:settle-replacement', failing.receipt, 'delete'),
      undefined,
      'a confirmed non-commit leaves the exact receipt reusable',
    );
    assert.equal(harness.committedDeleteMarkers.length, 1);
    await assert.rejects(
      harness.invoke('calendar:privacy-migration:settle-replacement', failing.receipt, 'delete'),
      /receipt|보상|사용/i,
    );
    assert.equal(deleteCalls, 2);
  } finally {
    console.error = originalError;
    harness.restore();
  }
});

test('calendar event move passes the expected source, whitelisted target patch, and session actor', async () => {
  const updateCalls: unknown[][] = [];
  const previous = calendarEventRow({ calendar_id: 'source-calendar' });
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
    getEventByIdForWrite: async () => previous,
    getCalendarWithMembers: async (calendarId) => ({
      calendar: calendarRow({ id: calendarId, owner_id: 'session-user' }),
      members: [],
    }),
    updateEvent: async (...args) => {
      updateCalls.push(args);
      return { ...previous, calendar_id: 'target-calendar', title: '이동됨', memo: null };
    },
  }, 'session-user');
  try {
    await harness.invoke('calendar:events:update', 'event-1', {
      calendar_id: 'target-calendar',
      title: '이동됨',
      memo: null,
      created_by: 'spoofed-actor',
      created_at: '2099-01-01T00:00:00.000Z',
      updated_at: '2099-01-01T00:00:00.000Z',
      id: 'spoofed-id',
      arbitrary: 'spoofed-value',
    });
    assert.deepEqual(updateCalls, [[
      'event-1',
      { calendar_id: 'target-calendar', title: '이동됨', memo: null },
      'source-calendar',
      'session-user',
    ]]);
  } finally {
    harness.restore();
  }
});

test('calendar event RPC permission and conflict errors do not broadcast success', async () => {
  const originalError = console.error;
  const previous = calendarEventRow();
  const scenarios = [
    {
      channel: 'calendar:events:create',
      args: [{
        calendar_id: 'calendar-1', title: '새 일정', memo: null, tag_id: null,
        all_day: true, start_date: '2026-08-26', end_date: '2026-08-26',
        start_time: null, end_time: null, linked_episode: null, linked_part: null,
        linked_sheet_name: null, linked_scene_id: null, linked_department: null,
        linked_todo_id: null,
      }],
      overrides: { createEvent: async () => { throw new Error('42501 permission denied'); } },
      expected: /42501|permission denied/,
    },
    {
      channel: 'calendar:events:update',
      args: ['event-1', { title: '수정됨' }],
      overrides: { updateEvent: async () => { throw new Error('40001 stale source conflict'); } },
      expected: /40001|conflict/,
    },
    {
      channel: 'calendar:events:delete',
      args: ['event-1'],
      overrides: { deleteEvent: async () => { throw new Error('42501 permission revoked'); } },
      expected: /42501|permission revoked/,
    },
  ] as const;
  try {
    console.error = () => {};
    for (const scenario of scenarios) {
      const harness = await createIpcHarness({
        getUserRole: async () => 'user',
        getEventByIdForWrite: async () => previous,
        getCalendarWithMembers: async () => ({ calendar: calendarRow(), members: [] }),
        ...scenario.overrides,
      });
      try {
        await assert.rejects(harness.invoke(scenario.channel, ...scenario.args), scenario.expected);
        assert.deepEqual(harness.broadcasts, []);
      } finally {
        harness.restore();
      }
    }
  } finally {
    console.error = originalError;
  }
});

function calendarStoreTestPlugin(): Plugin {
  return {
    name: 'calendar-store-test-supabase',
    setup(builder) {
      builder.onResolve({ filter: /^\.\/supabase$/ }, () => ({ path: 'supabase', namespace: 'calendar-store-test' }));
      builder.onLoad({ filter: /^supabase$/, namespace: 'calendar-store-test' }, () => ({
        contents: `export const supabase = globalThis.${STORE_HARNESS_KEY};`,
      }));
    },
  };
}

async function bundledCalendarStoreSource(): Promise<string> {
  storeBundle ??= build({
    stdin: {
      contents: "export * from './electron/calendarStore.ts';",
      resolveDir: process.cwd(),
      sourcefile: 'calendar-store-strict-read-entry.ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    plugins: [calendarStoreTestPlugin()],
    write: false,
  }).then((result) => result.outputFiles[0].text);
  return storeBundle;
}

test('calendar store deterministically drains every calendar member page past a server row cap', async () => {
  const globalScope = globalThis as Record<string, unknown>;
  const hadPrior = Object.prototype.hasOwnProperty.call(globalScope, STORE_HARNESS_KEY);
  const prior = globalScope[STORE_HARNESS_KEY];
  const calendar = calendarRow({ id: 'calendar-shared', visibility: 'members' });
  const memberPages = [
    Array.from({ length: 1000 }, (_, index) => ({
      calendar_id: 'calendar-shared',
      user_id: `user-${String(index).padStart(4, '0')}`,
      can_edit: index % 2 === 0,
    })),
    [{ calendar_id: 'calendar-shared', user_id: 'user-1000', can_edit: false }],
  ];
  const ranges: Array<[number, number]> = [];
  const memberOrders: string[][] = [];
  let memberPage = 0;

  const from = (table: string) => {
    const orders: string[] = [];
    const query = {
      select: () => query,
      order: (column: string) => {
        orders.push(column);
        return query;
      },
      range: async (start: number, end: number) => {
        assert.equal(table, 'calendar_members');
        ranges.push([start, end]);
        memberOrders.push([...orders]);
        return { data: memberPages[memberPage++] ?? [], error: null };
      },
      then: (
        resolve: (value: { data: unknown; error: null }) => unknown,
        reject: (reason?: unknown) => unknown,
      ) => Promise.resolve(
        table === 'calendars'
          ? { data: [calendar], error: null }
          : { data: memberPages[0], error: null },
      ).then(resolve, reject),
    };
    return query;
  };
  globalScope[STORE_HARNESS_KEY] = { from };
  try {
    const encoded = Buffer.from(await bundledCalendarStoreSource()).toString('base64');
    const store = await import(`data:text/javascript;base64,${encoded}#calendar-store-${storeNonce++}`) as {
      listCalendarsWithMembers(): Promise<{ calendars: unknown[]; members: Array<{ user_id: string }> }>;
    };

    const result = await store.listCalendarsWithMembers();
    assert.equal(result.members.length, 1001);
    assert.equal(result.members[0]?.user_id, 'user-0000');
    assert.equal(result.members.at(-1)?.user_id, 'user-1000');
    assert.deepEqual(ranges, [[0, 999], [1000, 1999]]);
    assert.deepEqual(memberOrders, [
      ['calendar_id', 'user_id'],
      ['calendar_id', 'user_id'],
    ]);
  } finally {
    if (hadPrior) globalScope[STORE_HARNESS_KEY] = prior;
    else delete globalScope[STORE_HARNESS_KEY];
  }
});

test('calendar store pages one actor-authorized event RPC without accepting caller-computed calendar ids', async () => {
  const globalScope = globalThis as Record<string, unknown>;
  const hadPrior = Object.prototype.hasOwnProperty.call(globalScope, STORE_HARNESS_KEY);
  const prior = globalScope[STORE_HARNESS_KEY];
  const eventPages = [
    Array.from({ length: 1000 }, (_, index) => calendarEventRow({
      id: `event-${String(index).padStart(4, '0')}`,
    })),
    [calendarEventRow({ id: 'event-1000' })],
  ];
  const calls: Array<{
    name: string;
    args: Record<string, unknown>;
    orders: string[];
    range: [number, number];
  }> = [];
  let eventPage = 0;
  globalScope[STORE_HARNESS_KEY] = {
    rpc(name: string, args: Record<string, unknown>) {
      const orders: string[] = [];
      const query = {
        order(column: string) {
          orders.push(column);
          return query;
        },
        async range(start: number, end: number) {
          calls.push({ name, args, orders: [...orders], range: [start, end] });
          return { data: eventPages[eventPage++] ?? [], error: null };
        },
      };
      return query;
    },
  };
  try {
    const encoded = Buffer.from(await bundledCalendarStoreSource()).toString('base64');
    const store = await import(`data:text/javascript;base64,${encoded}#calendar-store-${storeNonce++}`) as {
      listEventsInRange(params: { actorId: string; from?: string; to?: string }): Promise<Array<{ id: string }>>;
    };

    const events = await store.listEventsInRange({
      actorId: 'member-user',
      from: '2026-08-01',
      to: '2026-08-31',
    });
    assert.equal(events.length, 1001);
    assert.equal(events[0]?.id, 'event-0000');
    assert.equal(events.at(-1)?.id, 'event-1000');
    assert.deepEqual(calls, [
      {
        name: 'list_calendar_events_authorized',
        args: { p_actor_id: 'member-user', p_from: '2026-08-01', p_to: '2026-08-31' },
        orders: ['start_date', 'id'],
        range: [0, 999],
      },
      {
        name: 'list_calendar_events_authorized',
        args: { p_actor_id: 'member-user', p_from: '2026-08-01', p_to: '2026-08-31' },
        orders: ['start_date', 'id'],
        range: [1000, 1999],
      },
    ]);
  } finally {
    if (hadPrior) globalScope[STORE_HARNESS_KEY] = prior;
    else delete globalScope[STORE_HARNESS_KEY];
  }
});

test('calendar store soft-reads only an exactly missing authorized event RPC before migration', async () => {
  const globalScope = globalThis as Record<string, unknown>;
  const hadPrior = Object.prototype.hasOwnProperty.call(globalScope, STORE_HARNESS_KEY);
  const prior = globalScope[STORE_HARNESS_KEY];
  const originalWarn = console.warn;
  const scenarios = [
    {
      error: {
        code: 'PGRST202',
        message: 'Could not find the function public.list_calendar_events_authorized in the schema cache',
      },
      empty: true,
    },
    {
      error: {
        code: '42883',
        message: 'function public.list_calendar_events_authorized(text,date,date) does not exist',
      },
      empty: true,
    },
    {
      error: {
        code: 'PGRST202',
        message: 'Could not find the function public.some_other_function in the schema cache',
      },
      empty: false,
    },
    {
      error: {
        code: '08006',
        message: 'temporary connection failure while calling list_calendar_events_authorized',
      },
      empty: false,
    },
  ] as const;
  try {
    console.warn = () => {};
    const encoded = Buffer.from(await bundledCalendarStoreSource()).toString('base64');
    for (const scenario of scenarios) {
      globalScope[STORE_HARNESS_KEY] = {
        rpc() {
          const query = {
            order: () => query,
            range: async () => ({ data: null, error: scenario.error }),
          };
          return query;
        },
      };
      const store = await import(`data:text/javascript;base64,${encoded}#calendar-store-${storeNonce++}`) as {
        listEventsInRange(params: { actorId: string }): Promise<unknown[]>;
      };
      if (scenario.empty) {
        assert.deepEqual(await store.listEventsInRange({ actorId: 'member-user' }), []);
      } else {
        await assert.rejects(
          store.listEventsInRange({ actorId: 'member-user' }),
          new RegExp(scenario.error.message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        );
      }
    }
  } finally {
    console.warn = originalWarn;
    if (hadPrior) globalScope[STORE_HARNESS_KEY] = prior;
    else delete globalScope[STORE_HARNESS_KEY];
  }
});

test('calendar store rejects a deleted session user instead of downgrading it to a user role', async () => {
  const globalScope = globalThis as Record<string, unknown>;
  const hadPrior = Object.prototype.hasOwnProperty.call(globalScope, STORE_HARNESS_KEY);
  const prior = globalScope[STORE_HARNESS_KEY];
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: null, error: null }),
  };
  globalScope[STORE_HARNESS_KEY] = { from: () => query };
  try {
    const encoded = Buffer.from(await bundledCalendarStoreSource()).toString('base64');
    const store = await import(`data:text/javascript;base64,${encoded}#calendar-store-${storeNonce++}`) as {
      getUserRole(userId: string): Promise<'admin' | 'user'>;
    };

    await assert.rejects(
      store.getUserRole('deleted-user'),
      /캘린더 사용자 세션이 더 이상 유효하지 않습니다/,
    );
  } finally {
    if (hadPrior) globalScope[STORE_HARNESS_KEY] = prior;
    else delete globalScope[STORE_HARNESS_KEY];
  }
});

test('calendar store preserves real user roles and propagates user lookup failures', async () => {
  const globalScope = globalThis as Record<string, unknown>;
  const hadPrior = Object.prototype.hasOwnProperty.call(globalScope, STORE_HARNESS_KEY);
  const prior = globalScope[STORE_HARNESS_KEY];
  let response: { data: unknown; error: { code?: string; message: string } | null } = {
    data: { role: 'user' },
    error: null,
  };
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => response,
  };
  globalScope[STORE_HARNESS_KEY] = { from: () => query };
  try {
    const encoded = Buffer.from(await bundledCalendarStoreSource()).toString('base64');
    const store = await import(`data:text/javascript;base64,${encoded}#calendar-store-${storeNonce++}`) as {
      getUserRole(userId: string): Promise<'admin' | 'user'>;
    };

    assert.equal(await store.getUserRole('real-user'), 'user');
    response = { data: { role: 'admin' }, error: null };
    assert.equal(await store.getUserRole('real-admin'), 'admin');

    response = {
      data: null,
      error: { code: '08006', message: 'temporary users lookup failure' },
    };
    await assert.rejects(
      store.getUserRole('real-user'),
      /temporary users lookup failure/,
    );
  } finally {
    if (hadPrior) globalScope[STORE_HARNESS_KEY] = prior;
    else delete globalScope[STORE_HARNESS_KEY];
  }
});

test('calendar store keeps soft reads empty while strict write pre-reads surface a missing table', async () => {
  const globalScope = globalThis as Record<string, unknown>;
  const hadPrior = Object.prototype.hasOwnProperty.call(globalScope, STORE_HARNESS_KEY);
  const prior = globalScope[STORE_HARNESS_KEY];
  let response: { data: unknown; error: { code?: string; message: string } | null } = {
    data: null,
    error: { code: '42P01', message: 'relation calendar_events does not exist' },
  };
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => response,
  };
  globalScope[STORE_HARNESS_KEY] = { from: () => query };
  const originalWarn = console.warn;
  try {
    console.warn = () => {};
    const encoded = Buffer.from(await bundledCalendarStoreSource()).toString('base64');
    const store = await import(`data:text/javascript;base64,${encoded}#calendar-store-${storeNonce++}`) as {
      getEventById(id: string): Promise<unknown>;
      getEventByIdForWrite(id: string): Promise<unknown>;
    };

    assert.equal(await store.getEventById('event-1'), null);
    await assert.rejects(store.getEventByIdForWrite('event-1'), /does not exist/);

    response = { data: null, error: null };
    assert.equal(await store.getEventByIdForWrite('already-gone'), null);
  } finally {
    console.warn = originalWarn;
    if (hadPrior) globalScope[STORE_HARNESS_KEY] = prior;
    else delete globalScope[STORE_HARNESS_KEY];
  }
});

test('personal calendar provisioning ignores only missing-table errors and propagates transient failures', async () => {
  const globalScope = globalThis as Record<string, unknown>;
  const hadPrior = Object.prototype.hasOwnProperty.call(globalScope, STORE_HARNESS_KEY);
  const prior = globalScope[STORE_HARNESS_KEY];
  const originalWarn = console.warn;
  try {
    console.warn = () => {};
    const encoded = Buffer.from(await bundledCalendarStoreSource()).toString('base64');
    const scenarios = [
      {
        userId: 'lookup-migration-user',
        lookupError: { code: '42P01', message: 'relation calendars does not exist' },
        insertError: null,
        rejects: false,
        expectedInsertCalls: 0,
      },
      {
        userId: 'insert-migration-user',
        lookupError: null,
        insertError: { code: 'PGRST205', message: 'calendars missing from schema cache' },
        rejects: false,
        expectedInsertCalls: 1,
      },
      {
        userId: 'transient-user',
        lookupError: null,
        insertError: { code: '08006', message: 'temporary calendar insert failure' },
        rejects: true,
        expectedError: /temporary calendar insert failure/,
        expectedInsertCalls: 1,
      },
      {
        userId: 'lookup-transient-user',
        lookupError: { code: '08006', message: 'temporary calendar lookup failure' },
        insertError: null,
        rejects: true,
        expectedError: /temporary calendar lookup failure/,
        expectedInsertCalls: 0,
      },
      {
        userId: 'missing-column-user',
        lookupError: { code: '42703', message: 'column calendars.is_personal does not exist' },
        insertError: null,
        rejects: true,
        expectedError: /column calendars\.is_personal does not exist/,
        expectedInsertCalls: 0,
      },
      {
        userId: 'stale-column-cache-user',
        lookupError: null,
        insertError: { code: 'PGRST204', message: "Could not find the 'owner_id' column of 'calendars' in the schema cache" },
        rejects: true,
        expectedError: /owner_id.*column.*schema cache/i,
        expectedInsertCalls: 1,
      },
    ] as const;

    for (const scenario of scenarios) {
      let insertCalls = 0;
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: null, error: scenario.lookupError }),
        insert: async () => {
          insertCalls += 1;
          return { error: scenario.insertError };
        },
      };
      globalScope[STORE_HARNESS_KEY] = { from: () => query };
      const store = await import(`data:text/javascript;base64,${encoded}#calendar-store-${storeNonce++}`) as {
        ensurePersonalCalendar(userId: string): Promise<void>;
      };

      if (scenario.rejects) {
        await assert.rejects(
          store.ensurePersonalCalendar(scenario.userId),
          scenario.expectedError,
        );
      } else {
        await assert.doesNotReject(store.ensurePersonalCalendar(scenario.userId));
      }
      assert.equal(insertCalls, scenario.expectedInsertCalls);
    }
  } finally {
    console.warn = originalWarn;
    if (hadPrior) globalScope[STORE_HARNESS_KEY] = prior;
    else delete globalScope[STORE_HARNESS_KEY];
  }
});

function calendarStoreRpcHarness(
  responseFor: (name: string, args: Record<string, unknown>) => {
    data: unknown;
    error: { code?: string; message: string } | null;
  },
) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    supabase: {
      async rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args });
        return responseFor(name, args);
      },
    },
  };
}

test('calendar store uses exact actor-authorized RPCs for calendar creation and management', async () => {
  const globalScope = globalThis as Record<string, unknown>;
  const hadPrior = Object.prototype.hasOwnProperty.call(globalScope, STORE_HARNESS_KEY);
  const prior = globalScope[STORE_HARNESS_KEY];
  const created = calendarRow({ name: '원자 생성', visibility: 'members' });
  let response: { data: unknown; error: { code?: string; message: string } | null } = {
    data: [created],
    error: null,
  };
  const harness = calendarStoreRpcHarness(() => response);
  globalScope[STORE_HARNESS_KEY] = harness.supabase;
  try {
    const encoded = Buffer.from(await bundledCalendarStoreSource()).toString('base64');
    const store = await import(`data:text/javascript;base64,${encoded}#calendar-store-${storeNonce++}`) as {
      createCalendar(
        input: { name: string; color: string; visibility: string },
        members: Array<{ user_id: string; can_edit: boolean }>,
        actorId: string,
      ): Promise<unknown>;
      updateCalendar(id: string, updates: Record<string, unknown>, actorId: string): Promise<void>;
      deleteCalendar(id: string, actorId: string): Promise<void>;
      replaceMembers(
        calendarId: string,
        members: Array<{ user_id: string; can_edit: boolean }>,
        actorId: string,
      ): Promise<void>;
    };
    const input = { name: '원자 생성', color: '#74B9FF', visibility: 'members' };
    const members = [{ user_id: 'user-2', can_edit: false }];

    assert.deepEqual(await store.createCalendar(input, members, 'session-user'), created);
    assert.deepEqual(harness.calls, [{
      name: 'create_calendar_with_members_authorized',
      args: { p_actor_id: 'session-user', p_calendar: input, p_members: members },
    }]);

    await store.updateCalendar('calendar-1', { name: '수정됨' }, 'session-user');
    await store.replaceMembers('calendar-1', members, 'session-user');
    await store.deleteCalendar('calendar-1', 'session-user');
    assert.deepEqual(harness.calls.slice(1), [
      {
        name: 'update_calendar_authorized',
        args: {
          p_actor_id: 'session-user',
          p_calendar_id: 'calendar-1',
          p_updates: { name: '수정됨' },
        },
      },
      {
        name: 'replace_calendar_members_authorized',
        args: {
          p_actor_id: 'session-user',
          p_calendar_id: 'calendar-1',
          p_members: members,
        },
      },
      {
        name: 'delete_calendar_authorized',
        args: { p_actor_id: 'session-user', p_calendar_id: 'calendar-1' },
      },
    ]);

    response = {
      data: [],
      error: { code: '23503', message: 'initial calendar member does not exist' },
    };
    await assert.rejects(
      store.createCalendar(input, members, 'session-user'),
      /initial calendar member does not exist/,
    );

    response = { data: [], error: null };
    await assert.rejects(
      store.createCalendar(input, members, 'session-user'),
      /결과 행|returned.*row/i,
    );
  } finally {
    if (hadPrior) globalScope[STORE_HARNESS_KEY] = prior;
    else delete globalScope[STORE_HARNESS_KEY];
  }
});

test('calendar store sends exact authorized RPC arguments and returns typed event rows', async () => {
  const globalScope = globalThis as Record<string, unknown>;
  const hadPrior = Object.prototype.hasOwnProperty.call(globalScope, STORE_HARNESS_KEY);
  const prior = globalScope[STORE_HARNESS_KEY];
  const created = calendarEventRow({ title: '생성됨' });
  const updated = calendarEventRow({ calendar_id: 'calendar-2', title: '이동됨' });
  const deleted = calendarEventRow();
  const harness = calendarStoreRpcHarness((name) => ({
    data: name === 'create_calendar_event_authorized'
      ? [created]
      : name === 'update_calendar_event_authorized'
        ? [updated]
        : [deleted],
    error: null,
  }));
  globalScope[STORE_HARNESS_KEY] = harness.supabase;
  try {
    const encoded = Buffer.from(await bundledCalendarStoreSource()).toString('base64');
    const store = await import(`data:text/javascript;base64,${encoded}#calendar-store-${storeNonce++}`) as {
      createEvent(input: Record<string, unknown>, actorId: string): Promise<unknown>;
      updateEvent(id: string, updates: Record<string, unknown>, expectedCalendarId: string, actorId: string): Promise<unknown>;
      deleteEvent(id: string, expectedCalendarId: string, actorId: string): Promise<void>;
      deletePrivacyReplacementEvent(id: string, calendarId: string, createdAt: string): Promise<void>;
    };

    const createInput = {
      calendar_id: 'calendar-1', title: '생성됨', memo: null, tag_id: null,
      all_day: true, start_date: '2026-08-26', end_date: '2026-08-26',
      start_time: null, end_time: null, linked_episode: null, linked_part: null,
      linked_sheet_name: null, linked_scene_id: null, linked_department: null,
      linked_todo_id: null,
    };
    assert.deepEqual(await store.createEvent(createInput, 'session-user'), created);
    assert.deepEqual(
      await store.updateEvent(
        'event-1',
        { calendar_id: 'calendar-2', title: '이동됨', memo: null },
        'calendar-1',
        'session-user',
      ),
      updated,
    );
    assert.equal(await store.deleteEvent('event-1', 'calendar-1', 'session-user'), undefined);
    assert.equal(
      await store.deletePrivacyReplacementEvent(
        'replacement-1',
        'calendar-1',
        '2026-08-25T01:02:03.456Z',
      ),
      undefined,
    );

    assert.deepEqual(harness.calls, [
      {
        name: 'create_calendar_event_authorized',
        args: { p_actor_id: 'session-user', p_event: createInput },
      },
      {
        name: 'update_calendar_event_authorized',
        args: {
          p_actor_id: 'session-user',
          p_event_id: 'event-1',
          p_expected_calendar_id: 'calendar-1',
          p_updates: { calendar_id: 'calendar-2', title: '이동됨', memo: null },
        },
      },
      {
        name: 'delete_calendar_event_authorized',
        args: {
          p_actor_id: 'session-user',
          p_event_id: 'event-1',
          p_expected_calendar_id: 'calendar-1',
        },
      },
      {
        name: 'delete_calendar_privacy_replacement',
        args: {
          p_event_id: 'replacement-1',
          p_calendar_id: 'calendar-1',
          p_created_at: '2026-08-25T01:02:03.456Z',
        },
      },
    ]);
  } finally {
    if (hadPrior) globalScope[STORE_HARNESS_KEY] = prior;
    else delete globalScope[STORE_HARNESS_KEY];
  }
});

test('calendar store sends the final tag list and actor only to the authorized replacement RPC', async () => {
  const globalScope = globalThis as Record<string, unknown>;
  const hadPrior = Object.prototype.hasOwnProperty.call(globalScope, STORE_HARNESS_KEY);
  const prior = globalScope[STORE_HARNESS_KEY];
  const tags = [{ id: 'tag-1', name: '회의', color: '#A29BFE', sort_order: 0 }];
  const harness = calendarStoreRpcHarness(() => ({ data: tags, error: null }));
  globalScope[STORE_HARNESS_KEY] = harness.supabase;
  try {
    const encoded = Buffer.from(await bundledCalendarStoreSource()).toString('base64');
    const store = await import(`data:text/javascript;base64,${encoded}#calendar-store-${storeNonce++}`) as {
      saveTags(input: typeof tags, actorId: string): Promise<unknown>;
    };

    assert.deepEqual(await store.saveTags(tags, 'session-admin'), tags);
    assert.deepEqual(harness.calls, [{
      name: 'replace_calendar_tags_authorized',
      args: { p_actor_id: 'session-admin', p_tags: tags },
    }]);
  } finally {
    if (hadPrior) globalScope[STORE_HARNESS_KEY] = prior;
    else delete globalScope[STORE_HARNESS_KEY];
  }
});

test('calendar store propagates RPC errors before checking returned row counts', async () => {
  const globalScope = globalThis as Record<string, unknown>;
  const hadPrior = Object.prototype.hasOwnProperty.call(globalScope, STORE_HARNESS_KEY);
  const prior = globalScope[STORE_HARNESS_KEY];
  const harness = calendarStoreRpcHarness(() => ({
    data: [],
    error: { code: 'PGRST202', message: 'authorized calendar RPC is missing from schema cache' },
  }));
  globalScope[STORE_HARNESS_KEY] = harness.supabase;
  try {
    const encoded = Buffer.from(await bundledCalendarStoreSource()).toString('base64');
    const store = await import(`data:text/javascript;base64,${encoded}#calendar-store-${storeNonce++}`) as {
      createEvent(input: Record<string, unknown>, actorId: string): Promise<unknown>;
    };
    await assert.rejects(
      store.createEvent({ calendar_id: 'calendar-1' }, 'session-user'),
      /authorized calendar RPC is missing from schema cache/,
    );
  } finally {
    if (hadPrior) globalScope[STORE_HARNESS_KEY] = prior;
    else delete globalScope[STORE_HARNESS_KEY];
  }
});

test('calendar store rejects zero-row create, update, and delete RPC results', async () => {
  const globalScope = globalThis as Record<string, unknown>;
  const hadPrior = Object.prototype.hasOwnProperty.call(globalScope, STORE_HARNESS_KEY);
  const prior = globalScope[STORE_HARNESS_KEY];
  const harness = calendarStoreRpcHarness(() => ({ data: [], error: null }));
  globalScope[STORE_HARNESS_KEY] = harness.supabase;
  try {
    const encoded = Buffer.from(await bundledCalendarStoreSource()).toString('base64');
    const store = await import(`data:text/javascript;base64,${encoded}#calendar-store-${storeNonce++}`) as {
      createEvent(input: Record<string, unknown>, actorId: string): Promise<unknown>;
      updateEvent(id: string, updates: Record<string, unknown>, expectedCalendarId: string, actorId: string): Promise<unknown>;
      deleteEvent(id: string, expectedCalendarId: string, actorId: string): Promise<void>;
      deletePrivacyReplacementEvent(id: string, calendarId: string, createdAt: string): Promise<void>;
    };
    for (const write of [
      () => store.createEvent({ calendar_id: 'calendar-1' }, 'session-user'),
      () => store.updateEvent('event-1', { title: '수정됨' }, 'calendar-1', 'session-user'),
      () => store.deleteEvent('event-1', 'calendar-1', 'session-user'),
      () => store.deletePrivacyReplacementEvent(
        'replacement-1',
        'calendar-1',
        '2026-08-25T01:02:03.456Z',
      ),
    ]) {
      await assert.rejects(write(), /결과 행|returned.*row/i);
    }
  } finally {
    if (hadPrior) globalScope[STORE_HARNESS_KEY] = prior;
    else delete globalScope[STORE_HARNESS_KEY];
  }
});
