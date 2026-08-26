import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { build, type Plugin } from 'esbuild';
import {
  broadcastCommittedCalendarDeleteToWindows,
  isCommittedCalendarDeleteMarker,
  relayIncomingCommittedCalendarDeleteToWindows,
} from '../electron/calendarWindowFanout.ts';
import { deleteGoogleEventWithCommittedMarker } from '../electron/googleCalendarDeleteBoundary.ts';
import { registerLegacyPrivateEventIpc } from '../electron/legacyPrivateEventIpc.ts';

type Handler = (_event: unknown, ...args: unknown[]) => Promise<unknown>;

type IpcHarnessState = {
  handlers: Map<string, Handler>;
  store: Record<string, (...args: unknown[]) => unknown>;
  readUsers: () => Promise<Array<{ id: string; name: string }>>;
  broadcasts: Array<{ kind: 'data' | 'calendar'; args: unknown[] }>;
  committedDeleteMarkers: unknown[];
  broadcastFailure: { data: boolean; calendar: boolean };
};

type CalendarIpcExternalDeps = {
  getSessionOrigin?: () => { userId: string; epoch: number; role: 'admin' | 'user' };
  readUsers?: () => Promise<Array<{ id: string; name: string }>>;
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

type CalendarNotificationRuntime = {
  beginQuitting(): void;
  beginPrivacyReplacementTransition(origin: { userId: string; epoch: number }): void;
  drainPrivacyReplacementTransition(origin: { userId: string; epoch: number }): Promise<void>;
  getPendingNotificationCount(): number;
  waitForNotificationIdle(timeoutMs: number): Promise<boolean>;
};

const IPC_HARNESS_KEY = '__calendarIpcBehaviorHarness';
const STORE_HARNESS_KEY = '__calendarStoreStrictReadHarness';
const SUPABASE_PRIVATE_HARNESS_KEY = '__calendarSupabasePrivateHarness';
let ipcBundle: Promise<string> | undefined;
let ipcNonce = 0;
const PRELOAD_HARNESS_KEY = '__calendarPreloadHarness';
let preloadBundle: Promise<string> | undefined;
let preloadNonce = 0;
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
  'insertNotifications',
] as const;

