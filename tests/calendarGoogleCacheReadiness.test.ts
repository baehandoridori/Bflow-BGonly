import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { build } from 'esbuild';

type ServiceModule = {
  loadBflowEvents(): Promise<void>;
  syncAll(options?: { skipBflowLoad?: boolean }): Promise<unknown>;
  getEvents(): Promise<Array<{
    id: string;
    title: string;
    sourceCalendarId?: string;
  }>>;
  saveTeamCalendarId(calendarId: string | null): Promise<void>;
  isGoogleCacheReady(): boolean;
};

type GoogleEventFixture = {
  id: string;
  summary: string;
  start: { date: string };
  end: { date: string };
  created: string;
  extendedProperties: { private: { bflow_type: 'custom' } };
};

type HarnessOptions = {
  fullSync(calendarId: string): Promise<GoogleEventFixture[]>;
  teamCalendarId?: string | null;
  personalCalendarId?: string | null;
  failSettingsWrite?: () => boolean;
};

let bundleSource: Promise<string> | undefined;
let bundleNonce = 0;

async function bundledServiceSource(): Promise<string> {
  bundleSource ??= build({
    stdin: {
      contents: "export * from './src/services/calendarService.ts';",
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

async function createHarness(
  input: HarnessOptions | HarnessOptions['fullSync'],
): Promise<{ service: ServiceModule; restore(): void }> {
  const options: HarnessOptions = typeof input === 'function' ? { fullSync: input } : input;
  const globalScope = globalThis as Record<string, unknown>;
  const prior = new Map<string, { exists: boolean; value: unknown }>();
  for (const key of ['window', 'localStorage', 'CustomEvent']) {
    prior.set(key, { exists: Object.prototype.hasOwnProperty.call(globalScope, key), value: globalScope[key] });
  }

  const values = new Map<string, string>();
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
      calendarList: async () => [],
      calendarTagsList: async () => [],
      calendarEventsList: async () => [],
      calendarBroadcastChange: async () => ({ ok: true }),
      supabaseReadPrivateEvents: async () => [],
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
      gcalEnsureWatch: async () => {},
    },
  });

  try {
    const encoded = Buffer.from(await bundledServiceSource()).toString('base64');
    const service = await import(`data:text/javascript;base64,${encoded}#calendar-google-ready-${bundleNonce++}`) as unknown as ServiceModule;
    return {
      service,
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
