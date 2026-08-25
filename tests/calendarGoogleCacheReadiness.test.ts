import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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
  syncIncremental(): Promise<void>;
  addEvent(event: Record<string, unknown>): Promise<void>;
  updateEvent(eventId: string, updates: Record<string, unknown>): Promise<void>;
  getEvents(): Promise<Array<{
    id: string;
    title: string;
    color: string;
    createdBy: string;
    type: string;
    startDate: string;
    endDate: string;
    linkedPart?: string;
    sourceCalendarId?: string;
    isPrivate?: boolean;
    canEdit?: boolean;
    isReadOnly?: boolean;
  }>>;
  deleteEvent(eventId: string): Promise<void>;
  saveTeamCalendarId(calendarId: string | null): Promise<void>;
  applyCommittedGoogleDelete(payload: unknown): boolean;
  applyCommittedPrivacyReplacementDelete(payload: unknown): boolean;
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
  description?: string;
  start: { date: string };
  end: { date: string };
  created: string;
  extendedProperties: { private: Record<string, string> };
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
  incrementalSync?: (calendarId: string) => Promise<{
    updated: GoogleEventFixture[];
    deleted: string[];
    isFullSync: boolean;
  }>;
  calendarList?: () => Promise<BflowCalendarFixture[]>;
  bflowEventsList?: () => Promise<BflowEventFixture[]>;
  createBflowEvent?: (input: Record<string, unknown>) => Promise<BflowEventFixture>;
  createLegacyEvent?: (input: Record<string, unknown>) => Promise<LegacyPrivateEventFixture>;
  createPrivacyReplacement?: (input: Record<string, unknown>) => Promise<{
    actual_id: string;
    storage: 'bflow' | 'legacy-private' | 'google';
    calendar_id?: string;
    receipt: string;
  }>;
  settlePrivacyReplacement?: (receipt: string, disposition: 'keep' | 'delete') => Promise<void>;
  updateBflowEvent?: (eventId: string, patch: Record<string, unknown>) => Promise<BflowEventFixture>;
  updateLegacyEvent?: (eventId: string, patch: Record<string, unknown>) => Promise<void>;
  updateGoogleEvent?: (calendarId: string, eventId: string, patch: Record<string, unknown>) => Promise<void>;
  deleteBflowEvent?: (eventId: string) => Promise<void>;
  deleteBflowMigrationSource?: (
    eventId: string,
  ) => Promise<'deleted' | 'missing' | 'ambiguous'>;
  deletePrivacyMigrationSource?: (request: {
    storage: 'bflow' | 'legacy-private' | 'google';
    event_id: string;
    calendar_id?: string;
  }) => Promise<'deleted' | 'missing' | 'ambiguous'>;
  deleteLegacyEvent?: (eventId: string) => Promise<void>;
  deleteGoogleEvent?: (calendarId: string, eventId: string) => Promise<void>;
  readPrivateEvents?: (userId: string) => Promise<LegacyPrivateEventFixture[]>;
  currentUserId?: string;
  teamCalendarId?: string | null;
  personalCalendarId?: string | null;
  failSettingsWrite?: () => boolean;
};

let bundleSource: Promise<string> | undefined;
let widgetPopupBundleSource: Promise<string> | undefined;
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

type PopupCalendarChangeHandler = (payload: unknown) => Promise<void>;
type PopupSupabaseCalendarChangeHandler = (raw: unknown) => Promise<boolean>;