function calendarIpcTestPlugin(): Plugin {
  return {
    name: 'calendar-ipc-test-dependencies',
    setup(builder) {
      builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'calendar-ipc-test' }));
      builder.onResolve({ filter: /^\.\/calendarStore$/ }, () => ({ path: 'store', namespace: 'calendar-ipc-test' }));
      builder.onResolve({ filter: /^\.\/broadcast$/ }, () => ({ path: 'broadcast', namespace: 'calendar-ipc-test' }));
      builder.onResolve({ filter: /^\.\/supabase$/ }, () => ({ path: 'supabase', namespace: 'calendar-ipc-test' }));
      builder.onLoad({ filter: /^electron$/, namespace: 'calendar-ipc-test' }, () => ({
        contents: `export const ipcMain = { handle(channel, handler) { globalThis.${IPC_HARNESS_KEY}.handlers.set(channel, handler); } };`,
      }));
      builder.onLoad({ filter: /^store$/, namespace: 'calendar-ipc-test' }, () => ({
        contents: storeFunctionNames.map((name) => (
          `export const ${name} = (...args) => globalThis.${IPC_HARNESS_KEY}.store.${name}(...args);`
        )).join('\n'),
      }));
      builder.onLoad({ filter: /^supabase$/, namespace: 'calendar-ipc-test' }, () => ({
        contents: `export const readUsers = () => globalThis.${IPC_HARNESS_KEY}.readUsers();`,
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
        ].map((name) => (
          `export const ${name} = (...args) => globalThis.${SUPABASE_PRIVATE_HARNESS_KEY}.broadcasts.push({ name: '${name}', args });`
        )).join('\n'),
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

async function loadCalendarSupabasePrivateModule(
  client: unknown,
  broadcasts: Array<{ name: string; args: unknown[] }> = [],
): Promise<{
  addPrivateEvent(input: Record<string, unknown>): Promise<unknown>;
  getPrivateEventOwner(eventId: string): Promise<string | null>;
  updatePrivateEvent(
    eventId: string,
    ownerId: string,
    updates: Record<string, unknown>,
  ): Promise<void>;
  deletePrivateEventForOwner?: (eventId: string, ownerId: string) => Promise<void>;
  deletePrivateEventForOwnerIfPresent?: (
    eventId: string,
    ownerId: string,
  ) => Promise<'deleted' | 'missing'>;
}> {
  const globalScope = globalThis as Record<string, unknown>;
  globalScope[SUPABASE_PRIVATE_HARNESS_KEY] = { client, broadcasts };
  const encoded = Buffer.from(await bundledCalendarSupabasePrivateSource()).toString('base64');
  return import(
    `data:text/javascript;base64,${encoded}#calendar-supabase-private-${supabasePrivateNonce++}`
  ) as Promise<{
    addPrivateEvent(input: Record<string, unknown>): Promise<unknown>;
    getPrivateEventOwner(eventId: string): Promise<string | null>;
    updatePrivateEvent(
      eventId: string,
      ownerId: string,
      updates: Record<string, unknown>,
    ): Promise<void>;
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
  notificationRuntime: CalendarNotificationRuntime | undefined;
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
    readUsers: externalDeps.readUsers ?? (async () => []),
    broadcasts: [],
    committedDeleteMarkers: [],
    broadcastFailure: { data: false, calendar: false },
  };
  globalScope[IPC_HARNESS_KEY] = state;
  try {
    const encoded = Buffer.from(await bundledCalendarIpcSource()).toString('base64');
    const module = await import(`data:text/javascript;base64,${encoded}#calendar-ipc-${ipcNonce++}`) as {
      registerCalendarIpc(deps: {
        getSessionUserIdOrThrow(): string;
        getSessionOriginOrThrow(): { userId: string; epoch: number; role: 'admin' | 'user' };
      }): CalendarNotificationRuntime | undefined;
    };
    const notificationRuntime = module.registerCalendarIpc({
      getSessionUserIdOrThrow: () => typeof userId === 'function' ? userId() : userId,
      getSessionOriginOrThrow: () => externalDeps.getSessionOrigin?.() ?? {
        userId: typeof userId === 'function' ? userId() : userId,
        epoch: 0,
        role: 'user',
      },
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
    // 기존 receipt 테스트는 main raw IPC를 직접 호출한다. 제품 preload는 raw secret을
    // 공개하지 않지만, 이전 테스트의 3-argument invocation은 새 capability 형식으로
    // 정규화해 exact target/상태기 회귀를 계속 검증한다. 4-argument 호출은 그대로 두어
    // no-secret/wrong-secret 거부를 별도로 검증한다.
    const legacyReceiptSecrets = new Map<string, string>();
    const invokeAs = async (senderId: number, channel: string, ...args: unknown[]) => {
      const handler = state.handlers.get(channel);
      assert.ok(handler, `missing IPC handler: ${channel}`);
      let normalizedArgs = args;
      if (channel === 'calendar:privacy-migration:create-replacement') {
        const input = args[0];
        if (input && typeof input === 'object' && !('source' in input)) {
          normalizedArgs = [{
            ...(input as Record<string, unknown>),
            source: { storage: 'bflow', event_id: 'legacy-test-source' },
          }];
        }
      } else if (
        channel === 'calendar:privacy-migration:settle-replacement'
        && args.length === 2
        && typeof args[0] === 'string'
        && (args[1] === 'keep' || args[1] === 'delete')
      ) {
        normalizedArgs = [args[0], legacyReceiptSecrets.get(args[0]), args[1]];
      }
      const result = await handler({ sender: { id: senderId } }, ...normalizedArgs);
      if (
        channel === 'calendar:privacy-migration:create-replacement'
        && result
        && typeof result === 'object'
        && typeof (result as { receipt?: unknown }).receipt === 'string'
        && typeof (result as { continuation_secret?: unknown }).continuation_secret === 'string'
      ) {
        const raw = result as { receipt: string; continuation_secret: string };
        legacyReceiptSecrets.set(raw.receipt, raw.continuation_secret);
      }
      return result;
    };
    return {
      ...state,
      notificationRuntime,
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

function calendarPreloadTestPlugin(): Plugin {
  return {
    name: 'calendar-preload-test-electron',
    setup(builder) {
      builder.onResolve({ filter: /^electron$/ }, () => ({
        path: 'electron',
        namespace: 'calendar-preload-test',
      }));
      builder.onLoad({ filter: /^electron$/, namespace: 'calendar-preload-test' }, () => ({
        contents: [
          `export const contextBridge = { exposeInMainWorld: (name, api) => globalThis.${PRELOAD_HARNESS_KEY}.exposed.set(name, api) };`,
          `export const ipcRenderer = { invoke: (...args) => globalThis.${PRELOAD_HARNESS_KEY}.invoke(...args), on: () => {}, removeListener: () => {} };`,
          'export const webUtils = { getPathForFile: () => \"\" };',
        ].join('\n'),
      }));
    },
  };
}

async function loadCalendarPreloadApi(
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>,
): Promise<{
  api: Record<string, unknown>;
  restore(): void;
}> {
  const globalScope = globalThis as Record<string, unknown>;
  const hadPrior = Object.prototype.hasOwnProperty.call(globalScope, PRELOAD_HARNESS_KEY);
  const prior = globalScope[PRELOAD_HARNESS_KEY];
  const exposed = new Map<string, Record<string, unknown>>();
  globalScope[PRELOAD_HARNESS_KEY] = { exposed, invoke };
  try {
    preloadBundle ??= build({
      entryPoints: ['electron/preload.ts'],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node22',
      plugins: [calendarPreloadTestPlugin()],
      write: false,
    }).then((result) => result.outputFiles[0].text);
    const encoded = Buffer.from(await preloadBundle).toString('base64');
    await import(`data:text/javascript;base64,${encoded}#calendar-preload-${preloadNonce++}`);
    const api = exposed.get('electronAPI');
    assert.ok(api, 'preload exposes ElectronAPI through the context bridge');
    return {
      api,
      restore() {
        if (hadPrior) globalScope[PRELOAD_HARNESS_KEY] = prior;
        else delete globalScope[PRELOAD_HARNESS_KEY];
      },
    };
  } catch (error) {
    if (hadPrior) globalScope[PRELOAD_HARNESS_KEY] = prior;
    else delete globalScope[PRELOAD_HARNESS_KEY];
    throw error;
  }
}

test('calendar event notifications persist recipient-specific create, update, and delete rows', async (t) => {
  const users = [
    { id: 'actor', name: '한솔' },
    { id: 'owner', name: '리더' },
    { id: 'member', name: '멤버' },
  ];
  const calendar = calendarRow({
    name: 'EP 마일스톤',
    visibility: 'members',
    owner_id: 'owner',
  });
  const members = [
    { calendar_id: 'calendar-1', user_id: 'actor', can_edit: true },
    { calendar_id: 'calendar-1', user_id: 'member', can_edit: true },
  ];
  const eventInput = {
    calendar_id: 'calendar-1', title: 'EP12 업로드', memo: null, tag_id: null,
    all_day: true, start_date: '2026-09-25', end_date: '2026-09-25',
    start_time: null, end_time: null, linked_episode: null, linked_part: null,
    linked_sheet_name: null, linked_scene_id: null, linked_department: null, linked_todo_id: null,
  };

  await t.test('create', async () => {
    let rows: unknown;
    const inserted = deferred<void>();
    const created = calendarEventRow({ ...eventInput, created_by: 'actor' });
    const harness = await createIpcHarness({
      getUserRole: async () => 'user',
      getCalendarWithMembers: async () => ({ calendar, members }),
      createEvent: async () => created,
      insertNotifications: async (nextRows) => { rows = nextRows; inserted.resolve(); },
    }, 'actor', { readUsers: async () => users });
    try {
      assert.deepEqual(await harness.invoke('calendar:events:create', eventInput), created);
      await inserted.promise;
      assert.deepEqual(rows, [
        { recipient_id: 'owner', actor_id: 'actor', actor_name: '한솔', calendar_id: 'calendar-1', calendar_name: 'EP 마일스톤', event_id: 'event-1', event_title: 'EP12 업로드', event_date: '2026-09-25', action: 'create', detail: null },
        { recipient_id: 'member', actor_id: 'actor', actor_name: '한솔', calendar_id: 'calendar-1', calendar_name: 'EP 마일스톤', event_id: 'event-1', event_title: 'EP12 업로드', event_date: '2026-09-25', action: 'create', detail: null },
      ]);
    } finally {
      harness.restore();
    }
  });

  await t.test('update', async () => {
    let rows: unknown;
    let insertCallCount = 0;
    const inserted = deferred<void>();
    const previous = calendarEventRow({ ...eventInput, created_by: 'actor' });
    const updated = calendarEventRow({ ...eventInput, title: 'EP12 일정 변경', start_date: '2026-09-26', end_date: '2026-09-26', created_by: 'actor' });
    const harness = await createIpcHarness({
      getUserRole: async () => 'user',
      getEventByIdForWrite: async () => previous,
      getCalendarWithMembers: async () => ({ calendar, members }),
      updateEvent: async () => updated,
      insertNotifications: async (nextRows) => {
        insertCallCount += 1;
        rows = nextRows;
        inserted.resolve();
      },
    }, 'actor', { readUsers: async () => users });
    try {
      assert.deepEqual(await harness.invoke('calendar:events:update', 'event-1', {
        title: 'EP12 일정 변경', start_date: '2026-09-26', end_date: '2026-09-26',
      }), updated);
      await inserted.promise;
      assert.ok(harness.notificationRuntime);
      assert.equal(
        await harness.notificationRuntime.waitForNotificationIdle(1_000),
        true,
        'the ordinary update notification settles before its count is checked',
      );
      assert.deepEqual(rows, [
        { recipient_id: 'owner', actor_id: 'actor', actor_name: '한솔', calendar_id: 'calendar-1', calendar_name: 'EP 마일스톤', event_id: 'event-1', event_title: 'EP12 일정 변경', event_date: '2026-09-26', action: 'update', detail: '9/25 → 9/26' },
        { recipient_id: 'member', actor_id: 'actor', actor_name: '한솔', calendar_id: 'calendar-1', calendar_name: 'EP 마일스톤', event_id: 'event-1', event_title: 'EP12 일정 변경', event_date: '2026-09-26', action: 'update', detail: '9/25 → 9/26' },
      ]);
      assert.equal(insertCallCount, 1, 'a non-move update remains one update notification');
    } finally {
      harness.restore();
    }
  });

  await t.test('delete', async () => {
    let rows: unknown;
    const inserted = deferred<void>();
    const previous = calendarEventRow({ ...eventInput, created_by: 'actor' });
    const harness = await createIpcHarness({
      getUserRole: async () => 'user',
      getEventByIdForWrite: async () => previous,
      getCalendarWithMembers: async () => ({ calendar, members }),
      deleteEvent: async () => {},
      insertNotifications: async (nextRows) => { rows = nextRows; inserted.resolve(); },
    }, 'actor', { readUsers: async () => users });
    try {
      assert.equal(await harness.invoke('calendar:events:delete', 'event-1'), undefined);
      await inserted.promise;
      assert.deepEqual(rows, [
        { recipient_id: 'owner', actor_id: 'actor', actor_name: '한솔', calendar_id: 'calendar-1', calendar_name: 'EP 마일스톤', event_id: 'event-1', event_title: 'EP12 업로드', event_date: '2026-09-25', action: 'delete', detail: null },
        { recipient_id: 'member', actor_id: 'actor', actor_name: '한솔', calendar_id: 'calendar-1', calendar_name: 'EP 마일스톤', event_id: 'event-1', event_title: 'EP12 업로드', event_date: '2026-09-25', action: 'delete', detail: null },
      ]);
    } finally {
      harness.restore();
    }
  });
});

test('calendar CRUD and strict migration do not wait for best-effort notification reads', async (t) => {
  const eventInput = {
    calendar_id: 'calendar-1', title: '비차단 알림', memo: null, tag_id: null,
    all_day: true, start_date: '2026-09-25', end_date: '2026-09-25',
    start_time: null, end_time: null, linked_episode: null, linked_part: null,
    linked_sheet_name: null, linked_scene_id: null, linked_department: null, linked_todo_id: null,
  };
  const scenarios = [
    {
      name: 'create',
      channel: 'calendar:events:create',
      args: [eventInput],
      store: { createEvent: async () => calendarEventRow(eventInput) },
    },
    {
      name: 'update',
      channel: 'calendar:events:update',
      args: ['event-1', { title: '수정됨' }],
      store: {
        getEventByIdForWrite: async () => calendarEventRow(eventInput),
        updateEvent: async () => calendarEventRow({ ...eventInput, title: '수정됨' }),
      },
    },
    {
      name: 'delete',
      channel: 'calendar:events:delete',
      args: ['event-1'],
      store: { getEventByIdForWrite: async () => calendarEventRow(eventInput), deleteEvent: async () => {} },
    },
    {
      name: 'strict migration delete',
      channel: 'calendar:privacy-migration:delete-source',
      args: [{ storage: 'bflow', event_id: 'event-1' }],
      store: { getEventByIdForWrite: async () => calendarEventRow(eventInput), deleteEvent: async () => {} },
    },
  ] as const;

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const readStarted = deferred<void>();
      const releaseRead = deferred<Array<{ id: string; name: string }>>();
      const harness = await createIpcHarness({
        getUserRole: async () => 'user',
        getCalendarWithMembers: async () => ({ calendar: calendarRow(), members: [] }),
        insertNotifications: async () => {},
        ...scenario.store,
      }, 'user-1', {
        readUsers: async () => {
          readStarted.resolve();
          return releaseRead.promise;
        },
      });
      try {
        const invocation = harness.invoke(scenario.channel, ...scenario.args);
        await readStarted.promise;
        let returned = false;
        void invocation.then(() => { returned = true; }, () => {});
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(returned, true);
        releaseRead.resolve([]);
        await invocation;
      } finally {
        releaseRead.resolve([]);
        await new Promise<void>((resolve) => setImmediate(resolve));
        harness.restore();
      }
    });
  }
});

test('calendar notification drain tracks nonblocking work until a failed best-effort write settles', async () => {
  const readStarted = deferred<void>();
  const releaseRead = deferred<Array<{ id: string; name: string }>>();
  const writeStarted = deferred<void>();
  const releaseWrite = deferred<void>();
  const eventInput = {
    calendar_id: 'calendar-1', title: '종료 전 알림', memo: null, tag_id: null,
    all_day: true, start_date: '2026-09-25', end_date: '2026-09-25',
    start_time: null, end_time: null, linked_episode: null, linked_part: null,
    linked_sheet_name: null, linked_scene_id: null, linked_department: null, linked_todo_id: null,
  };
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
    getCalendarWithMembers: async () => ({
      calendar: calendarRow({ visibility: 'team' }),
      members: [{ calendar_id: 'calendar-1', user_id: 'actor', can_edit: true }],
    }),
    createEvent: async () => calendarEventRow(eventInput),
    insertNotifications: async () => {
      writeStarted.resolve();
      await releaseWrite.promise;
      throw new Error('best-effort notification insert unavailable');
    },
  }, 'actor', {
    readUsers: async () => {
      readStarted.resolve();
      return releaseRead.promise;
    },
  });
  const originalWarn = console.warn;
  try {
    console.warn = () => {};
    const invocation = harness.invoke('calendar:events:create', eventInput);
    await readStarted.promise;
    let returned = false;
    void invocation.then(() => { returned = true; }, () => {});
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(returned, true, 'calendar create remains immediate while its notification is pending');

    assert.ok(harness.notificationRuntime, 'calendar IPC exposes a shutdown drain for tracked notifications');
    assert.equal(harness.notificationRuntime.getPendingNotificationCount(), 1);
    assert.equal(
      await harness.notificationRuntime.waitForNotificationIdle(0),
      false,
      'a bounded drain reports timeout while the notification task is still blocked',
    );

    const draining = harness.notificationRuntime.waitForNotificationIdle(1_000);
    releaseRead.resolve([{ id: 'recipient', name: '수신자' }]);
    await writeStarted.promise;
    let drained = false;
    void draining.then(() => { drained = true; }, () => {});
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(drained, false, 'the drain waits for the actual write, not just the directory lookup');

    releaseWrite.resolve();
    await invocation;
    assert.equal(await draining, true, 'a caught best-effort failure cannot leave shutdown waiting forever');
    assert.equal(harness.notificationRuntime.getPendingNotificationCount(), 0);
  } finally {
    console.warn = originalWarn;
    releaseRead.resolve([]);
    releaseWrite.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    harness.restore();
  }
});

test('calendar shutdown fence keeps an already-started create and its notification in the drain', async () => {
  const createStarted = deferred<void>();
  const releaseCreate = deferred<ReturnType<typeof calendarEventRow>>();
  const notificationReadStarted = deferred<void>();
  const releaseNotificationRead = deferred<Array<{ id: string; name: string }>>();
  let createCalls = 0;
  const eventInput = {
    calendar_id: 'calendar-1', title: '종료 경계 일정', memo: null, tag_id: null,
    all_day: true, start_date: '2026-09-25', end_date: '2026-09-25',
    start_time: null, end_time: null, linked_episode: null, linked_part: null,
    linked_sheet_name: null, linked_scene_id: null, linked_department: null, linked_todo_id: null,
  };
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
    getCalendarWithMembers: async () => ({
      calendar: calendarRow({ visibility: 'team', owner_id: 'actor' }),
      members: [],
    }),
    createEvent: async () => {
      createCalls += 1;
      createStarted.resolve();
      return releaseCreate.promise;
    },
    insertNotifications: async () => {},
  }, 'actor', {
    readUsers: async () => {
      notificationReadStarted.resolve();
      return releaseNotificationRead.promise;
    },
  });
  try {
    const invocation = harness.invoke('calendar:events:create', eventInput);
    await createStarted.promise;
    assert.ok(harness.notificationRuntime);
    assert.equal(
      harness.notificationRuntime.getPendingNotificationCount(),
      1,
      'the producer fence is registered before the persistence await can race shutdown',
    );

    harness.notificationRuntime.beginQuitting();
    const draining = harness.notificationRuntime.waitForNotificationIdle(1_000);
    assert.equal(await harness.notificationRuntime.waitForNotificationIdle(0), false);

    releaseCreate.resolve(calendarEventRow(eventInput));
    await notificationReadStarted.promise;
    assert.deepEqual(
      await invocation,
      calendarEventRow(eventInput),
      'normal CRUD replies without waiting for the best-effort notification read',
    );
    let drained = false;
    void draining.then(() => { drained = true; }, () => {});
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(drained, false, 'the notification remains in the drain after its producer releases');

    releaseNotificationRead.resolve([]);
    assert.equal(await draining, true);
    assert.equal(harness.notificationRuntime.getPendingNotificationCount(), 0);

    await assert.rejects(
      harness.invoke('calendar:events:create', eventInput),
      /종료|quitting/i,
      'new notification-producing writes are rejected after the intake closes',
    );
    assert.equal(createCalls, 1, 'a post-shutdown create never reaches persistence');
  } finally {
    releaseCreate.resolve(calendarEventRow(eventInput));
    releaseNotificationRead.resolve([]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    harness.restore();
  }
});

test('calendar shutdown fence releases a failed persistence producer', async () => {
  const createStarted = deferred<void>();
  const releaseFailure = deferred<void>();
  const eventInput = {
    calendar_id: 'calendar-1', title: '실패 종료 경계', memo: null, tag_id: null,
    all_day: true, start_date: '2026-09-25', end_date: '2026-09-25',
    start_time: null, end_time: null, linked_episode: null, linked_part: null,
    linked_sheet_name: null, linked_scene_id: null, linked_department: null, linked_todo_id: null,
  };
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
    getCalendarWithMembers: async () => ({ calendar: calendarRow(), members: [] }),
    createEvent: async () => {
      createStarted.resolve();
      await releaseFailure.promise;
      throw new Error('calendar persistence unavailable');
    },
  });
  const originalError = console.error;
  try {
    console.error = () => {};
    const invocation = harness.invoke('calendar:events:create', eventInput);
    void invocation.catch(() => {});
    await createStarted.promise;
    assert.ok(harness.notificationRuntime);
    assert.equal(harness.notificationRuntime.getPendingNotificationCount(), 1);
    harness.notificationRuntime.beginQuitting();
    releaseFailure.resolve();
    await assert.rejects(invocation, /calendar persistence unavailable/);
    assert.equal(
      await harness.notificationRuntime.waitForNotificationIdle(1_000),
      true,
      'a rejected persistence promise always releases its shutdown fence',
    );
    assert.equal(harness.notificationRuntime.getPendingNotificationCount(), 0);
  } finally {
    console.error = originalError;
    releaseFailure.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    harness.restore();
  }
});

