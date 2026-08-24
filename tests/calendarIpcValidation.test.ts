import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { build, type Plugin } from 'esbuild';

type Handler = (_event: unknown, ...args: unknown[]) => Promise<unknown>;

type IpcHarnessState = {
  handlers: Map<string, Handler>;
  store: Record<string, (...args: unknown[]) => unknown>;
  broadcasts: Array<{ kind: 'data' | 'calendar'; args: unknown[] }>;
};

type CalendarIpcExternalDeps = {
  createLegacyPrivateEvent?: (input: Record<string, unknown>, actorId: string) => Promise<{ id: string }>;
  deleteLegacyPrivateEvent?: (eventId: string, actorId: string) => Promise<void>;
  createGoogleEvent?: (calendarId: string, input: unknown, actorId: string) => Promise<string>;
  deleteGoogleEvent?: (calendarId: string, eventId: string, actorId: string) => Promise<void>;
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
      createGoogleEvent: externalDeps.createGoogleEvent ?? (async () => {
        throw new Error('unexpected Google replacement create');
      }),
      deleteGoogleEvent: externalDeps.deleteGoogleEvent ?? (async () => {
        throw new Error('unexpected Google replacement delete');
      }),
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
    assert.deepEqual(harness.broadcasts, []);

    current = previous;
    deleteOutcome = 'permission-error';
    await assert.rejects(
      harness.invoke('calendar:privacy-migration:delete-source', previous.id),
      /42501.*permission denied/,
    );
    assert.deepEqual(harness.broadcasts, []);
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
        assert.deepEqual(harness.broadcasts, []);
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
  const createCalls: unknown[][] = [];
  const receiptDeleteCalls: unknown[][] = [];
  const created = calendarEventRow({
    id: 'replacement-user-a',
    calendar_id: 'personal-user-a',
    created_by: 'user-a',
    created_at: '2026-08-25T01:02:03.456Z',
  });
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
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
  const harness = await createIpcHarness({}, () => currentUserId, {
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

test('privacy replacement receipt is consumed on keep and on a failed compensation attempt', async () => {
  let deleteCalls = 0;
  const harness = await createIpcHarness({
    getUserRole: async () => 'user',
    getCalendarWithMembers: async () => ({ calendar: calendarRow(), members: [] }),
    createEvent: async () => calendarEventRow({ id: `replacement-${deleteCalls}` }),
    deletePrivacyReplacementEvent: async () => {
      deleteCalls += 1;
      throw new Error('privacy replacement row identity no longer matches');
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
    await assert.rejects(
      harness.invoke('calendar:privacy-migration:settle-replacement', failing.receipt, 'delete'),
      /receipt|보상|사용/i,
    );
    assert.equal(deleteCalls, 1);
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
