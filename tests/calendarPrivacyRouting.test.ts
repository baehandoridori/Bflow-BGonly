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
  getEvents(): Promise<Array<Record<string, unknown>>>;
  updateEvent(eventId: string, updates: Record<string, unknown>): Promise<void>;
  useAuthStore: { getState(): { setCurrentUser(user: unknown): void } };
};

type Calls = {
  bflowCreates: Array<Record<string, unknown>>;
  bflowDeletes: string[];
  googleCreates: Array<{ calendarId: string; input: unknown }>;
  googleDeletes: Array<{ calendarId: string; eventId: string }>;
};

let bundleSource: Promise<string> | undefined;
let bundleNonce = 0;

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
    bflowCreates: [],
    bflowDeletes: [],
    googleCreates: [],
    googleDeletes: [],
  };
  const calendars = [calendarRow('personal-cal', true), calendarRow('shared-cal', false)];
  const electronAPI = {
    calendarList: async () => calendars,
    calendarTagsList: async () => [],
    calendarEventsList: async () => options.rows,
    calendarEventCreate: async (input: Record<string, unknown>) => {
      calls.bflowCreates.push(input);
      return { ...input, id: 'created-private-event' };
    },
    calendarEventUpdate: async () => {},
    calendarEventDelete: async (id: string) => {
      calls.bflowDeletes.push(id);
      if (options.bflowDeleteError) throw options.bflowDeleteError;
    },
    calendarBroadcastChange: async () => ({ ok: true }),
    supabaseReadPrivateEvents: async () => [],
    supabaseAddPrivateEvent: async () => ({ id: 'legacy-private-event' }),
    supabaseUpdatePrivateEvent: async () => {},
    supabaseDeletePrivateEvent: async () => {},
    gcalIsAuthenticated: async () => false,
    gcalInsertEvent: async (calendarId: string, input: unknown) => {
      calls.googleCreates.push({ calendarId, input });
      if (options.failGoogleCreate) throw new Error('Google calendar unavailable');
      return 'created-google-event';
    },
    gcalUpdateEvent: async () => {},
    gcalDeleteEvent: async (calendarId: string, eventId: string) => {
      calls.googleDeletes.push({ calendarId, eventId });
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
    const events = await harness.service.getEvents();
    assert.equal(events.find((event) => event.id === 'created-private-event')?.isPrivate, true);
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

test('compensation failure retains both deletion errors with source and replacement IDs', async () => {
  const originalDeleteError = new Error('original B flow delete failed');
  const replacementDeleteError = new Error('replacement Google delete failed');
  const harness = await createHarness({
    rows: [eventRow('personal-event', 'personal-cal')],
    bflowDeleteError: originalDeleteError,
    googleDeleteError: replacementDeleteError,
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
  } finally {
    harness.restore();
  }
});