test('main shutdown includes the calendar notification drain alongside existing persistence queues', () => {
  const main = readFileSync('electron/main.ts', 'utf8');
  const beforeQuit = main.slice(main.indexOf("app.on('before-quit'"), main.indexOf("process.on('exit'"));
  assert.match(
    main,
    /calendarNotificationDrain\s*=\s*registerCalendarIpc\(/,
    'main keeps the calendar IPC drain returned at registration time',
  );
  assert.match(
    beforeQuit,
    /calendarNotificationDrain\.getPendingNotificationCount\(\)/,
    'calendar notification work contributes to the shutdown pending count',
  );
  const closingIndex = beforeQuit.indexOf('calendarNotificationDrain.beginQuitting()');
  const pendingSnapshotIndex = beforeQuit.indexOf('calendarNotificationDrain.getPendingNotificationCount()');
  assert.ok(
    closingIndex >= 0 && closingIndex < pendingSnapshotIndex,
    'main closes calendar notification intake before snapshotting pending work',
  );
  assert.match(
    beforeQuit,
    /calendarNotificationDrain\.waitForNotificationIdle\(15000\)/,
    'shutdown waits for a bounded calendar notification drain before exit',
  );
});

test('failed calendar notification reads and inserts leave CRUD successful', async (t) => {
  const eventInput = {
    calendar_id: 'calendar-1', title: '실패 격리', memo: null, tag_id: null,
    all_day: true, start_date: '2026-09-25', end_date: '2026-09-25',
    start_time: null, end_time: null, linked_episode: null, linked_part: null,
    linked_sheet_name: null, linked_scene_id: null, linked_department: null, linked_todo_id: null,
  };
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await t.test('read failure', async () => {
      const attempted = deferred<void>();
      const created = calendarEventRow(eventInput);
      const harness = await createIpcHarness({
        getUserRole: async () => 'user',
        getCalendarWithMembers: async () => ({ calendar: calendarRow({ visibility: 'team' }), members: [] }),
        createEvent: async () => created,
      }, 'user-1', {
        readUsers: async () => { attempted.resolve(); throw new Error('directory unavailable'); },
      });
      try {
        assert.deepEqual(await harness.invoke('calendar:events:create', eventInput), created);
        await attempted.promise;
      } finally {
        harness.restore();
      }
    });

    await t.test('insert failure', async () => {
      const attempted = deferred<void>();
      const created = calendarEventRow(eventInput);
      const harness = await createIpcHarness({
        getUserRole: async () => 'user',
        getCalendarWithMembers: async () => ({ calendar: calendarRow({ visibility: 'team' }), members: [] }),
        createEvent: async () => created,
        insertNotifications: async () => { attempted.resolve(); throw new Error('insert unavailable'); },
      }, 'user-1', { readUsers: async () => [{ id: 'other', name: '다른 사용자' }] });
      try {
        assert.deepEqual(await harness.invoke('calendar:events:create', eventInput), created);
        await attempted.promise;
      } finally {
        harness.restore();
      }
    });
  } finally {
    console.warn = originalWarn;
  }
});

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

test('calendar:update persists calendar fields and sanitized members in one storage call', async () => {
  const updates: unknown[][] = [];
  let replaceCalls = 0;
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
    getCalendarWithMembers: async () => ({
      calendar: calendarRow({ visibility: 'members', owner_id: 'user-1' }),
      members: [],
    }),
    updateCalendar: async (...args) => { updates.push(args); },
    replaceMembers: async () => { replaceCalls += 1; },
  });
  try {
    await harness.invoke('calendar:update', 'calendar-1', {
      name: '원자 수정',
      visibility: 'members',
      members: [
        { user_id: 'user-1', can_edit: true, role: 'owner-spoof' },
        { user_id: 'user-2', can_edit: false, role: 'admin-spoof' },
      ],
    });

    assert.deepEqual(updates, [[
      'calendar-1',
      {
        name: '원자 수정',
        visibility: 'members',
        members: [{ user_id: 'user-2', can_edit: false }],
      },
      'user-1',
    ]]);
    assert.equal(replaceCalls, 0);
    assert.deepEqual(harness.broadcasts, [
      { kind: 'data', args: ['calendars', 'UPDATE'] },
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

type ReplacementResult = Awaited<ReturnType<ElectronAPI['calendarPrivacyReplacementCreate']>>;
declare const replacementResult: ReplacementResult;
if (!('transition_resolved' in replacementResult)) {
  replacementResult.settle('keep');
  // @ts-expect-error The main-process receipt never crosses the context bridge.
  replacementResult.receipt;
  // @ts-expect-error The private continuation secret never crosses the context bridge.
  replacementResult.continuation_secret;
}
declare const api: ElectronAPI;
// @ts-expect-error Renderer code cannot invoke a generic raw-receipt settlement route.
api.calendarPrivacyReplacementSettle('raw-receipt', 'delete');
// @ts-expect-error Renderer code cannot choose a raw source-delete target.
api.calendarPrivacyMigrationSourceDelete({ storage: 'bflow', event_id: 'raw-source' });
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
    /CalendarApiInputContract,[\s\S]*from '\.\.\/src\/shared\/calendarApiContract';/,
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
    calendarPrivacyReplacementCreate: [0],
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

test('preload exposes only an opaque privacy replacement continuation', async () => {
  const settleCalls: unknown[][] = [];
  const raw = {
    storage: 'bflow',
    actual_id: 'replacement-1',
    calendar_id: 'calendar-1',
    receipt: 'main-only-receipt',
    continuation_secret: 'main-only-continuation-secret',
  };
  const harness = await loadCalendarPreloadApi(async (channel, ...args) => {
    if (channel === 'calendar:privacy-migration:create-replacement') return raw;
    if (channel === 'calendar:privacy-migration:settle-replacement') {
      settleCalls.push(args);
      return undefined;
    }
    throw new Error(`unexpected preload channel: ${channel}`);
  });
  try {
    const create = harness.api.calendarPrivacyReplacementCreate as ((input: unknown) => Promise<Record<string, unknown>>);
    const created = await create({ storage: 'bflow', event: {} });
    assert.deepEqual(
      Object.keys(created).sort(),
      ['actual_id', 'calendar_id', 'deleteSource', 'settle', 'storage'],
      'the public result contains only event identity plus a narrow continuation function',
    );
    assert.equal('receipt' in created, false);
    assert.equal('continuation_secret' in created, false);
    assert.equal('calendarPrivacyReplacementSettle' in harness.api, false);
    assert.equal('calendarPrivacyMigrationSourceDelete' in harness.api, false);
    assert.equal(typeof created.settle, 'function');
    assert.equal(typeof created.deleteSource, 'function');

    await (created.settle as (disposition: 'keep' | 'delete') => Promise<void>)('delete');
    assert.deepEqual(settleCalls, [[
      raw.receipt,
      raw.continuation_secret,
      'delete',
    ]], 'only the preload closure supplies the private capability to main');
  } finally {
    harness.restore();
  }
});

test('a B flow privacy replacement emits its create notification only after its receipt is kept', async () => {
  const notificationRows: Array<Array<Record<string, unknown>>> = [];
  const inserted = deferred<void>();
  let replacementNumber = 0;
  const replacementCalendar = calendarRow({
    id: 'replacement-calendar',
    name: '이관 대상',
    visibility: 'members',
    owner_id: 'recipient',
  });
  const request = {
    storage: 'bflow' as const,
    event: {
      calendar_id: 'replacement-calendar', title: '보상 전용 일정', memo: null, tag_id: null,
      all_day: true, start_date: '2026-08-26', end_date: '2026-08-26',
      start_time: null, end_time: null, linked_episode: null, linked_part: null,
      linked_sheet_name: null, linked_scene_id: null, linked_department: null, linked_todo_id: null,
    },
  };
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
    getCalendarWithMembers: async () => ({
      calendar: replacementCalendar,
      members: [{ calendar_id: 'replacement-calendar', user_id: 'actor', can_edit: true }],
    }),
    createEvent: async () => calendarEventRow({
      id: `replacement-${++replacementNumber}`,
      calendar_id: 'replacement-calendar',
      title: '보상 전용 일정',
      start_date: '2026-08-26',
      end_date: '2026-08-26',
      created_by: 'actor',
      created_at: `2026-08-26T00:00:0${replacementNumber}.000Z`,
    }),
    deletePrivacyReplacementEvent: async () => {},
    insertNotifications: async (rows) => {
      notificationRows.push(rows as Array<Record<string, unknown>>);
      inserted.resolve();
    },
  }, 'actor', {
    readUsers: async () => [
      { id: 'actor', name: '행위자' },
      { id: 'recipient', name: '수신자' },
    ],
  });
  try {
    const kept = await harness.invokeAs(
      501,
      'calendar:privacy-migration:create-replacement',
      request,
    ) as { receipt: string };

    assert.deepEqual(
      notificationRows,
      [],
      'the provisional replacement is not visible to recipients before source deletion is settled',
    );

    await harness.invokeAs(
      501,
      'calendar:privacy-migration:settle-replacement',
      kept.receipt,
      'keep',
    );
    await inserted.promise;
    assert.deepEqual(notificationRows, [[{
      recipient_id: 'recipient', actor_id: 'actor', actor_name: '행위자',
      calendar_id: 'replacement-calendar', calendar_name: '이관 대상',
      event_id: 'replacement-1', event_title: '보상 전용 일정', event_date: '2026-08-26',
      action: 'create', detail: null,
    }]], 'keeping the replacement emits its create notification exactly once');
    await assert.rejects(
      harness.invokeAs(
        501,
        'calendar:privacy-migration:settle-replacement',
        kept.receipt,
        'keep',
      ),
      /receipt|보상|사용/i,
      'a settled receipt cannot queue the same replacement notification again',
    );
    assert.ok(harness.notificationRuntime);
    assert.equal(await harness.notificationRuntime.waitForNotificationIdle(1_000), true);
    assert.equal(notificationRows.length, 1, 'a duplicate keep attempt adds no notification');

    const compensated = await harness.invokeAs(
      501,
      'calendar:privacy-migration:create-replacement',
      request,
    ) as { receipt: string };
    await harness.invokeAs(
      501,
      'calendar:privacy-migration:settle-replacement',
      compensated.receipt,
      'delete',
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(
      notificationRows.length,
      1,
      'compensating the provisional replacement never exposes a create notification',
    );
  } finally {
    harness.restore();
  }
});

test('a B flow replacement create compensates its exact target when post-create broadcast fails', async () => {
  const replacement = calendarEventRow({
    id: 'broadcast-failure-replacement',
    calendar_id: 'calendar-1',
    created_by: 'user-a',
    created_at: '2026-08-27T03:04:05.678Z',
  });
  const replacementDeletes: unknown[][] = [];
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
    getCalendarWithMembers: async () => ({
      calendar: calendarRow({ owner_id: 'user-a' }),
      members: [],
    }),
    createEvent: async () => replacement,
    getEventByIdForWrite: async () => null,
    deletePrivacyReplacementEvent: async (...args) => { replacementDeletes.push(args); },
  }, 'user-a');
  const originalError = console.error;
  try {
    console.error = () => {};
    harness.broadcastFailure.data = true;
    await assert.rejects(
      harness.invokeAs(501, 'calendar:privacy-migration:create-replacement', {
        storage: 'bflow',
        source: { storage: 'bflow', event_id: 'source-before-broadcast-failure' },
        event: {
          calendar_id: 'calendar-1', title: 'fanout 실패 정리', memo: null, tag_id: null,
          all_day: true, start_date: '2026-08-27', end_date: '2026-08-27',
          start_time: null, end_time: null, linked_episode: null, linked_part: null,
          linked_sheet_name: null, linked_scene_id: null, linked_department: null, linked_todo_id: null,
        },
      }),
      /data broadcast channel closed/,
    );
    assert.deepEqual(replacementDeletes, [[
      'broadcast-failure-replacement',
      'calendar-1',
      '2026-08-27T03:04:05.678Z',
    ]], 'a broadcast failure after persistence still deletes the exact provisional replacement');
  } finally {
    console.error = originalError;
    harness.restore();
  }
});

