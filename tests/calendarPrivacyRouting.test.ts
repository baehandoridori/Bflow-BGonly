import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

type CalendarRow = {
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

type CalendarEventRow = {
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

type ServiceModule = {
  loadBflowEvents(): Promise<void>;
  syncAll(options?: { broadcast?: boolean; skipBflowLoad?: boolean }): Promise<Array<Record<string, unknown>>>;
  syncIncremental(): Promise<void>;
  getEvents(): Promise<Array<Record<string, unknown>>>;
  addEvent(event: Record<string, unknown>): Promise<void>;
  updateEvent(eventId: string, updates: Record<string, unknown>): Promise<void>;
  useAuthStore: { getState(): { setCurrentUser(user: unknown): void } };
};

type Calls = {
  broadcasts: unknown[];
  bflowCreates: Array<Record<string, unknown>>;
  legacyCreates: Array<Record<string, unknown>>;
  bflowUpdates: Array<{ id: string; patch: Record<string, unknown> }>;
  bflowDeletes: string[];
  legacyUpdates: Array<{ id: string; patch: Record<string, unknown> }>;
  legacyDeletes: string[];
  googleCreates: Array<{ calendarId: string; input: unknown }>;
  googleUpdates: Array<{ calendarId: string; eventId: string; input: unknown }>;
  googleDeletes: Array<{ calendarId: string; eventId: string }>;
  watches: Array<{ calendarId: string; userId: string }>;
};

let bundleSource: Promise<string> | undefined;
let bundleNonce = 0;

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function calendarRow(id: string, isPersonal: boolean): CalendarRow {
  return {
    id,
    name: isPersonal ? '개인 캘린더' : '공유 캘린더',
    color: isPersonal ? '#6C5CE7' : '#74B9FF',
    visibility: isPersonal ? 'private' : 'team',
    owner_id: isPersonal ? 'user-1' : 'owner-1',
    is_personal: isPersonal,
    created_at: '2026-08-24T00:00:00.000Z',
    updated_at: '2026-08-24T00:00:00.000Z',
    members: [],
    can_edit: true,
    can_manage: true,
  };
}

function eventRow(id: string, calendarId: string): CalendarEventRow {
  return {
    id,
    calendar_id: calendarId,
    title: '전환 대상',
    memo: '',
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
    created_by: 'user-1',
    created_at: '2026-08-24T00:00:00.000Z',
    updated_at: '2026-08-24T00:00:00.000Z',
  };
}

function googleEvent(id: string): Record<string, unknown> {
  return {
    id,
    summary: '전환 대상',
    description: '',
    start: { date: '2026-08-24' },
    end: { date: '2026-08-25' },
    extendedProperties: { private: { bflow_type: 'custom' } },
  };
}

async function bundledServiceSource(): Promise<string> {
  bundleSource ??= build({
    stdin: {
      contents: [
        "export * from './src/services/calendarService.ts';",
        "export { useAuthStore } from './src/stores/useAuthStore.ts';",
      ].join('\n'),
      resolveDir: process.cwd(),
      sourcefile: 'calendar-privacy-routing-entry.ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
  }).then((result) => result.outputFiles[0].text);
  return bundleSource;
}

async function createHarness(options: {
  rows: CalendarEventRow[];
  failGoogleCreate?: boolean;
  bflowDeleteError?: Error;
  googleDeleteError?: Error;
  bflowDelete?: (id: string) => Promise<void>;
  googleDelete?: (calendarId: string, eventId: string) => Promise<void>;
  googleFullSync?: (calendarId: string) => Promise<unknown[]>;
  googleIncrementalSync?: (calendarId: string) => Promise<{
    updated: unknown[];
    deleted: string[];
    isFullSync: boolean;
  }>;
  teamGoogleCalendarId?: string;
  personalGoogleCalendarId?: string;
  includePersonalCalendar?: boolean;
  calendarList?: () => Promise<CalendarRow[]>;
}): Promise<{ service: ServiceModule; calls: Calls; restore(): void }> {
  const globalScope = globalThis as Record<string, unknown>;
  const prior = new Map<string, { exists: boolean; value: unknown }>();
  for (const key of ['window', 'localStorage', 'CustomEvent']) {
    prior.set(key, {
      exists: Object.prototype.hasOwnProperty.call(globalScope, key),
      value: globalScope[key],
    });
  }

  const localStorageValues = new Map<string, string>();
  if (options.personalGoogleCalendarId) {
    localStorageValues.set('bflow_gcal_local_settings', JSON.stringify({
      personalCalendarId: options.personalGoogleCalendarId,
      lastSyncAt: null,
    }));
  }
  globalScope.localStorage = {
    getItem: (key: string) => localStorageValues.get(key) ?? null,
    setItem: (key: string, value: string) => { localStorageValues.set(key, value); },
  };
  globalScope.CustomEvent = class extends Event {
    detail: unknown;

    constructor(type: string, init?: { detail?: unknown }) {
      super(type);
      this.detail = init?.detail;
    }
  };

  const calls: Calls = {
    broadcasts: [],
    bflowCreates: [],
    legacyCreates: [],
    bflowUpdates: [],
    bflowDeletes: [],
    legacyUpdates: [],
    legacyDeletes: [],
    googleCreates: [],
    googleUpdates: [],
    googleDeletes: [],
    watches: [],
  };
  const calendars = options.includePersonalCalendar === false
    ? [calendarRow('shared-cal', false)]
    : [calendarRow('personal-cal', true), calendarRow('shared-cal', false)];
  const electronAPI = {
    calendarList: async () => (
      options.calendarList ? options.calendarList() : calendars
    ),
    calendarTagsList: async () => [],
    calendarEventsList: async () => options.rows,
    calendarEventCreate: async (input: Record<string, unknown>) => {
      calls.bflowCreates.push(input);
      return { ...input, id: 'created-private-event' };
    },
    calendarEventUpdate: async (id: string, patch: Record<string, unknown>) => {
      calls.bflowUpdates.push({ id, patch });
    },
    calendarEventDelete: async (id: string) => {
      calls.bflowDeletes.push(id);
      if (options.bflowDelete) {
        await options.bflowDelete(id);
        return;
      }
      if (options.bflowDeleteError) throw options.bflowDeleteError;
    },
    calendarBroadcastChange: async (detail: unknown) => {
      calls.broadcasts.push(detail);
      return { ok: true };
    },
    supabaseReadPrivateEvents: async () => [],
    supabaseAddPrivateEvent: async (input: Record<string, unknown>) => {
      calls.legacyCreates.push(input);
      return { id: 'legacy-private-event' };
    },
    supabaseUpdatePrivateEvent: async (id: string, patch: Record<string, unknown>) => {
      calls.legacyUpdates.push({ id, patch });
    },
    supabaseDeletePrivateEvent: async (id: string) => { calls.legacyDeletes.push(id); },
    supabaseReadMetadata: async (type: string, key: string) => (
      type === 'gcal' && key === 'teamCalendarId' && options.teamGoogleCalendarId
        ? {
          type,
          key,
          value: options.teamGoogleCalendarId,
          updatedAt: '2026-08-24T00:00:00.000Z',
        }
        : null
    ),
    supabaseWriteMetadata: async () => {},
    gcalIsAuthenticated: async () => false,
    gcalSaveLocalSettings: async () => {},
    gcalFullSync: async (calendarId: string) => (
      options.googleFullSync ? options.googleFullSync(calendarId) : []
    ),
    gcalIncrementalSync: async (calendarId: string) => (
      options.googleIncrementalSync
        ? options.googleIncrementalSync(calendarId)
        : { updated: [], deleted: [], isFullSync: false }
    ),
    gcalEnsureWatch: async (calendarId: string, userId: string) => {
      calls.watches.push({ calendarId, userId });
    },
    gcalInsertEvent: async (calendarId: string, input: unknown) => {
      calls.googleCreates.push({ calendarId, input });
      if (options.failGoogleCreate) throw new Error('Google calendar unavailable');
      return 'created-google-event';
    },
    gcalUpdateEvent: async (calendarId: string, eventId: string, input: unknown) => {
      calls.googleUpdates.push({ calendarId, eventId, input });
    },
    gcalDeleteEvent: async (calendarId: string, eventId: string) => {
      calls.googleDeletes.push({ calendarId, eventId });
      if (options.googleDelete) {
        await options.googleDelete(calendarId, eventId);
        return;
      }
      if (options.googleDeleteError) throw options.googleDeleteError;
    },
  };
  globalScope.window = Object.assign(new EventTarget(), { electronAPI });

  try {
    const source = await bundledServiceSource();
    const encoded = Buffer.from(source).toString('base64');
    const service = await import(
      `data:text/javascript;base64,${encoded}#calendar-privacy-${bundleNonce++}`
    ) as unknown as ServiceModule;
    service.useAuthStore.getState().setCurrentUser({
      id: 'user-1',
      name: '테스트 사용자',
      slackId: 'U_TEST',
      isInitialPassword: false,
      createdAt: '2026-08-24T00:00:00.000Z',
      role: 'user',
    });
    return {
      service,
      calls,
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

test('private add retries a clean-profile calendar-list failure before choosing storage', async () => {
  let calendarListCalls = 0;
  const originalWarn = console.warn;
  const harness = await createHarness({
    rows: [],
    calendarList: async () => {
      calendarListCalls += 1;
      if (calendarListCalls === 1) throw new Error('temporary calendar-list outage');
      return [calendarRow('personal-cal', true), calendarRow('shared-cal', false)];
    },
  });
  console.warn = () => {};
  try {
    await harness.service.loadBflowEvents();
    await harness.service.addEvent({
      id: 'retry-private-event',
      title: '재시도 후 저장',
      memo: '',
      color: '#6C5CE7',
      type: 'custom',
      startDate: '2026-08-24',
      endDate: '2026-08-24',
      createdBy: 'user-1',
      createdAt: '2026-08-24T00:00:00.000Z',
      isPrivate: true,
    });

    assert.equal(calendarListCalls, 2);
    assert.equal(harness.calls.bflowCreates.length, 1);
    assert.equal(harness.calls.bflowCreates[0].calendar_id, 'personal-cal');
    assert.deepEqual(harness.calls.legacyCreates, []);
  } finally {
    console.warn = originalWarn;
    harness.restore();
  }
});

test('private add never falls back to legacy storage while calendar-list readiness is unresolved', async () => {
  let calendarListCalls = 0;
  const originalWarn = console.warn;
  const harness = await createHarness({
    rows: [],
    calendarList: async () => {
      calendarListCalls += 1;
      throw new Error('persistent calendar-list outage');
    },
  });
  console.warn = () => {};
  try {
    await harness.service.loadBflowEvents();
    await assert.rejects(
      harness.service.addEvent({
        id: 'blocked-private-event',
        title: '잘못된 폴백 방지',
        memo: '',
        color: '#6C5CE7',
        type: 'custom',
        startDate: '2026-08-24',
        endDate: '2026-08-24',
        createdBy: 'user-1',
        createdAt: '2026-08-24T00:00:00.000Z',
        isPrivate: true,
      }),
      /캘린더 목록/,
    );

    assert.equal(calendarListCalls, 2);
    assert.deepEqual(harness.calls.bflowCreates, []);
    assert.deepEqual(harness.calls.legacyCreates, []);
  } finally {
    console.warn = originalWarn;
    harness.restore();
  }
});

test('personal B flow calendar rows retain isPrivate on load', async () => {
  const harness = await createHarness({ rows: [eventRow('personal-event', 'personal-cal')] });
  try {
    await harness.service.loadBflowEvents();
    const events = await harness.service.getEvents();

    assert.equal(events.find((event) => event.id === 'personal-event')?.isPrivate, true);
  } finally {
    harness.restore();
  }
});

test('making a personal B flow event public creates Google replacement before deleting source', async () => {
  const harness = await createHarness({ rows: [eventRow('personal-event', 'personal-cal')] });
  try {
    await harness.service.loadBflowEvents();
    await harness.service.updateEvent('personal-event', { isPrivate: false });

    assert.equal(harness.calls.googleCreates.length, 1);
    assert.deepEqual(harness.calls.bflowDeletes, ['personal-event']);
    assert.deepEqual(harness.calls.bflowUpdates, []);
    const events = await harness.service.getEvents();
    const migrated = events.find((event) => event.id === 'created-google-event');
    assert.equal(migrated?.source, 'google');
    assert.equal(migrated?.isPrivate, false);
  } finally {
    harness.restore();
  }
});

test('making a shared B flow event private creates personal-calendar replacement before deleting source', async () => {
  const harness = await createHarness({ rows: [eventRow('shared-event', 'shared-cal')] });
  try {
    await harness.service.loadBflowEvents();
    await harness.service.updateEvent('shared-event', { isPrivate: true });

    assert.equal(harness.calls.bflowCreates.length, 1);
    assert.equal(harness.calls.bflowCreates[0].calendar_id, 'personal-cal');
    assert.deepEqual(harness.calls.bflowDeletes, ['shared-event']);
    assert.deepEqual(harness.calls.bflowUpdates, []);
    const events = await harness.service.getEvents();
    assert.equal(events.find((event) => event.id === 'created-private-event')?.isPrivate, true);
  } finally {
    harness.restore();
  }
});

test('ordinary B flow update stays on calendar IPC and never falls through to Google', async () => {
  const harness = await createHarness({ rows: [eventRow('shared-event', 'shared-cal')] });
  try {
    await harness.service.loadBflowEvents();
    await harness.service.updateEvent('shared-event', { title: '수정된 일정' });

    assert.deepEqual(harness.calls.bflowUpdates, [{
      id: 'shared-event',
      patch: { title: '수정된 일정' },
    }]);
    assert.deepEqual(harness.calls.legacyUpdates, []);
    assert.deepEqual(harness.calls.googleUpdates, []);
  } finally {
    harness.restore();
  }
});

test('ordinary legacy-private update stays on Supabase and never falls through to Google', async () => {
  const harness = await createHarness({ rows: [], includePersonalCalendar: false });
  try {
    await harness.service.addEvent({
      id: 'local-private-event',
      title: '비공개 일정',
      memo: '',
      color: '#6C5CE7',
      type: 'custom',
      startDate: '2026-08-24',
      endDate: '2026-08-24',
      createdBy: 'user-1',
      createdAt: '2026-08-24T00:00:00.000Z',
      isPrivate: true,
    });
    await harness.service.updateEvent('legacy-private-event', { title: '수정된 비공개 일정' });

    assert.deepEqual(harness.calls.bflowUpdates, []);
    assert.deepEqual(harness.calls.legacyUpdates, [{
      id: 'legacy-private-event',
      patch: { title: '수정된 비공개 일정' },
    }]);
    assert.deepEqual(harness.calls.googleUpdates, []);
  } finally {
    harness.restore();
  }
});

test('failed public replacement leaves the personal B flow source intact', async () => {
  const harness = await createHarness({
    rows: [eventRow('personal-event', 'personal-cal')],
    failGoogleCreate: true,
  });
  try {
    await harness.service.loadBflowEvents();

    await assert.rejects(
      harness.service.updateEvent('personal-event', { isPrivate: false }),
      /Google calendar unavailable/,
    );
    assert.deepEqual(harness.calls.bflowDeletes, []);
    const events = await harness.service.getEvents();
    assert.equal(events.find((event) => event.id === 'personal-event')?.isPrivate, true);
  } finally {
    harness.restore();
  }
});

test('failed original delete compensates the Google replacement and rejects the privacy migration', async () => {
  const originalDeleteError = new Error('original B flow delete failed');
  const harness = await createHarness({
    rows: [eventRow('personal-event', 'personal-cal')],
    bflowDeleteError: originalDeleteError,
  });
  try {
    await harness.service.loadBflowEvents();

    await assert.rejects(
      harness.service.updateEvent('personal-event', { isPrivate: false }),
      originalDeleteError,
    );
    assert.deepEqual(harness.calls.bflowDeletes, ['personal-event']);
    assert.deepEqual(harness.calls.googleDeletes, [{
      calendarId: 'primary',
      eventId: 'created-google-event',
    }]);
    const events = await harness.service.getEvents();
    assert.deepEqual(events.map((event) => event.id), ['personal-event']);
  } finally {
    harness.restore();
  }
});

test('stale empty Google sync cannot hide a confirmed replacement from privacy migration compensation', async () => {
  const originalDeleteError = new Error('original B flow delete failed');
  const staleSnapshot = createDeferred<unknown[]>();
  const syncStarted = createDeferred<void>();
  const originalDelete = createDeferred<void>();
  const originalDeleteStarted = createDeferred<void>();
  const harness = await createHarness({
    rows: [eventRow('personal-event', 'personal-cal')],
    googleFullSync: async () => {
      syncStarted.resolve(undefined);
      return staleSnapshot.promise;
    },
    bflowDelete: async (id) => {
      if (id === 'personal-event') {
        originalDeleteStarted.resolve(undefined);
        return originalDelete.promise;
      }
    },
  });
  try {
    await harness.service.loadBflowEvents();
    const staleSync = harness.service.syncAll({ skipBflowLoad: true });
    await syncStarted.promise;

    const update = harness.service.updateEvent('personal-event', { isPrivate: false });
    const rejectedUpdate = assert.rejects(update, originalDeleteError);
    await originalDeleteStarted.promise;

    staleSnapshot.resolve([]);
    await staleSync;
    originalDelete.reject(originalDeleteError);
    await rejectedUpdate;

    assert.deepEqual(harness.calls.googleDeletes, [{
      calendarId: 'primary',
      eventId: 'created-google-event',
    }]);
    const events = await harness.service.getEvents();
    assert.deepEqual(events.map((event) => event.id), ['personal-event']);
    assert.equal(events.some((event) => event.id === 'created-google-event'), false);
  } finally {
    harness.restore();
  }
});

test('successful Google compensation filters only the replacement from a pending full sync', async () => {
  const originalDeleteError = new Error('original B flow delete failed');
  const compensationDelete = createDeferred<void>();
  const compensationDeleteStarted = createDeferred<void>();
  const staleSnapshot = createDeferred<unknown[]>();
  const syncStarted = createDeferred<void>();
  const harness = await createHarness({
    rows: [eventRow('personal-event', 'personal-cal')],
    bflowDeleteError: originalDeleteError,
    googleDelete: async () => {
      compensationDeleteStarted.resolve(undefined);
      return compensationDelete.promise;
    },
    googleFullSync: async () => {
      syncStarted.resolve(undefined);
      return staleSnapshot.promise;
    },
  });
  try {
    await harness.service.loadBflowEvents();
    const update = harness.service.updateEvent('personal-event', { isPrivate: false });
    const rejectedUpdate = assert.rejects(update, originalDeleteError);
    await compensationDeleteStarted.promise;

    const staleSync = harness.service.syncAll({ skipBflowLoad: true });
    await syncStarted.promise;

    compensationDelete.resolve(undefined);
    await rejectedUpdate;
    const broadcastsAfterCompensation = harness.calls.broadcasts.length;
    const watchesAfterCompensation = harness.calls.watches.length;

    staleSnapshot.resolve([
      googleEvent('created-google-event'),
      googleEvent('unrelated-google-event'),
    ]);
    await staleSync;

    const events = await harness.service.getEvents();
    assert.deepEqual(events.map((event) => event.id), [
      'personal-event',
      'unrelated-google-event',
    ]);
    assert.equal(events.some((event) => event.id === 'created-google-event'), false);
    assert.equal(harness.calls.broadcasts.length, broadcastsAfterCompensation + 1);
    assert.equal(harness.calls.watches.length, watchesAfterCompensation + 1);
  } finally {
    harness.restore();
  }
});

test('successful Google compensation filters the replacement from incremental and full-fallback updates', async () => {
  const originalDeleteError = new Error('original B flow delete failed');
  let incrementalCalls = 0;
  const harness = await createHarness({
    rows: [eventRow('personal-event', 'personal-cal')],
    bflowDeleteError: originalDeleteError,
    googleIncrementalSync: async () => {
      incrementalCalls += 1;
      return {
        updated: [
          googleEvent('created-google-event'),
          googleEvent(incrementalCalls === 1
            ? 'unrelated-incremental-event'
            : 'unrelated-full-fallback-event'),
        ],
        deleted: [],
        isFullSync: incrementalCalls === 2,
      };
    },
  });
  try {
    await harness.service.loadBflowEvents();
    await assert.rejects(
      harness.service.updateEvent('personal-event', { isPrivate: false }),
      originalDeleteError,
    );
    const broadcastsAfterCompensation = harness.calls.broadcasts.length;

    await harness.service.syncIncremental();
    let events = await harness.service.getEvents();
    assert.deepEqual(events.map((event) => event.id), [
      'personal-event',
      'unrelated-incremental-event',
    ]);
    assert.equal(harness.calls.broadcasts.length, broadcastsAfterCompensation + 1);

    await harness.service.syncIncremental();
    events = await harness.service.getEvents();
    assert.deepEqual(events.map((event) => event.id), [
      'personal-event',
      'unrelated-full-fallback-event',
    ]);
    assert.equal(harness.calls.broadcasts.length, broadcastsAfterCompensation + 2);
    assert.equal(incrementalCalls, 2);
    assert.equal(events.some((event) => event.id === 'created-google-event'), false);
  } finally {
    harness.restore();
  }
});

test('Google compensation tombstone keeps the same event ID from another calendar', async () => {
  const originalDeleteError = new Error('original B flow delete failed');
  const harness = await createHarness({
    rows: [eventRow('personal-event', 'personal-cal')],
    bflowDeleteError: originalDeleteError,
    teamGoogleCalendarId: 'primary',
    personalGoogleCalendarId: 'other-google-calendar',
    googleFullSync: async () => [googleEvent('created-google-event')],
  });
  try {
    await harness.service.loadBflowEvents();
    await assert.rejects(
      harness.service.updateEvent('personal-event', { isPrivate: false }),
      originalDeleteError,
    );
    const broadcastsAfterCompensation = harness.calls.broadcasts.length;
    const watchesAfterCompensation = harness.calls.watches.length;

    await harness.service.syncAll({ skipBflowLoad: true });

    const matchingEvents = (await harness.service.getEvents()).filter(
      (event) => event.id === 'created-google-event',
    );
    assert.equal(matchingEvents.length, 1);
    assert.equal(matchingEvents[0].sourceCalendarId, 'other-google-calendar');
    assert.equal(harness.calls.broadcasts.length, broadcastsAfterCompensation + 1);
    assert.equal(harness.calls.watches.length, watchesAfterCompensation + 2);
  } finally {
    harness.restore();
  }
});

test('failed shared-source delete compensates the confirmed personal B flow replacement', async () => {
  const originalDeleteError = new Error('original shared B flow delete failed');
  const harness = await createHarness({
    rows: [eventRow('shared-event', 'shared-cal')],
    bflowDelete: async (id) => {
      if (id === 'shared-event') throw originalDeleteError;
    },
  });
  try {
    await harness.service.loadBflowEvents();

    await assert.rejects(
      harness.service.updateEvent('shared-event', { isPrivate: true }),
      originalDeleteError,
    );

    assert.deepEqual(harness.calls.bflowDeletes, ['shared-event', 'created-private-event']);
    const events = await harness.service.getEvents();
    assert.deepEqual(events.map((event) => event.id), ['shared-event']);
  } finally {
    harness.restore();
  }
});

test('failed shared-source delete compensates the confirmed legacy-private replacement by real ID', async () => {
  const originalDeleteError = new Error('original shared B flow delete failed');
  const harness = await createHarness({
    rows: [eventRow('shared-event', 'shared-cal')],
    includePersonalCalendar: false,
    bflowDelete: async (id) => {
      if (id === 'shared-event') throw originalDeleteError;
    },
  });
  try {
    await harness.service.loadBflowEvents();

    await assert.rejects(
      harness.service.updateEvent('shared-event', { isPrivate: true }),
      originalDeleteError,
    );

    assert.deepEqual(harness.calls.bflowDeletes, ['shared-event']);
    assert.deepEqual(harness.calls.legacyDeletes, ['legacy-private-event']);
    const events = await harness.service.getEvents();
    assert.deepEqual(events.map((event) => event.id), ['shared-event']);
  } finally {
    harness.restore();
  }
});

test('exported addEvent keeps its Promise<void> result while internal creation tracks the real ID', async () => {
  const harness = await createHarness({ rows: [] });
  try {
    const result = await harness.service.addEvent({
      id: 'local-public-event',
      title: '공개 일정',
      memo: '',
      color: '#6C5CE7',
      type: 'custom',
      startDate: '2026-08-24',
      endDate: '2026-08-24',
      createdBy: 'user-1',
      createdAt: '2026-08-24T00:00:00.000Z',
      isPrivate: false,
    });

    assert.equal(result, undefined);
    assert.equal(harness.calls.googleCreates.length, 1);
  } finally {
    harness.restore();
  }
});

test('compensation failure retains both deletion errors with source and replacement IDs', async () => {
  const originalDeleteError = new Error('original B flow delete failed');
  const replacementDeleteError = new Error('replacement Google delete failed');
  const harness = await createHarness({
    rows: [eventRow('personal-event', 'personal-cal')],
    bflowDeleteError: originalDeleteError,
    googleDeleteError: replacementDeleteError,
    googleFullSync: async () => [googleEvent('created-google-event')],
  });
  try {
    await harness.service.loadBflowEvents();

    let thrown: unknown;
    try {
      await harness.service.updateEvent('personal-event', { isPrivate: false });
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown instanceof Error);
    assert.equal(thrown.name, 'PrivacyMigrationCompensationError');
    assert.match(thrown.message, /personal-event/);
    assert.match(thrown.message, /created-google-event/);
    assert.deepEqual(
      (thrown as Error & { errors: readonly unknown[] }).errors,
      [originalDeleteError, replacementDeleteError],
    );
    await harness.service.syncAll({ skipBflowLoad: true });
    const events = await harness.service.getEvents();
    assert.equal(events.some((event) => event.id === 'created-google-event'), true);
  } finally {
    harness.restore();
  }
});