async function bundledWidgetPopupSource(): Promise<string> {
  widgetPopupBundleSource ??= build({
    entryPoints: ['src/views/WidgetPopup.tsx'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    write: false,
    external: [
      'react',
      'react/jsx-runtime',
      'lucide-react',
      'sonner',
      '@/*',
    ],
  }).then((result) => result.outputFiles[0].text);
  return widgetPopupBundleSource;
}

async function loadWidgetPopupCalendarChangeHandler(
  applyCommittedGoogleDelete: (payload: unknown) => boolean,
  applyCommittedPrivacyReplacementDelete: (payload: unknown) => boolean = () => false,
): Promise<{
  calendarChange: PopupCalendarChangeHandler | undefined;
  supabaseCalendarChange: PopupSupabaseCalendarChangeHandler | undefined;
}> {
  const source = await bundledWidgetPopupSource();
  const module = { exports: {} as Record<string, unknown> };
  const nodeRequire = createRequire(import.meta.url);
  const noop = () => null;
  const mockExport = new Proxy(noop, {
    get: () => mockExport,
  });
  const mockModule = new Proxy({} as Record<string, unknown>, {
    get: (_target, key) => (key === '__esModule' ? true : mockExport),
  });
  const runtimeRequire = (id: string): unknown => {
    if (id === 'react' || id === 'react/jsx-runtime') return nodeRequire(id);
    if (id === '@/services/calendarService') {
      return { applyCommittedGoogleDelete, applyCommittedPrivacyReplacementDelete };
    }
    return mockModule;
  };

  const evaluate = new Function('require', 'module', 'exports', source);
  evaluate(runtimeRequire, module, module.exports);
  return {
    calendarChange: module.exports.applyIncomingCalendarChangeInPopup as PopupCalendarChangeHandler | undefined,
    supabaseCalendarChange: (
      module.exports.applyIncomingSupabaseCalendarChangeInPopup
    ) as PopupSupabaseCalendarChangeHandler | undefined,
  };
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

function committedGoogleDeleteBroadcast(eventId: string, calendarId = 'primary') {
  return {
    eventId,
    calendarId,
    action: 'delete',
    committedGoogleDelete: true,
  };
}

function committedPrivacyReplacementDeleteBroadcast(
  storage: 'bflow' | 'legacy-private',
  eventId: string,
  calendarId?: string,
  ownerId = 'user-a',
) {
  return {
    eventId,
    action: 'delete',
    storage,
    ...(calendarId ? { calendarId } : {}),
    ...(storage === 'legacy-private' ? { ownerId } : {}),
    committedPrivacyReplacementDelete: true,
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
  deletedGoogleEventIds: string[];
  privacyMigrationSourceDeletes: Array<{
    storage: 'bflow' | 'legacy-private' | 'google';
    event_id: string;
    calendar_id?: string;
  }>;
  privacyReplacementCreates: Record<string, unknown>[];
  privacyReplacementSettlements: Array<{ receipt: string; disposition: 'keep' | 'delete' }>;
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
  const deletedGoogleEventIds: string[] = [];
  const privacyMigrationSourceDeletes: Array<{
    storage: 'bflow' | 'legacy-private' | 'google';
    event_id: string;
    calendar_id?: string;
  }> = [];
  const privacyReplacementCreates: Record<string, unknown>[] = [];
  const privacyReplacementSettlements: Array<{
    receipt: string;
    disposition: 'keep' | 'delete';
  }> = [];
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
      calendarPrivacyMigrationSourceDelete: async (rawRequest: string | {
        storage: 'bflow' | 'legacy-private' | 'google';
        event_id: string;
        calendar_id?: string;
      }) => {
        const request = typeof rawRequest === 'string'
          ? { storage: 'bflow' as const, event_id: rawRequest }
          : rawRequest;
        privacyMigrationSourceDeletes.push(request);
        if (options.deletePrivacyMigrationSource) {
          return options.deletePrivacyMigrationSource(request);
        }
        if (request.storage === 'bflow') {
          deletedBflowEventIds.push(request.event_id);
          if (options.deleteBflowMigrationSource) {
            return options.deleteBflowMigrationSource(request.event_id);
          }
          await options.deleteBflowEvent?.(request.event_id);
        } else if (request.storage === 'legacy-private') {
          deletedLegacyEventIds.push(request.event_id);
          await options.deleteLegacyEvent?.(request.event_id);
        } else {
          deletedGoogleEventIds.push(request.event_id);
          await options.deleteGoogleEvent?.(request.calendar_id ?? '', request.event_id);
        }
        return 'deleted';
      },
      calendarPrivacyReplacementCreate: async (request: Record<string, unknown>) => {
        privacyReplacementCreates.push(request);
        if (!options.createPrivacyReplacement) {
          throw new Error('unexpected calendarPrivacyReplacementCreate');
        }
        return options.createPrivacyReplacement(request);
      },
      calendarPrivacyReplacementSettle: async (
        receipt: string,
        disposition: 'keep' | 'delete',
      ) => {
        privacyReplacementSettlements.push({ receipt, disposition });
        if (!options.settlePrivacyReplacement) {
          throw new Error('unexpected calendarPrivacyReplacementSettle');
        }
        await options.settlePrivacyReplacement(receipt, disposition);
      },
      calendarBroadcastChange: async (detail: unknown) => {
        broadcasts.push(detail);
        return { ok: true };
      },
      supabaseReadPrivateEvents: options.readPrivateEvents ?? (async () => []),
      supabaseAddPrivateEvent: async (input: Record<string, unknown>) => {
        if (!options.createLegacyEvent) throw new Error('unexpected supabaseAddPrivateEvent');
        return options.createLegacyEvent(input);
      },
      supabaseUpdatePrivateEvent: async (eventId: string, patch: Record<string, unknown>) => {
        if (!options.updateLegacyEvent) throw new Error('unexpected supabaseUpdatePrivateEvent');
        await options.updateLegacyEvent(eventId, patch);
      },
      supabaseDeletePrivateEvent: async (eventId: string) => {
        deletedLegacyEventIds.push(eventId);
        await options.deleteLegacyEvent?.(eventId);
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
      gcalIncrementalSync: options.incrementalSync ?? (async () => ({
        updated: [],
        deleted: [],
        isFullSync: false,
      })),
      gcalIsAuthenticated: async () => false,
      gcalDeleteEvent: async (calendarId: string, eventId: string) => {
        deletedGoogleEventIds.push(eventId);
        await options.deleteGoogleEvent?.(calendarId, eventId);
      },
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
      deletedGoogleEventIds,
      privacyMigrationSourceDeletes,
      privacyReplacementCreates,
      privacyReplacementSettlements,
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

test('popup applies exact committed delete markers before forwarding them to widget subscribers', async () => {
  const globalScope = globalThis as Record<string, unknown>;
  const priorWindow = {
    exists: Object.prototype.hasOwnProperty.call(globalScope, 'window'),
    value: globalScope.window,
  };
  const priorCustomEvent = {
    exists: Object.prototype.hasOwnProperty.call(globalScope, 'CustomEvent'),
    value: globalScope.CustomEvent,
  };
  const order: string[] = [];
  const received: unknown[] = [];
  const popupWindow = new EventTarget();
  popupWindow.addEventListener('bflow:calendar-changed', (event) => {
    order.push('dispatch');
    received.push((event as Event & { detail?: unknown }).detail);
  });
  globalScope.window = popupWindow;
  globalScope.CustomEvent = class extends Event {
    detail: unknown;
    constructor(type: string, init?: { detail?: unknown }) {
      super(type);
      this.detail = init?.detail;
    }
  };

  try {
    const googleTombstoneCalls: unknown[] = [];
    const privacyTombstoneCalls: unknown[] = [];
    const { calendarChange: handler } = await loadWidgetPopupCalendarChangeHandler(
      (payload) => {
        googleTombstoneCalls.push(payload);
        order.push('google-tombstone');
        return (payload as { committedGoogleDelete?: boolean }).committedGoogleDelete === true;
      },
      (payload) => {
        privacyTombstoneCalls.push(payload);
        order.push('privacy-tombstone');
        return (payload as { committedPrivacyReplacementDelete?: boolean })
          .committedPrivacyReplacementDelete === true;
      },
    );
    assert.ok(
      handler,
      'WidgetPopup must expose the same cache-refreshing receiver that its IPC subscription uses',
    );

    const googlePayload = {
      eventId: 'google-ghost',
      calendarId: 'primary',
      action: 'delete',
      committedGoogleDelete: true,
    };
    const bflowPayload = committedPrivacyReplacementDeleteBroadcast(
      'bflow',
      'bflow-ghost',
      'calendar-1',
    );
    await handler(googlePayload);
    await handler(bflowPayload);
    assert.deepEqual(googleTombstoneCalls, [googlePayload, bflowPayload]);
    assert.deepEqual(privacyTombstoneCalls, [bflowPayload]);
    assert.deepEqual(order, [
      'google-tombstone',
      'dispatch',
      'google-tombstone',
      'privacy-tombstone',
      'dispatch',
    ]);
    assert.deepEqual(received, [googlePayload, bflowPayload]);
  } finally {
    if (priorWindow.exists) globalScope.window = priorWindow.value;
    else delete globalScope.window;
    if (priorCustomEvent.exists) globalScope.CustomEvent = priorCustomEvent.value;
    else delete globalScope.CustomEvent;
  }
});

test('popup applies remote Supabase calendar markers for Google, B flow, and legacy without removing unrelated rows', async () => {
  const bflowTarget = bflowEvent('remote-bflow-target', '삭제할 B flow 일정');
  const bflowUnrelated = bflowEvent('remote-bflow-unrelated', '유지할 B flow 일정');
  const legacyTarget = legacyPrivateEvent('remote-legacy-target', 'user-a');
  const legacyUnrelated = legacyPrivateEvent('remote-legacy-unrelated', 'user-a');
  const googleTarget = googleEvent('remote-google-target', '삭제할 Google 일정');
  const googleUnrelated = googleEvent('remote-google-unrelated', '유지할 Google 일정');
  const harness = await createHarness({
    currentUserId: 'user-a',
    personalCalendarId: 'primary',
    calendarList: async () => [personalCalendar('user-a')],
    bflowEventsList: async () => [bflowTarget, bflowUnrelated],
    readPrivateEvents: async () => [legacyTarget, legacyUnrelated],
    fullSync: async () => [googleTarget, googleUnrelated],
  });
  try {
    await harness.service.loadBflowEvents();
    await harness.service.syncAll({ skipBflowLoad: true });
    const { supabaseCalendarChange: handler } = await loadWidgetPopupCalendarChangeHandler(
      harness.service.applyCommittedGoogleDelete,
      harness.service.applyCommittedPrivacyReplacementDelete,
    );
    assert.ok(handler, 'WidgetPopup must expose its Supabase calendar marker receiver');

    for (const payload of [
      committedGoogleDeleteBroadcast(googleTarget.id),
      committedPrivacyReplacementDeleteBroadcast(
        'bflow',
        bflowTarget.id,
        bflowTarget.calendar_id,
      ),
      committedPrivacyReplacementDeleteBroadcast('legacy-private', legacyTarget.id),
    ]) {
      assert.equal(
        await handler({ event: 'calendar-changed', payload }),
        true,
        'remote calendar-changed is routed through the same exact marker receiver',
      );
    }

    assert.deepEqual(
      (await harness.service.getEvents()).map(({ id }) => id).sort(),
      [bflowUnrelated.id, legacyUnrelated.id, googleUnrelated.id].sort(),
      'each storage removes only its exact row and preserves unrelated cached events',
    );
    assert.equal(
      await handler({ event: 'data-change', payload: {} }),
      false,
      'the narrow PR2 receiver does not absorb unrelated broadcast events',
    );
  } finally {
    harness.restore();
  }
});

test('an external committed Google delete tombstones only its exact row and blocks an older pending snapshot', async () => {
  const staleSnapshotStarted = deferred<void>();
  const staleSnapshot = deferred<GoogleEventFixture[]>();
  let fullSyncCalls = 0;
  const harness = await createHarness({
    personalCalendarId: 'primary',
    fullSync: async () => {
      fullSyncCalls += 1;
      if (fullSyncCalls === 1) {
        return [
          googleEvent('google-ghost', '다른 창에서 삭제할 일정'),
          googleEvent('google-unrelated', '보존할 일정'),
        ];
      }
      staleSnapshotStarted.resolve();
      return staleSnapshot.promise;
    },
  });

  try {
    await harness.service.syncAll({ skipBflowLoad: true });
    const pendingSync = harness.service.syncAll({ skipBflowLoad: true });
    await staleSnapshotStarted.promise;
    const broadcastsBeforeApply = harness.broadcasts.length;

    assert.equal(
      harness.service.applyCommittedGoogleDelete(
        committedGoogleDeleteBroadcast('google-ghost'),
      ),
      true,
    );
    assert.deepEqual(
      (await harness.service.getEvents()).map(({ id }) => id),
      ['google-unrelated'],
      'the receiving window removes only the committed row from its independent cache',
    );
    assert.equal(
      harness.broadcasts.length,
      broadcastsBeforeApply,
      'receiver-side tombstoning must not ping-pong another IPC broadcast',
    );

    staleSnapshot.resolve([
      googleEvent('google-ghost', '삭제 전 오래된 snapshot'),
      googleEvent('google-unrelated', '보존할 일정'),
    ]);
    await pendingSync;
    assert.deepEqual((await harness.service.getEvents()).map(({ id }) => id), ['google-unrelated']);
  } finally {
    harness.restore();
  }
});

test('an external privacy compensation marker tombstones only its exact B flow or legacy source row', async (t) => {
  await t.test('B flow calendar identity', async () => {
    const target = bflowEvent('shared-id', '삭제할 B flow 일정');
    const unrelated = {
      ...bflowEvent('unrelated-id', '유지할 같은 캘린더 일정'),
      calendar_id: 'calendar-1',
    };
    const harness = await createHarness({
      currentUserId: 'user-a',
      calendarList: async () => [personalCalendar('user-a')],
      bflowEventsList: async () => [target, unrelated],
      readPrivateEvents: async () => [],
      fullSync: async () => [],
    });
    try {
      await harness.service.loadBflowEvents();
      const broadcastsBeforeApply = harness.broadcasts.length;

      assert.equal(
        harness.service.applyCommittedPrivacyReplacementDelete(
          committedPrivacyReplacementDeleteBroadcast('bflow', target.id, 'other-calendar'),
        ),
        true,
      );
      assert.deepEqual(
        (await harness.service.getEvents()).map(({ id }) => id),
        [target.id, unrelated.id],
        'the same id from another B flow calendar is not the exact deleted source',
      );

      assert.equal(
        harness.service.applyCommittedPrivacyReplacementDelete(
          committedPrivacyReplacementDeleteBroadcast('bflow', target.id, target.calendar_id),
        ),
        true,
      );
      assert.deepEqual((await harness.service.getEvents()).map(({ id }) => id), [unrelated.id]);
      assert.equal(
        harness.broadcasts.length,
        broadcastsBeforeApply,
        'receiver tombstones must not broadcast again',
      );
    } finally {
      harness.restore();
    }
  });

  await t.test('legacy private source identity', async () => {
    const target = legacyPrivateEvent('legacy-target', 'user-a');
    const unrelated = legacyPrivateEvent('legacy-unrelated', 'user-a');
    const harness = await createHarness({
      currentUserId: 'user-a',
      calendarList: async () => [],
      bflowEventsList: async () => [],
      readPrivateEvents: async () => [target, unrelated],
      fullSync: async () => [],
    });
    try {
      await harness.service.loadBflowEvents();
      assert.equal(
        harness.service.applyCommittedPrivacyReplacementDelete(
          committedPrivacyReplacementDeleteBroadcast('bflow', target.id, 'calendar-1'),
        ),
        true,
      );
      assert.deepEqual(
        (await harness.service.getEvents()).map(({ id }) => id),
        [target.id, unrelated.id],
        'the same id in legacy storage is not a B flow calendar row',
      );

      assert.equal(
        harness.service.applyCommittedPrivacyReplacementDelete(
          committedPrivacyReplacementDeleteBroadcast('legacy-private', target.id),
        ),
        true,
      );
      assert.deepEqual((await harness.service.getEvents()).map(({ id }) => id), [unrelated.id]);
    } finally {
      harness.restore();
    }
  });

  await t.test('legacy private owner identity survives a cross-session same-id marker', async () => {
    const sharedId = 'legacy-owner-scoped-id';
    const userBRow = legacyPrivateEvent(sharedId, 'user-b');
    const userAStaleRow = legacyPrivateEvent(sharedId, 'user-a');
    const userAUnrelated = legacyPrivateEvent('legacy-owner-a-unrelated', 'user-a');
    const harness = await createHarness({
      currentUserId: 'user-a',
      calendarList: async () => [],
      bflowEventsList: async () => [],
      readPrivateEvents: async (userId) => (
        userId === 'user-b' ? [userBRow] : [userAStaleRow, userAUnrelated]
      ),
      fullSync: async () => [],
    });
    try {
      await harness.service.loadBflowEvents();
      const { supabaseCalendarChange: popupHandler } = await loadWidgetPopupCalendarChangeHandler(
        harness.service.applyCommittedGoogleDelete,
        harness.service.applyCommittedPrivacyReplacementDelete,
      );
      assert.ok(popupHandler);

      const userAMarker = committedPrivacyReplacementDeleteBroadcast(
        'legacy-private',
        sharedId,
        undefined,
        'user-a',
      );
      assert.equal(
        await popupHandler({
          event: 'calendar-changed',
          payload: userAMarker,
        }),
        true,
      );
      assert.deepEqual(
        (await harness.service.getEvents()).map(({ id }) => id),
        [userAUnrelated.id],
        'the marker removes the exact row in its captured owner session',
      );

      harness.service.__testUseAuthStore.setState({ currentUser: authUser('user-b') });
      await harness.service.loadBflowEvents();
      await popupHandler({ event: 'calendar-changed', payload: userAMarker });
      assert.deepEqual(
        (await harness.service.getEvents()).map(({ id }) => id),
        [sharedId],
        'the popup receiver must not hide user B\'s row when user A reused the same legacy id',
      );

      harness.service.__testUseAuthStore.setState({ currentUser: authUser('user-a') });
      await harness.service.loadBflowEvents();
      assert.deepEqual(
        (await harness.service.getEvents()).map(({ id }) => id),
        [userAUnrelated.id],
        'the owner-scoped tombstone remains available to filter user A\'s later stale snapshot',
      );
    } finally {
      harness.restore();
    }
  });
});

test('an exact B flow or legacy marker during the first load schedules a fresh snapshot for unrelated rows', async (t) => {
  for (const storage of ['bflow', 'legacy-private'] as const) {
    await t.test(storage, async () => {
      const targetId = `first-load-${storage}-target`;
      const unrelatedId = `first-load-${storage}-unrelated`;
      const firstStarted = deferred<void>();
      const followupStarted = deferred<void>();
      const staleBflow = deferred<BflowEventFixture[]>();
      const freshBflow = deferred<BflowEventFixture[]>();
      const staleLegacy = deferred<LegacyPrivateEventFixture[]>();
      const freshLegacy = deferred<LegacyPrivateEventFixture[]>();
      let relevantReadCalls = 0;
      const targetBflow = bflowEvent(targetId, '오래된 삭제 대상');
      const unrelatedBflow = bflowEvent(unrelatedId, '유지할 B flow 일정');
      const targetLegacy = legacyPrivateEvent(targetId, 'user-a');
      const unrelatedLegacy = legacyPrivateEvent(unrelatedId, 'user-a');
      const harness = await createHarness({
        currentUserId: 'user-a',
        calendarList: async () => [personalCalendar('user-a')],
        bflowEventsList: storage === 'bflow'
          ? async () => {
              relevantReadCalls += 1;
              if (relevantReadCalls === 1) {
                firstStarted.resolve();
                return staleBflow.promise;
              }
              if (relevantReadCalls === 2) {
                followupStarted.resolve();
                return freshBflow.promise;
              }
              throw new Error(`unexpected B flow read: ${relevantReadCalls}`);
            }
          : async () => [],
        readPrivateEvents: storage === 'legacy-private'
          ? async () => {
              relevantReadCalls += 1;
              if (relevantReadCalls === 1) {
                firstStarted.resolve();
                return staleLegacy.promise;
              }
              if (relevantReadCalls === 2) {
                followupStarted.resolve();
                return freshLegacy.promise;
              }
              throw new Error(`unexpected legacy read: ${relevantReadCalls}`);
            }
          : async () => [],
        fullSync: async () => [],
      });
      try {
        const firstLoad = harness.service.loadBflowEvents();
        await firstStarted.promise;

        assert.equal(
          harness.service.applyCommittedPrivacyReplacementDelete(
            storage === 'bflow'
              ? committedPrivacyReplacementDeleteBroadcast('bflow', targetId, 'calendar-1')
              : committedPrivacyReplacementDeleteBroadcast('legacy-private', targetId),
          ),
          true,
        );
        await followupStarted.promise;

        if (storage === 'bflow') {
          freshBflow.resolve([unrelatedBflow]);
          staleBflow.resolve([targetBflow, unrelatedBflow]);
        } else {
          freshLegacy.resolve([unrelatedLegacy]);
          staleLegacy.resolve([targetLegacy, unrelatedLegacy]);
        }
        await firstLoad;
        await new Promise<void>((resolve) => setImmediate(resolve));

        assert.equal(relevantReadCalls, 2, 'the invalidated first load is followed by one coalesced reload');
        assert.deepEqual(
          (await harness.service.getEvents()).map(({ id }) => id),
          [unrelatedId],
          'the stale target stays absent while unrelated authoritative rows become visible',
        );
      } finally {
        harness.restore();
      }
    });
  }
});

test('a remote committed marker prevents a later ordinary delete failure from restoring its exact row', async (t) => {
  for (const storage of ['bflow', 'legacy-private', 'google'] as const) {
    await t.test(storage, async () => {
      const targetId = `pending-delete-${storage}-target`;
      const unrelatedId = `pending-delete-${storage}-unrelated`;
      const deleteStarted = deferred<void>();
      const deleteGate = deferred<void>();
      const targetBflow = bflowEvent(targetId, '삭제할 B flow 일정');
      const unrelatedBflow = bflowEvent(unrelatedId, '유지할 B flow 일정');
      const targetLegacy = legacyPrivateEvent(targetId, 'user-a');
      const unrelatedLegacy = legacyPrivateEvent(unrelatedId, 'user-a');
      const targetGoogle = googleEvent(targetId, '삭제할 Google 일정');
      const unrelatedGoogle = googleEvent(unrelatedId, '유지할 Google 일정');
      const pendingDelete = async () => {
        deleteStarted.resolve();
        await deleteGate.promise;
      };
      const harness = await createHarness({
        currentUserId: 'user-a',
        personalCalendarId: 'primary',
        calendarList: async () => [personalCalendar('user-a')],
        bflowEventsList: async () => storage === 'bflow'
          ? [targetBflow, unrelatedBflow]
          : [],
        readPrivateEvents: async () => storage === 'legacy-private'
          ? [targetLegacy, unrelatedLegacy]
          : [],
        fullSync: async () => storage === 'google'
          ? [targetGoogle, unrelatedGoogle]
          : [],
        deleteBflowEvent: storage === 'bflow' ? pendingDelete : undefined,
        deleteLegacyEvent: storage === 'legacy-private' ? pendingDelete : undefined,
        deleteGoogleEvent: storage === 'google' ? async () => pendingDelete() : undefined,
      });
      try {
        if (storage === 'google') {
          await harness.service.syncAll();
        } else {
          await harness.service.loadBflowEvents();
        }
        const deletion = harness.service.deleteEvent(targetId);
        await deleteStarted.promise;

        const marker = storage === 'google'
          ? committedGoogleDeleteBroadcast(targetId)
          : committedPrivacyReplacementDeleteBroadcast(
              storage,
              targetId,
              storage === 'bflow' ? 'calendar-1' : undefined,
            );
        if (storage === 'google') {
          assert.equal(harness.service.applyCommittedGoogleDelete(marker), true);
        } else {
          assert.equal(harness.service.applyCommittedPrivacyReplacementDelete(marker), true);
        }
        deleteGate.reject(new Error(`${storage} local delete lost the race`));

        assert.equal(
          await deletion,
          undefined,
          'the same exact row is already durably deleted by another actor',
        );
        assert.deepEqual(
          (await harness.service.getEvents()).map(({ id }) => id),
          [unrelatedId],
          'a late local failure cannot rollback the remotely committed exact row',
        );
      } finally {
        harness.restore();
      }
    });
  }
});

test('failed or uncommitted privacy compensation cannot tombstone an independent receiver cache', async () => {
  const target = bflowEvent('kept-bflow', '유지할 B flow 일정');
  const harness = await createHarness({
    currentUserId: 'user-a',
    calendarList: async () => [personalCalendar('user-a')],
    bflowEventsList: async () => [target],
    readPrivateEvents: async () => [],
    fullSync: async () => [],
  });
  try {
    await harness.service.loadBflowEvents();
    for (const payload of [
      { eventId: target.id, action: 'delete', storage: 'bflow', calendarId: target.calendar_id },
      committedPrivacyReplacementDeleteBroadcast('bflow', target.id),
      committedPrivacyReplacementDeleteBroadcast('legacy-private', target.id, target.calendar_id),
      {
        eventId: target.id,
        action: 'delete',
        storage: 'legacy-private',
        committedPrivacyReplacementDelete: true,
      },
      {
        eventId: target.id,
        action: 'delete',
        storage: 'legacy-private',
        ownerId: '   ',
        committedPrivacyReplacementDelete: true,
      },
    ]) {
      assert.equal(harness.service.applyCommittedPrivacyReplacementDelete(payload), false);
    }
    assert.deepEqual((await harness.service.getEvents()).map(({ id }) => id), [target.id]);
  } finally {
    harness.restore();
  }
});

test('an uncommitted or malformed external delete cannot tombstone Google cache rows', async () => {
  const harness = await createHarness({
    personalCalendarId: 'primary',
    fullSync: async () => [googleEvent('google-kept', '유지할 일정')],
  });
  try {
    await harness.service.syncAll({ skipBflowLoad: true });
    assert.equal(
      harness.service.applyCommittedGoogleDelete({
        eventId: 'google-kept',
        calendarId: 'primary',
        action: 'delete',
      }),
      false,
    );
    assert.equal(
      harness.service.applyCommittedGoogleDelete({
        eventId: 'google-kept',
        action: 'delete',
        committedGoogleDelete: true,
      }),
      false,
    );
    assert.deepEqual((await harness.service.getEvents()).map(({ id }) => id), ['google-kept']);
  } finally {
    harness.restore();
  }
});

test('a successful Google delete leaves committed marker fanout to the main persistence boundary', async () => {
  const deleteStarted = deferred<void>();
  const deleteGate = deferred<void>();
  const harness = await createHarness({
    personalCalendarId: 'primary',
    fullSync: async () => [
      googleEvent('google-delete', '삭제할 일정'),
      googleEvent('google-unrelated', '보존할 일정'),
    ],
    deleteGoogleEvent: async () => {
      deleteStarted.resolve();
      await deleteGate.promise;
    },
  });
  try {
    await harness.service.syncAll({ skipBflowLoad: true });
    const beforeDelete = harness.broadcasts.length;
    const deletion = harness.service.deleteEvent('google-delete');
    await deleteStarted.promise;
    assert.deepEqual(
      harness.broadcasts.slice(beforeDelete),
      [{ eventId: 'google-delete', action: 'delete' }],
      'the first signal remains the existing optimistic delete',
    );

    deleteGate.resolve();
    await deletion;
    assert.deepEqual(
      harness.broadcasts.slice(beforeDelete),
      [{ eventId: 'google-delete', action: 'delete' }],
      'renderer never forges a committed flag; main emits it after persistence',
    );
    assert.deepEqual((await harness.service.getEvents()).map(({ id }) => id), ['google-unrelated']);
  } finally {
    harness.restore();
  }
});

test('a failed Google delete rolls back without emitting a committed delete', async () => {
  const deleteStarted = deferred<void>();
  const deleteGate = deferred<void>();
  const failure = new Error('Google delete failed');
  const harness = await createHarness({
    personalCalendarId: 'primary',
    fullSync: async () => [
      googleEvent('google-delete', '삭제할 일정'),
      googleEvent('google-unrelated', '보존할 일정'),
    ],
    deleteGoogleEvent: async () => {
      deleteStarted.resolve();
      await deleteGate.promise;
    },
  });
  try {
    await harness.service.syncAll({ skipBflowLoad: true });
    const beforeDelete = harness.broadcasts.length;
    const deletion = harness.service.deleteEvent('google-delete').then(
      () => null,
      (error: unknown) => error,
    );
    await deleteStarted.promise;
    deleteGate.reject(failure);
    assert.equal(await deletion, failure);
    assert.deepEqual(
      harness.broadcasts.slice(beforeDelete),
      [
        { eventId: 'google-delete', action: 'delete' },
        { eventId: 'google-delete', action: 'add' },
      ],
    );
    assert.deepEqual(
      (await harness.service.getEvents()).map(({ id }) => id).sort(),
      ['google-delete', 'google-unrelated'],
    );
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

test('unchanged isPrivate fields do not serialize otherwise ordinary overlapping updates', async () => {
  const source = bflowEvent('unchanged-private-source', '수정 전 제목');
  const persistenceGate = deferred<void>();
  let persistenceStarts = 0;
  const harness = await createHarness({
    currentUserId: 'user-a',
    calendarList: async () => [personalCalendar('user-a')],
    bflowEventsList: async () => [source],
    readPrivateEvents: async () => [],
    fullSync: async () => [],
    updateBflowEvent: async (_eventId, patch) => {
      persistenceStarts += 1;
      await persistenceGate.promise;
      return {
        ...source,
        title: typeof patch.title === 'string' ? patch.title : source.title,
        memo: typeof patch.memo === 'string' ? patch.memo : source.memo,
      };
    },
  });

  try {
    await harness.service.loadBflowEvents();
    const first = harness.service.updateEvent(source.id, {
      title: '수정 A',
      isPrivate: true,
    });
    const second = harness.service.updateEvent(source.id, {
      memo: '수정 B',
      isPrivate: true,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const startsBeforeRelease = persistenceStarts;
    persistenceGate.resolve();
    await Promise.all([first, second]);

    assert.equal(startsBeforeRelease, 2, 'ordinary updates must still persist concurrently');
  } finally {
    harness.restore();
  }
});

test('overlapping Google edits never copy an unconfirmed different field into a title-only write', async (t) => {
  const scenarios = [
    { name: 'A fails before B succeeds', order: [0, 1] as const, outcomes: ['failure', 'success'] as const },
    { name: 'B succeeds before A fails', order: [1, 0] as const, outcomes: ['failure', 'success'] as const },
    { name: 'both succeed A then B', order: [0, 1] as const, outcomes: ['success', 'success'] as const },
    { name: 'both succeed B then A', order: [1, 0] as const, outcomes: ['success', 'success'] as const },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const eventId = 'google-different-fields';
      let authoritative = googleEvent(eventId, '수정 전 제목');
      let updateCalls = 0;
      let canonicalReads = 0;
      const started = [deferred<void>(), deferred<void>()];
      const gates = [deferred<void>(), deferred<void>()];
      const patches: Array<Record<string, unknown>> = [];

      const harness = await createHarness({
        personalCalendarId: 'primary',
        fullSync: async () => {
          canonicalReads += 1;
          return [authoritative];
        },
        updateGoogleEvent: async (_calendarId, _id, patch) => {
          const index = updateCalls;
          updateCalls += 1;
          patches[index] = patch;
          started[index].resolve();
          await gates[index].promise;
          if (scenario.outcomes[index] === 'failure') throw new Error(`update ${index} failed`);

          if (Object.hasOwn(patch, 'summary')) authoritative = { ...authoritative, summary: String(patch.summary) };
          if (Object.hasOwn(patch, 'description')) authoritative = { ...authoritative, description: String(patch.description ?? '') };
          if (Object.hasOwn(patch, 'startDate')) {
            authoritative = { ...authoritative, start: { date: String(patch.startDate) } };
          }
          if (Object.hasOwn(patch, 'endDate')) {
            authoritative = { ...authoritative, end: { date: String(patch.endDate) } };
          }
          if (Object.hasOwn(patch, 'extendedProperties')) {
            authoritative = {
              ...authoritative,
              extendedProperties: { private: { ...(patch.extendedProperties as Record<string, string>) } },
            };
          }
        },
      });

      try {
        await harness.service.syncAll({ skipBflowLoad: true });
        const updates = [
          harness.service.updateEvent(eventId, {
            type: 'scene',
            linkedPart: '파트 A',
            startDate: '2026-08-26',
            endDate: '2026-08-27',
          }),
          undefined as Promise<void> | undefined,
        ];
        await started[0].promise;
        updates[1] = harness.service.updateEvent(eventId, { title: '제목 B' });
        await started[1].promise;

        const settled = updates.map((promise) => promise!.then(
          () => null,
          (error: unknown) => error,
        ));
        for (const index of scenario.order) {
          gates[index].resolve();
          await settled[index];
        }
        await Promise.all(settled);

        assert.deepEqual(
          Object.keys(patches[1]).sort(),
          ['summary'],
          'the title-only write must not carry dates or extended metadata from A optimistic state',
        );
        const current = (await harness.service.getEvents()).find(({ id }) => id === eventId);
        assert.ok(current);
        assert.equal(current.title, '제목 B');
        if (scenario.outcomes[0] === 'failure') {
          assert.equal(current.type, 'custom');
          assert.equal(current.linkedPart, undefined);
          assert.equal(current.startDate, '2026-08-24');
          assert.equal(current.endDate, '2026-08-24');
        } else {
          assert.equal(current.type, 'scene');
          assert.equal(current.linkedPart, '파트 A');
          assert.equal(current.startDate, '2026-08-26');
          assert.equal(current.endDate, '2026-08-27');
        }
        assert.equal(canonicalReads, 2, 'initial sync plus one coalesced reconciliation');
      } finally {
        harness.restore();
      }
    });
  }
});

test('failed full sync and empty incremental never confirm a pending optimistic metadata edit', async (t) => {
  for (const syncKind of ['partial-full-failure', 'empty-incremental'] as const) {
    await t.test(syncKind, async () => {
      const eventId = `pending-${syncKind}`;
      let failPrimaryFullSync = false;
      let updateCalls = 0;
      const started = [deferred<void>(), deferred<void>()];
      const gates = [deferred<void>(), deferred<void>()];
      const patches: Array<Record<string, unknown>> = [];
      const harness = await createHarness({
        teamCalendarId: 'team-calendar',
        personalCalendarId: 'primary',
        fullSync: async (calendarId) => {
          if (calendarId === 'team-calendar') return [];
          if (failPrimaryFullSync) throw new Error('primary sync failed');
          return [googleEvent(eventId, '서버 제목')];
        },
        incrementalSync: async () => ({ updated: [], deleted: [], isFullSync: false }),
        updateGoogleEvent: async (_calendarId, _id, patch) => {
          const index = updateCalls;
          updateCalls += 1;
          patches[index] = patch;
          started[index].resolve();
          await gates[index].promise;
          if (index === 0) throw new Error('optimistic A failed');
        },
      });
      const originalWarn = console.warn;
      console.warn = () => {};

      try {
        await harness.service.syncAll({ skipBflowLoad: true });
        failPrimaryFullSync = true;
        const editA = harness.service.updateEvent(eventId, { type: 'scene' }).catch(() => {});
        await started[0].promise;

        if (syncKind === 'partial-full-failure') {
          await harness.service.syncAll({ skipBflowLoad: true });
        } else {
          await harness.service.syncIncremental();
        }

        const editB = harness.service.updateEvent(eventId, { linkedTodoId: 'todo-b' });
        await started[1].promise;
        assert.deepEqual(patches[1].extendedProperties, {
          bflow_type: 'custom',
          bflow_linked_todo_id: 'todo-b',
        });

        gates[1].resolve();
        await editB;
        gates[0].resolve();
        await editA;
      } finally {
        console.warn = originalWarn;
        harness.restore();
      }
    });
  }
});

test('successful metadata writes confirm Google PATCH merges in completion order', async (t) => {
  const scenarios = [
    {
      name: 'A then B',
      order: [0, 1] as const,
      afterWrites: { bflow_type: 'custom', bflow_linked_part: '파트 B' },
      afterC: {
        bflow_type: 'custom',
        bflow_linked_part: '파트 B',
        bflow_linked_todo_id: 'todo-c',
      },
    },
    {
      name: 'B then A',
      order: [1, 0] as const,
      afterWrites: { bflow_type: 'scene', bflow_linked_part: '파트 B' },
      afterC: {
        bflow_type: 'scene',
        bflow_linked_part: '파트 B',
        bflow_linked_todo_id: 'todo-c',
      },
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const eventId = `metadata-last-${scenario.name}`;
      let failReconciliation = false;
      let updateCalls = 0;
      const started = [deferred<void>(), deferred<void>()];
      const gates = [deferred<void>(), deferred<void>()];
      const patches: Array<Record<string, unknown>> = [];
      let serverMetadata: Record<string, string> = { bflow_type: 'custom' };
      const harness = await createHarness({
        personalCalendarId: 'primary',
        fullSync: async () => {
          if (failReconciliation) throw new Error('reconciliation unavailable');
          return [googleEvent(eventId, '서버 제목')];
        },
        updateGoogleEvent: async (_calendarId, _id, patch) => {
          const index = updateCalls;
          updateCalls += 1;
          patches[index] = patch;
          if (index < 2) {
            started[index].resolve();
            await gates[index].promise;
          }
          if (patch.extendedProperties) {
            serverMetadata = {
              ...serverMetadata,
              ...(patch.extendedProperties as Record<string, string>),
            };
          }
        },
      });
      const originalWarn = console.warn;
      console.warn = () => {};

      try {
        await harness.service.syncAll({ skipBflowLoad: true });
        failReconciliation = true;
        const edits = [
          harness.service.updateEvent(eventId, { type: 'scene' }),
          undefined as Promise<void> | undefined,
        ];
        await started[0].promise;
        edits[1] = harness.service.updateEvent(eventId, { linkedPart: '파트 B' });
        await started[1].promise;

        for (const index of scenario.order) {
          gates[index].resolve();
          await edits[index];
        }
        await Promise.all(edits);
        assert.deepEqual(
          serverMetadata,
          scenario.afterWrites,
          'the fake server must model Google PATCH by retaining omitted property keys',
        );

        await harness.service.updateEvent(eventId, { linkedTodoId: 'todo-c' });
        assert.deepEqual(
          patches[2].extendedProperties,
          scenario.afterC,
          'C must extend the same metadata merge that Google retained on the server',
        );
        assert.deepEqual(serverMetadata, scenario.afterC);
      } finally {
        console.warn = originalWarn;
        harness.restore();
      }
    });
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

test('a clean-session metadata failure defers event mapping until a later metadata retry succeeds', async () => {
  let calendarListCalls = 0;
  let eventListCalls = 0;
  const harness = await createHarness({
    currentUserId: 'user-a',
    calendarList: async () => {
      calendarListCalls += 1;
      if (calendarListCalls === 1) throw new Error('calendar metadata unavailable');
      return [personalCalendar('user-a')];
    },
    fullSync: async () => [],
    bflowEventsList: async () => {
      eventListCalls += 1;
      return [bflowEvent('personal-user-a', 'A 개인 일정')];
    },
  });
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await harness.service.loadBflowEvents();

    assert.equal(eventListCalls, 0, 'rows must not be fetched or mapped without calendar metadata');
    assert.deepEqual(await harness.service.getEvents(), []);
    assert.deepEqual(harness.broadcasts, []);

    await harness.service.loadBflowEvents();

    assert.equal(eventListCalls, 1);
    const [event] = await harness.service.getEvents();
    assert.deepEqual({
      id: event?.id,
      color: event?.color,
      sourceCalendarId: event?.sourceCalendarId,
      isPrivate: event?.isPrivate,
      canEdit: event?.canEdit,
      isReadOnly: event?.isReadOnly,
    }, {
      id: 'personal-user-a',
      color: '#6C5CE7',
      sourceCalendarId: 'bflow:calendar-1',
      isPrivate: true,
      canEdit: true,
      isReadOnly: false,
    });
    assert.equal(harness.broadcasts.length, 1);
  } finally {
    console.warn = originalWarn;
    harness.restore();
  }
});

test('an older failed metadata request does not duplicate the newer successful event load', async () => {
  const olderMetadata = deferred<BflowCalendarFixture[]>();
  const olderMetadataStarted = deferred<void>();
  let calendarListCalls = 0;
  let eventListCalls = 0;
  const harness = await createHarness({
    currentUserId: 'user-a',
    calendarList: async () => {
      calendarListCalls += 1;
      if (calendarListCalls === 1) {
        olderMetadataStarted.resolve();
        return olderMetadata.promise;
      }
      return [personalCalendar('user-a')];
    },
    fullSync: async () => [],
    bflowEventsList: async () => {
      eventListCalls += 1;
      return [bflowEvent('latest-personal', '최신 개인 일정')];
    },
  });
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const olderLoad = harness.service.loadBflowEvents();
    await olderMetadataStarted.promise;
    await harness.service.loadBflowEvents();

    olderMetadata.reject(new Error('older metadata failed'));
    await olderLoad;

    assert.equal(eventListCalls, 1, 'only the latest metadata-ready request may fetch event rows');
    assert.deepEqual((await harness.service.getEvents()).map(({ id }) => id), ['latest-personal']);
    assert.equal(harness.broadcasts.length, 1);
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

test('stale B flow and legacy delete failures cannot restore user A rows into user B cache', async (t) => {
  for (const source of ['bflow', 'legacy'] as const) {
    await t.test(source, async () => {
      let activeUserId = 'user-a';
      const deleteStarted = deferred<void>();
      const deleteGate = deferred<void>();
      const harness = await createHarness({
        currentUserId: activeUserId,
        calendarList: async () => [personalCalendar(activeUserId)],
        fullSync: async () => [],
        bflowEventsList: async () => source === 'bflow'
          ? [bflowEvent(`event-${activeUserId}`, `일정 ${activeUserId}`)]
          : [],
        readPrivateEvents: async () => source === 'legacy'
          ? [{ ...legacyPrivateEvent(`event-${activeUserId}`, activeUserId), title: `일정 ${activeUserId}` }]
          : [],
        deleteBflowEvent: async () => {
          if (source !== 'bflow') return;
          deleteStarted.resolve();
          await deleteGate.promise;
          throw new Error('A delete failed');
        },
        deleteLegacyEvent: async () => {
          if (source !== 'legacy') return;
          deleteStarted.resolve();
          await deleteGate.promise;
          throw new Error('A delete failed');
        },
      });

      try {
        await harness.service.loadBflowEvents();
        const deletion = harness.service.deleteEvent('event-user-a').then(
          () => null,
          (error: unknown) => error,
        );
        await deleteStarted.promise;

        activeUserId = 'user-b';
        harness.service.__testUseAuthStore.setState({ currentUser: authUser(activeUserId) });
        await harness.service.loadBflowEvents();
        const broadcastsAfterBLoad = harness.broadcasts.length;

        deleteGate.resolve();
        await deletion;

        assert.deepEqual(
          (await harness.service.getEvents()).map(({ id, title }) => ({ id, title })),
          [{ id: 'event-user-b', title: '일정 user-b' }],
        );
        assert.equal(harness.broadcasts.length, broadcastsAfterBLoad);
      } finally {
        harness.restore();
      }
    });
  }
});

test('stale B flow and legacy update failures cannot roll user A data over user B same-id rows', async (t) => {
  for (const source of ['bflow', 'legacy'] as const) {
    await t.test(source, async () => {
      let activeUserId = 'user-a';
      const updateStarted = deferred<void>();
      const updateGate = deferred<void>();
      const harness = await createHarness({
        currentUserId: activeUserId,
        calendarList: async () => [personalCalendar(activeUserId)],
        fullSync: async () => [],
        bflowEventsList: async () => source === 'bflow'
          ? [{ ...bflowEvent('shared-id', `일정 ${activeUserId}`) }]
          : [],
        readPrivateEvents: async () => source === 'legacy'
          ? [{ ...legacyPrivateEvent('shared-id', activeUserId), title: `일정 ${activeUserId}` }]
          : [],
        updateBflowEvent: async () => {
          updateStarted.resolve();
          await updateGate.promise;
          throw new Error('A update failed');
        },
        updateLegacyEvent: async () => {
          updateStarted.resolve();
          await updateGate.promise;
          throw new Error('A update failed');
        },
      });

      try {
        await harness.service.loadBflowEvents();
        const update = harness.service.updateEvent('shared-id', { title: 'A 낙관적 수정' }).then(
          () => null,
          (error: unknown) => error,
        );
        await updateStarted.promise;

        activeUserId = 'user-b';
        harness.service.__testUseAuthStore.setState({ currentUser: authUser(activeUserId) });
        await harness.service.loadBflowEvents();
        const broadcastsAfterBLoad = harness.broadcasts.length;

        updateGate.resolve();
        await update;

        assert.equal(
          (await harness.service.getEvents()).find(({ id }) => id === 'shared-id')?.title,
          '일정 user-b',
        );
        assert.equal(harness.broadcasts.length, broadcastsAfterBLoad);
      } finally {
        harness.restore();
      }
    });
  }
});

test('stale B flow and legacy add successes cannot leave cache, broadcast, or ID aliases in user B session', async (t) => {
  for (const source of ['bflow', 'legacy'] as const) {
    await t.test(source, async () => {
      let activeUserId = 'user-a';
      const createStarted = deferred<void>();
      const createGate = deferred<void>();
      const serverId = 'server-shared-id';
      const harness = await createHarness({
        currentUserId: activeUserId,
        calendarList: async () => source === 'bflow' ? [personalCalendar(activeUserId)] : [],
        fullSync: async () => [],
        bflowEventsList: async () => source === 'bflow' && activeUserId === 'user-b'
          ? [bflowEvent(serverId, 'B 기존 일정')]
          : [],
        readPrivateEvents: async () => source === 'legacy' && activeUserId === 'user-b'
          ? [{ ...legacyPrivateEvent(serverId, activeUserId), title: 'B 기존 일정' }]
          : [],
        createBflowEvent: async () => {
          createStarted.resolve();
          await createGate.promise;
          return bflowEvent(serverId, 'A 새 일정');
        },
        createLegacyEvent: async () => {
          createStarted.resolve();
          await createGate.promise;
          return { ...legacyPrivateEvent(serverId, 'user-a'), title: 'A 새 일정' };
        },
      });

      try {
        const input = calendarEventInput('local-user-a', 'A 새 일정');
        if (source === 'legacy') {
          delete input.calendarId;
          input.isPrivate = true;
        }
        const add = harness.service.addEvent(input).then(
          () => null,
          (error: unknown) => error,
        );
        await createStarted.promise;

        activeUserId = 'user-b';
        harness.service.__testUseAuthStore.setState({ currentUser: authUser(activeUserId) });
        await harness.service.loadBflowEvents();
        const broadcastsAfterBLoad = harness.broadcasts.length;

        createGate.resolve();
        await add;

        assert.deepEqual(
          (await harness.service.getEvents()).map(({ id, title }) => ({ id, title })),
          [{ id: serverId, title: 'B 기존 일정' }],
        );
        assert.equal(harness.broadcasts.length, broadcastsAfterBLoad);

        await harness.service.deleteEvent('local-user-a');
        assert.deepEqual(harness.deletedBflowEventIds, []);
        assert.deepEqual(harness.deletedLegacyEventIds, []);
      } finally {
        harness.restore();
      }
    });
  }
});

test('privacy migration compensates only the committed replacement when the authenticated session changes', async () => {
  const createStarted = deferred<void>();
  const createGate = deferred<void>();
  const harness = await createHarness({
    currentUserId: 'user-a',
    personalCalendarId: 'primary',
    calendarList: async () => [personalCalendar('user-a')],
    bflowEventsList: async () => [],
    fullSync: async () => [googleEvent('google-user-a', 'A 공개 일정')],
    createPrivacyReplacement: async (request) => {
      assert.equal(request.storage, 'bflow');
      createStarted.resolve();
      await createGate.promise;
      return {
        actual_id: 'replacement-user-a',
        storage: 'bflow',
        calendar_id: 'calendar-1',
        receipt: 'receipt-user-a',
      };
    },
    settlePrivacyReplacement: async () => {},
  });

  try {
    await harness.service.loadBflowEvents();
    await harness.service.syncAll({ skipBflowLoad: true });
    const migration = harness.service.updateEvent('google-user-a', { isPrivate: true }).then(
      () => null,
      (error: unknown) => error,
    );
    await createStarted.promise;

    harness.service.__testUseAuthStore.setState({ currentUser: authUser('user-b') });
    const broadcastsAfterSwitch = harness.broadcasts.length;
    createGate.resolve();
    await migration;

    assert.deepEqual(harness.deletedGoogleEventIds, [], 'old Google source must not be deleted for user B');
    assert.deepEqual(
      harness.privacyReplacementSettlements,
      [{ receipt: 'receipt-user-a', disposition: 'delete' }],
      'only the exact server ID committed by the old create may be compensated',
    );
    assert.deepEqual(harness.deletedBflowEventIds, [], 'stale compensation must not use current-session delete');
    assert.deepEqual(
      harness.broadcasts.slice(broadcastsAfterSwitch),
      [],
      'the renderer does not duplicate the exact marker emitted by the main persistence boundary',
    );

    assert.equal(
      (await harness.service.getEvents()).some(({ id }) => id === 'replacement-user-a'),
      false,
      'the old-session replacement must not enter user B cache',
    );
    await harness.service.deleteEvent('replacement-user-a');
    assert.deepEqual(
      harness.privacyReplacementSettlements,
      [{ receipt: 'receipt-user-a', disposition: 'delete' }],
      'the stale request ID must not leave an alias that triggers another delete in user B',
    );
  } finally {
    harness.restore();
  }
});

test('an ordinary delete started after privacy migration waits and targets the replacement', async (t) => {
  for (const ordinaryOutcome of ['success', 'failure'] as const) {
    await t.test(ordinaryOutcome, async () => {
      const replacementCreateStarted = deferred<void>();
      const replacementCreateGate = deferred<void>();
      const ordinaryDeleteStarted = deferred<void>();
      const ordinaryDeleteGate = deferred<void>();
      const ordinaryDeleteError = new Error('ordinary source delete failed');
      const source = bflowEvent('private-source-user-a', 'A 비공개 일정');
      const harness = await createHarness({
        currentUserId: 'user-a',
        personalCalendarId: 'primary',
        calendarList: async () => [personalCalendar('user-a')],
        bflowEventsList: async () => [source],
        readPrivateEvents: async () => [],
        fullSync: async () => [],
        createPrivacyReplacement: async () => {
          replacementCreateStarted.resolve();
          await replacementCreateGate.promise;
          return {
            actual_id: 'google-replacement-user-a',
            storage: 'google',
            calendar_id: 'primary',
            receipt: 'google-receipt-user-a',
          };
        },
        settlePrivacyReplacement: async () => {},
        deleteBflowEvent: async () => {},
        deleteGoogleEvent: async () => {
          ordinaryDeleteStarted.resolve();
          await ordinaryDeleteGate.promise;
          if (ordinaryOutcome === 'failure') throw ordinaryDeleteError;
        },
      });

      try {
        await harness.service.loadBflowEvents();
        const migration = harness.service.updateEvent(source.id, { isPrivate: false }).then(
          () => null,
          (error: unknown) => error,
        );
        await replacementCreateStarted.promise;

        const ordinaryDelete = harness.service.deleteEvent(source.id).then(
          () => null,
          (error: unknown) => error,
        );
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(
          (await harness.service.getEvents()).some(({ id }) => id === source.id),
          true,
          'the later delete must wait instead of removing the migration source',
        );

        replacementCreateGate.resolve();
        assert.equal(await migration, null);
        await ordinaryDeleteStarted.promise;
        assert.deepEqual(harness.privacyReplacementSettlements, [
          { receipt: 'google-receipt-user-a', disposition: 'keep' },
        ]);

        ordinaryDeleteGate.resolve();
        const ordinaryError = await ordinaryDelete;
        if (ordinaryOutcome === 'failure') assert.equal(ordinaryError, ordinaryDeleteError);
        else assert.equal(ordinaryError, null);

        assert.deepEqual(harness.deletedBflowEventIds, [source.id]);
        assert.deepEqual(harness.deletedGoogleEventIds, ['google-replacement-user-a']);
        assert.deepEqual(
          (await harness.service.getEvents()).map(({ id }) => id),
          ordinaryOutcome === 'failure' ? ['google-replacement-user-a'] : [],
          'the later delete outcome remains authoritative on the committed replacement',
        );
      } finally {
        harness.restore();
      }
    });
  }
});

test('privacy migration compensates when an external committed delete removes its source', async () => {
  const replacementCreateStarted = deferred<void>();
  const replacementCreateGate = deferred<void>();
  const source = googleEvent('google-source-user-a', 'A 공개 일정');
  const harness = await createHarness({
    currentUserId: 'user-a',
    personalCalendarId: 'primary',
    calendarList: async () => [personalCalendar('user-a')],
    bflowEventsList: async () => [],
    readPrivateEvents: async () => [],
    fullSync: async () => [source],
    createPrivacyReplacement: async () => {
      replacementCreateStarted.resolve();
      await replacementCreateGate.promise;
      return {
        actual_id: 'bflow-replacement-user-a',
        storage: 'bflow',
        calendar_id: 'calendar-1',
        receipt: 'bflow-receipt-user-a',
      };
    },
    settlePrivacyReplacement: async () => {},
  });

  try {
    await harness.service.syncAll();
    const migration = harness.service.updateEvent(source.id, { isPrivate: true }).then(
      () => null,
      (error: unknown) => error,
    );
    await replacementCreateStarted.promise;

    assert.equal(harness.service.applyCommittedGoogleDelete(
      committedGoogleDeleteBroadcast(source.id, 'primary'),
    ), true);
    replacementCreateGate.resolve();

    const migrationError = await migration;
    assert.ok(migrationError instanceof Error, 'missing inherited source must fail the migration');
    assert.match(migrationError.message, /source|원본|찾을 수/i);
    assert.deepEqual(harness.privacyReplacementSettlements, [
      { receipt: 'bflow-receipt-user-a', disposition: 'delete' },
    ]);
    assert.deepEqual(
      (await harness.service.getEvents()).map(({ id }) => id),
      [],
      'only the exact replacement is compensated after the external source delete',
    );
  } finally {
    harness.restore();
  }
});

test('privacy migration compensates when strict B flow source deletion reports an externally missing row', async () => {
  const source = bflowEvent('externally-deleted-source', '이미 외부에서 삭제된 비공개 일정');
  let ordinaryDeleteCalls = 0;
  let strictDeleteCalls = 0;
  const harness = await createHarness({
    currentUserId: 'user-a',
    personalCalendarId: 'primary',
    calendarList: async () => [personalCalendar('user-a')],
    bflowEventsList: async () => [source],
    readPrivateEvents: async () => [],
    fullSync: async () => [],
    createPrivacyReplacement: async () => ({
      actual_id: 'replacement-for-missing-source',
      storage: 'google',
      calendar_id: 'primary',
      receipt: 'receipt-for-missing-source',
    }),
    settlePrivacyReplacement: async () => {},
    deleteBflowEvent: async () => { ordinaryDeleteCalls += 1; },
    deleteBflowMigrationSource: async () => {
      strictDeleteCalls += 1;
      return 'missing';
    },
  });

  try {
    await harness.service.loadBflowEvents();
    const broadcastsBeforeMigration = harness.broadcasts.length;
    const migrationError = await harness.service.updateEvent(source.id, { isPrivate: false }).then(
      () => null,
      (error: unknown) => error,
    );

    assert.ok(migrationError instanceof Error);
    assert.match(migrationError.message, /source|원본|missing|찾을 수/i);
    assert.equal(strictDeleteCalls, 1);
    assert.equal(ordinaryDeleteCalls, 0, 'inherited deletion must use the strict migration IPC');
    assert.deepEqual(harness.privacyReplacementSettlements, [
      { receipt: 'receipt-for-missing-source', disposition: 'delete' },
    ]);
    assert.deepEqual(await harness.service.getEvents(), []);
    assert.equal(
      harness.broadcasts.slice(broadcastsBeforeMigration).some((payload) => (
        (payload as { eventId?: string; action?: string } | undefined)?.eventId === source.id
        && (payload as { action?: string }).action === 'add'
      )),
      false,
      'a DB row already gone must not be restored into the renderer cache',
    );
  } finally {
    harness.restore();
  }
});

test('an ambiguous strict B flow delete keeps the replacement and never cleans a legacy shadow', async (t) => {
  for (const hasLegacyShadow of [false, true]) {
    await t.test(hasLegacyShadow ? 'with legacy shadow' : 'without legacy shadow', async () => {
      const source = bflowEvent(`ambiguous-canonical-${hasLegacyShadow}`, '응답 유실 원본');
      const replacementId = `ambiguous-replacement-${hasLegacyShadow}`;
      const googleUpdates: unknown[][] = [];
      const harness = await createHarness({
        currentUserId: 'user-a',
        personalCalendarId: 'primary',
        calendarList: async () => [personalCalendar('user-a')],
        bflowEventsList: async () => [source],
        readPrivateEvents: async () => (
          hasLegacyShadow ? [legacyPrivateEvent(source.id, 'user-a')] : []
        ),
        fullSync: async () => [],
        createPrivacyReplacement: async () => ({
          actual_id: replacementId,
          storage: 'google',
          calendar_id: 'primary',
          receipt: `ambiguous-receipt-${hasLegacyShadow}`,
        }),
        settlePrivacyReplacement: async () => {},
        deleteBflowMigrationSource: async () => 'ambiguous',
        deleteLegacyEvent: async () => { throw new Error('legacy cleanup must not run'); },
        updateGoogleEvent: async (...args) => { googleUpdates.push(args); },
      });
      const originalWarn = console.warn;

      try {
        console.warn = () => {};
        await harness.service.loadBflowEvents();
        await harness.service.updateEvent(source.id, { isPrivate: false });

        assert.deepEqual(harness.privacyReplacementSettlements, [
          { receipt: `ambiguous-receipt-${hasLegacyShadow}`, disposition: 'keep' },
        ]);
        assert.deepEqual(harness.deletedLegacyEventIds, []);
        assert.deepEqual((await harness.service.getEvents()).map(({ id }) => id), [replacementId]);

        await harness.service.updateEvent(source.id, { title: 'stale alias after response loss' });
        assert.equal(googleUpdates.length, 1);
        assert.equal(googleUpdates[0]?.[1], replacementId);
      } finally {
        console.warn = originalWarn;
        harness.restore();
      }
    });
  }
});

test('privacy migration uses strict source outcomes for legacy and Google stores without risking zero rows', async (t) => {
  for (const storage of ['legacy-private', 'google'] as const) {
    for (const outcome of ['deleted', 'missing', 'ambiguous', 'definitive-failure'] as const) {
      await t.test(`${storage} ${outcome}`, async () => {
        const sourceId = `${storage}-source-${outcome}`;
        const replacementId = `${storage}-replacement-${outcome}`;
        const definitiveError = new Error(`${storage} source definitely remained`);
        const sourceDeleteRequests: Array<{
          storage: 'bflow' | 'legacy-private' | 'google';
          event_id: string;
          calendar_id?: string;
        }> = [];
        const harness = await createHarness({
          currentUserId: 'user-a',
          personalCalendarId: 'primary',
          calendarList: async () => [personalCalendar('user-a')],
          bflowEventsList: async () => [],
          readPrivateEvents: async () => (
            storage === 'legacy-private' ? [legacyPrivateEvent(sourceId, 'user-a')] : []
          ),
          fullSync: async () => (
            storage === 'google' ? [googleEvent(sourceId, 'Google 원본')] : []
          ),
          createPrivacyReplacement: async () => storage === 'legacy-private'
            ? {
                actual_id: replacementId,
                storage: 'google',
                calendar_id: 'primary',
                receipt: `receipt-${storage}-${outcome}`,
              }
            : {
                actual_id: replacementId,
                storage: 'bflow',
                calendar_id: 'personal-user-a',
                receipt: `receipt-${storage}-${outcome}`,
              },
          settlePrivacyReplacement: async () => {},
          deletePrivacyMigrationSource: async (request) => {
            sourceDeleteRequests.push(request);
            if (outcome === 'definitive-failure') throw definitiveError;
            return outcome;
          },
        });

        try {
          if (storage === 'google') await harness.service.syncAll();
          else await harness.service.loadBflowEvents();

          const migrationError = await harness.service.updateEvent(sourceId, {
            isPrivate: storage === 'google',
          }).then(
            () => null,
            (error: unknown) => error,
          );

          assert.deepEqual(sourceDeleteRequests, [storage === 'google'
            ? { storage, calendar_id: 'primary', event_id: sourceId }
            : { storage, event_id: sourceId }]);
          assert.deepEqual(
            harness.privacyReplacementSettlements,
            [{
              receipt: `receipt-${storage}-${outcome}`,
              disposition: outcome === 'deleted' || outcome === 'ambiguous' ? 'keep' : 'delete',
            }],
          );

          const visibleIds = (await harness.service.getEvents()).map(({ id }) => id);
          if (outcome === 'deleted' || outcome === 'ambiguous') {
            assert.equal(migrationError, null);
            assert.deepEqual(visibleIds, [replacementId]);
          } else if (outcome === 'missing') {
            assert.ok(migrationError instanceof Error);
            assert.match(migrationError.message, /source|원본|missing|찾을 수/i);
            assert.deepEqual(visibleIds, [], 'an externally missing source is never restored as a ghost');
          } else {
            assert.equal(migrationError, definitiveError);
            assert.deepEqual(visibleIds, [sourceId], 'a definite failure restores the still-persisted source');
          }

          assert.deepEqual(
            storage === 'legacy-private'
              ? harness.deletedLegacyEventIds
              : harness.deletedGoogleEventIds,
            [],
            'migration source deletion never falls through to the ordinary unclassified API',
          );
        } finally {
          harness.restore();
        }
      });
    }
  }
});

test('a same-owner legacy zero-row failure restores the source and compensates its replacement', async () => {
  const source = legacyPrivateEvent('legacy-same-owner-source', 'user-a');
  const replacementId = 'legacy-same-owner-replacement';
  const sameOwnerDeleteError = new Error('구 비공개 이관 원본 삭제가 완료되지 않았습니다');
  const harness = await createHarness({
    currentUserId: 'user-a',
    personalCalendarId: 'primary',
    calendarList: async () => [personalCalendar('user-a')],
    bflowEventsList: async () => [],
    readPrivateEvents: async () => [source],
    fullSync: async () => [],
    createPrivacyReplacement: async () => ({
      actual_id: replacementId,
      storage: 'google',
      calendar_id: 'primary',
      receipt: 'legacy-same-owner-receipt',
    }),
    settlePrivacyReplacement: async () => {},
    deletePrivacyMigrationSource: async () => { throw sameOwnerDeleteError; },
  });

  try {
    await harness.service.loadBflowEvents();
    await assert.rejects(
      harness.service.updateEvent(source.id, { isPrivate: false }),
      (error: unknown) => error === sameOwnerDeleteError,
    );
    assert.deepEqual(harness.privacyReplacementSettlements, [{
      receipt: 'legacy-same-owner-receipt',
      disposition: 'delete',
    }]);
    assert.deepEqual(
      (await harness.service.getEvents()).map(({ id }) => id),
      [source.id],
      'the still-owned source returns to cache after the replacement is compensated',
    );
  } finally {
    harness.restore();
  }
});

test('a session switch during strict legacy or Google deletion keeps the replacement for committed or ambiguous outcomes', async (t) => {
  for (const storage of ['legacy-private', 'google'] as const) {
    for (const outcome of ['deleted', 'ambiguous'] as const) {
      await t.test(`${storage} ${outcome}`, async () => {
        const sourceId = `${storage}-session-source-${outcome}`;
        const replacementId = `${storage}-session-replacement-${outcome}`;
        let switchSession = () => {};
        const harness = await createHarness({
          currentUserId: 'user-a',
          personalCalendarId: 'primary',
          calendarList: async () => [personalCalendar('user-a')],
          bflowEventsList: async () => [],
          readPrivateEvents: async () => (
            storage === 'legacy-private' ? [legacyPrivateEvent(sourceId, 'user-a')] : []
          ),
          fullSync: async () => (
            storage === 'google' ? [googleEvent(sourceId, '세션 전환 Google 원본')] : []
          ),
          createPrivacyReplacement: async () => storage === 'legacy-private'
            ? {
                actual_id: replacementId,
                storage: 'google',
                calendar_id: 'primary',
                receipt: `receipt-${storage}-${outcome}`,
              }
            : {
                actual_id: replacementId,
                storage: 'bflow',
                calendar_id: 'personal-user-a',
                receipt: `receipt-${storage}-${outcome}`,
              },
          settlePrivacyReplacement: async () => {},
          deletePrivacyMigrationSource: async () => {
            switchSession();
            return outcome;
          },
        });

        try {
          switchSession = () => harness.service.__testUseAuthStore.setState({
            currentUser: authUser('user-b'),
            users: [authUser('user-b')],
          });
          if (storage === 'google') await harness.service.syncAll();
          else await harness.service.loadBflowEvents();

          await harness.service.updateEvent(sourceId, {
            isPrivate: storage === 'google',
          });

          assert.deepEqual(harness.privacyMigrationSourceDeletes, [storage === 'google'
            ? { storage, calendar_id: 'primary', event_id: sourceId }
            : { storage, event_id: sourceId }]);
          assert.deepEqual(harness.privacyReplacementSettlements, [{
            receipt: `receipt-${storage}-${outcome}`,
            disposition: 'keep',
          }]);
          assert.deepEqual(
            storage === 'legacy-private'
              ? harness.deletedLegacyEventIds
              : harness.deletedGoogleEventIds,
            [],
          );
        } finally {
          harness.restore();
        }
      });
    }
  }
});

test('strict missing B flow source restores its legacy shadow for queued stale-ID followers', async (t) => {
  for (const followerKind of ['update', 'delete'] as const) {
    await t.test(followerKind, async () => {
      const strictDeleteStarted = deferred<void>();
      const strictDeleteGate = deferred<void>();
      const source = bflowEvent(`missing-canonical-with-legacy-${followerKind}`, 'legacy 비공개 일정');
      const legacyUpdates: Array<[string, Record<string, unknown>]> = [];
      const harness = await createHarness({
        currentUserId: 'user-a',
        personalCalendarId: 'primary',
        calendarList: async () => [personalCalendar('user-a')],
        bflowEventsList: async () => [source],
        readPrivateEvents: async () => [legacyPrivateEvent(source.id, 'user-a')],
        fullSync: async () => [],
        createPrivacyReplacement: async () => ({
          actual_id: `replacement-for-legacy-shadow-${followerKind}`,
          storage: 'google',
          calendar_id: 'primary',
          receipt: `receipt-for-legacy-shadow-${followerKind}`,
        }),
        settlePrivacyReplacement: async () => {},
        deleteBflowMigrationSource: async () => {
          strictDeleteStarted.resolve();
          await strictDeleteGate.promise;
          return 'missing';
        },
        updateLegacyEvent: async (eventId, patch) => { legacyUpdates.push([eventId, patch]); },
        deleteLegacyEvent: async () => {},
      });

      try {
        await harness.service.loadBflowEvents();
        const broadcastsBeforeMigration = harness.broadcasts.length;
        const migration = harness.service.updateEvent(source.id, { isPrivate: false }).then(
          () => null,
          (error: unknown) => error,
        );
        await strictDeleteStarted.promise;
        const follower = followerKind === 'update'
          ? harness.service.updateEvent(source.id, { title: 'queued legacy update' })
          : harness.service.deleteEvent(source.id);
        assert.deepEqual(harness.deletedLegacyEventIds, [], 'strict false must not delete the shadow');

        strictDeleteGate.resolve();
        assert.ok(await migration instanceof Error);
        await follower;

        assert.deepEqual(harness.privacyReplacementSettlements, [
          { receipt: `receipt-for-legacy-shadow-${followerKind}`, disposition: 'delete' },
        ]);
        assert.equal(
          harness.broadcasts.slice(broadcastsBeforeMigration).some((payload) => (
            (payload as { eventId?: string; action?: string } | undefined)?.eventId === source.id
            && (payload as { action?: string }).action === 'add'
          )),
          false,
          'the surviving legacy row is a source switch, not a B flow ghost rollback',
        );
        if (followerKind === 'update') {
          assert.deepEqual(legacyUpdates, [[source.id, { title: 'queued legacy update' }]]);
          assert.deepEqual(
            (await harness.service.getEvents()).map(({ id, sourceCalendarId, title }) => ({
              id,
              sourceCalendarId,
              title,
            })),
            [{ id: source.id, sourceCalendarId: 'supabase-private', title: 'queued legacy update' }],
          );
        } else {
          assert.deepEqual(harness.deletedLegacyEventIds, [source.id]);
          assert.deepEqual(await harness.service.getEvents(), []);
        }
      } finally {
        harness.restore();
      }
    });
  }
});

test('legacy cleanup response loss after strict canonical deletion never compensates the replacement', async (t) => {
  for (const legacyOutcome of ['throw-before-commit', 'commit-then-throw'] as const) {
    await t.test(legacyOutcome, async () => {
      const source = bflowEvent(`canonical-deleted-${legacyOutcome}`, '비공개 일정');
      const legacy = legacyPrivateEvent(source.id, 'user-a');
      const replacementId = `replacement-${legacyOutcome}`;
      const googleUpdates: unknown[][] = [];
      let legacyExists = true;
      const harness = await createHarness({
        currentUserId: 'user-a',
        personalCalendarId: 'primary',
        calendarList: async () => [personalCalendar('user-a')],
        bflowEventsList: async () => [source],
        readPrivateEvents: async () => (legacyExists ? [legacy] : []),
        fullSync: async () => [],
        createPrivacyReplacement: async () => ({
          actual_id: replacementId,
          storage: 'google',
          calendar_id: 'primary',
          receipt: `receipt-${legacyOutcome}`,
        }),
        settlePrivacyReplacement: async () => {},
        deleteBflowMigrationSource: async () => 'deleted',
        deleteLegacyEvent: async () => {
          if (legacyOutcome === 'commit-then-throw') legacyExists = false;
          throw new Error(`legacy cleanup ${legacyOutcome}`);
        },
        updateGoogleEvent: async (...args) => { googleUpdates.push(args); },
      });
      const originalWarn = console.warn;

      try {
        console.warn = () => {};
        await harness.service.loadBflowEvents();
        await harness.service.updateEvent(source.id, { isPrivate: false });

        assert.deepEqual(harness.privacyReplacementSettlements, [
          { receipt: `receipt-${legacyOutcome}`, disposition: 'keep' },
        ]);
        assert.deepEqual(
          (await harness.service.getEvents()).map(({ id }) => id),
          [replacementId],
          'a committed canonical delete makes the replacement the data-loss safety copy',
        );

        await harness.service.updateEvent(source.id, { title: 'stale alias retry' });
        assert.equal(googleUpdates.length, 1);
        assert.equal(googleUpdates[0]?.[1], replacementId);
      } finally {
        console.warn = originalWarn;
        harness.restore();
      }
    });
  }
});

test('an ordinary update started after privacy migration applies to the committed replacement', async () => {
  const replacementCreateStarted = deferred<void>();
  const replacementCreateGate = deferred<void>();
  const source = bflowEvent('private-source-user-a', 'T1 제목');
  const bflowUpdates: unknown[][] = [];
  const googleUpdates: unknown[][] = [];
  const harness = await createHarness({
    currentUserId: 'user-a',
    personalCalendarId: 'primary',
    calendarList: async () => [personalCalendar('user-a')],
    bflowEventsList: async () => [source],
    readPrivateEvents: async () => [],
    fullSync: async () => [],
    createPrivacyReplacement: async () => {
      replacementCreateStarted.resolve();
      await replacementCreateGate.promise;
      return {
        actual_id: 'google-replacement-user-a',
        storage: 'google',
        calendar_id: 'primary',
        receipt: 'google-receipt-user-a',
      };
    },
    settlePrivacyReplacement: async () => {},
    deleteBflowEvent: async () => {},
    updateBflowEvent: async (...args) => {
      bflowUpdates.push(args);
      return { ...source, title: 'T2 최신 제목' };
    },
    updateGoogleEvent: async (...args) => {
      googleUpdates.push(args);
    },
  });

  try {
    await harness.service.loadBflowEvents();
    const migration = harness.service.updateEvent(source.id, { isPrivate: false });
    await replacementCreateStarted.promise;

    let followerSettled = false;
    const follower = harness.service.updateEvent(source.id, { title: 'T2 최신 제목' })
      .finally(() => { followerSettled = true; });
    await Promise.resolve();
    await Promise.resolve();
    const settledBeforeMigration = followerSettled;

    replacementCreateGate.resolve();
    await Promise.all([migration, follower]);

    assert.equal(settledBeforeMigration, false, 'later intent waits for the active privacy migration');
    assert.deepEqual(bflowUpdates, [], 'the later update must not persist against the soon-deleted source');
    assert.equal(googleUpdates.length, 1);
    assert.equal(googleUpdates[0]?.[0], 'primary');
    assert.equal(googleUpdates[0]?.[1], 'google-replacement-user-a');
    assert.equal((googleUpdates[0]?.[2] as { summary?: string }).summary, 'T2 최신 제목');
    assert.deepEqual(harness.privacyReplacementSettlements, [
      { receipt: 'google-receipt-user-a', disposition: 'keep' },
    ]);
    assert.deepEqual(
      (await harness.service.getEvents()).map(({ id, title }) => ({ id, title })),
      [{ id: 'google-replacement-user-a', title: 'T2 최신 제목' }],
    );
  } finally {
    harness.restore();
  }
});

test('an ordinary delete started after privacy migration deletes the committed replacement', async () => {
  const replacementCreateStarted = deferred<void>();
  const replacementCreateGate = deferred<void>();
  const source = bflowEvent('private-source-user-a', '삭제할 일정');
  const harness = await createHarness({
    currentUserId: 'user-a',
    personalCalendarId: 'primary',
    calendarList: async () => [personalCalendar('user-a')],
    bflowEventsList: async () => [source],
    readPrivateEvents: async () => [],
    fullSync: async () => [],
    createPrivacyReplacement: async () => {
      replacementCreateStarted.resolve();
      await replacementCreateGate.promise;
      return {
        actual_id: 'google-replacement-user-a',
        storage: 'google',
        calendar_id: 'primary',
        receipt: 'google-receipt-user-a',
      };
    },
    settlePrivacyReplacement: async () => {},
    deleteBflowEvent: async () => {},
    deleteGoogleEvent: async () => {},
  });

  try {
    await harness.service.loadBflowEvents();
    const migration = harness.service.updateEvent(source.id, { isPrivate: false }).then(
      () => null,
      (error: unknown) => error,
    );
    await replacementCreateStarted.promise;
    const follower = harness.service.deleteEvent(source.id);

    replacementCreateGate.resolve();
    assert.equal(await migration, null);
    await follower;
    assert.deepEqual(harness.privacyReplacementSettlements, [
      { receipt: 'google-receipt-user-a', disposition: 'keep' },
    ]);
    assert.deepEqual(harness.deletedBflowEventIds, [source.id]);
    assert.deepEqual(harness.deletedGoogleEventIds, ['google-replacement-user-a']);
    assert.deepEqual(await harness.service.getEvents(), []);
  } finally {
    harness.restore();
  }
});

test('a follower update continues on the restored source after privacy migration fails', async () => {
  const replacementCreateStarted = deferred<void>();
  const replacementCreateGate = deferred<void>();
  const replacementError = new Error('replacement create failed');
  const source = bflowEvent('private-source-user-a', 'T1 제목');
  const bflowUpdates: unknown[][] = [];
  const harness = await createHarness({
    currentUserId: 'user-a',
    personalCalendarId: 'primary',
    calendarList: async () => [personalCalendar('user-a')],
    bflowEventsList: async () => [source],
    readPrivateEvents: async () => [],
    fullSync: async () => [],
    createPrivacyReplacement: async () => {
      replacementCreateStarted.resolve();
      await replacementCreateGate.promise;
      throw replacementError;
    },
    updateBflowEvent: async (...args) => {
      bflowUpdates.push(args);
      return { ...source, title: 'T2 최신 제목' };
    },
  });

  try {
    await harness.service.loadBflowEvents();
    const migration = harness.service.updateEvent(source.id, { isPrivate: false }).then(
      () => null,
      (error: unknown) => error,
    );
    await replacementCreateStarted.promise;

    const follower = harness.service.updateEvent(source.id, { title: 'T2 최신 제목' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const sourceUpdatesBeforeMigration = bflowUpdates.length;

    replacementCreateGate.resolve();
    assert.equal(await migration, replacementError);
    await follower;
    assert.equal(sourceUpdatesBeforeMigration, 0, 'follower must wait before writing the source');
    assert.equal(bflowUpdates.length, 1);
    assert.deepEqual(
      (await harness.service.getEvents()).map(({ id, title }) => ({ id, title })),
      [{ id: source.id, title: 'T2 최신 제목' }],
    );
  } finally {
    harness.restore();
  }
});

test('fresh replacement ID followers continue on the source after create rejection', async (t) => {
  for (const replacementStorage of ['bflow', 'legacy-private', 'google'] as const) {
    for (const followerKind of ['update', 'delete'] as const) {
      await t.test(`${replacementStorage} then ${followerKind}`, async () => {
        const createStarted = deferred<void>();
        const createGate = deferred<void>();
        const createError = new Error(`${replacementStorage} replacement create failed`);
        const sourceId = `create-reject-source-${replacementStorage}-${followerKind}`;
        const sourceIsBflow = replacementStorage === 'google';
        const bflowSource = bflowEvent(sourceId, 'T1 제목');
        const googleSource = googleEvent(sourceId, 'T1 제목');
        const bflowUpdates: unknown[][] = [];
        const googleUpdates: unknown[][] = [];
        const harness = await createHarness({
          currentUserId: 'user-a',
          personalCalendarId: 'primary',
          calendarList: async () => replacementStorage === 'legacy-private'
            ? []
            : [personalCalendar('user-a')],
          bflowEventsList: async () => sourceIsBflow ? [bflowSource] : [],
          readPrivateEvents: async () => [],
          fullSync: async () => sourceIsBflow ? [] : [googleSource],
          createPrivacyReplacement: async (request) => {
            assert.equal(request.storage, replacementStorage);
            createStarted.resolve();
            await createGate.promise;
            throw createError;
          },
          updateBflowEvent: async (...args) => {
            bflowUpdates.push(args);
            return { ...bflowSource, title: 'T2 최신 제목' };
          },
          updateGoogleEvent: async (...args) => {
            googleUpdates.push(args);
          },
          deleteBflowEvent: async () => {},
          deleteGoogleEvent: async () => {},
        });

        try {
          if (sourceIsBflow) await harness.service.loadBflowEvents();
          else await harness.service.syncAll();
          const migration = harness.service.updateEvent(sourceId, {
            isPrivate: replacementStorage !== 'google',
          }).then(
            () => null,
            (error: unknown) => error,
          );
          await createStarted.promise;
          const optimisticAdd = [...harness.broadcasts].reverse().find((payload) => (
            payload !== null
            && typeof payload === 'object'
            && (payload as { action?: unknown }).action === 'add'
            && typeof (payload as { eventId?: unknown }).eventId === 'string'
            && ((payload as { eventId: string }).eventId).startsWith('cal_')
          )) as { eventId: string } | undefined;
          assert.ok(optimisticAdd, 'the optimistic fresh replacement ID must be exposed');

          const follower = (followerKind === 'update'
            ? harness.service.updateEvent(optimisticAdd.eventId, { title: 'T2 최신 제목' })
            : harness.service.deleteEvent(optimisticAdd.eventId)).then(
              () => null,
              (error: unknown) => error,
            );
          await new Promise<void>((resolve) => setImmediate(resolve));
          assert.deepEqual(bflowUpdates, []);
          assert.deepEqual(googleUpdates, []);
          assert.deepEqual(harness.deletedBflowEventIds, []);
          assert.deepEqual(harness.deletedGoogleEventIds, []);

          createGate.resolve();
          assert.equal(await migration, createError);
          assert.equal(await follower, null);
          assert.deepEqual(harness.privacyReplacementSettlements, []);

          if (followerKind === 'update') {
            if (sourceIsBflow) {
              assert.equal(bflowUpdates.length, 1);
              assert.equal(bflowUpdates[0]?.[0], sourceId);
              assert.deepEqual(googleUpdates, []);
            } else {
              assert.deepEqual(bflowUpdates, []);
              assert.equal(googleUpdates.length, 1);
              assert.equal(googleUpdates[0]?.[1], sourceId);
            }
            assert.deepEqual(
              (await harness.service.getEvents()).map(({ id, title }) => ({ id, title })),
              [{ id: sourceId, title: 'T2 최신 제목' }],
            );
          } else {
            assert.deepEqual(await harness.service.getEvents(), []);
            if (sourceIsBflow) {
              assert.deepEqual(harness.deletedBflowEventIds, [sourceId]);
              assert.deepEqual(harness.deletedGoogleEventIds, []);
            } else {
              assert.deepEqual(harness.deletedBflowEventIds, []);
              assert.deepEqual(harness.deletedGoogleEventIds, [sourceId]);
            }
          }
        } finally {
          harness.restore();
        }
      });
    }
  }
});

test('same-tick privacy migration reserves the event before a later ordinary intent', async (t) => {
  for (const followerKind of ['update', 'delete'] as const) {
    await t.test(followerKind, async () => {
      const replacementCreateStarted = deferred<void>();
      const replacementCreateGate = deferred<void>();
      const source = bflowEvent('same-tick-source-user-a', 'T1 제목');
      const bflowUpdates: unknown[][] = [];
      const googleUpdates: unknown[][] = [];
      const harness = await createHarness({
        currentUserId: 'user-a',
        personalCalendarId: 'primary',
        calendarList: async () => [personalCalendar('user-a')],
        bflowEventsList: async () => [source],
        readPrivateEvents: async () => [],
        fullSync: async () => [],
        createPrivacyReplacement: async () => {
          replacementCreateStarted.resolve();
          await replacementCreateGate.promise;
          return {
            actual_id: 'same-tick-google-replacement',
            storage: 'google',
            calendar_id: 'primary',
            receipt: 'same-tick-google-receipt',
          };
        },
        settlePrivacyReplacement: async () => {},
        deleteBflowEvent: async () => {},
        updateBflowEvent: async (...args) => {
          bflowUpdates.push(args);
          return { ...source, title: 'T2 최신 제목' };
        },
        updateGoogleEvent: async (...args) => {
          googleUpdates.push(args);
        },
        deleteGoogleEvent: async () => {},
      });

      try {
        await harness.service.loadBflowEvents();
        const migration = harness.service.updateEvent(source.id, { isPrivate: false });
        const follower = followerKind === 'update'
          ? harness.service.updateEvent(source.id, { title: 'T2 최신 제목' })
          : harness.service.deleteEvent(source.id);

        await replacementCreateStarted.promise;
        replacementCreateGate.resolve();
        const outcomes = await Promise.allSettled([migration, follower]);

        assert.deepEqual(outcomes.map(({ status }) => status), ['fulfilled', 'fulfilled']);
        assert.deepEqual(bflowUpdates, [], 'a same-tick later update must not write the source');
        assert.deepEqual(harness.privacyReplacementSettlements, [
          { receipt: 'same-tick-google-receipt', disposition: 'keep' },
        ]);
        assert.deepEqual(harness.deletedBflowEventIds, [source.id]);
        if (followerKind === 'update') {
          assert.equal(googleUpdates.length, 1);
          assert.equal(googleUpdates[0]?.[1], 'same-tick-google-replacement');
          assert.deepEqual(
            (await harness.service.getEvents()).map(({ id, title }) => ({ id, title })),
            [{ id: 'same-tick-google-replacement', title: 'T2 최신 제목' }],
          );
        } else {
          assert.deepEqual(harness.deletedGoogleEventIds, ['same-tick-google-replacement']);
          assert.deepEqual(await harness.service.getEvents(), []);
        }
      } finally {
        harness.restore();
      }
    });
  }
});

test('a privacy migration invoked after an ordinary update waits for the earlier intent', async () => {
  const ordinaryUpdateStarted = deferred<void>();
  const ordinaryUpdateGate = deferred<void>();
  const source = bflowEvent('ordinary-before-migration-source', 'T0 제목');
  let authoritative = source;
  let replacementCreates = 0;
  const harness = await createHarness({
    currentUserId: 'user-a',
    personalCalendarId: 'primary',
    calendarList: async () => [personalCalendar('user-a')],
    bflowEventsList: async () => [authoritative],
    readPrivateEvents: async () => [],
    fullSync: async () => [],
    updateBflowEvent: async () => {
      ordinaryUpdateStarted.resolve();
      await ordinaryUpdateGate.promise;
      authoritative = { ...source, title: 'T1 최신 제목' };
      return authoritative;
    },
    createPrivacyReplacement: async (request) => {
      replacementCreates += 1;
      assert.equal((request.event as { summary?: string }).summary, 'T1 최신 제목');
      return {
        actual_id: 'ordinary-before-migration-replacement',
        storage: 'google',
        calendar_id: 'primary',
        receipt: 'ordinary-before-migration-receipt',
      };
    },
    settlePrivacyReplacement: async () => {},
    deleteBflowEvent: async () => {},
  });

  try {
    await harness.service.loadBflowEvents();
    const ordinary = harness.service.updateEvent(source.id, { title: 'T1 최신 제목' });
    const migration = harness.service.updateEvent(source.id, { isPrivate: false });
    await ordinaryUpdateStarted.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(replacementCreates, 0, 'later migration waits for the earlier ordinary write');

    ordinaryUpdateGate.resolve();
    await Promise.all([ordinary, migration]);

    assert.equal(replacementCreates, 1);
    assert.deepEqual(
      (await harness.service.getEvents()).map(({ id, title }) => ({ id, title })),
      [{ id: 'ordinary-before-migration-replacement', title: 'T1 최신 제목' }],
    );
  } finally {
    harness.restore();
  }
});

test('a linked-todo synthetic ID shares the privacy reservation with its persisted event ID', async () => {
  const replacementCreateStarted = deferred<void>();
  const replacementCreateGate = deferred<void>();
  const source = {
    ...bflowEvent('linked-todo-source-user-a', 'T1 제목'),
    linked_todo_id: 'todo-1',
  };
  const bflowUpdates: unknown[][] = [];
  const googleUpdates: unknown[][] = [];
  const harness = await createHarness({
    currentUserId: 'user-a',
    personalCalendarId: 'primary',
    calendarList: async () => [personalCalendar('user-a')],
    bflowEventsList: async () => [source],
    readPrivateEvents: async () => [],
    fullSync: async () => [],
    createPrivacyReplacement: async () => {
      replacementCreateStarted.resolve();
      await replacementCreateGate.promise;
      return {
        actual_id: 'linked-todo-google-replacement',
        storage: 'google',
        calendar_id: 'primary',
        receipt: 'linked-todo-google-receipt',
      };
    },
    settlePrivacyReplacement: async () => {},
    deleteBflowEvent: async () => {},
    updateBflowEvent: async (...args) => {
      bflowUpdates.push(args);
      return { ...source, title: 'T2 최신 제목' };
    },
    updateGoogleEvent: async (...args) => {
      googleUpdates.push(args);
    },
  });

  try {
    await harness.service.loadBflowEvents();
    const migration = harness.service.updateEvent(source.id, { isPrivate: false });
    await replacementCreateStarted.promise;
    const follower = harness.service.updateEvent('cal_todo-1', { title: 'T2 최신 제목' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const sourceWritesBeforeMigration = bflowUpdates.length;

    replacementCreateGate.resolve();
    await Promise.all([migration, follower]);

    assert.equal(sourceWritesBeforeMigration, 0);
    assert.deepEqual(bflowUpdates, []);
    assert.equal(googleUpdates.length, 1);
    assert.equal(googleUpdates[0]?.[1], 'linked-todo-google-replacement');
    assert.deepEqual(
      (await harness.service.getEvents()).map(({ id, title }) => ({ id, title })),
      [{ id: 'linked-todo-google-replacement', title: 'T2 최신 제목' }],
    );
  } finally {
    harness.restore();
  }
});

test('same-tick privacy migrations serialize in invocation order without overwriting the reservation', async () => {
  const firstCreateStarted = deferred<void>();
  const firstCreateGate = deferred<void>();
  const source = bflowEvent('double-migration-source-user-a', 'T1 제목');
  let replacementCreates = 0;
  const googleUpdates: unknown[][] = [];
  const harness = await createHarness({
    currentUserId: 'user-a',
    personalCalendarId: 'primary',
    calendarList: async () => [personalCalendar('user-a')],
    bflowEventsList: async () => [source],
    readPrivateEvents: async () => [],
    fullSync: async () => [],
    createPrivacyReplacement: async () => {
      replacementCreates += 1;
      if (replacementCreates === 1) {
        firstCreateStarted.resolve();
        await firstCreateGate.promise;
      }
      return {
        actual_id: `double-migration-replacement-${replacementCreates}`,
        storage: 'google',
        calendar_id: 'primary',
        receipt: `double-migration-receipt-${replacementCreates}`,
      };
    },
    settlePrivacyReplacement: async () => {},
    deleteBflowEvent: async () => {},
    deleteGoogleEvent: async () => {},
    updateGoogleEvent: async (...args) => {
      googleUpdates.push(args);
    },
  });

  try {
    await harness.service.loadBflowEvents();
    const first = harness.service.updateEvent(source.id, { isPrivate: false, title: 'T1 전환' });
    const second = harness.service.updateEvent(source.id, { isPrivate: false, title: 'T2 최신 제목' });
    await firstCreateStarted.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    firstCreateGate.resolve();
    const outcomes = await Promise.allSettled([first, second]);

    assert.deepEqual(outcomes.map(({ status }) => status), ['fulfilled', 'fulfilled']);
    assert.equal(replacementCreates, 1, 'the second privacy intent must not start another migration');
    assert.deepEqual(harness.privacyReplacementSettlements, [
      { receipt: 'double-migration-receipt-1', disposition: 'keep' },
    ]);
    assert.equal(googleUpdates.length, 1);
    assert.equal(googleUpdates[0]?.[1], 'double-migration-replacement-1');
    assert.deepEqual(
      (await harness.service.getEvents()).map(({ id, title }) => ({ id, title })),
      [{ id: 'double-migration-replacement-1', title: 'T2 최신 제목' }],
    );
  } finally {
    harness.restore();
  }
});

test('a stale transitive alias survives a second migration invoked with the refreshed ID', async (t) => {
  for (const timing of ['same-tick', 'after-commit'] as const) {
    for (const followerKind of ['update', 'delete'] as const) {
      await t.test(`${timing} ${followerKind}`, async () => {
        const secondSourceDeleteStarted = deferred<void>();
        const secondSourceDeleteGate = deferred<void>();
        const source = bflowEvent(
          `alias-source-${timing}-${followerKind}`,
          '처음 비공개 일정',
        );
        const firstReplacementId = `alias-google-${timing}-${followerKind}`;
        const secondReplacementId = `alias-bflow-${timing}-${followerKind}`;
        const bflowUpdates: unknown[][] = [];
        let replacementCreates = 0;
        const harness = await createHarness({
          currentUserId: 'user-a',
          personalCalendarId: 'primary',
          calendarList: async () => [personalCalendar('user-a')],
          bflowEventsList: async () => [source],
          readPrivateEvents: async () => [],
          fullSync: async () => [],
          createPrivacyReplacement: async () => {
            replacementCreates += 1;
            if (replacementCreates === 1) {
              return {
                actual_id: firstReplacementId,
                storage: 'google',
                calendar_id: 'primary',
                receipt: `alias-first-receipt-${timing}-${followerKind}`,
              };
            }
            return {
              actual_id: secondReplacementId,
              storage: 'bflow',
              calendar_id: 'calendar-1',
              receipt: `alias-second-receipt-${timing}-${followerKind}`,
            };
          },
          settlePrivacyReplacement: async () => {},
          deleteBflowEvent: async () => {},
          deleteGoogleEvent: async (_calendarId, eventId) => {
            if (eventId !== firstReplacementId) return;
            secondSourceDeleteStarted.resolve();
            await secondSourceDeleteGate.promise;
          },
          updateBflowEvent: async (...args) => {
            bflowUpdates.push(args);
            return {
              ...bflowEvent(secondReplacementId, 'stale A 별칭으로 수정됨'),
              calendar_id: 'calendar-1',
            };
          },
        });

        try {
          await harness.service.loadBflowEvents();
          await harness.service.updateEvent(source.id, { isPrivate: false });

          const secondMigration = harness.service.updateEvent(firstReplacementId, {
            isPrivate: true,
          });
          const sameTickFollower = timing === 'same-tick'
            ? followerKind === 'update'
              ? harness.service.updateEvent(source.id, { title: 'stale A 별칭으로 수정됨' })
              : harness.service.deleteEvent(source.id)
            : null;

          await secondSourceDeleteStarted.promise;
          assert.deepEqual(bflowUpdates, [], 'same-tick stale alias follower waits for migration');
          secondSourceDeleteGate.resolve();
          await secondMigration;

          const follower = sameTickFollower ?? (followerKind === 'update'
            ? harness.service.updateEvent(source.id, { title: 'stale A 별칭으로 수정됨' })
            : harness.service.deleteEvent(source.id));
          await follower;

          assert.equal(replacementCreates, 2);
          assert.deepEqual(harness.deletedGoogleEventIds, [firstReplacementId]);
          if (followerKind === 'update') {
            assert.equal(bflowUpdates.length, 1);
            assert.equal(bflowUpdates[0]?.[0], secondReplacementId);
            assert.deepEqual(
              (await harness.service.getEvents()).map(({ id, title }) => ({ id, title })),
              [{ id: secondReplacementId, title: 'stale A 별칭으로 수정됨' }],
            );
          } else {
            assert.deepEqual(
              harness.deletedBflowEventIds,
              [source.id, secondReplacementId],
              'stale A must delete the final canonical replacement, not stop at a removed middle alias',
            );
            assert.deepEqual(await harness.service.getEvents(), []);
          }
        } finally {
          harness.restore();
        }
      });
    }
  }
});

test('cyclic event aliases terminate safely and still resolve a cached identity', async () => {
  const persistedIds = ['cycle-b', 'cycle-a', 'cycle-a'];
  const bflowUpdates: unknown[][] = [];
  const harness = await createHarness({
    currentUserId: 'user-a',
    calendarList: async () => [personalCalendar('user-a')],
    bflowEventsList: async () => [],
    readPrivateEvents: async () => [],
    fullSync: async () => [],
    createBflowEvent: async (input) => bflowEvent(
      persistedIds.shift() ?? String(input.id),
      String(input.title),
    ),
    updateBflowEvent: async (...args) => {
      bflowUpdates.push(args);
      return bflowEvent(String(args[0]), String(args[1].title));
    },
  });

  try {
    // A→B, B→A를 만든 뒤 C→A로 cycle 바깥의 stale alias를 연결한다.
    await harness.service.addEvent(calendarEventInput('cycle-a', 'A'));
    await harness.service.addEvent(calendarEventInput('cycle-b', 'B'));
    await harness.service.addEvent(calendarEventInput('cycle-c', 'C'));

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([
      harness.service.updateEvent('cycle-c', { title: 'cycle-safe update' }).then(() => 'updated'),
      new Promise<'timeout'>((resolve) => {
        timeout = setTimeout(() => resolve('timeout'), 250);
      }),
    ]);
    if (timeout) clearTimeout(timeout);

    assert.equal(outcome, 'updated', 'visited-set traversal must not loop on A↔B');
    assert.equal(bflowUpdates.length, 1);
    assert.equal(bflowUpdates[0]?.[0], 'cycle-a');
  } finally {
    harness.restore();
  }
});

test('a session switch drops update and delete intents waiting behind another user privacy migration', async (t) => {
  for (const followerKind of ['update', 'delete'] as const) {
    await t.test(followerKind, async () => {
      let activeUserId = 'user-a';
      const replacementCreateStarted = deferred<void>();
      const replacementCreateGate = deferred<void>();
      const sourceId = `waiting-${followerKind}-shared-id`;
      const bflowUpdates: unknown[][] = [];
      const harness = await createHarness({
        currentUserId: activeUserId,
        personalCalendarId: 'primary',
        calendarList: async () => [personalCalendar(activeUserId)],
        bflowEventsList: async () => [bflowEvent(sourceId, `${activeUserId} 일정`)],
        readPrivateEvents: async () => [],
        fullSync: async () => [],
        createPrivacyReplacement: async () => {
          replacementCreateStarted.resolve();
          await replacementCreateGate.promise;
          return {
            actual_id: `stale-${followerKind}-replacement`,
            storage: 'google',
            calendar_id: 'primary',
            receipt: `stale-${followerKind}-receipt`,
          };
        },
        settlePrivacyReplacement: async () => {},
        updateBflowEvent: async (...args) => {
          bflowUpdates.push(args);
          return bflowEvent(sourceId, '잘못 적용된 A 수정');
        },
        deleteBflowEvent: async () => {},
      });

      try {
        await harness.service.loadBflowEvents();
        const migration = harness.service.updateEvent(sourceId, { isPrivate: false });
        await replacementCreateStarted.promise;
        const follower = followerKind === 'update'
          ? harness.service.updateEvent(sourceId, { title: 'A의 대기 중 수정' })
          : harness.service.deleteEvent(sourceId);

        activeUserId = 'user-b';
        harness.service.__testUseAuthStore.setState({ currentUser: authUser(activeUserId) });
        await harness.service.loadBflowEvents();
        const broadcastsAfterBLoad = harness.broadcasts.length;

        replacementCreateGate.resolve();
        await Promise.allSettled([migration, follower]);

        assert.deepEqual(bflowUpdates, []);
        assert.deepEqual(harness.deletedBflowEventIds, []);
        assert.deepEqual(harness.privacyReplacementSettlements, [
          { receipt: `stale-${followerKind}-receipt`, disposition: 'delete' },
        ]);
        assert.deepEqual(
          (await harness.service.getEvents()).map(({ id, title }) => ({ id, title })),
          [{ id: sourceId, title: 'user-b 일정' }],
        );
        assert.equal(
          harness.broadcasts.length,
          broadcastsAfterBLoad,
          'replacement settlement relies on the main-process committed marker without renderer rebroadcast',
        );
      } finally {
        harness.restore();
      }
    });
  }
});

test('a persisted replacement ID follower waits for source deletion and preserves its intent', async (t) => {
  for (const sourceDeleteOutcome of ['success', 'failure'] as const) {
    for (const followerKind of ['update', 'delete'] as const) {
      await t.test(`${sourceDeleteOutcome} then ${followerKind}`, async () => {
        const sourceDeleteStarted = deferred<void>();
        const sourceDeleteGate = deferred<void>();
        const sourceDeleteError = new Error('Google source delete failed');
        const sourceId = `replacement-id-source-${sourceDeleteOutcome}-${followerKind}`;
        const replacementId = `personal-replacement-${sourceDeleteOutcome}-${followerKind}`;
        const source = googleEvent(sourceId, 'T1 제목');
        const bflowUpdates: unknown[][] = [];
        const googleUpdates: unknown[][] = [];
        let googleDeleteCalls = 0;
        const harness = await createHarness({
          currentUserId: 'user-a',
          personalCalendarId: 'primary',
          calendarList: async () => [personalCalendar('user-a')],
          bflowEventsList: async () => [],
          readPrivateEvents: async () => [],
          fullSync: async () => [source],
          createPrivacyReplacement: async (request) => {
            assert.equal(request.storage, 'bflow');
            return {
              actual_id: replacementId,
              storage: 'bflow',
              calendar_id: 'calendar-1',
              receipt: `replacement-id-receipt-${sourceDeleteOutcome}-${followerKind}`,
            };
          },
          settlePrivacyReplacement: async () => {},
          deleteGoogleEvent: async () => {
            googleDeleteCalls += 1;
            if (googleDeleteCalls !== 1) return;
            sourceDeleteStarted.resolve();
            await sourceDeleteGate.promise;
            if (sourceDeleteOutcome === 'failure') throw sourceDeleteError;
          },
          deleteBflowEvent: async () => {},
          updateBflowEvent: async (...args) => {
            bflowUpdates.push(args);
            return { ...bflowEvent(replacementId, 'T2 최신 제목'), calendar_id: 'calendar-1' };
          },
          updateGoogleEvent: async (...args) => {
            googleUpdates.push(args);
          },
        });

        try {
          await harness.service.syncAll();
          const migration = harness.service.updateEvent(sourceId, { isPrivate: true }).then(
            () => null,
            (error: unknown) => error,
          );
          await sourceDeleteStarted.promise;

          const follower = followerKind === 'update'
            ? harness.service.updateEvent(replacementId, { title: 'T2 최신 제목' })
            : harness.service.deleteEvent(replacementId);
          await new Promise<void>((resolve) => setImmediate(resolve));
          assert.deepEqual(bflowUpdates, []);
          assert.deepEqual(googleUpdates, []);
          assert.deepEqual(harness.deletedBflowEventIds, []);
          assert.deepEqual(harness.deletedGoogleEventIds, [sourceId]);

          sourceDeleteGate.resolve();
          const migrationResult = await migration;
          if (sourceDeleteOutcome === 'failure') assert.equal(migrationResult, sourceDeleteError);
          else assert.equal(migrationResult, null);
          await follower;

          assert.deepEqual(harness.privacyReplacementSettlements, [{
            receipt: `replacement-id-receipt-${sourceDeleteOutcome}-${followerKind}`,
            disposition: sourceDeleteOutcome === 'success' ? 'keep' : 'delete',
          }]);
          if (followerKind === 'update') {
            if (sourceDeleteOutcome === 'success') {
              assert.equal(bflowUpdates.length, 1);
              assert.equal(bflowUpdates[0]?.[0], replacementId);
              assert.deepEqual(googleUpdates, []);
            } else {
              assert.deepEqual(bflowUpdates, []);
              assert.equal(googleUpdates.length, 1);
              assert.equal(googleUpdates[0]?.[1], sourceId);
            }
            assert.deepEqual(
              (await harness.service.getEvents()).map(({ id, title }) => ({ id, title })),
              [{
                id: sourceDeleteOutcome === 'success' ? replacementId : sourceId,
                title: 'T2 최신 제목',
              }],
            );
          } else {
            assert.deepEqual(await harness.service.getEvents(), []);
            if (sourceDeleteOutcome === 'success') {
              assert.deepEqual(harness.deletedBflowEventIds, [replacementId]);
              assert.deepEqual(harness.deletedGoogleEventIds, [sourceId]);
            } else {
              assert.deepEqual(harness.deletedBflowEventIds, []);
              assert.deepEqual(harness.deletedGoogleEventIds, [sourceId, sourceId]);
            }
          }
        } finally {
          harness.restore();
        }
      });
    }
  }
});

test('old-ID followers still target the replacement when receipt keep fails', async (t) => {
  for (const followerKind of ['update', 'delete'] as const) {
    await t.test(followerKind, async () => {
      const keepStarted = deferred<void>();
      const keepGate = deferred<void>();
      const keepError = new Error('receipt keep failed');
      const source = bflowEvent(`keep-failure-source-${followerKind}`, 'T1 제목');
      const googleUpdates: unknown[][] = [];
      const harness = await createHarness({
        currentUserId: 'user-a',
        personalCalendarId: 'primary',
        calendarList: async () => [personalCalendar('user-a')],
        bflowEventsList: async () => [source],
        readPrivateEvents: async () => [],
        fullSync: async () => [],
        createPrivacyReplacement: async () => ({
          actual_id: `keep-failure-replacement-${followerKind}`,
          storage: 'google',
          calendar_id: 'primary',
          receipt: `keep-failure-receipt-${followerKind}`,
        }),
        settlePrivacyReplacement: async (_receipt, disposition) => {
          assert.equal(disposition, 'keep');
          keepStarted.resolve();
          await keepGate.promise;
          throw keepError;
        },
        deleteBflowEvent: async () => {},
        deleteGoogleEvent: async () => {},
        updateGoogleEvent: async (...args) => {
          googleUpdates.push(args);
        },
      });

      try {
        await harness.service.loadBflowEvents();
        const migration = harness.service.updateEvent(source.id, { isPrivate: false }).then(
          () => null,
          (error: unknown) => error,
        );
        await keepStarted.promise;
        const follower = followerKind === 'update'
          ? harness.service.updateEvent(source.id, { title: 'T2 최신 제목' })
          : harness.service.deleteEvent(source.id);
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.deepEqual(googleUpdates, []);
        assert.deepEqual(harness.deletedGoogleEventIds, []);

        keepGate.resolve();
        assert.equal(await migration, keepError);
        await follower;

        assert.deepEqual(harness.deletedBflowEventIds, [source.id]);
        assert.deepEqual(harness.privacyReplacementSettlements, [
          { receipt: `keep-failure-receipt-${followerKind}`, disposition: 'keep' },
        ]);
        if (followerKind === 'update') {
          assert.equal(googleUpdates.length, 1);
          assert.equal(googleUpdates[0]?.[1], `keep-failure-replacement-${followerKind}`);
          assert.deepEqual(
            (await harness.service.getEvents()).map(({ id, title }) => ({ id, title })),
            [{ id: `keep-failure-replacement-${followerKind}`, title: 'T2 최신 제목' }],
          );
        } else {
          assert.deepEqual(
            harness.deletedGoogleEventIds,
            [`keep-failure-replacement-${followerKind}`],
          );
          assert.deepEqual(await harness.service.getEvents(), []);
        }
      } finally {
        harness.restore();
      }
    });
  }
});

test('queued followers abort when source deletion and replacement compensation both fail', async (t) => {
  for (const followerKind of ['update', 'delete'] as const) {
    await t.test(followerKind, async () => {
      const sourceDeleteStarted = deferred<void>();
      const sourceDeleteGate = deferred<void>();
      const sourceDeleteError = new Error('source delete failed');
      const compensationError = new Error('replacement compensation failed');
      const source = bflowEvent(`ambiguous-source-${followerKind}`, 'T1 제목');
      const bflowUpdates: unknown[][] = [];
      const googleUpdates: unknown[][] = [];
      const harness = await createHarness({
        currentUserId: 'user-a',
        personalCalendarId: 'primary',
        calendarList: async () => [personalCalendar('user-a')],
        bflowEventsList: async () => [source],
        readPrivateEvents: async () => [],
        fullSync: async () => [],
        createPrivacyReplacement: async () => ({
          actual_id: `ambiguous-replacement-${followerKind}`,
          storage: 'google',
          calendar_id: 'primary',
          receipt: `ambiguous-receipt-${followerKind}`,
        }),
        settlePrivacyReplacement: async (_receipt, disposition) => {
          assert.equal(disposition, 'delete');
          throw compensationError;
        },
        deleteBflowEvent: async () => {
          sourceDeleteStarted.resolve();
          await sourceDeleteGate.promise;
          throw sourceDeleteError;
        },
        updateBflowEvent: async (...args) => {
          bflowUpdates.push(args);
          return { ...source, title: '잘못 적용된 follower 수정' };
        },
        updateGoogleEvent: async (...args) => {
          googleUpdates.push(args);
        },
        deleteGoogleEvent: async () => {},
      });

      try {
        await harness.service.loadBflowEvents();
        const migration = harness.service.updateEvent(source.id, { isPrivate: false }).then(
          () => null,
          (error: unknown) => error,
        );
        await sourceDeleteStarted.promise;
        const follower = (followerKind === 'update'
          ? harness.service.updateEvent(source.id, { title: 'follower 수정' })
          : harness.service.deleteEvent(source.id)).then(
            () => null,
            (error: unknown) => error,
          );

        sourceDeleteGate.resolve();
        const migrationError = await migration;
        const followerError = await follower;

        assert.ok(migrationError instanceof Error);
        assert.equal(migrationError.name, 'PrivacyMigrationCompensationError');
        assert.deepEqual((migrationError as Error & { errors: unknown[] }).errors, [
          sourceDeleteError,
          compensationError,
        ]);
        assert.equal(followerError, migrationError, 'waiters receive the ambiguous migration outcome');
        assert.deepEqual(bflowUpdates, []);
        assert.deepEqual(googleUpdates, []);
        assert.deepEqual(harness.deletedBflowEventIds, [source.id]);
        assert.deepEqual(harness.deletedGoogleEventIds, []);
      } finally {
        harness.restore();
      }
    });
  }
});

test('stale-session replacement compensation failure retains the session and delete causes', async () => {
  const createStarted = deferred<void>();
  const createGate = deferred<void>();
  const replacementDeleteError = new Error('replacement delete failed in the new session');
  const harness = await createHarness({
    currentUserId: 'user-a',
    personalCalendarId: 'primary',
    calendarList: async () => [personalCalendar('user-a')],
    bflowEventsList: async () => [],
    fullSync: async () => [googleEvent('google-user-a', 'A 공개 일정')],
    createPrivacyReplacement: async () => {
      createStarted.resolve();
      await createGate.promise;
      return {
        actual_id: 'replacement-user-a',
        storage: 'bflow',
        calendar_id: 'calendar-1',
        receipt: 'receipt-user-a',
      };
    },
    settlePrivacyReplacement: async (receipt, disposition) => {
      assert.equal(receipt, 'receipt-user-a');
      assert.equal(disposition, 'delete');
      throw replacementDeleteError;
    },
  });

  try {
    await harness.service.loadBflowEvents();
    await harness.service.syncAll({ skipBflowLoad: true });
    const migration = harness.service.updateEvent('google-user-a', { isPrivate: true }).then(
      () => null,
      (error: unknown) => error,
    );
    await createStarted.promise;

    harness.service.__testUseAuthStore.setState({ currentUser: authUser('user-b') });
    const broadcastsAfterSwitch = harness.broadcasts.length;
    createGate.resolve();
    const thrown = await migration;

    assert.ok(thrown instanceof Error);
    assert.equal(thrown.name, 'PrivacyMigrationCompensationError');
    assert.match(thrown.message, /google-user-a/);
    assert.match(thrown.message, /replacement-user-a/);
    assert.match(
      String((thrown as Error & { errors: readonly unknown[] }).errors[0]),
      /session changed/,
    );
    assert.equal((thrown as Error & { errors: readonly unknown[] }).errors[1], replacementDeleteError);
    assert.deepEqual(harness.deletedGoogleEventIds, [], 'the old Google source remains untouched');
    assert.deepEqual(harness.deletedBflowEventIds, []);
    assert.deepEqual(harness.privacyReplacementSettlements, [
      { receipt: 'receipt-user-a', disposition: 'delete' },
    ]);
    assert.equal(harness.broadcasts.length, broadcastsAfterSwitch);
  } finally {
    harness.restore();
  }
});

test('stale B flow and legacy replacement compensation does not forge renderer markers', async (t) => {
  for (const storage of ['bflow', 'legacy-private'] as const) {
    for (const deleteOutcome of ['success', 'failure'] as const) {
      await t.test(`${storage} ${deleteOutcome}`, async () => {
        const createStarted = deferred<void>();
        const createGate = deferred<void>();
        const compensationError = new Error(`${storage} compensation failed`);
        const replacementId = `${storage}-stale-replacement`;
        const harness = await createHarness({
          currentUserId: 'user-a',
          calendarList: async () => storage === 'bflow'
            ? [personalCalendar('user-a')]
            : [],
          bflowEventsList: async () => [],
          readPrivateEvents: async (userId) => (
            storage === 'legacy-private' && userId === 'user-b'
              ? [legacyPrivateEvent(replacementId, 'user-b')]
              : []
          ),
          fullSync: async () => [googleEvent(`${storage}-source`, 'A 공개 일정')],
          createPrivacyReplacement: async () => {
            createStarted.resolve();
            await createGate.promise;
            return {
              actual_id: replacementId,
              storage,
              ...(storage === 'bflow' ? { calendar_id: 'calendar-1' } : {}),
              receipt: `${storage}-stale-receipt`,
            };
          },
          settlePrivacyReplacement: async (_receipt, disposition) => {
            assert.equal(disposition, 'delete');
            if (deleteOutcome === 'failure') throw compensationError;
          },
        });

        try {
          await harness.service.syncAll();
          const migration = harness.service.updateEvent(`${storage}-source`, {
            isPrivate: true,
          }).then(
            () => null,
            (error: unknown) => error,
          );
          await createStarted.promise;

          harness.service.__testUseAuthStore.setState({ currentUser: authUser('user-b') });
          if (storage === 'legacy-private') await harness.service.loadBflowEvents();
          const broadcastsAfterSwitch = harness.broadcasts.length;
          createGate.resolve();
          const result = await migration;

          if (deleteOutcome === 'success') {
            assert.equal(result, null);
            assert.deepEqual(
              harness.broadcasts.slice(broadcastsAfterSwitch),
              [],
              'the main settlement boundary, not its renderer caller, publishes the committed marker',
            );
          } else {
            assert.ok(result instanceof Error);
            assert.equal(
              (result as Error & { errors: readonly unknown[] }).errors[1],
              compensationError,
            );
            assert.deepEqual(
              harness.broadcasts.slice(broadcastsAfterSwitch),
              [],
              'a failed exact delete cannot announce a committed tombstone',
            );
          }
          if (storage === 'legacy-private') {
            assert.equal(
              (await harness.service.getEvents()).some(({ id }) => id === replacementId),
              true,
              'user A\'s stale receipt settlement cannot tombstone user B\'s same-id legacy row',
            );
          }
        } finally {
          harness.restore();
        }
      });
    }
  }
});

test('stale Google create response compensates without a duplicate renderer marker', async () => {
  const createStarted = deferred<void>();
  const createGate = deferred<void>();
  const harness = await createHarness({
    currentUserId: 'user-a',
    calendarList: async () => [personalCalendar('user-a')],
    bflowEventsList: async () => [bflowEvent('private-source-user-a', 'A 비공개 일정')],
    readPrivateEvents: async () => [],
    fullSync: async () => [],
    createPrivacyReplacement: async () => {
      createStarted.resolve();
      await createGate.promise;
      return {
        actual_id: 'google-replacement-user-a',
        storage: 'google',
        calendar_id: 'primary',
        receipt: 'google-receipt-user-a',
      };
    },
    settlePrivacyReplacement: async () => {},
  });

  try {
    await harness.service.loadBflowEvents();
    const migration = harness.service.updateEvent('private-source-user-a', { isPrivate: false });
    await createStarted.promise;
    harness.service.__testUseAuthStore.setState({ currentUser: authUser('user-b') });
    const broadcastsAfterSwitch = harness.broadcasts.length;
    createGate.resolve();
    await migration;

    assert.deepEqual(harness.privacyReplacementSettlements, [
      { receipt: 'google-receipt-user-a', disposition: 'delete' },
    ]);
    assert.deepEqual(
      harness.broadcasts.slice(broadcastsAfterSwitch),
      [],
      'the main settlement boundary publishes the marker even when this renderer never cached the row',
    );
    assert.equal(
      (await harness.service.getEvents()).some(({ id }) => id === 'google-replacement-user-a'),
      false,
    );
  } finally {
    harness.restore();
  }
});

test('privacy migration compensates the exact replacement when the source delete fails after a session switch', async () => {
  const sourceDeleteStarted = deferred<void>();
  const sourceDeleteGate = deferred<void>();
  const sourceDeleteError = new Error('42501 source delete denied for the new session');
  const harness = await createHarness({
    currentUserId: 'user-a',
    personalCalendarId: 'primary',
    calendarList: async () => [personalCalendar('user-a')],
    bflowEventsList: async () => [],
    fullSync: async () => [googleEvent('google-user-a', 'A 공개 일정')],
    createPrivacyReplacement: async () => ({
      actual_id: 'replacement-user-a',
      storage: 'bflow',
      calendar_id: 'calendar-1',
      receipt: 'receipt-user-a',
    }),
    settlePrivacyReplacement: async () => {},
    deleteGoogleEvent: async () => {
      sourceDeleteStarted.resolve();
      await sourceDeleteGate.promise;
    },
  });

  try {
    await harness.service.loadBflowEvents();
    await harness.service.syncAll({ skipBflowLoad: true });
    const migration = harness.service.updateEvent('google-user-a', { isPrivate: true }).then(
      () => null,
      (error: unknown) => error,
    );
    await sourceDeleteStarted.promise;

    harness.service.__testUseAuthStore.setState({ currentUser: authUser('user-b') });
    const broadcastsAfterSwitch = harness.broadcasts.length;
    sourceDeleteGate.reject(sourceDeleteError);

    assert.equal(await migration, null, 'successful replacement compensation should close the stale request');
    assert.deepEqual(harness.deletedGoogleEventIds, ['google-user-a']);
    assert.deepEqual(harness.privacyReplacementSettlements, [
      { receipt: 'receipt-user-a', disposition: 'delete' },
    ]);
    assert.deepEqual(harness.deletedBflowEventIds, [], 'compensation must not use the new session delete');
    assert.deepEqual(
      harness.broadcasts.slice(broadcastsAfterSwitch),
      [],
      'a stale failure does not forge a renderer marker or source rollback',
    );
  } finally {
    harness.restore();
  }
});

test('source-delete and replacement-compensation failures preserve both causes after a session switch', async () => {
  const sourceDeleteStarted = deferred<void>();
  const sourceDeleteGate = deferred<void>();
  const sourceDeleteError = new Error('42501 source delete denied for the new session');
  const compensationError = new Error('exact replacement receipt delete failed');
  const harness = await createHarness({
    currentUserId: 'user-a',
    personalCalendarId: 'primary',
    calendarList: async () => [personalCalendar('user-a')],
    bflowEventsList: async () => [],
    fullSync: async () => [googleEvent('google-user-a', 'A 공개 일정')],
    createPrivacyReplacement: async () => ({
      actual_id: 'replacement-user-a',
      storage: 'bflow',
      calendar_id: 'calendar-1',
      receipt: 'receipt-user-a',
    }),
    settlePrivacyReplacement: async () => {
      throw compensationError;
    },
    deleteGoogleEvent: async () => {
      sourceDeleteStarted.resolve();
      await sourceDeleteGate.promise;
    },
  });

  try {
    await harness.service.loadBflowEvents();
    await harness.service.syncAll({ skipBflowLoad: true });
    const migration = harness.service.updateEvent('google-user-a', { isPrivate: true }).then(
      () => null,
      (error: unknown) => error,
    );
    await sourceDeleteStarted.promise;

    harness.service.__testUseAuthStore.setState({ currentUser: authUser('user-b') });
    const broadcastsAfterSwitch = harness.broadcasts.length;
    sourceDeleteGate.reject(sourceDeleteError);
    const thrown = await migration;

    assert.ok(thrown instanceof Error);
    assert.equal(thrown.name, 'PrivacyMigrationCompensationError');
    assert.equal((thrown as Error & { errors: readonly unknown[] }).errors[0], sourceDeleteError);
    assert.equal((thrown as Error & { errors: readonly unknown[] }).errors[1], compensationError);
    assert.deepEqual(harness.privacyReplacementSettlements, [
      { receipt: 'receipt-user-a', disposition: 'delete' },
    ]);
    assert.equal(harness.broadcasts.length, broadcastsAfterSwitch);
  } finally {
    harness.restore();
  }
});

test('privacy migration keeps the replacement when source persistence succeeds after a session switch', async () => {
  const sourceDeleteStarted = deferred<void>();
  const sourceDeleteGate = deferred<void>();
  const harness = await createHarness({
    currentUserId: 'user-a',
    personalCalendarId: 'primary',
    calendarList: async () => [personalCalendar('user-a')],
    bflowEventsList: async () => [],
    fullSync: async () => [googleEvent('google-user-a', 'A 공개 일정')],
    createPrivacyReplacement: async () => ({
      actual_id: 'replacement-user-a',
      storage: 'bflow',
      calendar_id: 'calendar-1',
      receipt: 'receipt-user-a',
    }),
    settlePrivacyReplacement: async () => {},
    deleteGoogleEvent: async () => {
      sourceDeleteStarted.resolve();
      await sourceDeleteGate.promise;
    },
  });

  try {
    await harness.service.loadBflowEvents();
    await harness.service.syncAll({ skipBflowLoad: true });
    const migration = harness.service.updateEvent('google-user-a', { isPrivate: true });
    await sourceDeleteStarted.promise;

    harness.service.__testUseAuthStore.setState({ currentUser: authUser('user-b') });
    const broadcastsAfterSwitch = harness.broadcasts.length;
    sourceDeleteGate.resolve();
    await migration;

    assert.deepEqual(harness.privacyReplacementSettlements, [
      { receipt: 'receipt-user-a', disposition: 'keep' },
    ]);
    assert.deepEqual(harness.deletedGoogleEventIds, ['google-user-a']);
    assert.deepEqual(harness.deletedBflowEventIds, []);
    assert.deepEqual(
      harness.broadcasts.slice(broadcastsAfterSwitch),
      [],
      'the renderer never forges the final exact delete; main emits it at the persistence boundary',
    );
  } finally {
    harness.restore();
  }
});

test('successful stale Google source deletion keeps its replacement and tombstones an older source snapshot', async () => {
  const delayedSyncStarted = deferred<void>();
  const delayedSyncGate = deferred<GoogleEventFixture[]>();
  const sourceDeleteStarted = deferred<void>();
  const sourceDeleteGate = deferred<void>();
  let fullSyncCalls = 0;
  const harness = await createHarness({
    currentUserId: 'user-a',
    personalCalendarId: 'primary',
    calendarList: async () => [personalCalendar('user-a')],
    bflowEventsList: async () => [],
    fullSync: async () => {
      fullSyncCalls += 1;
      if (fullSyncCalls === 1) return [googleEvent('google-source-user-a', 'A 공개 일정')];
      delayedSyncStarted.resolve();
      return delayedSyncGate.promise;
    },
    createPrivacyReplacement: async () => ({
      actual_id: 'private-replacement-user-a',
      storage: 'bflow',
      calendar_id: 'calendar-1',
      receipt: 'private-receipt-user-a',
    }),
    settlePrivacyReplacement: async () => {},
    deleteGoogleEvent: async () => {
      sourceDeleteStarted.resolve();
      await sourceDeleteGate.promise;
    },
  });

  try {
    await harness.service.loadBflowEvents();
    await harness.service.syncAll({ skipBflowLoad: true });
    const delayedSync = harness.service.syncAll({ skipBflowLoad: true });
    await delayedSyncStarted.promise;
    const migration = harness.service.updateEvent('google-source-user-a', { isPrivate: true });
    await sourceDeleteStarted.promise;

    harness.service.__testUseAuthStore.setState({ currentUser: authUser('user-b') });
    const broadcastsAfterSwitch = harness.broadcasts.length;
    sourceDeleteGate.resolve();
    await migration;
    assert.deepEqual(harness.privacyReplacementSettlements, [
      { receipt: 'private-receipt-user-a', disposition: 'keep' },
    ]);
    assert.deepEqual(
      harness.broadcasts.slice(broadcastsAfterSwitch),
      [],
      'main owns cross-window invalidation while this renderer tombstones its pending snapshot locally',
    );

    delayedSyncGate.resolve([
      googleEvent('google-source-user-a', '삭제된 A 공개 일정 snapshot'),
      googleEvent('google-unrelated-user-b', '유지할 무관 일정'),
    ]);
    await delayedSync;
    assert.deepEqual(
      (await harness.service.getEvents()).map(({ id, title }) => ({ id, title })),
      [{ id: 'google-unrelated-user-b', title: '유지할 무관 일정' }],
    );
  } finally {
    harness.restore();
  }
});

test('session switch during the pre-delete legacy read compensates before touching either source row', async () => {
  const legacyReadStarted = deferred<void>();
  const legacyReadGate = deferred<LegacyPrivateEventFixture[]>();
  let legacyReadCalls = 0;
  const harness = await createHarness({
    currentUserId: 'user-a',
    calendarList: async () => [personalCalendar('user-a')],
    bflowEventsList: async () => [bflowEvent('private-source-user-a', 'A 비공개 일정')],
    fullSync: async () => [],
    readPrivateEvents: async () => {
      legacyReadCalls += 1;
      if (legacyReadCalls === 1) throw new Error('initial legacy readiness unavailable');
      legacyReadStarted.resolve();
      return legacyReadGate.promise;
    },
    createPrivacyReplacement: async () => ({
      actual_id: 'google-replacement-user-a',
      storage: 'google',
      calendar_id: 'primary',
      receipt: 'google-receipt-user-a',
    }),
    settlePrivacyReplacement: async () => {},
  });
  const originalWarn = console.warn;

  try {
    console.warn = () => {};
    await harness.service.loadBflowEvents();
    const migration = harness.service.updateEvent('private-source-user-a', { isPrivate: false });
    await legacyReadStarted.promise;

    harness.service.__testUseAuthStore.setState({ currentUser: authUser('user-b') });
    const broadcastsAfterSwitch = harness.broadcasts.length;
    legacyReadGate.resolve([]);
    await migration;

    assert.deepEqual(harness.privacyReplacementSettlements, [
      { receipt: 'google-receipt-user-a', disposition: 'delete' },
    ]);
    assert.deepEqual(harness.deletedBflowEventIds, []);
    assert.deepEqual(harness.deletedLegacyEventIds, []);
    assert.deepEqual(
      harness.broadcasts.slice(broadcastsAfterSwitch),
      [],
      'the main settlement boundary owns the exact Google replacement marker',
    );
  } finally {
    console.warn = originalWarn;
    harness.restore();
  }
});

test('session switch during legacy cleanup keeps the replacement after both sources commit deletion', async () => {
  const legacyDeleteStarted = deferred<void>();
  const legacyDeleteGate = deferred<void>();
  const harness = await createHarness({
    currentUserId: 'user-a',
    calendarList: async () => [personalCalendar('user-a')],
    bflowEventsList: async () => [bflowEvent('private-source-user-a', 'A 비공개 일정')],
    fullSync: async () => [],
    readPrivateEvents: async () => [legacyPrivateEvent('private-source-user-a', 'user-a')],
    createPrivacyReplacement: async () => ({
      actual_id: 'google-replacement-user-a',
      storage: 'google',
      calendar_id: 'primary',
      receipt: 'google-receipt-user-a',
    }),
    settlePrivacyReplacement: async () => {},
    deleteLegacyEvent: async () => {
      legacyDeleteStarted.resolve();
      await legacyDeleteGate.promise;
    },
  });

  try {
    await harness.service.loadBflowEvents();
    const migration = harness.service.updateEvent('private-source-user-a', { isPrivate: false });
    await legacyDeleteStarted.promise;

    harness.service.__testUseAuthStore.setState({ currentUser: authUser('user-b') });
    const broadcastsAfterSwitch = harness.broadcasts.length;
    legacyDeleteGate.resolve();
    await migration;

    assert.deepEqual(harness.deletedLegacyEventIds, ['private-source-user-a']);
    assert.deepEqual(harness.deletedBflowEventIds, ['private-source-user-a']);
    assert.deepEqual(harness.privacyReplacementSettlements, [
      { receipt: 'google-receipt-user-a', disposition: 'keep' },
    ]);
    assert.deepEqual(
      harness.broadcasts.slice(broadcastsAfterSwitch),
      [],
    );
  } finally {
    harness.restore();
  }
});

test('stale Google replacement compensation tombstones a delayed snapshot without hiding unrelated events', async () => {
  const fullSyncStarted = deferred<void>();
  const fullSyncGate = deferred<GoogleEventFixture[]>();
  const sourceDeleteStarted = deferred<void>();
  const sourceDeleteGate = deferred<void>();
  const harness = await createHarness({
    currentUserId: 'user-a',
    calendarList: async () => [personalCalendar('user-a')],
    bflowEventsList: async () => [bflowEvent('private-source-user-a', 'A 비공개 일정')],
    readPrivateEvents: async () => [],
    fullSync: async () => {
      fullSyncStarted.resolve();
      return fullSyncGate.promise;
    },
    createPrivacyReplacement: async (request) => {
      assert.equal(request.storage, 'google');
      return {
        actual_id: 'google-replacement-user-a',
        storage: 'google',
        calendar_id: 'primary',
        receipt: 'google-receipt-user-a',
      };
    },
    settlePrivacyReplacement: async () => {},
    deleteBflowEvent: async () => {
      sourceDeleteStarted.resolve();
      await sourceDeleteGate.promise;
    },
  });

  try {
    await harness.service.loadBflowEvents();
    const delayedSync = harness.service.syncAll({ skipBflowLoad: true });
    await fullSyncStarted.promise;
    const migration = harness.service.updateEvent('private-source-user-a', { isPrivate: false });
    await sourceDeleteStarted.promise;

    harness.service.__testUseAuthStore.setState({ currentUser: authUser('user-b') });
    const broadcastsBeforeCompensation = harness.broadcasts.length;
    sourceDeleteGate.reject(new Error('42501 source delete denied for the new session'));
    await migration;

    assert.deepEqual(harness.privacyReplacementSettlements, [
      { receipt: 'google-receipt-user-a', disposition: 'delete' },
    ]);
    assert.deepEqual(
      harness.broadcasts.slice(broadcastsBeforeCompensation),
      [],
      'the renderer tombstones locally while main owns cross-window marker delivery',
    );

    fullSyncGate.resolve([
      googleEvent('google-replacement-user-a', '삭제된 A 임시 공개 일정'),
      googleEvent('google-unrelated-user-b', '유지할 무관 일정'),
    ]);
    await delayedSync;
    assert.deepEqual(
      (await harness.service.getEvents()).map(({ id, title }) => ({ id, title })),
      [{ id: 'google-unrelated-user-b', title: '유지할 무관 일정' }],
      'the exact compensated row stays tombstoned while unrelated snapshot rows survive',
    );
  } finally {
    harness.restore();
  }
});

test('Google compensation finishing after a session switch still tombstones a pending snapshot', async () => {
  const fullSyncStarted = deferred<void>();
  const fullSyncGate = deferred<GoogleEventFixture[]>();
  const compensationStarted = deferred<void>();
  const compensationGate = deferred<void>();
  const harness = await createHarness({
    currentUserId: 'user-a',
    calendarList: async () => [personalCalendar('user-a')],
    bflowEventsList: async () => [bflowEvent('private-source-user-a', 'A 비공개 일정')],
    readPrivateEvents: async () => [],
    fullSync: async () => {
      fullSyncStarted.resolve();
      return fullSyncGate.promise;
    },
    createPrivacyReplacement: async () => ({
      actual_id: 'google-replacement-user-a',
      storage: 'google',
      calendar_id: 'primary',
      receipt: 'google-receipt-user-a',
    }),
    settlePrivacyReplacement: async (_receipt, disposition) => {
      if (disposition !== 'delete') return;
      compensationStarted.resolve();
      await compensationGate.promise;
    },
    deleteBflowEvent: async () => {
      throw new Error('source B flow delete failed');
    },
  });

  try {
    await harness.service.loadBflowEvents();
    const delayedSync = harness.service.syncAll({ skipBflowLoad: true });
    await fullSyncStarted.promise;
    const migration = harness.service.updateEvent('private-source-user-a', { isPrivate: false });
    await compensationStarted.promise;

    harness.service.__testUseAuthStore.setState({ currentUser: authUser('user-b') });
    const broadcastsBeforeCompensation = harness.broadcasts.length;
    compensationGate.resolve();
    await migration;
    assert.deepEqual(
      harness.broadcasts.slice(broadcastsBeforeCompensation),
      [],
      'the renderer tombstones locally while main owns cross-window marker delivery',
    );

    fullSyncGate.resolve([
      googleEvent('google-replacement-user-a', '삭제된 A 임시 공개 일정'),
      googleEvent('google-unrelated-user-b', '유지할 무관 일정'),
    ]);
    await delayedSync;
    assert.deepEqual(
      (await harness.service.getEvents()).map(({ id, title }) => ({ id, title })),
      [{ id: 'google-unrelated-user-b', title: '유지할 무관 일정' }],
    );
  } finally {
    harness.restore();
  }
});

test('Google compensation broadcasts an exact delete when a delayed snapshot already exposed the ghost', async () => {
  const fullSyncStarted = deferred<void>();
  const fullSyncGate = deferred<GoogleEventFixture[]>();
  const compensationStarted = deferred<void>();
  const compensationGate = deferred<void>();
  const harness = await createHarness({
    currentUserId: 'user-a',
    calendarList: async () => [personalCalendar('user-a')],
    bflowEventsList: async () => [bflowEvent('private-source-user-a', 'A 비공개 일정')],
    readPrivateEvents: async () => [],
    fullSync: async () => {
      fullSyncStarted.resolve();
      return fullSyncGate.promise;
    },
    createPrivacyReplacement: async () => ({
      actual_id: 'google-replacement-user-a',
      storage: 'google',
      calendar_id: 'primary',
      receipt: 'google-receipt-user-a',
    }),
    settlePrivacyReplacement: async (_receipt, disposition) => {
      if (disposition !== 'delete') return;
      compensationStarted.resolve();
      await compensationGate.promise;
    },
    deleteBflowEvent: async () => {
      throw new Error('source B flow delete failed');
    },
  });

  try {
    await harness.service.loadBflowEvents();
    const delayedSync = harness.service.syncAll({ skipBflowLoad: true });
    await fullSyncStarted.promise;
    const migration = harness.service.updateEvent('private-source-user-a', { isPrivate: false });
    await compensationStarted.promise;
    harness.service.__testUseAuthStore.setState({ currentUser: authUser('user-b') });

    fullSyncGate.resolve([
      googleEvent('google-replacement-user-a', '노출된 A 임시 공개 일정'),
      googleEvent('google-unrelated-user-b', '유지할 무관 일정'),
    ]);
    await delayedSync;
    assert.equal(
      (await harness.service.getEvents()).some(({ id }) => id === 'google-replacement-user-a'),
      true,
      'the ordering fixture must expose the stale snapshot before compensation completes',
    );
    const broadcastsBeforeCompensation = harness.broadcasts.length;

    compensationGate.resolve();
    await migration;
    assert.deepEqual(
      harness.broadcasts.slice(broadcastsBeforeCompensation),
      [],
      'the renderer removes its ghost without duplicating main-process marker delivery',
    );
    assert.deepEqual(
      (await harness.service.getEvents()).map(({ id, title }) => ({ id, title })),
      [{ id: 'google-unrelated-user-b', title: '유지할 무관 일정' }],
    );
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