test('privacy replacement capability keeps the original continuation valid across a session switch without exposing raw settlement', async () => {
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
    ) as {
      actual_id: string;
      receipt: string;
      continuation_secret: string;
      storage: string;
    };
    assert.equal(result.actual_id, 'replacement-user-a');
    assert.equal(result.storage, 'bflow');
    assert.equal(typeof result.receipt, 'string');
    assert.equal(typeof result.continuation_secret, 'string');
    assert.equal(result.receipt.includes('replacement-user-a'), false, 'receipt stays opaque');
    assert.deepEqual(createCalls, [[request.event, 'user-a']]);

    currentUserId = 'user-b';
    actorExists = false;
    const originalError = console.error;
    try {
      console.error = () => {};
      await assert.rejects(
        harness.invokeAs(
          501,
          'calendar:privacy-migration:settle-replacement',
          result.receipt,
          undefined,
          'delete',
        ),
        /secret|continuation|보상/i,
        'a raw receipt without the private continuation secret cannot settle after the session changed',
      );
      await assert.rejects(
        harness.invokeAs(
          501,
          'calendar:privacy-migration:settle-replacement',
          result.receipt,
          'wrong-continuation-secret',
          'delete',
        ),
        /secret|continuation|보상/i,
        'a raw receipt with a forged secret cannot settle after the session changed',
      );
      await assert.rejects(
        harness.invokeAs(
          777,
          'calendar:privacy-migration:settle-replacement',
          result.receipt,
          result.continuation_secret,
          'delete',
        ),
        /receipt|보상|발급/i,
        'another renderer cannot spend the private continuation capability',
      );
      assert.deepEqual(receiptDeleteCalls, []);

      await harness.invokeAs(
        501,
        'calendar:privacy-migration:settle-replacement',
        result.receipt,
        result.continuation_secret,
        'delete',
      );
      assert.deepEqual(receiptDeleteCalls, [[
        'replacement-user-a',
        'personal-user-a',
        '2026-08-25T01:02:03.456Z',
      ]]);

      await assert.rejects(
        harness.invokeAs(
          501,
          'calendar:privacy-migration:settle-replacement',
          result.receipt,
          result.continuation_secret,
          'delete',
        ),
        /receipt|보상|사용/i,
        'a consumed receipt cannot be reused',
      );
      await assert.rejects(
        harness.invokeAs(
          501,
          'calendar:privacy-migration:settle-replacement',
          'forged-receipt',
          result.continuation_secret,
          'delete',
        ),
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

test('privacy replacement transition waits for a bound source delete and keeps only the settled replacement', async () => {
  let origin = { userId: 'user-a', epoch: 7, role: 'user' as const };
  const sourceDeleteStarted = deferred<void>();
  const releaseSourceDelete = deferred<void>();
  const targetDeleteCalls: unknown[][] = [];
  const source = calendarEventRow({
    id: 'source-a',
    calendar_id: 'calendar-1',
    created_by: 'user-a',
  });
  const replacement = calendarEventRow({
    id: 'replacement-a',
    calendar_id: 'calendar-1',
    created_by: 'user-a',
    created_at: '2026-08-27T01:02:03.456Z',
  });
  const request = {
    storage: 'bflow' as const,
    source: { storage: 'bflow' as const, event_id: source.id },
    event: {
      calendar_id: 'calendar-1', title: '이관 대상', memo: null, tag_id: null,
      all_day: true, start_date: '2026-08-27', end_date: '2026-08-27',
      start_time: null, end_time: null, linked_episode: null, linked_part: null,
      linked_sheet_name: null, linked_scene_id: null, linked_department: null, linked_todo_id: null,
    },
  };
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
    getCalendarWithMembers: async () => ({
      calendar: calendarRow({ owner_id: 'user-a', visibility: 'members' }),
      members: [],
    }),
    createEvent: async () => replacement,
    getEventByIdForWrite: async (eventId) => eventId === source.id ? source : null,
    deleteEvent: async (eventId) => {
      assert.equal(eventId, source.id, 'the bound source—not a renderer argument—reaches persistence');
      sourceDeleteStarted.resolve();
      await releaseSourceDelete.promise;
    },
    deletePrivacyReplacementEvent: async (...args) => { targetDeleteCalls.push(args); },
    insertNotifications: async () => {},
  }, () => origin.userId, {
    getSessionOrigin: () => origin,
    readUsers: async () => [{ id: 'user-a', name: 'A' }],
  });
  const originalError = console.error;
  try {
    console.error = () => {};
    const created = await harness.invokeAs(
      501,
      'calendar:privacy-migration:create-replacement',
      request,
    ) as { receipt: string; continuation_secret: string };
    const sourceDelete = harness.invokeAs(
      501,
      'calendar:privacy-migration:delete-bound-source',
      created.receipt,
      created.continuation_secret,
    );
    await sourceDeleteStarted.promise;
    assert.ok(harness.notificationRuntime);
    harness.notificationRuntime.beginPrivacyReplacementTransition({ userId: 'user-a', epoch: 7 });
    const transitionDrain = harness.notificationRuntime.drainPrivacyReplacementTransition({
      userId: 'user-a', epoch: 7,
    });
    let drained = false;
    void transitionDrain.then(() => { drained = true; }, () => {});
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(drained, false, 'the session transition waits for the already-started source delete');

    await assert.rejects(
      harness.invokeAs(
        501,
        'calendar:privacy-migration:settle-replacement',
        created.receipt,
        created.continuation_secret,
        'delete',
      ),
      /전환.*정리|retir/i,
      'a retiring receipt cannot let the renderer choose delete while source deletion is in flight',
    );
    assert.deepEqual(targetDeleteCalls, [], 'the rejected retiring settlement never reaches target persistence');

    origin = { userId: 'user-b', epoch: 8, role: 'user' };
    await assert.rejects(
      harness.invokeAs(
        501,
        'calendar:privacy-migration:delete-bound-source',
        created.receipt,
        created.continuation_secret,
      ),
      /retir|전환|source/i,
      'a retired receipt cannot start a second source mutation in user B\'s session',
    );

    releaseSourceDelete.resolve();
    assert.equal(await sourceDelete, 'deleted');
    assert.equal(await transitionDrain, undefined);
    assert.deepEqual(targetDeleteCalls, [], 'a committed source deletion keeps the exact replacement');

    assert.equal(
      await harness.invokeAs(
        501,
        'calendar:privacy-migration:settle-replacement',
        created.receipt,
        created.continuation_secret,
        'keep',
      ),
      undefined,
      'the retained A continuation sees the transition-owned keep as an idempotent completion',
    );
    await assert.rejects(
      harness.invokeAs(
        501,
        'calendar:privacy-migration:settle-replacement',
        created.receipt,
        created.continuation_secret,
        'delete',
      ),
      /완료|처리|보상/i,
      'the opposite stale disposition cannot mutate the replacement after B publishes',
    );
  } finally {
    console.error = originalError;
    releaseSourceDelete.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    harness.restore();
  }
});

test('a retiring created replacement ignores renderer keep and transition deletes it exactly once', async () => {
  const targetDeleteStarted = deferred<void>();
  const releaseTargetDelete = deferred<void>();
  const targetDeleteCalls: unknown[][] = [];
  const notificationRows: Array<Array<Record<string, unknown>>> = [];
  let sourceDeleteCalls = 0;
  const replacement = calendarEventRow({
    id: 'retiring-created-replacement',
    calendar_id: 'calendar-1',
    created_by: 'user-a',
    created_at: '2026-08-27T04:05:06.789Z',
  });
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
    getCalendarWithMembers: async () => ({
      calendar: calendarRow({
        owner_id: 'recipient',
        visibility: 'members',
      }),
      members: [{ calendar_id: 'calendar-1', user_id: 'user-a', can_edit: true }],
    }),
    createEvent: async () => replacement,
    deleteEvent: async () => { sourceDeleteCalls += 1; },
    deletePrivacyReplacementEvent: async (...args) => {
      targetDeleteCalls.push(args);
      targetDeleteStarted.resolve();
      await releaseTargetDelete.promise;
    },
    insertNotifications: async (rows) => { notificationRows.push(rows as Array<Record<string, unknown>>); },
  }, 'user-a', {
    getSessionOrigin: () => ({ userId: 'user-a', epoch: 7, role: 'user' }),
    readUsers: async () => [
      { id: 'user-a', name: 'A' },
      { id: 'recipient', name: 'R' },
    ],
  });
  try {
    const created = await harness.invokeAs(
      501,
      'calendar:privacy-migration:create-replacement',
      {
        storage: 'bflow',
        source: { storage: 'bflow', event_id: 'source-still-undeleted' },
        event: {
          calendar_id: 'calendar-1', title: '전환 중 created', memo: null, tag_id: null,
          all_day: true, start_date: '2026-08-27', end_date: '2026-08-27',
          start_time: null, end_time: null, linked_episode: null, linked_part: null,
          linked_sheet_name: null, linked_scene_id: null, linked_department: null, linked_todo_id: null,
        },
      },
    ) as { receipt: string; continuation_secret: string };
    assert.ok(harness.notificationRuntime);
    harness.notificationRuntime.beginPrivacyReplacementTransition({ userId: 'user-a', epoch: 7 });
    const transitionDrain = harness.notificationRuntime.drainPrivacyReplacementTransition({
      userId: 'user-a', epoch: 7,
    });
    await targetDeleteStarted.promise;

    await assert.rejects(
      harness.invokeAs(
        501,
        'calendar:privacy-migration:settle-replacement',
        created.receipt,
        created.continuation_secret,
        'keep',
      ),
      /전환.*정리|retir/i,
      'a renderer continuation cannot keep a replacement once transition cleanup owns it',
    );
    assert.equal(sourceDeleteCalls, 0, 'transition cleanup never deletes an undeleted source');
    assert.deepEqual(notificationRows, [], 'the rejected keep queues no create notification');
    assert.equal(targetDeleteCalls.length, 1, 'only transition cleanup begins the exact target deletion');

    releaseTargetDelete.resolve();
    await transitionDrain;
    assert.deepEqual(targetDeleteCalls, [[
      'retiring-created-replacement',
      'calendar-1',
      '2026-08-27T04:05:06.789Z',
    ]]);
    await assert.rejects(
      harness.invokeAs(
        501,
        'calendar:privacy-migration:settle-replacement',
        created.receipt,
        created.continuation_secret,
        'keep',
      ),
      /반대|확정|보상/i,
      'after terminal delete, stale keep cannot revive the replacement',
    );
  } finally {
    releaseTargetDelete.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    harness.restore();
  }
});

