import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { build, type Plugin } from 'esbuild';
import * as calendarWindowFanout from '../electron/calendarWindowFanout.ts';

type RegisteredHandler = {
  type: string;
  filter: Record<string, unknown>;
  handler: (payload: Record<string, unknown>) => void;
};

const REALTIME_HARNESS_KEY = '__calendarRealtimeSubscriptionHarness';
const BROADCAST_HARNESS_KEY = '__calendarLocalBroadcastHarness';
let bundleNonce = 0;

async function bundleModule(entry: string, plugin: Plugin): Promise<Record<string, unknown>> {
  const result = await build({
    stdin: {
      contents: entry,
      resolveDir: process.cwd(),
      sourcefile: 'calendar-realtime-fanout-entry.ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    plugins: [plugin],
    write: false,
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}#calendar-realtime-${bundleNonce++}`) as Promise<Record<string, unknown>>;
}

function retryStub(namespace: string, schedule: string = '() => true'): Plugin {
  return {
    name: `${namespace}-retry-stub`,
    setup(builder) {
      builder.onResolve({ filter: /^\.\/retry-utils$/ }, () => ({ path: 'retry-utils', namespace }));
      builder.onLoad({ filter: /^retry-utils$/, namespace }, () => ({
        contents: `export const createRetryManager = () => ({ schedule: ${schedule}, reset() {}, clear() {} });`,
      }));
    },
  };
}

function realtimePlugin(): Plugin {
  const retry = retryStub(
    'calendar-realtime-test',
    `(callback) => {
      globalThis.${REALTIME_HARNESS_KEY}.retryCallbacks?.push(callback);
      return true;
    }`,
  );
  return {
    name: 'calendar-realtime-test-dependencies',
    setup(builder) {
      retry.setup(builder);
      builder.onResolve({ filter: /^\.\/supabase$/ }, () => ({
        path: 'supabase',
        namespace: 'calendar-realtime-test',
      }));
      builder.onLoad({ filter: /^supabase$/, namespace: 'calendar-realtime-test' }, () => ({
        contents: `export const supabase = globalThis.${REALTIME_HARNESS_KEY}.supabase;`,
      }));
    },
  };
}

function broadcastPlugin(): Plugin {
  const retry = retryStub('calendar-broadcast-test');
  return {
    name: 'calendar-broadcast-test-dependencies',
    setup(builder) {
      retry.setup(builder);
      builder.onResolve({ filter: /^\.\/supabase$/ }, () => ({
        path: 'supabase',
        namespace: 'calendar-broadcast-test',
      }));
      builder.onLoad({ filter: /^supabase$/, namespace: 'calendar-broadcast-test' }, () => ({
        contents: `export const supabase = globalThis.${BROADCAST_HARNESS_KEY}.supabase;`,
      }));
    },
  };
}

test('the live Supabase realtime channel forwards shared-calendar changes as row-free invalidations', async () => {
  const registrations: RegisteredHandler[] = [];
  const channel = {
    on(type: string, filter: Record<string, unknown>, handler: RegisteredHandler['handler']) {
      registrations.push({ type, filter, handler });
      return this;
    },
    subscribe(callback?: (status: string) => void) {
      callback?.('SUBSCRIBED');
      return this;
    },
    presenceState: () => ({}),
    track: async () => 'ok',
  };
  (globalThis as Record<string, unknown>)[REALTIME_HARNESS_KEY] = {
    supabase: {
      channel: () => channel,
      removeChannel: () => {},
    },
  };

  try {
    const module = await bundleModule(
      "export * from './electron/realtime.ts';",
      realtimePlugin(),
    );
    const setup = module.setupRealtimeSubscription as ((callbacks: Record<string, unknown>) => () => void);
    const received: Array<{ table: string; payload: Record<string, unknown> }> = [];
    const noOp = () => {};
    const cleanup = setup({
      onSceneChange: noOp,
      onCommentChange: noOp,
      onRevisionChange: noOp,
      onRevisionSetChange: noOp,
      onEpisodeChange: noOp,
      onPartChange: noOp,
      onSceneWorkLinkChange: noOp,
      onActivityInsert: noOp,
      onStatusChange: noOp,
      onCalendarChange: (table: string, payload: Record<string, unknown>) => {
        received.push({ table, payload });
      },
    });

    const expectedTables = ['calendars', 'calendar_members', 'calendar_events', 'calendar_tags'];
    const calendarRegistrations = registrations.filter(({ type, filter }) => (
      type === 'postgres_changes' && expectedTables.includes(String(filter.table))
    ));
    assert.deepEqual(
      calendarRegistrations.map(({ filter }) => filter.table),
      expectedTables,
      'every canonical shared-calendar table must be on the actual bflow-realtime channel',
    );
    for (const registration of calendarRegistrations) {
      registration.handler({
        eventType: 'UPDATE',
        schema: 'public',
        table: registration.filter.table,
        commit_timestamp: '2026-08-25T00:00:00.000Z',
        new: {
          id: registration.filter.table,
          title: '권한 없는 사용자가 보면 안 되는 일정 제목',
          memo: '권한 없는 사용자가 보면 안 되는 메모',
        },
        old: {
          id: registration.filter.table,
          title: '수정 전 비공개 제목',
        },
        row: {
          title: 'SDK 모양이 바뀌어도 전달하면 안 되는 행',
        },
      });
    }
    assert.deepEqual(
      received,
      expectedTables.map((table) => ({ table, payload: { eventType: 'UPDATE' } })),
      'renderer invalidations may identify the fixed table and event type, but must never include database rows',
    );
    cleanup();
  } finally {
    delete (globalThis as Record<string, unknown>)[REALTIME_HARNESS_KEY];
  }
});

test('the live Realtime status contract distinguishes an actual reconnect from the first subscription', async () => {
  const statusCallbacks: Array<(status: string) => void> = [];
  const retryCallbacks: Array<() => void> = [];
  const channels: Array<Record<string, unknown>> = [];
  (globalThis as Record<string, unknown>)[REALTIME_HARNESS_KEY] = {
    retryCallbacks,
    supabase: {
      channel: () => {
        const channel = {
          on() { return this; },
          subscribe(callback?: (status: string) => void) {
            if (callback) statusCallbacks.push(callback);
            return this;
          },
          presenceState: () => ({}),
          track: async () => 'ok',
        };
        channels.push(channel);
        return channel;
      },
      removeChannel: () => {},
    },
  };

  try {
    const module = await bundleModule(
      "export * from './electron/realtime.ts';",
      realtimePlugin(),
    );
    const setup = module.setupRealtimeSubscription as ((callbacks: Record<string, unknown>) => () => void);
    const subscribed: Array<{ status: string; reconnected: unknown }> = [];
    const noOp = () => {};
    const callbacks = {
      onSceneChange: noOp,
      onCommentChange: noOp,
      onRevisionChange: noOp,
      onRevisionSetChange: noOp,
      onEpisodeChange: noOp,
      onPartChange: noOp,
      onSceneWorkLinkChange: noOp,
      onActivityInsert: noOp,
      onCalendarChange: noOp,
      onStatusChange: (status: string, metadata?: { reconnected?: boolean }) => {
        if (status === 'SUBSCRIBED') {
          subscribed.push({ status, reconnected: metadata?.reconnected });
        }
      },
    };
    const cleanup = setup(callbacks);

    assert.equal(channels.length, 1);
    statusCallbacks[0]('SUBSCRIBED');
    assert.deepEqual(subscribed, [{ status: 'SUBSCRIBED', reconnected: false }]);

    statusCallbacks[0]('CHANNEL_ERROR');
    assert.equal(retryCallbacks.length, 1, 'a channel failure must schedule the production reconnect path');
    statusCallbacks[0]('SUBSCRIBED');
    assert.deepEqual(subscribed, [
      { status: 'SUBSCRIBED', reconnected: false },
      { status: 'SUBSCRIBED', reconnected: true },
    ], 'the SDK same-channel auto-rejoin is also a catch-up boundary');
    statusCallbacks[0]('SUBSCRIBED');
    assert.deepEqual(subscribed, [
      { status: 'SUBSCRIBED', reconnected: false },
      { status: 'SUBSCRIBED', reconnected: true },
      { status: 'SUBSCRIBED', reconnected: false },
    ], 'the same channel consumes its catch-up marker on its first successful rejoin');
    cleanup();

    statusCallbacks.length = 0;
    retryCallbacks.length = 0;
    channels.length = 0;
    subscribed.length = 0;
    const cleanupFailedInitialJoin = setup(callbacks);
    statusCallbacks[0]('CHANNEL_ERROR');
    retryCallbacks.shift()!();
    assert.equal(channels.length, 2);
    statusCallbacks[1]('SUBSCRIBED');
    assert.deepEqual(subscribed, [
      { status: 'SUBSCRIBED', reconnected: true },
    ], 'a retry join is a catch-up boundary even when the initial channel never subscribed');
    statusCallbacks[1]('SUBSCRIBED');
    assert.deepEqual(subscribed, [
      { status: 'SUBSCRIBED', reconnected: true },
      { status: 'SUBSCRIBED', reconnected: false },
    ], 'a replacement retry channel also consumes the marker only once');
    cleanupFailedInitialJoin();
  } finally {
    delete (globalThis as Record<string, unknown>)[REALTIME_HARNESS_KEY];
  }
});

test('the shared-calendar migration publishes every table consumed by the realtime channel', () => {
  const migration = readFileSync('DEVLOG/migrations/2026-08-24-shared-calendars.sql', 'utf8');
  const publicationSection = migration.match(
    /-- ── 6\) Realtime publication[\s\S]*?(?=-- ── 7\))/,
  );
  assert.ok(publicationSection, 'the migration must keep its idempotent Realtime publication loop');
  const publicationArray = publicationSection[0].match(/FOREACH t IN ARRAY ARRAY\[([^\]]+)\] LOOP/);
  assert.ok(publicationArray);
  const publishedTables = [...publicationArray[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(publishedTables, [
    'calendars',
    'calendar_members',
    'calendar_events',
    'calendar_tags',
    'calendar_notifications',
  ]);
  assert.match(publicationSection[0], /ALTER PUBLICATION supabase_realtime ADD TABLE/);
  assert.match(publicationSection[0], /EXCEPTION WHEN duplicate_object THEN NULL/);
});

type BroadcastHarness = {
  sends: Array<Record<string, unknown>>;
  throwOnSend: boolean;
  supabase: Record<string, unknown>;
};

async function createBroadcastHarness(): Promise<{
  state: BroadcastHarness;
  module: Record<string, unknown>;
}> {
  const state = {
    sends: [] as Array<Record<string, unknown>>,
    throwOnSend: false,
    supabase: {},
  };
  state.supabase = {
    channel: () => ({
      on() { return this; },
      subscribe(callback?: (status: string) => void) {
        callback?.('SUBSCRIBED');
        return this;
      },
      send(message: Record<string, unknown>) {
        if (state.throwOnSend) throw new Error('cross-client channel closed');
        state.sends.push(message);
        return Promise.resolve('ok');
      },
    }),
    removeChannel: () => {},
  };
  (globalThis as Record<string, unknown>)[BROADCAST_HARNESS_KEY] = state;
  const module = await bundleModule(
    "export * from './electron/broadcast.ts';",
    broadcastPlugin(),
  );
  return { state, module };
}

test('ordinary uppercase calendar commits fan out locally even when cross-client delivery fails', async () => {
  const { state, module } = await createBroadcastHarness();
  const setupBroadcast = module.setupBroadcast as ((listener: () => void) => () => void);
  const setLocalListener = module.setCalendarChangedLocalListener as undefined | ((
    listener: (payload: Record<string, unknown>) => void,
  ) => () => void);
  const broadcastCalendarChanged = module.broadcastCalendarChanged as ((action: string, senderId?: string) => void);
  assert.equal(typeof setLocalListener, 'function', 'broadcast.ts needs a main-process local commit listener');

  const localPayloads: Array<Record<string, unknown>> = [];
  const clearListener = setLocalListener!((payload) => { localPayloads.push(payload); });
  const teardown = setupBroadcast(() => {});
  state.throwOnSend = true;
  const originalWarn = console.warn;
  try {
    console.warn = () => {};
    assert.doesNotThrow(
      () => broadcastCalendarChanged('UPDATE', 'actor-window'),
      'a transport failure after persistence cannot reject the IPC result',
    );
  } finally {
    console.warn = originalWarn;
    teardown();
    clearListener();
    delete (globalThis as Record<string, unknown>)[BROADCAST_HARNESS_KEY];
  }
  assert.equal(localPayloads.length, 1);
  assert.equal(localPayloads[0].action, 'UPDATE');
  assert.equal(localPayloads[0].senderId, 'actor-window');
  assert.equal(localPayloads[0].trustedSharedCalendarChange, true);
  assert.equal(typeof localPayloads[0].ts, 'number');
});

test('a preceding data-change transport failure cannot skip the local calendar commit fanout', async () => {
  const { state, module } = await createBroadcastHarness();
  const setupBroadcast = module.setupBroadcast as ((listener: () => void) => () => void);
  const setLocalListener = module.setCalendarChangedLocalListener as ((
    listener: (payload: Record<string, unknown>) => void,
  ) => () => void);
  const broadcastDataChange = module.broadcastDataChange as ((table: string, action: string) => void);
  const broadcastCalendarChanged = module.broadcastCalendarChanged as ((action: string) => void);
  const localPayloads: Array<Record<string, unknown>> = [];
  const clearListener = setLocalListener((payload) => { localPayloads.push(payload); });
  const teardown = setupBroadcast(() => {});
  state.throwOnSend = true;
  const originalWarn = console.warn;
  try {
    console.warn = () => {};
    assert.doesNotThrow(() => {
      // calendarIpc의 실제 persistence 후 호출 순서와 같다.
      broadcastDataChange('calendar_members', 'UPDATE');
      broadcastCalendarChanged('UPDATE');
    });
  } finally {
    console.warn = originalWarn;
    teardown();
    clearListener();
    delete (globalThis as Record<string, unknown>)[BROADCAST_HARNESS_KEY];
  }
  assert.equal(localPayloads.length, 1);
});

test('local fanout failure cannot block the existing cross-client calendar broadcast', async () => {
  const { state, module } = await createBroadcastHarness();
  const setupBroadcast = module.setupBroadcast as ((listener: () => void) => () => void);
  const setLocalListener = module.setCalendarChangedLocalListener as ((
    listener: (payload: Record<string, unknown>) => void,
  ) => () => void);
  const broadcastCalendarChanged = module.broadcastCalendarChanged as ((action: string) => void);
  const clearListener = setLocalListener(() => { throw new Error('first local window closed'); });
  const teardown = setupBroadcast(() => {});
  const originalWarn = console.warn;
  try {
    console.warn = () => {};
    assert.doesNotThrow(() => broadcastCalendarChanged('INSERT'));
  } finally {
    console.warn = originalWarn;
    teardown();
    clearListener();
    delete (globalThis as Record<string, unknown>)[BROADCAST_HARNESS_KEY];
  }
  assert.equal(state.sends.length, 1, 'the pre-existing Supabase broadcast remains active');
  assert.equal(state.sends[0].event, 'calendar-changed');
  assert.equal((state.sends[0].payload as Record<string, unknown>).action, 'INSERT');
});

test('listener replacement is cleanup-safe and exact committed markers stay on their separate boundary', async () => {
  const { state, module } = await createBroadcastHarness();
  const setupBroadcast = module.setupBroadcast as ((listener: () => void) => () => void);
  const setLocalListener = module.setCalendarChangedLocalListener as ((
    listener: (payload: Record<string, unknown>) => void,
  ) => () => void);
  const broadcastCalendarChanged = module.broadcastCalendarChanged as ((action: string) => void);
  const broadcastCommittedDelete = module.broadcastCalendarCommittedDelete as ((marker: Record<string, unknown>) => void);
  assert.equal(typeof setLocalListener, 'function');
  const deliveries: string[] = [];
  const clearOld = setLocalListener(() => { deliveries.push('old'); });
  const clearCurrent = setLocalListener(() => { deliveries.push('current'); });
  clearOld();
  const teardown = setupBroadcast(() => {});
  broadcastCalendarChanged('UPDATE');
  broadcastCalendarChanged('update');
  broadcastCommittedDelete({
    eventId: 'exact-row',
    action: 'delete',
    storage: 'bflow',
    calendarId: 'calendar-1',
    committedPrivacyReplacementDelete: true,
  });
  teardown();
  clearCurrent();
  delete (globalThis as Record<string, unknown>)[BROADCAST_HARNESS_KEY];

  assert.deepEqual(deliveries, ['current'], 'only trusted uppercase ordinary commits use the local listener');
  assert.equal(state.sends.length, 3, 'lowercase and exact-marker cross-client behavior remains unchanged');
});

test('trusted shared-calendar fanout isolates each BrowserWindow send failure', () => {
  const fanout = (calendarWindowFanout as Record<string, unknown>)
    .broadcastTrustedSharedCalendarChangeToWindows as undefined | ((
      mainWindow: unknown,
      widgetWindows: Iterable<unknown>,
      payload: unknown,
      onError?: (error: unknown) => void,
    ) => void);
  assert.equal(typeof fanout, 'function', 'calendarWindowFanout needs an ordinary trusted-change helper');
  const delivered: Array<{ channel: string; payload: unknown }> = [];
  const errors: unknown[] = [];
  const payload = { action: 'DELETE', trustedSharedCalendarChange: true, ts: 1 };
  assert.doesNotThrow(() => fanout!(
    {
      isDestroyed: () => false,
      webContents: { send: () => { throw new Error('main window closed'); } },
    },
    [{
      isDestroyed: () => false,
      webContents: { send: (channel: string, sent: unknown) => delivered.push({ channel, payload: sent }) },
    }],
    payload,
    (error) => { errors.push(error); },
  ));
  assert.deepEqual(delivered, [{ channel: 'calendar:changed', payload }]);
  assert.equal(errors.length, 1);
});

test('remote shared-calendar relay channels continue from a failed main window to later widgets', () => {
  const fanout = (calendarWindowFanout as Record<string, unknown>)
    .broadcastSharedCalendarSignalToWindows as undefined | ((
      channel: string,
      mainWindow: unknown,
      widgetWindows: Iterable<unknown>,
      payload: unknown,
      onError?: (error: unknown) => void,
    ) => void);
  assert.equal(typeof fanout, 'function', 'remote calendar relays need the channel-aware best-effort helper');

  for (const channel of ['supabase:realtime-event', 'supabase:broadcast-event']) {
    const delivered: Array<{ channel: string; payload: unknown }> = [];
    const errors: unknown[] = [];
    const payload = { table: 'calendar_members', payload: { eventType: 'DELETE' } };
    assert.doesNotThrow(() => fanout!(
      channel,
      {
        isDestroyed: () => false,
        webContents: { send: () => { throw new Error(`main closed before ${channel}`); } },
      },
      [{
        isDestroyed: () => false,
        webContents: { send: (sentChannel: string, sent: unknown) => delivered.push({ channel: sentChannel, payload: sent }) },
      }],
      payload,
      (error) => { errors.push(error); },
    ));
    assert.deepEqual(delivered, [{ channel, payload }]);
    assert.equal(errors.length, 1);
  }
});

test('only ordinary calendar broadcasts enter the generic hardened relay', () => {
  const predicate = (calendarWindowFanout as Record<string, unknown>)
    .isSharedCalendarBroadcastSignal as undefined | ((event: string, payload: unknown) => boolean);
  assert.equal(typeof predicate, 'function');
  assert.equal(predicate!('calendar-changed', { action: 'UPDATE' }), true);
  assert.equal(predicate!('calendar-changed', { action: 'upsert', calendarId: 'primary' }), true);
  for (const table of ['calendars', 'calendar_members', 'calendar_events', 'calendar_tags']) {
    assert.equal(predicate!('data-change', { table, action: 'UPDATE' }), true);
  }
  assert.equal(predicate!('data-change', { table: 'scenes', action: 'UPDATE' }), false);
  assert.equal(predicate!('scene-update', { table: 'calendar_events' }), false);
  assert.equal(predicate!('calendar-changed', {
    eventId: 'exact-row',
    action: 'delete',
    storage: 'bflow',
    calendarId: 'calendar-1',
    committedPrivacyReplacementDelete: true,
  }), false, 'exact committed markers remain on their dedicated calendar:changed boundary');
});

test('main wires realtime calendar rows to renderers and persistence commits to local windows', () => {
  const main = readFileSync('electron/main.ts', 'utf8');
  assert.match(
    main,
    /setupRealtimeSubscription\(\{[\s\S]*?onCalendarChange:\s*\(table, payload\)\s*=>\s*broadcastSupabaseCalendarEvent\(table, payload\)/,
    'startSupabaseRealtime must forward calendar postgres_changes through supabase:realtime-event',
  );
  assert.match(
    main,
    /function broadcastSupabaseCalendarEvent\([\s\S]{0,300}broadcastSharedCalendarSignalToWindows\(\s*'supabase:realtime-event'[\s\S]{0,300}widgetWindows\.values\(\)/,
    'a failed main-window realtime send must not skip popup windows',
  );
  assert.match(
    main,
    /if \(isSharedCalendarBroadcastSignal\(event, payload\)\) \{\s*broadcastSharedCalendarSignalToWindows\(\s*'supabase:broadcast-event'[\s\S]{0,300}widgetWindows\.values\(\)[\s\S]{0,200}return;/,
    'ordinary remote calendar broadcasts must use the same destination-isolated delivery',
  );
  assert.match(
    main,
    /setCalendarChangedLocalListener\(\(payload\)\s*=>[\s\S]{0,300}broadcastTrustedSharedCalendarChangeToWindows\([\s\S]{0,200}mainWindow[\s\S]{0,200}widgetWindows\.values\(\)/,
    'main must register the one local trusted-change fanout for every live window',
  );

  const calendarIpc = readFileSync('electron/calendarIpc.ts', 'utf8');
  assert.match(calendarIpc, /await store\.createCalendar\([\s\S]{0,500}broadcastCalendarChanged\('INSERT'\)/);
  assert.match(calendarIpc, /await store\.updateCalendar\([\s\S]{0,500}broadcastCalendarChanged\('UPDATE'\)/);
  assert.match(calendarIpc, /await store\.replaceMembers\([\s\S]{0,300}broadcastCalendarChanged\('UPDATE'\)/);
});

test('Realtime reconnect metadata stays row-free across main and preload status transport', () => {
  const realtime = readFileSync('electron/realtime.ts', 'utf8');
  const main = readFileSync('electron/main.ts', 'utf8');
  const preload = readFileSync('electron/preload.ts', 'utf8');

  assert.match(
    realtime,
    /export type RealtimeStatusMetadata = \{\s*reconnected: boolean;\s*\};/,
    'status metadata may identify reconnects but must never carry calendar rows',
  );
  assert.match(
    main,
    /onStatusChange:\s*\(status, metadata\)\s*=>[\s\S]{0,400}mainWindow\.webContents\.send\('supabase:status', status, metadata\)[\s\S]{0,300}win\.webContents\.send\('supabase:status', status, metadata\)/,
    'main must forward the same row-free metadata to the main window and every popup',
  );
  assert.match(
    preload,
    /onSupabaseStatus:\s*\(callback:\s*\(status: string, metadata: RealtimeStatusMetadata\) => void\)[\s\S]{0,250}callback\(status, metadata\)/,
    'preload must preserve the metadata argument instead of dropping it at the renderer boundary',
  );
});
