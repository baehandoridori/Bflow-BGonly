import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

type CalendarRow = {
  id: string;
  name: string;
  color: string;
  visibility: 'private';
  owner_id: string;
  is_personal: true;
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

type LegacyPrivateRow = Omit<CalendarEventRow, 'calendar_id' | 'tag_id' | 'all_day' | 'start_time' | 'end_time'> & {
  color: string | null;
  type: string | null;
};

type CalendarTagRow = { id: string; name: string; color: string; sort_order: number };

type ServiceModule = {
  loadBflowEvents(options?: { requireTagsFresh?: boolean }): Promise<boolean>;
  getEvents(): Promise<Array<Record<string, unknown>>>;
  addEvent(event: Record<string, unknown>): Promise<void>;
  deleteEvent(eventId: string): Promise<void>;
  useAuthStore: { getState(): { setCurrentUser(user: unknown): void } };
};

type Calls = {
  bflowDeletes: string[];
  legacyDeletes: string[];
  legacyReadUsers: string[];
  eventReads: number;
};

let bundleSource: Promise<string> | undefined;
let bundleNonce = 0;

function calendarRow(id: string, ownerId: string): CalendarRow {
  return {
    id,
    name: '개인 캘린더',
    color: '#6C5CE7',
    visibility: 'private',
    owner_id: ownerId,
    is_personal: true,
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
    title: '이관 일정',
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

function legacyRow(id: string): LegacyPrivateRow {
  const { calendar_id: _calendarId, tag_id: _tagId, all_day: _allDay, start_time: _startTime, end_time: _endTime, ...row } = eventRow(id, 'unused');
  return { ...row, color: '#6C5CE7', type: 'custom' };
}

async function bundledServiceSource(): Promise<string> {
  bundleSource ??= build({
    stdin: {
      contents: [
        "export * from './src/services/calendarService.ts';",
        "export { useAuthStore } from './src/stores/useAuthStore.ts';",
      ].join('\n'),
      resolveDir: process.cwd(),
      sourcefile: 'calendar-legacy-migration-entry.ts',
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
  calendars: CalendarRow[];
  rows: CalendarEventRow[];
  listCalendars?(): Promise<CalendarRow[]>;
  listTags?(): Promise<CalendarTagRow[]>;
  listEvents?(): Promise<CalendarEventRow[]>;
  readLegacy(userId: string, attempt: number): Promise<LegacyPrivateRow[]>;
}): Promise<{ service: ServiceModule; calls: Calls; restore(): void }> {
  const globalScope = globalThis as Record<string, unknown>;
  const prior = new Map<string, { exists: boolean; value: unknown }>();
  for (const key of ['window', 'localStorage', 'CustomEvent']) {
    prior.set(key, { exists: Object.prototype.hasOwnProperty.call(globalScope, key), value: globalScope[key] });
  }

  const localStorageValues = new Map<string, string>();
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
    bflowDeletes: [], legacyDeletes: [], legacyReadUsers: [], eventReads: 0,
  };
  const electronAPI = {
    calendarList: async () => options.listCalendars?.() ?? options.calendars,
    calendarTagsList: async () => options.listTags?.() ?? [],
    calendarEventsList: async () => {
      calls.eventReads += 1;
      return options.listEvents?.() ?? options.rows;
    },
    calendarEventCreate: async (input: Record<string, unknown>) => ({ ...input, id: 'legacy-only' }),
    calendarEventUpdate: async () => {},
    calendarEventDelete: async (id: string) => { calls.bflowDeletes.push(id); },
    calendarBroadcastChange: async () => ({ ok: true }),
    supabaseReadPrivateEvents: async (userId: string) => {
      calls.legacyReadUsers.push(userId);
      return options.readLegacy(userId, calls.legacyReadUsers.length);
    },
    supabaseAddPrivateEvent: async () => ({ id: 'legacy-private-event' }),
    supabaseUpdatePrivateEvent: async () => {},
    supabaseDeletePrivateEvent: async (id: string) => { calls.legacyDeletes.push(id); },
    gcalIsAuthenticated: async () => false,
    gcalInsertEvent: async () => 'google-event',
    gcalUpdateEvent: async () => {},
    gcalDeleteEvent: async () => {},
  };
  globalScope.window = Object.assign(new EventTarget(), { electronAPI });

  try {
    const source = await bundledServiceSource();
    const encoded = Buffer.from(source).toString('base64');
    const service = await import(`data:text/javascript;base64,${encoded}#calendar-legacy-${bundleNonce++}`) as unknown as ServiceModule;
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

function setUser(service: ServiceModule, id: string): void {
  service.useAuthStore.getState().setCurrentUser({
    id,
    name: id,
    slackId: `U_${id}`,
    isInitialPassword: false,
    createdAt: '2026-08-24T00:00:00.000Z',
    role: 'user',
  });
}

test('a cold legacy-read failure blocks deletion of the current personal B flow event', async () => {
  const harness = await createHarness({
    calendars: [calendarRow('personal-1', 'user-1')],
    rows: [eventRow('migrated-event', 'personal-1')],
    readLegacy: async () => { throw new Error('legacy read outage'); },
  });
  try {
    setUser(harness.service, 'user-1');
    await harness.service.loadBflowEvents();

    await assert.rejects(harness.service.deleteEvent('migrated-event'), /legacy read outage/);
    assert.deepEqual(harness.calls.bflowDeletes, []);
    assert.deepEqual(harness.calls.legacyDeletes, []);
    assert.deepEqual(harness.calls.legacyReadUsers, ['user-1', 'user-1']);
    assert.equal((await harness.service.getEvents()).some((event) => event.id === 'migrated-event'), true);
  } finally {
    harness.restore();
  }
});

test('loadBflowEvents returns false and preserves the last cache when its canonical event read fails', async () => {
  let eventReadFails = false;
  const originalWarn = console.warn;
  const existing = eventRow('existing-event', 'personal-1');
  const harness = await createHarness({
    calendars: [calendarRow('personal-1', 'user-1')],
    rows: [existing],
    listEvents: async () => {
      if (eventReadFails) throw new Error('canonical event outage');
      return [existing];
    },
    readLegacy: async () => [],
  });
  try {
    setUser(harness.service, 'user-1');
    assert.equal(await harness.service.loadBflowEvents(), true);
    assert.deepEqual((await harness.service.getEvents()).map((event) => event.id), ['existing-event']);

    console.warn = () => {};
    eventReadFails = true;
    assert.equal(await harness.service.loadBflowEvents(), false);
    assert.deepEqual(
      (await harness.service.getEvents()).map((event) => event.id),
      ['existing-event'],
      'a failed reload cannot partially replace the last confirmed event cache',
    );
  } finally {
    console.warn = originalWarn;
    harness.restore();
  }
});

test('a warmed calendar metadata failure returns false before stale metadata can remap events', async () => {
  let calendarReadFails = false;
  let rows = [eventRow('existing-event', 'personal-1')];
  const originalWarn = console.warn;
  const harness = await createHarness({
    calendars: [calendarRow('personal-1', 'user-1')],
    rows,
    listCalendars: async () => {
      if (calendarReadFails) throw new Error('calendar metadata outage');
      return [calendarRow('personal-1', 'user-1')];
    },
    listEvents: async () => rows,
    readLegacy: async () => [],
  });
  try {
    setUser(harness.service, 'user-1');
    assert.equal(await harness.service.loadBflowEvents(), true);
    assert.equal(harness.calls.eventReads, 1);

    console.warn = () => {};
    calendarReadFails = true;
    rows = [eventRow('must-not-replace-cache', 'personal-1')];
    assert.equal(await harness.service.loadBflowEvents(), false);
    assert.equal(harness.calls.eventReads, 1, 'stale calendar metadata must stop before the event read');
    assert.deepEqual((await harness.service.getEvents()).map((event) => event.id), ['existing-event']);
  } finally {
    console.warn = originalWarn;
    harness.restore();
  }
});

test('a tag-sensitive B flow reload requires a fresh tag list and preserves its event cache on failure', async () => {
  let tagReadFails = false;
  let rows = [eventRow('existing-event', 'personal-1')];
  const originalWarn = console.warn;
  const harness = await createHarness({
    calendars: [calendarRow('personal-1', 'user-1')],
    rows,
    listTags: async () => {
      if (tagReadFails) throw new Error('tag metadata outage');
      return [{ id: 'tag-1', name: '회의', color: '#FDCB6E', sort_order: 0 }];
    },
    listEvents: async () => rows,
    readLegacy: async () => [],
  });
  try {
    setUser(harness.service, 'user-1');
    assert.equal(await harness.service.loadBflowEvents({ requireTagsFresh: true }), true);
    assert.equal(harness.calls.eventReads, 1);

    console.warn = () => {};
    tagReadFails = true;
    rows = [eventRow('must-not-replace-cache', 'personal-1')];
    assert.equal(await harness.service.loadBflowEvents({ requireTagsFresh: true }), false);
    assert.equal(harness.calls.eventReads, 1, 'tag-sensitive refresh stops before events when tags are stale');
    assert.deepEqual((await harness.service.getEvents()).map((event) => event.id), ['existing-event']);

    assert.equal(
      await harness.service.loadBflowEvents(),
      true,
      'ordinary event refreshes only require fresh calendar metadata',
    );
    assert.equal(harness.calls.eventReads, 2);
    assert.deepEqual((await harness.service.getEvents()).map((event) => event.id), ['must-not-replace-cache']);
  } finally {
    console.warn = originalWarn;
    harness.restore();
  }
});

test('a failed user-B legacy read cannot reuse user-A tracking to delete a B personal event as new-only', async () => {
  const harness = await createHarness({
    calendars: [calendarRow('personal-a', 'user-a'), calendarRow('personal-b', 'user-b')],
    rows: [eventRow('b-migrated-event', 'personal-b')],
    readLegacy: async (userId) => {
      if (userId === 'user-a') return [legacyRow('a-migrated-event')];
      throw new Error('user B legacy read outage');
    },
  });
  try {
    setUser(harness.service, 'user-a');
    await harness.service.loadBflowEvents();
    setUser(harness.service, 'user-b');
    await harness.service.loadBflowEvents();

    await assert.rejects(harness.service.deleteEvent('b-migrated-event'), /user B legacy read outage/);
    assert.deepEqual(harness.calls.bflowDeletes, []);
    assert.deepEqual(harness.calls.legacyDeletes, []);
    assert.deepEqual(harness.calls.legacyReadUsers, ['user-a', 'user-b', 'user-b']);
  } finally {
    harness.restore();
  }
});

test('deleting a legacy-only event removes its tracked ID before a later B flow delete', async () => {
  const harness = await createHarness({
    calendars: [calendarRow('personal-1', 'user-1')],
    rows: [],
    readLegacy: async () => [legacyRow('legacy-only')],
  });
  try {
    setUser(harness.service, 'user-1');
    await harness.service.loadBflowEvents();
    await harness.service.deleteEvent('legacy-only');
    await harness.service.addEvent({
      id: 'new-local-id', title: '새 B flow 일정', memo: '', type: 'custom', startDate: '2026-08-24', endDate: '2026-08-24', calendarId: 'personal-1',
    });
    await harness.service.deleteEvent('legacy-only');

    assert.deepEqual(harness.calls.legacyDeletes, ['legacy-only']);
    assert.deepEqual(harness.calls.bflowDeletes, ['legacy-only']);
  } finally {
    harness.restore();
  }
});