test('shutdown drain keeps a transition-owned replacement delete after its source producer releases', async () => {
  const sourceDeleteStarted = deferred<void>();
  const releaseSourceDelete = deferred<void>();
  const targetDeleteStarted = deferred<void>();
  const releaseTargetDelete = deferred<void>();
  let sourceExists = true;
  const source = calendarEventRow({ id: 'transition-drain-source', created_by: 'user-a' });
  const replacement = calendarEventRow({
    id: 'transition-drain-replacement',
    created_by: 'user-a',
    created_at: '2026-08-27T05:06:07.890Z',
  });
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
    getCalendarWithMembers: async () => ({
      calendar: calendarRow({ owner_id: 'user-a' }),
      members: [],
    }),
    createEvent: async () => replacement,
    getEventByIdForWrite: async () => sourceExists ? source : null,
    deleteEvent: async () => {
      sourceDeleteStarted.resolve();
      await releaseSourceDelete.promise;
      sourceExists = false;
      throw new Error('calendar event source changed; refresh and retry');
    },
    deletePrivacyReplacementEvent: async () => {
      targetDeleteStarted.resolve();
      await releaseTargetDelete.promise;
    },
  }, 'user-a', {
    getSessionOrigin: () => ({ userId: 'user-a', epoch: 7, role: 'user' }),
  });
  const originalError = console.error;
  try {
    console.error = () => {};
    const created = await harness.invokeAs(
      501,
      'calendar:privacy-migration:create-replacement',
      {
        storage: 'bflow',
        source: { storage: 'bflow', event_id: source.id },
        event: {
          calendar_id: 'calendar-1', title: '종료 경합 대상', memo: null, tag_id: null,
          all_day: true, start_date: '2026-08-27', end_date: '2026-08-27',
          start_time: null, end_time: null, linked_episode: null, linked_part: null,
          linked_sheet_name: null, linked_scene_id: null, linked_department: null, linked_todo_id: null,
        },
      },
    ) as { receipt: string; continuation_secret: string };
    const sourceDelete = harness.invokeAs(
      501,
      'calendar:privacy-migration:delete-bound-source',
      created.receipt,
      created.continuation_secret,
    );
    await sourceDeleteStarted.promise;
    assert.ok(harness.notificationRuntime);
    harness.notificationRuntime.beginPrivacyReplacementTransition({ userId: 'user-a', epoch: 7 });
    const transitionDrain = harness.notificationRuntime.drainPrivacyReplacementTransition({
      userId: 'user-a', epoch: 7,
    });

    releaseSourceDelete.resolve();
    assert.equal(await sourceDelete, 'missing');
    await targetDeleteStarted.promise;
    harness.notificationRuntime.beginQuitting();
    assert.equal(
      await harness.notificationRuntime.waitForNotificationIdle(0),
      false,
      'the transition-owned exact delete stays visible after the source handler releases its producer fence',
    );

    releaseTargetDelete.resolve();
    await transitionDrain;
    assert.equal(await harness.notificationRuntime.waitForNotificationIdle(1_000), true);
  } finally {
    console.error = originalError;
    releaseSourceDelete.resolve();
    releaseTargetDelete.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    harness.restore();
  }
});

test('shutdown rejects an unreserved privacy transition before it can delete an existing replacement', async () => {
  let targetDeleteCalls = 0;
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
    getCalendarWithMembers: async () => ({
      calendar: calendarRow({ owner_id: 'user-a' }),
      members: [],
    }),
    createEvent: async () => calendarEventRow({
      id: 'shutdown-unreserved-replacement',
      created_by: 'user-a',
      created_at: '2026-08-27T06:07:08.901Z',
    }),
    deletePrivacyReplacementEvent: async () => { targetDeleteCalls += 1; },
  }, 'user-a', {
    getSessionOrigin: () => ({ userId: 'user-a', epoch: 7, role: 'user' }),
  });
  try {
    await harness.invokeAs(501, 'calendar:privacy-migration:create-replacement', {
      storage: 'bflow',
      source: { storage: 'bflow', event_id: 'source-that-must-remain' },
      event: {
        calendar_id: 'calendar-1', title: '종료 뒤 전환 차단', memo: null, tag_id: null,
        all_day: true, start_date: '2026-08-27', end_date: '2026-08-27',
        start_time: null, end_time: null, linked_episode: null, linked_part: null,
        linked_sheet_name: null, linked_scene_id: null, linked_department: null, linked_todo_id: null,
      },
    });
    assert.ok(harness.notificationRuntime);
    assert.equal(harness.notificationRuntime.getPendingNotificationCount(), 0);
    harness.notificationRuntime.beginQuitting();

    assert.throws(
      () => harness.notificationRuntime?.beginPrivacyReplacementTransition({ userId: 'user-a', epoch: 7 }),
      /종료|quitting/i,
      'a transition that begins after quit cannot reserve replacement cleanup work',
    );
    await assert.rejects(
      harness.notificationRuntime.drainPrivacyReplacementTransition({ userId: 'user-a', epoch: 7 }),
      /종료|quitting|예약/i,
    );
    assert.equal(targetDeleteCalls, 0, 'post-quit transition work never reaches exact target deletion');
  } finally {
    harness.restore();
  }
});

test('privacy replacement transition compensates a target created while its origin is retiring', async () => {
  let origin = { userId: 'user-a', epoch: 7, role: 'user' as const };
  const createStarted = deferred<void>();
  const releaseCreate = deferred<ReturnType<typeof calendarEventRow>>();
  const targetDeleteCalls: unknown[][] = [];
  const replacement = calendarEventRow({
    id: 'replacement-race',
    calendar_id: 'calendar-1',
    created_by: 'user-a',
    created_at: '2026-08-27T02:03:04.567Z',
  });
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
    getCalendarWithMembers: async () => ({
      calendar: calendarRow({ owner_id: 'user-a' }),
      members: [],
    }),
    createEvent: async () => {
      createStarted.resolve();
      return releaseCreate.promise;
    },
    deletePrivacyReplacementEvent: async (...args) => { targetDeleteCalls.push(args); },
  }, () => origin.userId, {
    getSessionOrigin: () => origin,
  });
  try {
    const creating = harness.invokeAs(
      501,
      'calendar:privacy-migration:create-replacement',
      {
        storage: 'bflow',
        source: { storage: 'bflow', event_id: 'source-race' },
        event: {
          calendar_id: 'calendar-1', title: '전환 경합 대상', memo: null, tag_id: null,
          all_day: true, start_date: '2026-08-27', end_date: '2026-08-27',
          start_time: null, end_time: null, linked_episode: null, linked_part: null,
          linked_sheet_name: null, linked_scene_id: null, linked_department: null, linked_todo_id: null,
        },
      },
    );
    await createStarted.promise;
    assert.ok(harness.notificationRuntime);
    harness.notificationRuntime.beginPrivacyReplacementTransition({ userId: 'user-a', epoch: 7 });
    const transitionDrain = harness.notificationRuntime.drainPrivacyReplacementTransition({
      userId: 'user-a', epoch: 7,
    });
    origin = { userId: 'user-b', epoch: 8, role: 'user' };
    releaseCreate.resolve(replacement);

    assert.deepEqual(
      await creating,
      { transition_resolved: 'deleted' },
      'a create that wins the DB race returns no usable continuation once its origin retires',
    );
    await transitionDrain;
    assert.deepEqual(targetDeleteCalls, [[
      'replacement-race',
      'calendar-1',
      '2026-08-27T02:03:04.567Z',
    ]], 'the main process compensates the exact persisted target before user B can publish');
  } finally {
    releaseCreate.resolve(replacement);
    await new Promise<void>((resolve) => setImmediate(resolve));
    harness.restore();
  }
});

test('session transition does not publish user B when privacy replacement drain fails', async () => {
  const { SessionManager } = await import('../electron/sessionManager.ts');
  const users = [
    { id: 'user-a', name: 'A', password: 'a', role: 'user' },
    { id: 'user-b', name: 'B', password: 'b', role: 'user' },
  ];
  const published: Array<string | null> = [];
  const begun: Array<{ userId: string; epoch: number }> = [];
  const manager = new SessionManager({
    readUsers: async () => ({ users, status: 'authoritative' as const }),
    readRememberedSession: async () => null,
    writeRememberedSession: async () => undefined,
    beginPersonalDataTransition: () => undefined,
    endPersonalDataTransition: () => undefined,
    drainPersonalDataQueue: async () => undefined,
    flushCalendarJournal: async () => undefined,
    beginPrivacyReplacementTransition: (userId: string, epoch: number) => {
      begun.push({ userId, epoch });
    },
    drainPrivacyReplacementTransition: async () => {
      throw new Error('privacy replacement cleanup unavailable');
    },
    setActivityUser: () => undefined,
    broadcast: (payload: { user: { id: string } | null }) => { published.push(payload.user?.id ?? null); },
  });

  assert.equal((await manager.login({ name: 'A', password: 'a' })).ok, true);
  const switched = await manager.login({ name: 'B', password: 'b' });
  assert.equal(switched.ok, false);
  assert.match(switched.error ?? '', /privacy replacement cleanup unavailable/);
  assert.deepEqual(begun, [{ userId: 'user-a', epoch: 1 }]);
  assert.equal(manager.getCanonicalUserId(), 'user-a');
  assert.deepEqual(published, ['user-a'], 'B is never published after an unresolved A replacement');
});

