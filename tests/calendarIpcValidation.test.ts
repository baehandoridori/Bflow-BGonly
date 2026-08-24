import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { build, type Plugin } from 'esbuild';

type Handler = (_event: unknown, ...args: unknown[]) => Promise<unknown>;

type IpcHarnessState = {
  handlers: Map<string, Handler>;
  store: Record<string, (...args: unknown[]) => unknown>;
  broadcasts: Array<{ kind: 'data' | 'calendar'; args: unknown[] }>;
};

const IPC_HARNESS_KEY = '__calendarIpcBehaviorHarness';
const STORE_HARNESS_KEY = '__calendarStoreStrictReadHarness';
let ipcBundle: Promise<string> | undefined;
let ipcNonce = 0;
let storeBundle: Promise<string> | undefined;
let storeNonce = 0;

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
          `export const broadcastDataChange = (...args) => globalThis.${IPC_HARNESS_KEY}.broadcasts.push({ kind: 'data', args });`,
          `export const broadcastCalendarChanged = (...args) => globalThis.${IPC_HARNESS_KEY}.broadcasts.push({ kind: 'calendar', args });`,
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

function defaultStore(): IpcHarnessState['store'] {
  const unexpected = (name: string) => async () => { throw new Error(`unexpected store call: ${name}`); };
  return Object.fromEntries(storeFunctionNames.map((name) => [name, unexpected(name)]));
}

async function createIpcHarness(
  overrides: Partial<IpcHarnessState['store']> = {},
  userId = 'user-1',
): Promise<IpcHarnessState & { invoke(channel: string, ...args: unknown[]): Promise<unknown>; restore(): void }> {
  const globalScope = globalThis as Record<string, unknown>;
  const hadPrior = Object.prototype.hasOwnProperty.call(globalScope, IPC_HARNESS_KEY);
  const prior = globalScope[IPC_HARNESS_KEY];
  const state: IpcHarnessState = {
    handlers: new Map(),
    store: { ...defaultStore(), ...overrides },
    broadcasts: [],
  };
  globalScope[IPC_HARNESS_KEY] = state;
  try {
    const encoded = Buffer.from(await bundledCalendarIpcSource()).toString('base64');
    const module = await import(`data:text/javascript;base64,${encoded}#calendar-ipc-${ipcNonce++}`) as {
      registerCalendarIpc(deps: { getSessionUserIdOrThrow(): string }): void;
    };
    module.registerCalendarIpc({ getSessionUserIdOrThrow: () => userId });
    return {
      ...state,
      async invoke(channel, ...args) {
        const handler = state.handlers.get(channel);
        assert.ok(handler, `missing IPC handler: ${channel}`);
        return handler(null, ...args);
      },
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
    ]]);
    assert.deepEqual(harness.broadcasts, [
      { kind: 'data', args: ['calendar_members', 'UPDATE'] },
      { kind: 'calendar', args: ['UPDATE'] },
    ]);
  } finally {
    harness.restore();
  }
});

test('calendar:create keeps omitted members equivalent to an empty member list', async () => {
  let replaceCalls = 0;
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
    createCalendar: async () => calendarRow({ visibility: 'members' }),
    replaceMembers: async () => { replaceCalls += 1; },
  });
  try {
    await harness.invoke('calendar:create', {
      name: '공유 캘린더',
      color: '#6C5CE7',
      visibility: 'members',
    });
    assert.equal(replaceCalls, 0);
    assert.deepEqual(harness.broadcasts, [
      { kind: 'data', args: ['calendars', 'INSERT'] },
      { kind: 'calendar', args: ['INSERT'] },
    ]);
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
    await harness.invoke('calendar:events:delete', 'already-gone');
    assert.equal(deleteCalls, 0);
  } finally {
    console.error = originalError;
    harness.restore();
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