test('session transition closes personal work and leaves B unpublished when quit blocks privacy transition start', async () => {
  const { SessionManager } = await import('../electron/sessionManager.ts');
  const users = [
    { id: 'user-a', name: 'A', password: 'a', role: 'user' },
    { id: 'user-b', name: 'B', password: 'b', role: 'user' },
  ];
  const published: Array<string | null> = [];
  const ended: Array<{ userId: string; epoch: number }> = [];
  const manager = new SessionManager({
    readUsers: async () => ({ users, status: 'authoritative' as const }),
    readRememberedSession: async () => null,
    writeRememberedSession: async () => undefined,
    beginPersonalDataTransition: () => undefined,
    endPersonalDataTransition: (userId, epoch) => { ended.push({ userId, epoch }); },
    drainPersonalDataQueue: async () => undefined,
    beginPrivacyReplacementTransition: () => {
      throw new Error('앱 종료 중이라 새 캘린더 변경을 저장할 수 없습니다');
    },
    drainPrivacyReplacementTransition: async () => undefined,
    flushCalendarJournal: async () => undefined,
    setActivityUser: () => undefined,
    broadcast: (payload: { user: { id: string } | null }) => { published.push(payload.user?.id ?? null); },
  });

  assert.equal((await manager.login({ name: 'A', password: 'a' })).ok, true);
  const switched = await manager.login({ name: 'B', password: 'b' });
  assert.equal(switched.ok, false);
  assert.match(switched.error ?? '', /종료/);
  assert.deepEqual(ended, [{ userId: 'user-a', epoch: 1 }]);
  assert.equal(manager.getCanonicalUserId(), 'user-a');
  assert.deepEqual(published, ['user-a'], 'B never publishes when shutdown rejects transition reservation');
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
          const predicates = new Map<string, unknown>();
          const builder = {
            eq(field: string, value: unknown) {
              predicates.set(field, value);
              return builder;
            },
            async select(selection: string) {
              assert.equal(selection, 'id');
              assert.deepEqual([...predicates], [
                ['id', 'legacy-event'],
                ['user_id', 'legacy-user'],
              ]);
              return { data: [{ id: 'legacy-event' }], error: null };
            },
          };
          return builder;
        },
      };
    },
  };

  try {
    const module = await loadCalendarSupabasePrivateModule(client);
    await module.updatePrivateEvent('legacy-event', 'legacy-user', {
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

test('legacy update rejects a row deleted after owner pre-read and never broadcasts success', async () => {
  const globalScope = globalThis as Record<string, unknown>;
  const priorHarness = globalScope[SUPABASE_PRIVATE_HARNESS_KEY];
  const hadHarness = Object.prototype.hasOwnProperty.call(globalScope, SUPABASE_PRIVATE_HARNESS_KEY);
  const priorWebSocket = globalScope.WebSocket;
  const hadWebSocket = Object.prototype.hasOwnProperty.call(globalScope, 'WebSocket');
  const broadcasts: Array<{ name: string; args: unknown[] }> = [];
  let row: { id: string; user_id: string } | null = {
    id: 'concurrently-deleted-event',
    user_id: 'legacy-user',
  };
  const client = {
    from(table: string) {
      assert.equal(table, 'private_calendar_events');
      return {
        select(selection: string) {
          assert.equal(selection, 'user_id');
          const predicates = new Map<string, unknown>();
          return {
            eq(field: string, value: unknown) {
              predicates.set(field, value);
              return {
                async maybeSingle() {
                  const matched = row && [...predicates].every(
                    ([key, expected]) => row?.[key as 'id' | 'user_id'] === expected,
                  ) ? { user_id: row.user_id } : null;
                  row = null;
                  return { data: matched, error: null };
                },
              };
            },
          };
        },
        update() {
          const predicates = new Map<string, unknown>();
          const builder = {
            eq(field: string, value: unknown) {
              predicates.set(field, value);
              return builder;
            },
            async select(selection: string) {
              assert.equal(selection, 'id');
              const matched = row && [...predicates].every(
                ([key, expected]) => row?.[key as 'id' | 'user_id'] === expected,
              ) ? [{ id: row.id }] : [];
              return { data: matched, error: null };
            },
          };
          return builder;
        },
      };
    },
  };

  try {
    const module = await loadCalendarSupabasePrivateModule(client, broadcasts);
    const registered = new Map<string, Handler>();
    registerLegacyPrivateEventIpc({
      handle(channel, handler) {
        registered.set(channel, handler as Handler);
      },
    }, {
      getSessionUserIdOrThrow: () => 'legacy-user',
      assertLiveUser: async () => {},
      readEvents: async () => [],
      addEvent: async () => ({ id: 'unused' }),
      getEventOwner: (eventId) => module.getPrivateEventOwner(eventId),
      updateEvent: (eventId, ownerId, updates) => (
        module.updatePrivateEvent(eventId, ownerId, updates)
      ),
      deleteEvent: async () => {},
    });
    const update = registered.get('supabase:update-private-event');
    assert.ok(update);

    await assert.rejects(
      update({}, 'concurrently-deleted-event', { title: '유령 수정' }),
      /찾을 수 없습니다|변경되었습니다/,
    );
    assert.deepEqual(broadcasts, []);
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

test('calendar event move emits an isolated source delete and target create notification', async () => {
  const sourceCalendar = calendarRow({
    id: 'source-calendar',
    name: '원본 전용 캘린더',
    visibility: 'members',
    owner_id: 'source-owner',
  });
  const targetCalendar = calendarRow({
    id: 'target-calendar',
    name: '대상 전용 캘린더',
    visibility: 'members',
    owner_id: 'target-owner',
  });
  const sourceMembers = [
    { calendar_id: 'source-calendar', user_id: 'actor', can_edit: true },
    { calendar_id: 'source-calendar', user_id: 'source-only', can_edit: false },
    { calendar_id: 'source-calendar', user_id: 'common', can_edit: false },
  ];
  const targetMembers = [
    { calendar_id: 'target-calendar', user_id: 'actor', can_edit: true },
    { calendar_id: 'target-calendar', user_id: 'target-only', can_edit: false },
    { calendar_id: 'target-calendar', user_id: 'common', can_edit: false },
  ];
  const previous = calendarEventRow({
    id: 'moving-event',
    calendar_id: 'source-calendar',
    title: '원본 전용 제목',
    start_date: '2026-09-20',
    end_date: '2026-09-20',
    created_by: 'actor',
  });
  const updated = calendarEventRow({
    ...previous,
    calendar_id: 'target-calendar',
    title: '대상 전용 제목',
    start_date: '2026-09-22',
    end_date: '2026-09-22',
  });
  const notificationBatches: Array<Array<Record<string, unknown>>> = [];
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
    getEventByIdForWrite: async () => previous,
    getCalendarWithMembers: async (calendarId) => {
      if (calendarId === 'source-calendar') {
        return { calendar: sourceCalendar, members: sourceMembers };
      }
      if (calendarId === 'target-calendar') {
        return { calendar: targetCalendar, members: targetMembers };
      }
      throw new Error(`unexpected calendar ${String(calendarId)}`);
    },
    updateEvent: async () => updated,
    insertNotifications: async (rows) => {
      notificationBatches.push(rows as Array<Record<string, unknown>>);
    },
  }, 'actor', {
    readUsers: async () => [
      { id: 'actor', name: '행위자' },
      { id: 'source-owner', name: '원본 소유자' },
      { id: 'source-only', name: '원본 멤버' },
      { id: 'target-owner', name: '대상 소유자' },
      { id: 'target-only', name: '대상 멤버' },
      { id: 'common', name: '공통 멤버' },
    ],
  });
  try {
    assert.deepEqual(
      await harness.invoke('calendar:events:update', 'moving-event', {
        calendar_id: 'target-calendar',
        title: '대상 전용 제목',
        start_date: '2026-09-22',
        end_date: '2026-09-22',
      }),
      updated,
    );
    assert.ok(harness.notificationRuntime);
    assert.equal(await harness.notificationRuntime.waitForNotificationIdle(1_000), true);

    const rows = notificationBatches.flat();
    const sourceRows = rows.filter((row) => row.action === 'delete');
    const targetRows = rows.filter((row) => row.action === 'create');
    assert.deepEqual(
      sourceRows.map((row) => row.recipient_id).sort(),
      ['common', 'source-only', 'source-owner'],
      'the source audience receives only the removal context',
    );
    assert.deepEqual(
      targetRows.map((row) => row.recipient_id).sort(),
      ['common', 'target-only', 'target-owner'],
      'the target audience receives only the new-calendar context',
    );
    assert.deepEqual(
      sourceRows.filter((row) => row.recipient_id === 'source-only'),
      [{
        recipient_id: 'source-only', actor_id: 'actor', actor_name: '행위자',
        calendar_id: 'source-calendar', calendar_name: '원본 전용 캘린더',
        event_id: 'moving-event', event_title: '원본 전용 제목', event_date: '2026-09-20',
        action: 'delete', detail: null,
      }],
      'a source-only member never receives target title or calendar metadata',
    );
    assert.deepEqual(
      targetRows.filter((row) => row.recipient_id === 'target-only'),
      [{
        recipient_id: 'target-only', actor_id: 'actor', actor_name: '행위자',
        calendar_id: 'target-calendar', calendar_name: '대상 전용 캘린더',
        event_id: 'moving-event', event_title: '대상 전용 제목', event_date: '2026-09-22',
        action: 'create', detail: null,
      }],
      'a target-only member never receives source title or calendar metadata',
    );
    assert.deepEqual(
      rows.filter((row) => row.recipient_id === 'common').map((row) => ({
        action: row.action,
        calendar_id: row.calendar_id,
        event_title: row.event_title,
      })).sort((left, right) => String(left.action).localeCompare(String(right.action))),
      [
        { action: 'create', calendar_id: 'target-calendar', event_title: '대상 전용 제목' },
        { action: 'delete', calendar_id: 'source-calendar', event_title: '원본 전용 제목' },
      ],
      'a common member may see both, each with its own authoritative context',
    );
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

test('calendar notification catch-up posts every normalized exclusion UUID to its authorized RPC without a GET fallback', async () => {
  const globalScope = globalThis as Record<string, unknown>;
  const hadPrior = Object.prototype.hasOwnProperty.call(globalScope, STORE_HARNESS_KEY);
  const prior = globalScope[STORE_HARNESS_KEY];
  const expectedExcludedIds = Array.from(
    { length: 303 },
    (_, index) => `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  );
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  globalScope[STORE_HARNESS_KEY] = {
    from() {
      assert.fail('notification catch-up must not fall back to a direct GET query');
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return { data: [{ id: 'newest' }], error: null };
    },
  };
  try {
    const encoded = Buffer.from(await bundledCalendarStoreSource()).toString('base64');
    const store = await import(`data:text/javascript;base64,${encoded}#calendar-store-${storeNonce++}`) as {
      listUnreadNotifications(
        recipientId: string,
        sinceIso: string,
        input?: { excludedCalendarIds?: string[] },
      ): Promise<Array<{ id: string }>>;
    };

    assert.deepEqual(
      await store.listUnreadNotifications('canonical-recipient', '2026-07-27T00:00:00.000Z', {
        excludedCalendarIds: [
          expectedExcludedIds[0].toUpperCase(),
          expectedExcludedIds[0],
          'calendar_id.eq.renderer-controlled-recipient',
          ...expectedExcludedIds.slice(1),
        ],
      }),
      [{ id: 'newest' }],
    );
    assert.deepEqual(rpcCalls, [{
      name: 'list_calendar_notifications_authorized',
      args: {
        p_actor_id: 'canonical-recipient',
        p_since: '2026-07-27T00:00:00.000Z',
        p_excluded_calendar_ids: expectedExcludedIds,
      },
    }]);
  } finally {
    if (hadPrior) globalScope[STORE_HARNESS_KEY] = prior;
    else delete globalScope[STORE_HARNESS_KEY];
  }
});

test('calendar notification catch-up forwards all 101 muted calendars before the RPC limit, keeps deletion rows, and never marks rows read', async () => {
  const globalScope = globalThis as Record<string, unknown>;
  const hadPrior = Object.prototype.hasOwnProperty.call(globalScope, STORE_HARNESS_KEY);
  const prior = globalScope[STORE_HARNESS_KEY];
  const mutedCalendarIds = Array.from(
    { length: 101 },
    (_, index) => `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  );
  const visibleCalendarId = '30000000-0000-4000-8000-000000000003';
  const rows = [
    {
      id: 'visible-z',
      recipient_id: 'recipient-1',
      read_at: null,
      calendar_id: visibleCalendarId,
      created_at: '2026-08-26T11:00:00.000Z',
    },
    {
      id: 'visible-a',
      recipient_id: 'recipient-1',
      read_at: null,
      calendar_id: visibleCalendarId,
      created_at: '2026-08-26T11:00:00.000Z',
    },
    {
      id: 'deleted-event',
      recipient_id: 'recipient-1',
      read_at: null,
      calendar_id: null,
      created_at: '2026-08-26T10:00:00.000Z',
    },
  ];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  globalScope[STORE_HARNESS_KEY] = {
    from() {
      assert.fail('notification catch-up must not perform a direct GET query');
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return { data: rows, error: null };
    },
  };
  try {
    const encoded = Buffer.from(await bundledCalendarStoreSource()).toString('base64');
    const store = await import(`data:text/javascript;base64,${encoded}#calendar-store-${storeNonce++}`) as {
      listUnreadNotifications(
        recipientId: string,
        sinceIso: string,
        input?: { excludedCalendarIds?: string[] },
      ): Promise<Array<{ id: string }>>;
    };

    assert.deepEqual(
      (await store.listUnreadNotifications('recipient-1', '2026-07-27T00:00:00.000Z', {
        excludedCalendarIds: mutedCalendarIds,
      })).map((row) => row.id),
      ['visible-z', 'visible-a', 'deleted-event'],
    );
    assert.ok(rows.every((row) => row.read_at === null), 'muting only filters catch-up rows and never marks them read');
    assert.deepEqual(rpcCalls, [{
      name: 'list_calendar_notifications_authorized',
      args: {
        p_actor_id: 'recipient-1',
        p_since: '2026-07-27T00:00:00.000Z',
        p_excluded_calendar_ids: mutedCalendarIds,
      },
    }]);
  } finally {
    if (hadPrior) globalScope[STORE_HARNESS_KEY] = prior;
    else delete globalScope[STORE_HARNESS_KEY];
  }
});

test('calendar notification catch-up ignores malformed exclusion values before the RPC payload', async () => {
  const globalScope = globalThis as Record<string, unknown>;
  const hadPrior = Object.prototype.hasOwnProperty.call(globalScope, STORE_HARNESS_KEY);
  const prior = globalScope[STORE_HARNESS_KEY];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  globalScope[STORE_HARNESS_KEY] = {
    from() {
      assert.fail('notification catch-up must not compose a direct storage filter');
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return { data: [{ id: 'still-visible' }], error: null };
    },
  };
  try {
    const encoded = Buffer.from(await bundledCalendarStoreSource()).toString('base64');
    const store = await import(`data:text/javascript;base64,${encoded}#calendar-store-${storeNonce++}`) as {
      listUnreadNotifications(
        recipientId: string,
        sinceIso: string,
        input?: { excludedCalendarIds?: unknown[] },
      ): Promise<Array<{ id: string }>>;
    };

    assert.deepEqual(
      await store.listUnreadNotifications('recipient-1', '2026-07-27T00:00:00.000Z', {
        excludedCalendarIds: [
          'calendar_id.eq.someone-else',
          '10000000-0000-4000-8000-000000000002),recipient_id.eq(attacker)',
          42,
        ],
      }),
      [{ id: 'still-visible' }],
    );
    assert.deepEqual(rpcCalls, [{
      name: 'list_calendar_notifications_authorized',
      args: {
        p_actor_id: 'recipient-1',
        p_since: '2026-07-27T00:00:00.000Z',
        p_excluded_calendar_ids: [],
      },
    }]);
  } finally {
    if (hadPrior) globalScope[STORE_HARNESS_KEY] = prior;
    else delete globalScope[STORE_HARNESS_KEY];
  }
});

test('calendar notification catch-up soft-reads only its exactly missing authorized RPC', async () => {
  const globalScope = globalThis as Record<string, unknown>;
  const hadPrior = Object.prototype.hasOwnProperty.call(globalScope, STORE_HARNESS_KEY);
  const prior = globalScope[STORE_HARNESS_KEY];
  const originalWarn = console.warn;
  const scenarios = [
    {
      error: {
        code: 'PGRST202',
        message: 'Could not find the function public.list_calendar_notifications_authorized in the schema cache',
      },
      empty: true,
    },
    {
      error: {
        code: '42883',
        message: 'function public.list_calendar_notifications_authorized(text,timestamp with time zone,uuid[]) does not exist',
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
        message: 'temporary connection failure while calling list_calendar_notifications_authorized',
      },
      empty: false,
    },
    {
      error: {
        code: '42P01',
        message: 'relation calendar_notifications does not exist',
      },
      empty: false,
    },
  ] as const;
  try {
    console.warn = () => {};
    const encoded = Buffer.from(await bundledCalendarStoreSource()).toString('base64');
    for (const scenario of scenarios) {
      globalScope[STORE_HARNESS_KEY] = {
        from() {
          assert.fail('notification catch-up must not fall back to a direct GET query');
        },
        rpc: async () => ({ data: null, error: scenario.error }),
      };
      const store = await import(`data:text/javascript;base64,${encoded}#calendar-store-${storeNonce++}`) as {
        listUnreadNotifications(recipientId: string, sinceIso: string): Promise<unknown[]>;
      };
      if (scenario.empty) {
        assert.deepEqual(await store.listUnreadNotifications('recipient-1', '2026-07-27T00:00:00.000Z'), []);
      } else {
        await assert.rejects(
          store.listUnreadNotifications('recipient-1', '2026-07-27T00:00:00.000Z'),
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

test('calendar notification catch-up migration keeps filtering, ordering, and the 200-row cap inside an invoker RPC', () => {
  const migrationPath = join('DEVLOG', 'migrations', '2026-08-27-calendar-notification-catchup.sql');
  assert.ok(existsSync(migrationPath), 'notification catch-up migration must be added separately');
  const sql = readFileSync(migrationPath, 'utf8').replace(/\r\n?/g, '\n');
  assert.match(
    sql,
    /apply only AFTER\s+DEVLOG\/migrations\/2026-08-24-shared-calendars\.sql\s+has successfully been applied/i,
    'the migration must name the successful shared-calendar migration prerequisite',
  );
  assert.match(
    sql,
    /Before deploying v1\.106\.0, manually apply this migration after user approval/i,
    'the migration must require user-approved manual application before this release deploys',
  );
  assert.match(
    sql,
    /Verify that function public\.list_calendar_notifications_authorized and partial index idx_calendar_notifications_unread_recipient_created_id exist\. This PR does not execute SQL\./i,
    'the migration must name its post-apply verification and state that this PR never executes SQL',
  );
  const functionStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.list_calendar_notifications_authorized');
  const functionEnd = sql.indexOf('COMMENT ON FUNCTION public.list_calendar_notifications_authorized');
  assert.ok(functionStart >= 0 && functionEnd > functionStart, 'authorized catch-up RPC must have a bounded definition');
  const functionSql = sql.slice(functionStart, functionEnd);

  assert.match(
    functionSql,
    /p_actor_id\s+TEXT[\s\S]*p_since\s+TIMESTAMPTZ[\s\S]*p_excluded_calendar_ids\s+UUID\[\]\s+DEFAULT\s+ARRAY\[\]::UUID\[\][\s\S]*RETURNS\s+SETOF\s+public\.calendar_notifications/i,
  );
  assert.match(functionSql, /LANGUAGE\s+sql\s+SECURITY INVOKER\s+SET search_path\s*=\s*public,\s*pg_temp\s+STABLE/i);
  assert.doesNotMatch(functionSql, /SECURITY DEFINER/i);
  assert.match(
    functionSql,
    /unnest\s*\(\s*COALESCE\s*\(\s*p_excluded_calendar_ids\s*,\s*ARRAY\[\]::UUID\[\]\s*\)\s*\)\s+AS\s+input\s*\(\s*excluded_calendar_id\s*\)/i,
  );
  assert.match(functionSql, /input\.excluded_calendar_id\s+IS\s+NOT\s+NULL/i);
  assert.match(functionSql, /FROM\s+public\.users\s+AS\s+actor[\s\S]*actor\.id\s*=\s*p_actor_id/i);
  assert.match(functionSql, /notification\.recipient_id\s*=\s*p_actor_id/i);
  assert.match(functionSql, /notification\.read_at\s+IS\s+NULL/i);
  assert.match(functionSql, /notification\.created_at\s*>=\s*p_since/i);
  assert.match(
    functionSql,
    /LEFT JOIN\s+excluded_calendar_ids\s+AS\s+excluded\s+ON\s+excluded\.excluded_calendar_id\s*=\s*notification\.calendar_id/i,
  );
  assert.match(functionSql, /excluded\.excluded_calendar_id\s+IS\s+NULL/i);
  assert.match(functionSql, /ORDER BY\s+notification\.created_at\s+DESC\s*,\s*notification\.id\s+DESC\s+LIMIT\s+200\s*;/i);
  assert.match(
    sql,
    /CREATE INDEX IF NOT EXISTS idx_calendar_notifications_unread_recipient_created_id\s+ON public\.calendar_notifications\s+\(recipient_id, created_at DESC, id DESC\)\s+WHERE read_at IS NULL\s*;/i,
  );
});

test('calendar notification catch-up binds the recipient to the canonical session while forwarding only safe muted calendar ids', async () => {
  const calls: unknown[][] = [];
  const safeCalendarId = '10000000-0000-4000-8000-000000000002';
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
    listUnreadNotifications: async (...args: unknown[]) => {
      calls.push(args);
      return [];
    },
  }, 'canonical-recipient');
  try {
    await harness.invoke('calendar:notifications:catchup', {
      recipientId: 'renderer-controlled-recipient',
      excludedCalendarIds: [
        safeCalendarId,
        safeCalendarId,
        'calendar_id.eq.renderer-controlled-recipient',
      ],
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'canonical-recipient');
    assert.equal(typeof calls[0][1], 'string');
    assert.deepEqual(calls[0][2], { excludedCalendarIds: [safeCalendarId] });
  } finally {
    harness.restore();
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

type SharedCalendarReceiver = (raw: unknown) => Promise<boolean>;

const CALENDAR_RECEIVER_HARNESS_KEY = '__calendarReceiverBehaviorHarness';
let appCalendarReceiverBundle: Promise<string> | undefined;
let popupCalendarReceiverBundle: Promise<string> | undefined;

function calendarReceiverTestPlugin(): Plugin {
  return {
    name: 'calendar-receiver-test-dependencies',
    setup(builder) {
      builder.onResolve({ filter: /^@\/services\/calendarService$/ }, () => ({
        path: 'calendar-service',
        namespace: 'calendar-receiver-test',
      }));
      builder.onLoad({ filter: /^calendar-service$/, namespace: 'calendar-receiver-test' }, () => ({
        contents: [
          `const state = () => globalThis.${CALENDAR_RECEIVER_HARNESS_KEY};`,
          'export const loadBflowEvents = (...args) => state().loadBflowEvents(...args);',
          'export const applyCommittedGoogleDelete = () => false;',
          'export const applyCommittedPrivacyReplacementDelete = () => false;',
          'export const syncAll = async () => [];',
          'export const syncIncremental = async () => {};',
        ].join('\n'),
      }));
      builder.onResolve({ filter: /^@\/services\/googleCalendarService$/ }, () => ({
        path: 'google-calendar-service',
        namespace: 'calendar-receiver-test',
      }));
      builder.onLoad({ filter: /^google-calendar-service$/, namespace: 'calendar-receiver-test' }, () => ({
        contents: 'export const isAuthenticated = async () => false;',
      }));
    },
  };
}

async function bundledCalendarReceiverSource(entryPoint: 'src/App.tsx' | 'src/views/WidgetPopup.tsx') {
  const cache = entryPoint === 'src/App.tsx' ? appCalendarReceiverBundle : popupCalendarReceiverBundle;
  if (cache) return cache;
  const pending = build({
    entryPoints: [entryPoint],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    write: false,
    packages: 'external',
    external: ['@/*', '*.css'],
    plugins: [calendarReceiverTestPlugin()],
  }).then((result) => result.outputFiles[0].text);
  if (entryPoint === 'src/App.tsx') appCalendarReceiverBundle = pending;
  else popupCalendarReceiverBundle = pending;
  return pending;
}

async function loadSharedCalendarReceiver(
  entryPoint: 'src/App.tsx' | 'src/views/WidgetPopup.tsx',
  exportName: string,
  loadBflowEvents: (options?: Record<string, unknown>) => Promise<boolean>,
): Promise<SharedCalendarReceiver | undefined> {
  const source = await bundledCalendarReceiverSource(entryPoint);
  (globalThis as Record<string, unknown>)[CALENDAR_RECEIVER_HARNESS_KEY] = { loadBflowEvents };
  const module = { exports: {} as Record<string, unknown> };
  const nodeRequire = createRequire(import.meta.url);
  const noop = () => undefined;
  const mockExport = new Proxy(noop, {
    get: (_target, key) => (key === '__esModule' ? true : mockExport),
  });
  const mockModule = new Proxy({ __esModule: true } as Record<string, unknown>, {
    get: (_target, key) => (key === '__esModule' ? true : mockExport),
  });
  const runtimeRequire = (id: string): unknown => {
    if (id === 'react' || id === 'react/jsx-runtime' || id === 'react-dom') {
      return nodeRequire(id);
    }
    return mockModule;
  };
  const evaluate = new Function('require', 'module', 'exports', source);
  evaluate(runtimeRequire, module, module.exports);
  return module.exports[exportName] as SharedCalendarReceiver | undefined;
}

async function withCalendarReceiverWindow(
  run: (order: string[], received: unknown[]) => Promise<void>,
): Promise<void> {
  const globalScope = globalThis as Record<string, unknown>;
  const previousHarness = {
    exists: Object.prototype.hasOwnProperty.call(globalScope, CALENDAR_RECEIVER_HARNESS_KEY),
    value: globalScope[CALENDAR_RECEIVER_HARNESS_KEY],
  };
  const previousWindow = {
    exists: Object.prototype.hasOwnProperty.call(globalScope, 'window'),
    value: globalScope.window,
  };
  const previousCustomEvent = {
    exists: Object.prototype.hasOwnProperty.call(globalScope, 'CustomEvent'),
    value: globalScope.CustomEvent,
  };
  const order: string[] = [];
  const received: unknown[] = [];
  const receiverWindow = new EventTarget();
  receiverWindow.addEventListener('bflow:calendar-changed', (event) => {
    order.push('ui-refresh');
    received.push((event as Event & { detail?: unknown }).detail);
  });
  globalScope.window = receiverWindow;
  globalScope.CustomEvent = class extends Event {
    detail: unknown;
    constructor(type: string, init?: { detail?: unknown }) {
      super(type);
      this.detail = init?.detail;
    }
  };
  try {
    await run(order, received);
  } finally {
    if (previousWindow.exists) globalScope.window = previousWindow.value;
    else delete globalScope.window;
    if (previousCustomEvent.exists) globalScope.CustomEvent = previousCustomEvent.value;
    else delete globalScope.CustomEvent;
    if (previousHarness.exists) globalScope[CALENDAR_RECEIVER_HARNESS_KEY] = previousHarness.value;
    else delete globalScope[CALENDAR_RECEIVER_HARNESS_KEY];
  }
}

for (const receiver of [
  {
    label: 'main',
    entryPoint: 'src/App.tsx' as const,
    exportName: 'applyIncomingSharedBflowCalendarChangeInApp',
  },
  {
    label: 'popup',
    entryPoint: 'src/views/WidgetPopup.tsx' as const,
    exportName: 'applyIncomingSharedBflowCalendarChangeInPopup',
  },
]) {
  test(`${receiver.label} receiver reloads canonical B flow rows before refreshing shared-calendar UI`, async () => {
    await withCalendarReceiverWindow(async (order, received) => {
      const loadGate = deferred<void>();
      const loadStarted = deferred<void>();
      const loadOptions: Array<Record<string, unknown> | undefined> = [];
      const handler = await loadSharedCalendarReceiver(
        receiver.entryPoint,
        receiver.exportName,
        async (options) => {
          loadOptions.push(options);
          order.push('canonical-load');
          loadStarted.resolve(undefined);
          await loadGate.promise;
          return true;
        },
      );
      assert.ok(handler, `${receiver.label} must expose the receiver used by its subscriptions`);

      const memberChange = {
        event: 'data-change',
        payload: { table: 'calendar_members', action: 'UPDATE', ts: 1 },
      };
      const genericCalendarChange = {
        event: 'calendar-changed',
        payload: { action: 'UPDATE', ts: 2 },
      };
      const first = handler(memberChange);
      const duplicate = handler(genericCalendarChange);
      const localWindowSignal = handler({ event: 'local-calendar-changed', payload: undefined });
      await loadStarted.promise;

      assert.deepEqual(order, ['canonical-load'], 'UI subscribers must wait for canonical rows');
      assert.deepEqual(loadOptions, [{ broadcast: false }], 'receiver reload must not rebroadcast');

      loadGate.resolve(undefined);
      assert.deepEqual(await Promise.all([first, duplicate, localWindowSignal]), [true, true, true]);
      assert.deepEqual(order, ['canonical-load', 'ui-refresh']);
      assert.equal(received.length, 1, 'paired data/calendar signals are coalesced into one UI refresh');
    });
  });

  test(`${receiver.label} receiver reruns when a newer shared-calendar signal arrives during the canonical read`, async () => {
    await withCalendarReceiverWindow(async (order, received) => {
      const firstGate = deferred<void>();
      const secondGate = deferred<void>();
      const firstStarted = deferred<void>();
      const secondStarted = deferred<void>();
      let loads = 0;
      const handler = await loadSharedCalendarReceiver(
        receiver.entryPoint,
        receiver.exportName,
        async () => {
          loads += 1;
          order.push(`canonical-load-${loads}`);
          if (loads === 1) {
            firstStarted.resolve(undefined);
            await firstGate.promise;
          } else {
            secondStarted.resolve(undefined);
            await secondGate.promise;
          }
          return true;
        },
      );
      assert.ok(handler);

      const first = handler({ table: 'calendars', payload: { eventType: 'UPDATE' } });
      await firstStarted.promise;
      const newer = handler({ table: 'calendar_members', payload: { eventType: 'UPDATE' } });
      firstGate.resolve(undefined);
      await secondStarted.promise;

      assert.deepEqual(
        order,
        ['canonical-load-1', 'canonical-load-2'],
        'the stale read must not refresh UI before the queued canonical reread',
      );
      assert.deepEqual(received, []);

      secondGate.resolve(undefined);
      assert.deepEqual(await Promise.all([first, newer]), [true, true]);
      assert.deepEqual(order, ['canonical-load-1', 'canonical-load-2', 'ui-refresh']);
      assert.equal(received.length, 1);
    });
  });
}

type RealtimeStatusMetadata = { reconnected?: boolean };
type RealtimeStatusListener = (
  status: string,
  metadata?: RealtimeStatusMetadata,
) => boolean | Promise<boolean> | void;
type RealtimeStatusSubscriber = (listener: RealtimeStatusListener) => () => void;

test('main calendar reconnect subscription skips the first join and catches up canonical rows after a real reconnect', async () => {
  await withCalendarReceiverWindow(async (order, received) => {
    const loadGate = deferred<void>();
    const loadStarted = deferred<void>();
    const loadOptions: Array<Record<string, unknown> | undefined> = [];
    const exported = await loadSharedCalendarReceiver(
      'src/App.tsx',
      'installAppRealtimeCalendarReconnectCatchUp',
      async (options) => {
        loadOptions.push(options);
        order.push('canonical-load');
        loadStarted.resolve(undefined);
        await loadGate.promise;
        return true;
      },
    );
    const install = exported as unknown as undefined | ((
      reloadGeneralData: () => void,
      subscribe: RealtimeStatusSubscriber,
    ) => () => void);
    assert.ok(install, 'App must expose the production status subscription used by its effect');

    let listener: RealtimeStatusListener | undefined;
    let cleanups = 0;
    const cleanup = install!(
      () => { order.push('general-load'); },
      (next) => {
        listener = next;
        return () => { cleanups += 1; };
      },
    );
    assert.ok(listener);

    assert.equal(await listener!('SUBSCRIBED', { reconnected: false }), false);
    assert.deepEqual(
      order,
      ['general-load'],
      'the initial subscription keeps the existing general reload without adding a calendar read',
    );

    const catchUp = listener!('SUBSCRIBED', { reconnected: true }) as Promise<boolean>;
    await loadStarted.promise;
    assert.deepEqual(order, ['general-load', 'general-load', 'canonical-load']);
    assert.deepEqual(loadOptions, [{ broadcast: false }]);
    assert.deepEqual(received, [], 'UI consumers must wait for the authorized canonical read');

    loadGate.resolve(undefined);
    assert.equal(await catchUp, true);
    assert.deepEqual(order, ['general-load', 'general-load', 'canonical-load', 'ui-refresh']);
    assert.equal(received.length, 1);
    cleanup();
    assert.equal(cleanups, 1);
  });
});

test('popup calendar reconnect subscription skips the first join and catches up its independent cache after reconnect', async () => {
  await withCalendarReceiverWindow(async (order, received) => {
    const loadGate = deferred<void>();
    const loadStarted = deferred<void>();
    const loadOptions: Array<Record<string, unknown> | undefined> = [];
    const exported = await loadSharedCalendarReceiver(
      'src/views/WidgetPopup.tsx',
      'installPopupRealtimeCalendarReconnectCatchUp',
      async (options) => {
        loadOptions.push(options);
        order.push('canonical-load');
        loadStarted.resolve(undefined);
        await loadGate.promise;
        return true;
      },
    );
    const install = exported as unknown as undefined | ((
      subscribe: RealtimeStatusSubscriber,
    ) => () => void);
    assert.ok(install, 'WidgetPopup must expose the production status subscription used by its effect');

    let listener: RealtimeStatusListener | undefined;
    let cleanups = 0;
    const cleanup = install!((next) => {
      listener = next;
      return () => { cleanups += 1; };
    });
    assert.ok(listener);

    assert.equal(await listener!('SUBSCRIBED', { reconnected: false }), false);
    assert.deepEqual(order, [], 'the first popup join must not duplicate its initial calendar load');

    const catchUp = listener!('SUBSCRIBED', { reconnected: true }) as Promise<boolean>;
    await loadStarted.promise;
    assert.deepEqual(order, ['canonical-load']);
    assert.deepEqual(loadOptions, [{ broadcast: false }]);
    assert.deepEqual(received, []);

    loadGate.resolve(undefined);
    assert.equal(await catchUp, true);
    assert.deepEqual(order, ['canonical-load', 'ui-refresh']);
    assert.equal(received.length, 1);
    cleanup();
    assert.equal(cleanups, 1);
  });
});
