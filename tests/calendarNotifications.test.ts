import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

import {
  computeCalendarNotificationRecipients,
  formatCalendarDateShort,
  buildCalendarChangeDetail,
  buildCalendarNotificationText,
  mapCalendarNotificationRow,
} from '../src/shared/calendarNotifications.ts';
import {
  CALENDAR_NOTIFICATION_CATCHUP_LIMIT,
  normalizeCalendarNotificationCatchupInput,
} from '../src/shared/calendarNotificationCatchup.ts';
import { createDevCalendarNotificationRealtimeListeners } from '../src/mocks/devCalendarNotificationRealtime.ts';

test('수신자: members 캘린더 = 소유자 + 멤버 - 행위자', () => {
  const recipients = computeCalendarNotificationRecipients(
    { owner_id: 'u1', visibility: 'members' },
    ['u2', 'u3'],
    ['u1', 'u2', 'u3', 'u4', 'u5'],
    'u2',
  );
  assert.deepEqual(recipients.sort(), ['u1', 'u3']);
});

test('수신자: team 캘린더 = 전체 사용자 - 행위자', () => {
  const recipients = computeCalendarNotificationRecipients(
    { owner_id: 'u1', visibility: 'team' },
    [],
    ['u1', 'u2', 'u3'],
    'u1',
  );
  assert.deepEqual(recipients.sort(), ['u2', 'u3']);
});

test('수신자: 소유자가 멤버에도 있으면 중복 제거', () => {
  const recipients = computeCalendarNotificationRecipients(
    { owner_id: 'u1', visibility: 'members' },
    ['u1', 'u2'],
    ['u1', 'u2', 'u3'],
    'u3',
  );
  assert.deepEqual(recipients.sort(), ['u1', 'u2']);
});

test('수신자: 개인(private) 캘린더에서 본인 행위 = 빈 배열 (알림 없음)', () => {
  const recipients = computeCalendarNotificationRecipients(
    { owner_id: 'u1', visibility: 'private' },
    [],
    ['u1', 'u2'],
    'u1',
  );
  assert.deepEqual(recipients, []);
});

test('날짜 축약: 2026-09-05 → 9/5, 파싱 불가는 원문 유지', () => {
  assert.equal(formatCalendarDateShort('2026-09-05'), '9/5');
  assert.equal(formatCalendarDateShort('2026-12-25'), '12/25');
  assert.equal(formatCalendarDateShort('nonsense'), 'nonsense');
});

test('detail: 시작일 변경 시에만 M/D → M/D', () => {
  assert.equal(
    buildCalendarChangeDetail(
      { startDate: '2026-09-25', endDate: '2026-09-25' },
      { startDate: '2026-09-26', endDate: '2026-09-26' },
    ),
    '9/25 → 9/26',
  );
});

test('detail: 시작일 동일 + 종료일만 변경 → 종료일 기준', () => {
  assert.equal(
    buildCalendarChangeDetail(
      { startDate: '2026-09-25', endDate: '2026-09-25' },
      { startDate: '2026-09-25', endDate: '2026-09-27' },
    ),
    '9/25 → 9/27',
  );
});

test('detail: 날짜 무변경(제목·메모·태그만) → null', () => {
  assert.equal(
    buildCalendarChangeDetail(
      { startDate: '2026-09-25', endDate: '2026-09-25' },
      { startDate: '2026-09-25', endDate: '2026-09-25' },
    ),
    null,
  );
});

test('문구: create / update(detail 유·무) / delete', () => {
  assert.deepEqual(
    buildCalendarNotificationText({ actorName: '한솔', calendarName: 'EP 마일스톤', eventTitle: 'EP12 업로드', action: 'create', detail: null }),
    { title: '한솔 님이 [EP 마일스톤] 에 일정을 추가했어요', body: "'EP12 업로드'" },
  );
  assert.deepEqual(
    buildCalendarNotificationText({ actorName: '한솔', calendarName: 'EP 마일스톤', eventTitle: 'EP12 업로드', action: 'update', detail: '9/25 → 9/26' }),
    { title: "한솔 님이 'EP12 업로드' 을 변경했어요", body: '9/25 → 9/26' },
  );
  assert.deepEqual(
    buildCalendarNotificationText({ actorName: '한솔', calendarName: 'EP 마일스톤', eventTitle: 'EP12 업로드', action: 'update', detail: null }),
    { title: "한솔 님이 'EP12 업로드' 을 변경했어요", body: '[EP 마일스톤]' },
  );
  assert.deepEqual(
    buildCalendarNotificationText({ actorName: '한솔', calendarName: 'EP 마일스톤', eventTitle: 'EP12 업로드', action: 'delete', detail: null }),
    { title: '한솔 님이 [EP 마일스톤] 의 일정을 삭제했어요', body: "'EP12 업로드'" },
  );
});

test('realtime 알림 행은 renderer에 필요한 표시 필드만 camelCase로 정규화한다', () => {
  assert.deepEqual(
    mapCalendarNotificationRow({
      id: 'notification-1',
      recipient_id: 'user-2',
      actor_id: 'user-1',
      actor_name: '한솔',
      calendar_id: 'calendar-1',
      calendar_name: 'EP 마일스톤',
      event_id: 'event-1',
      event_title: 'EP12 업로드',
      event_date: '2026-09-25',
      action: 'create',
      detail: null,
      created_at: '2026-08-26T00:00:00.000Z',
      read_at: null,
      internal_audit_note: 'renderer에 전달하면 안 됨',
    }),
    {
      id: 'notification-1',
      recipientId: 'user-2',
      actorId: 'user-1',
      actorName: '한솔',
      calendarId: 'calendar-1',
      calendarName: 'EP 마일스톤',
      eventTitle: 'EP12 업로드',
      eventDate: '2026-09-25',
      action: 'create',
      detail: null,
      createdAt: '2026-08-26T00:00:00.000Z',
    },
  );
});

test('catch-up exclusion input keeps every unique UUID calendar id without silently dropping a muted calendar', () => {
  const validIds = Array.from(
    { length: 101 },
    (_, index) => `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  );
  const normalized = normalizeCalendarNotificationCatchupInput({
    excludedCalendarIds: [
      validIds[0].toUpperCase(),
      validIds[0],
      'calendar_id.eq.renderer-controlled-recipient',
      ...validIds.slice(1),
    ],
  });

  assert.equal(CALENDAR_NOTIFICATION_CATCHUP_LIMIT, 200);
  assert.equal(normalized.excludedCalendarIds.length, 101);
  assert.deepEqual(normalized.excludedCalendarIds.slice(0, 2), validIds.slice(0, 2));
  assert.equal(normalized.excludedCalendarIds.at(-1), validIds.at(-1));
  assert.equal(normalized.excludedCalendarIds.includes('calendar_id.eq.renderer-controlled-recipient'), false);
});

const previewMockPath = path.join(process.cwd(), 'src', 'mocks', 'devElectronAPI.ts');

function readPreviewApiSource(): string {
  return readFileSync(previewMockPath, 'utf8');
}

type PreviewCalendarNotificationRow = {
  id: string;
  recipient_id: string;
  actor_id: string | null;
  actor_name: string | null;
  calendar_id: string | null;
  calendar_name: string | null;
  event_id: string | null;
  event_title: string | null;
  event_date: string | null;
  action: 'create' | 'update' | 'delete';
  detail: string | null;
  created_at: string;
  read_at: string | null;
};

type PreviewCalendarNotificationCalendar = {
  id: string;
  name: string;
  visibility: 'private' | 'members' | 'team';
};

type PreviewCalendarNotificationEventInput = {
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
};

type PreviewCalendarNotificationEvent = PreviewCalendarNotificationEventInput & {
  id: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type PreviewCalendarNotificationTag = {
  id: string;
  name: string;
  color: string;
  sort_order: number;
};

type PreviewCalendarPrivacyReplacement = {
  storage: 'bflow' | 'legacy-private' | 'google';
  actual_id: string;
  calendar_id?: string;
  settle(disposition: 'keep' | 'delete'): Promise<void>;
  deleteSource(): Promise<'deleted' | 'missing' | 'ambiguous'>;
};

type PreviewCalendarNotificationApi = {
  loginCanonicalSession(input: { name: string; password: string; rememberMe: boolean }): Promise<{ ok: boolean }>;
  logoutCanonicalSession(): Promise<unknown>;
  calendarList(): Promise<PreviewCalendarNotificationCalendar[]>;
  calendarCreate(input: {
    name: string;
    color: string;
    visibility: 'private' | 'members' | 'team';
    members?: Array<{ user_id: string; can_edit: boolean }>;
  }): Promise<PreviewCalendarNotificationCalendar>;
  calendarUpdate(
    id: string,
    updates: {
      name?: string;
      color?: string;
      visibility?: 'private' | 'members' | 'team';
      members?: Array<{ user_id: string; can_edit: boolean }>;
    },
  ): Promise<void>;
  calendarDelete(id: string): Promise<void>;
  calendarEventCreate(input: PreviewCalendarNotificationEventInput): Promise<PreviewCalendarNotificationEvent>;
  calendarEventUpdate(
    id: string,
    updates: Partial<PreviewCalendarNotificationEventInput>,
  ): Promise<PreviewCalendarNotificationEvent>;
  calendarEventDelete(id: string): Promise<void>;
  calendarEventsList(params?: { from?: string; to?: string }): Promise<PreviewCalendarNotificationEvent[]>;
  calendarTagsList(): Promise<PreviewCalendarNotificationTag[]>;
  calendarTagsSave(tags: Array<{
    id?: string;
    name: string;
    color: string;
    sort_order: number;
  }>): Promise<PreviewCalendarNotificationTag[]>;
  calendarPrivacyReplacementCreate(request: {
    storage: 'bflow' | 'legacy-private' | 'google';
    calendar_id?: string;
    source: {
      storage: 'bflow' | 'legacy-private' | 'google';
      event_id: string;
      calendar_id?: string;
    };
    event: Record<string, unknown>;
  }): Promise<PreviewCalendarPrivacyReplacement | { transition_resolved: 'deleted' }>;
  calendarNotificationsCatchup(input?: { excludedCalendarIds?: string[] }): Promise<PreviewCalendarNotificationRow[]>;
  calendarNotificationsMarkRead(ids: string[]): Promise<void>;
  calendarBroadcastChange(payload?: unknown): Promise<{ ok: boolean }>;
  onCalendarChanged(callback: (payload: unknown) => void): () => void;
  onSupabaseRealtime(callback: (event: unknown) => void): () => void;
};

type PreviewCalendarNotificationWindow = {
  electronAPI?: PreviewCalendarNotificationApi;
  localStorage: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
  };
  __bflowMockCalendarNotify?: (overrides?: {
    recipientId?: string;
    calendarId?: string | null;
    eventTitle?: string | null;
  }) => void;
};

let previewCalendarNotificationBundle: Promise<string> | undefined;
let previewCalendarNotificationNonce = 0;
let previewCalendarSharedStorageValues: Map<string, string> | null = null;

type PreviewCalendarBroadcastChannelCleanup = (() => void) & {
  flush(): void;
};

function installPreviewCalendarBroadcastChannel(options?: {
  deferMessages?: boolean;
  sharedStorage?: boolean;
}): PreviewCalendarBroadcastChannelCleanup {
  const globalScope = globalThis as Record<string, unknown>;
  const hadBroadcastChannel = Object.prototype.hasOwnProperty.call(globalScope, 'BroadcastChannel');
  const previousBroadcastChannel = globalScope.BroadcastChannel;
  const previousSharedStorageValues = previewCalendarSharedStorageValues;
  if (options?.sharedStorage) previewCalendarSharedStorageValues = new Map<string, string>();
  const channelsByName = new Map<string, Set<PreviewCalendarBroadcastChannel>>();
  const pendingMessages: Array<{ channel: PreviewCalendarBroadcastChannel; data: unknown }> = [];

  class PreviewCalendarBroadcastChannel {
    private readonly listeners = new Set<(event: { data: unknown }) => void>();
    private closed = false;
    readonly name: string;

    constructor(name: string) {
      this.name = name;
      const channels = channelsByName.get(name) ?? new Set<PreviewCalendarBroadcastChannel>();
      channels.add(this);
      channelsByName.set(name, channels);
    }

    addEventListener(type: string, listener: (event: { data: unknown }) => void): void {
      if (type === 'message') this.listeners.add(listener);
    }

    removeEventListener(type: string, listener: (event: { data: unknown }) => void): void {
      if (type === 'message') this.listeners.delete(listener);
    }

    postMessage(data: unknown): void {
      for (const channel of channelsByName.get(this.name) ?? []) {
        if (channel === this || channel.closed) continue;
        if (options?.deferMessages) {
          pendingMessages.push({ channel, data });
        } else {
          queueMicrotask(() => channel.emit(data));
        }
      }
    }

    close(): void {
      this.closed = true;
      const channels = channelsByName.get(this.name);
      channels?.delete(this);
      if (channels?.size === 0) channelsByName.delete(this.name);
    }

    unref(): void {
      // Node의 실제 BroadcastChannel과 달리 이 test double은 열린 포트를 유지하지 않는다.
    }

    private emit(data: unknown): void {
      for (const listener of this.listeners) listener({ data });
    }
  }

  globalScope.BroadcastChannel = PreviewCalendarBroadcastChannel;
  const cleanup = (() => {
    if (hadBroadcastChannel) globalScope.BroadcastChannel = previousBroadcastChannel;
    else delete globalScope.BroadcastChannel;
    previewCalendarSharedStorageValues = previousSharedStorageValues;
  }) as PreviewCalendarBroadcastChannelCleanup;
  cleanup.flush = () => {
    const messages = pendingMessages.splice(0, pendingMessages.length);
    for (const { channel, data } of messages) channel.emit(data);
  };
  return cleanup;
}

async function bundledPreviewCalendarNotificationSource(): Promise<string> {
  previewCalendarNotificationBundle ??= build({
    stdin: {
      contents: "export { installDevElectronAPI } from './src/mocks/devElectronAPI.ts';",
      resolveDir: process.cwd(),
      sourcefile: 'calendar-notification-preview-entry.ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
  }).then((result) => result.outputFiles[0].text);
  return previewCalendarNotificationBundle;
}

async function createPreviewCalendarNotificationHarness(): Promise<{
  api: PreviewCalendarNotificationApi;
  previewWindow: PreviewCalendarNotificationWindow;
  restore(): void;
}> {
  const globalScope = globalThis as Record<string, unknown>;
  const prior = new Map<string, { exists: boolean; value: unknown }>();
  for (const key of ['window', 'document']) {
    prior.set(key, {
      exists: Object.prototype.hasOwnProperty.call(globalScope, key),
      value: globalScope[key],
    });
  }

  const localStorageValues = previewCalendarSharedStorageValues ?? new Map<string, string>();
  const previewWindow: PreviewCalendarNotificationWindow = {
    localStorage: {
      getItem: (key) => localStorageValues.get(key) ?? null,
      setItem: (key, value) => { localStorageValues.set(key, value); },
      removeItem: (key) => { localStorageValues.delete(key); },
    },
  };
  globalScope.window = previewWindow;
  globalScope.document = { documentElement: { dataset: {} } };

  try {
    const source = await bundledPreviewCalendarNotificationSource();
    const encoded = Buffer.from(source).toString('base64');
    const preview = await import(
      `data:text/javascript;base64,${encoded}#calendar-notification-preview-${previewCalendarNotificationNonce++}`,
    ) as { installDevElectronAPI(): void };
    preview.installDevElectronAPI();
    assert.ok(previewWindow.electronAPI);
    return {
      api: previewWindow.electronAPI,
      previewWindow,
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

async function previewLogin(api: PreviewCalendarNotificationApi, name: string): Promise<void> {
  const result = await api.loginCanonicalSession({ name, password: '1234', rememberMe: false });
  assert.equal(result.ok, true);
}

function previewNotificationEventInput(
  calendarId: string,
  title: string,
  startDate = '2026-09-25',
): PreviewCalendarNotificationEventInput {
  return {
    calendar_id: calendarId,
    title,
    memo: null,
    tag_id: null,
    all_day: true,
    start_date: startDate,
    end_date: startDate,
    start_time: null,
    end_time: null,
    linked_episode: null,
    linked_part: null,
    linked_sheet_name: null,
    linked_scene_id: null,
    linked_department: null,
    linked_todo_id: null,
  };
}

test('preview calendar catch-up seeds use the signed-in mock user and real current-month calendar rows', () => {
  const source = readPreviewApiSource();

  assert.match(source, /recipient_id:\s*MOCK_USERS\[0\]\.id/);
  assert.match(source, /createDevCalendarSeed\(\)/);
  assert.match(source, /EP06 업로드/);
  assert.match(source, /EP07 가편 작업/);
  assert.match(source, /action:\s*'create'/);
  assert.match(source, /action:\s*'update'/);
  assert.match(source, /detail:\s*`\$\{.*?\}\/12 → \$\{.*?\}\/13`/s);
  assert.match(source, /onSupabaseRealtime:\s*\(callback\) => previewCalendarNotificationRealtime\.subscribe\(callback\)/);
});

test('preview calendar catch-up returns copies, excludes the real muted seed calendar before its deterministic 200-row cap, and ignores malformed exclusions', async () => {
  const harness = await createPreviewCalendarNotificationHarness();
  try {
    await previewLogin(harness.api, '배한솔');
    const initial = await harness.api.calendarNotificationsCatchup();
    assert.ok(initial.length >= 2);
    const mutedSeedCalendarId = initial[0].calendar_id;
    assert.equal(mutedSeedCalendarId, '10000000-0000-4000-8000-000000000002');

    initial[0].event_title = '외부에서 바꾼 값';
    const reread = await harness.api.calendarNotificationsCatchup();
    assert.notEqual(reread[0].event_title, '외부에서 바꾼 값');

    for (let index = 0; index < 201; index += 1) {
      harness.previewWindow.__bflowMockCalendarNotify?.({ recipientId: '1' });
    }
    const capped = await harness.api.calendarNotificationsCatchup({
      excludedCalendarIds: ['calendar_id.eq.renderer-controlled-recipient'],
    });
    assert.equal(capped.length, 200);
    for (let index = 1; index < capped.length; index += 1) {
      const previous = capped[index - 1];
      const current = capped[index];
      assert.ok(
        previous.created_at > current.created_at
          || (previous.created_at === current.created_at && previous.id >= current.id),
        'preview rows use the same created_at DESC, id DESC order as the production catch-up query',
      );
    }

    const unrelatedMutedCalendarIds = Array.from(
      { length: 100 },
      (_, index) => `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    );
    assert.deepEqual(
      await harness.api.calendarNotificationsCatchup({
        excludedCalendarIds: [...unrelatedMutedCalendarIds, mutedSeedCalendarId!],
      }),
      [],
      'the 101st valid muted calendar is still excluded before the cap without marking its rows read',
    );
    assert.deepEqual(
      await harness.api.calendarNotificationsCatchup(),
      capped,
      'muting is a read-time exclusion only, so unmuting reveals the same unread rows again',
    );
  } finally {
    harness.restore();
  }
});

test('preview calendar notification reads persist per current session and injected realtime rows never fan out across users', async () => {
  const harness = await createPreviewCalendarNotificationHarness();
  try {
    await previewLogin(harness.api, '배한솔');
    const ownRows = await harness.api.calendarNotificationsCatchup();
    assert.ok(ownRows.length >= 2);
    const ownReadId = ownRows[0].id;
    const ownUntouchedId = ownRows[1].id;
    await harness.api.calendarNotificationsMarkRead([ownReadId]);
    assert.equal(
      (await harness.api.calendarNotificationsCatchup()).some((row) => row.id === ownReadId),
      false,
      'read_at persists in the preview store instead of returning the same unread row again',
    );

    const received: unknown[] = [];
    const unsubscribe = harness.api.onSupabaseRealtime((event) => received.push(event));
    harness.previewWindow.__bflowMockCalendarNotify?.({ recipientId: '2', eventTitle: '다른 사용자 알림' });
    assert.equal(received.length, 0, 'a database row for another user must not enter this mock renderer realtime channel');

    await harness.api.logoutCanonicalSession();
    await previewLogin(harness.api, '장삐쭈');
    const otherRows = await harness.api.calendarNotificationsCatchup();
    assert.ok(otherRows.length >= 1);
    assert.ok(otherRows.every((row) => row.recipient_id === '2'));
    const otherRowId = otherRows[0].id;
    await harness.api.calendarNotificationsMarkRead([otherRowId, ownUntouchedId]);

    harness.previewWindow.__bflowMockCalendarNotify?.({ recipientId: '2', eventTitle: '현재 사용자 알림' });
    assert.equal(received.length, 1);
    const currentRecipientEvent = received[0] as {
      table?: string;
      payload?: { notification?: { recipientId?: string; eventTitle?: string } };
    };
    assert.equal(currentRecipientEvent.table, 'calendar_notifications');
    assert.equal(currentRecipientEvent.payload?.notification?.recipientId, '2');
    assert.equal(currentRecipientEvent.payload?.notification?.eventTitle, '현재 사용자 알림');
    unsubscribe();
    harness.previewWindow.__bflowMockCalendarNotify?.({ recipientId: '2' });
    assert.equal(received.length, 1, 'the preview realtime unsubscribe still detaches the listener');

    await harness.api.logoutCanonicalSession();
    await previewLogin(harness.api, '배한솔');
    const restoredOwnRows = await harness.api.calendarNotificationsCatchup();
    assert.equal(restoredOwnRows.some((row) => row.id === ownReadId), false);
    assert.equal(
      restoredOwnRows.some((row) => row.id === ownUntouchedId),
      true,
      'another session cannot mark this user’s unread row read by guessing its id',
    );
  } finally {
    harness.restore();
  }
});

test('preview calendar CRUD persists recipient-specific notification rows for another user and keeps canonical realtime delivery', async () => {
  const harness = await createPreviewCalendarNotificationHarness();
  try {
    await previewLogin(harness.api, '배한솔');
    const sharedCalendar = await harness.api.calendarCreate({
      name: '프리뷰 알림 공유 일정',
      color: '#74B9FF',
      visibility: 'members',
      members: [{ user_id: '2', can_edit: true }],
    });
    const received: unknown[] = [];
    const unsubscribe = harness.api.onSupabaseRealtime((event) => received.push(event));
    const created = await harness.api.calendarEventCreate(
      previewNotificationEventInput(sharedCalendar.id, '알림 생성 일정'),
    );
    const updated = await harness.api.calendarEventUpdate(created.id, {
      title: '알림 변경 일정',
      start_date: '2026-09-26',
      end_date: '2026-09-26',
    });
    await harness.api.calendarEventDelete(created.id);

    assert.equal(received.length, 0, '행위자 자신에게는 preview realtime 알림을 보내지 않는다');
    assert.equal(
      (await harness.api.calendarNotificationsCatchup()).some((row) => row.event_id === created.id),
      false,
      '행위자의 catch-up에는 자기 변경 알림을 저장하지 않는다',
    );

    await harness.api.logoutCanonicalSession();
    await previewLogin(harness.api, '장삐쭈');
    const recipientRows = (await harness.api.calendarNotificationsCatchup())
      .filter((row) => row.event_id === created.id);
    assert.equal(recipientRows.length, 3);
    assert.deepEqual(
      recipientRows.map((row) => row.action).sort(),
      ['create', 'delete', 'update'],
    );
    assert.ok(recipientRows.every((row) => (
      row.recipient_id === '2'
      && row.actor_id === '1'
      && row.actor_name === '배한솔'
      && row.calendar_id === sharedCalendar.id
      && row.calendar_name === sharedCalendar.name
    )));
    const createRow = recipientRows.find((row) => row.action === 'create');
    assert.ok(createRow);
    assert.equal(createRow.event_title, '알림 생성 일정');
    assert.equal(createRow.event_date, '2026-09-25');
    assert.equal(createRow.detail, null);
    const updateRow = recipientRows.find((row) => row.action === 'update');
    assert.ok(updateRow);
    assert.equal(updateRow.event_title, updated.title);
    assert.equal(updateRow.event_date, updated.start_date);
    assert.equal(updateRow.detail, '9/25 → 9/26');
    const deleteRow = recipientRows.find((row) => row.action === 'delete');
    assert.ok(deleteRow);
    assert.equal(deleteRow.event_title, updated.title);
    assert.equal(deleteRow.event_date, updated.start_date);
    assert.equal(deleteRow.detail, null);

    await harness.api.logoutCanonicalSession();
    await previewLogin(harness.api, '허혜원');
    assert.equal(
      (await harness.api.calendarNotificationsCatchup()).some((row) => row.event_id === created.id),
      false,
      'members 캘린더의 다른 사용자는 이 변경 알림을 받지 않는다',
    );

    await harness.api.logoutCanonicalSession();
    await previewLogin(harness.api, '장삐쭈');

    harness.previewWindow.__bflowMockCalendarNotify?.({
      recipientId: '2',
      eventTitle: '현재 수신자 realtime',
    });
    assert.equal(received.length, 1);
    const realtime = received[0] as {
      table?: string;
      payload?: { notification?: { recipientId?: string; eventTitle?: string } };
    };
    assert.equal(realtime.table, 'calendar_notifications');
    assert.equal(realtime.payload?.notification?.recipientId, '2');
    assert.equal(realtime.payload?.notification?.eventTitle, '현재 수신자 realtime');
    unsubscribe();
  } finally {
    harness.restore();
  }
});

test('preview shared calendar fanout syncs canonical changes to another mock context without echoing the sender', async () => {
  const restoreBroadcastChannel = installPreviewCalendarBroadcastChannel();
  const actor = await createPreviewCalendarNotificationHarness();
  const receiver = await createPreviewCalendarNotificationHarness();
  const actorChanges: unknown[] = [];
  const receiverChanges: unknown[] = [];
  const unsubscribeActor = actor.api.onCalendarChanged((payload) => actorChanges.push(payload));
  const unsubscribeReceiver = receiver.api.onCalendarChanged((payload) => receiverChanges.push(payload));
  try {
    await previewLogin(actor.api, '배한솔');
    await previewLogin(receiver.api, '장삐쭈');
    const sharedCalendar = await actor.api.calendarCreate({
      name: '프리뷰 창 간 공유 일정',
      color: '#74B9FF',
      visibility: 'members',
      members: [{ user_id: '2', can_edit: true }],
    });
    await Promise.resolve();

    const created = await actor.api.calendarEventCreate(
      previewNotificationEventInput(sharedCalendar.id, '다른 프리뷰 창에서 만든 일정'),
    );
    await Promise.resolve();
    const updated = await actor.api.calendarEventUpdate(created.id, {
      title: '다른 프리뷰 창에서 고친 일정',
    });
    await Promise.resolve();

    assert.deepEqual(actorChanges, [], '보낸 프리뷰 창에는 자기 변경을 IPC로 되돌려 보내지 않는다');
    assert.ok(receiverChanges.length >= 3, '다른 프리뷰 창은 캘린더와 일정의 canonical 변경을 각각 받는다');
    assert.deepEqual(
      (await receiver.api.calendarEventsList()).find((event) => event.id === created.id),
      updated,
      '수신 프리뷰의 module-local row도 전달된 정본 snapshot으로 갱신한다',
    );

    const receiverChangeCount = receiverChanges.length;
    await actor.api.calendarBroadcastChange({ eventId: created.id, action: 'update' });
    await Promise.resolve();

    assert.deepEqual(actorChanges, [], '렌더러의 즉시 화면 갱신은 calendarService의 window event가 담당한다');
    assert.equal(
      receiverChanges.length,
      receiverChangeCount,
      '렌더러의 presentation broadcast는 다른 프리뷰 창의 canonical 상태를 바꾸지 않는다',
    );
  } finally {
    unsubscribeReceiver();
    unsubscribeActor();
    receiver.restore();
    actor.restore();
    restoreBroadcastChannel();
  }
});

test('preview failed optimistic delete rollback never tombstones a peer canonical event', async () => {
  const restoreBroadcastChannel = installPreviewCalendarBroadcastChannel({ deferMessages: true });
  const actor = await createPreviewCalendarNotificationHarness();
  const receiver = await createPreviewCalendarNotificationHarness();
  const unsubscribeActor = actor.api.onCalendarChanged(() => {});
  const unsubscribeReceiver = receiver.api.onCalendarChanged(() => {});
  try {
    await previewLogin(actor.api, '배한솔');
    await previewLogin(receiver.api, '장삐쭈');
    const sharedCalendar = await actor.api.calendarCreate({
      name: '롤백 격리 프리뷰 공유 일정',
      color: '#74B9FF',
      visibility: 'members',
      members: [{ user_id: '2', can_edit: true }],
    });
    restoreBroadcastChannel.flush();
    const created = await actor.api.calendarEventCreate(
      previewNotificationEventInput(sharedCalendar.id, '삭제 실패 후 되돌릴 일정'),
    );
    restoreBroadcastChannel.flush();

    // calendarService는 삭제를 먼저 화면에 반영하고 bridge를 호출한 뒤, 저장 실패 시 add로 되돌린다.
    // 이 두 renderer-origin 메시지는 이미 저장된 peer 정본을 바꾸면 안 된다.
    await actor.api.calendarBroadcastChange({
      table: 'calendar_events',
      action: 'DELETE',
      eventId: created.id,
    });
    await actor.api.calendarBroadcastChange({
      table: 'calendar_events',
      action: 'INSERT',
      eventId: created.id,
    });
    restoreBroadcastChannel.flush();

    assert.deepEqual(
      (await receiver.api.calendarEventsList()).find((event) => event.id === created.id),
      created,
      '실패한 낙관 삭제와 rollback은 다른 프리뷰 창의 이미 저장된 일정을 tombstone 처리하지 않는다',
    );
  } finally {
    unsubscribeReceiver();
    unsubscribeActor();
    receiver.restore();
    actor.restore();
    restoreBroadcastChannel();
  }
});

test('preview calendar fanout emits each newly received notification only to its canonical recipient', async () => {
  const restoreBroadcastChannel = installPreviewCalendarBroadcastChannel({ deferMessages: true });
  const actor = await createPreviewCalendarNotificationHarness();
  const recipient = await createPreviewCalendarNotificationHarness();
  const bystander = await createPreviewCalendarNotificationHarness();
  const recipientRealtime: unknown[] = [];
  const bystanderRealtime: unknown[] = [];
  const unsubscribeRecipientCalendar = recipient.api.onCalendarChanged(() => {});
  const unsubscribeBystanderCalendar = bystander.api.onCalendarChanged(() => {});
  const unsubscribeRecipient = recipient.api.onSupabaseRealtime((event) => recipientRealtime.push(event));
  const unsubscribeBystander = bystander.api.onSupabaseRealtime((event) => bystanderRealtime.push(event));
  try {
    await previewLogin(actor.api, '배한솔');
    await previewLogin(recipient.api, '장삐쭈');
    await previewLogin(bystander.api, '허혜원');
    const sharedCalendar = await actor.api.calendarCreate({
      name: '프리뷰 실시간 수신 공유 일정',
      color: '#74B9FF',
      visibility: 'members',
      members: [{ user_id: '2', can_edit: true }],
    });
    restoreBroadcastChannel.flush();

    const created = await actor.api.calendarEventCreate(
      previewNotificationEventInput(sharedCalendar.id, '다른 창에 바로 알려 줄 일정'),
    );
    restoreBroadcastChannel.flush();

    assert.equal(recipientRealtime.length, 1, '수신자 창은 새 notification row를 realtime 경로로 즉시 받는다');
    assert.equal(bystanderRealtime.length, 0, '수신 대상이 아닌 창에는 다른 사용자의 notification row를 보내지 않는다');
    const realtime = recipientRealtime[0] as {
      table?: string;
      payload?: { notification?: { recipientId?: string; eventTitle?: string } };
    };
    assert.equal(realtime.table, 'calendar_notifications');
    assert.equal(realtime.payload?.notification?.recipientId, '2');
    assert.equal(realtime.payload?.notification?.eventTitle, created.title);
    assert.equal(
      (await recipient.api.calendarNotificationsCatchup()).some((row) => row.event_id === created.id),
      true,
      'realtime을 보낸 row는 수신자 수신함 snapshot에도 함께 남는다',
    );

    await actor.api.calendarBroadcastChange({ table: 'calendar_events', action: 'UPDATE', eventId: created.id });
    restoreBroadcastChannel.flush();
    assert.equal(recipientRealtime.length, 1, '이미 병합한 notification row는 후속 snapshot에서 중복 realtime을 만들지 않는다');

    await actor.api.calendarEventUpdate(created.id, { title: '수정된 원격 알림 일정' });
    restoreBroadcastChannel.flush();
    await actor.api.calendarEventDelete(created.id);
    restoreBroadcastChannel.flush();
    assert.deepEqual(
      recipientRealtime.map((event) => (
        event as { payload?: { notification?: { action?: string } } }
      ).payload?.notification?.action),
      ['create', 'update', 'delete'],
      '일정 create·update·delete가 만든 새 알림은 모두 수신자 realtime으로 즉시 전달한다',
    );
  } finally {
    unsubscribeBystander();
    unsubscribeRecipient();
    unsubscribeBystanderCalendar();
    unsubscribeRecipientCalendar();
    bystander.restore();
    recipient.restore();
    actor.restore();
    restoreBroadcastChannel();
  }
});

test('preview mark-read fanout does not emit a first-seen read notification as a realtime insert', async () => {
  const restoreBroadcastChannel = installPreviewCalendarBroadcastChannel({ deferMessages: true });
  const owner = await createPreviewCalendarNotificationHarness();
  const editor = await createPreviewCalendarNotificationHarness();
  const reader = await createPreviewCalendarNotificationHarness();
  const unsubscribeOwnerCalendar = owner.api.onCalendarChanged(() => {});
  const unsubscribeEditorCalendar = editor.api.onCalendarChanged(() => {});
  const unsubscribeReaderCalendar = reader.api.onCalendarChanged(() => {});
  let lateRecipient: Awaited<ReturnType<typeof createPreviewCalendarNotificationHarness>> | null = null;
  let unsubscribeLateRecipientCalendar = () => {};
  let unsubscribeLateRecipientRealtime = () => {};
  try {
    await previewLogin(owner.api, '배한솔');
    await previewLogin(editor.api, '장삐쭈');
    await previewLogin(reader.api, '배한솔');
    const sharedCalendar = await owner.api.calendarCreate({
      name: '읽음 동기화 프리뷰 공유 일정',
      color: '#74B9FF',
      visibility: 'members',
      members: [{ user_id: '2', can_edit: true }],
    });
    restoreBroadcastChannel.flush();

    const created = await editor.api.calendarEventCreate(
      previewNotificationEventInput(sharedCalendar.id, '늦게 열린 수신 창의 읽음 알림'),
    );
    restoreBroadcastChannel.flush();
    const unread = (await reader.api.calendarNotificationsCatchup())
      .find((row) => row.event_id === created.id);
    assert.ok(unread, '읽음 처리할 새 notification row가 먼저 수신자 창에 도착한다');

    lateRecipient = await createPreviewCalendarNotificationHarness();
    const lateRecipientRealtime: unknown[] = [];
    unsubscribeLateRecipientCalendar = lateRecipient.api.onCalendarChanged(() => {});
    unsubscribeLateRecipientRealtime = lateRecipient.api.onSupabaseRealtime((event) => lateRecipientRealtime.push(event));
    await previewLogin(lateRecipient.api, '배한솔');

    await reader.api.calendarNotificationsMarkRead([unread.id]);
    restoreBroadcastChannel.flush();

    assert.equal(
      lateRecipientRealtime.length,
      0,
      'calendar_notifications UPDATE snapshot에서 처음 본 read row도 INSERT realtime/toast로 보내지 않는다',
    );
    assert.equal(
      (await lateRecipient.api.calendarNotificationsCatchup()).some((row) => row.id === unread.id),
      false,
      '읽음 상태 자체는 늦게 열린 같은 사용자 창에도 반영한다',
    );
  } finally {
    unsubscribeLateRecipientRealtime();
    unsubscribeLateRecipientCalendar();
    lateRecipient?.restore();
    unsubscribeReaderCalendar();
    unsubscribeEditorCalendar();
    unsubscribeOwnerCalendar();
    reader.restore();
    editor.restore();
    owner.restore();
    restoreBroadcastChannel();
  }
});

test('preview calendar fanout merges separate event changes that were both made before delivery', async () => {
  const restoreBroadcastChannel = installPreviewCalendarBroadcastChannel({ deferMessages: true });
  const actor = await createPreviewCalendarNotificationHarness();
  const receiver = await createPreviewCalendarNotificationHarness();
  const unsubscribeActor = actor.api.onCalendarChanged(() => {});
  const unsubscribeReceiver = receiver.api.onCalendarChanged(() => {});
  try {
    await previewLogin(actor.api, '배한솔');
    await previewLogin(receiver.api, '장삐쭈');
    const sharedCalendar = await actor.api.calendarCreate({
      name: '동시 변경 프리뷰 공유 일정',
      color: '#74B9FF',
      visibility: 'members',
      members: [{ user_id: '2', can_edit: true }],
    });
    restoreBroadcastChannel.flush();

    const actorEvent = await actor.api.calendarEventCreate(
      previewNotificationEventInput(sharedCalendar.id, '첫 번째 창에서 만든 일정'),
    );
    const receiverEvent = await receiver.api.calendarEventCreate(
      previewNotificationEventInput(sharedCalendar.id, '두 번째 창에서 만든 일정'),
    );

    restoreBroadcastChannel.flush();

    for (const api of [actor.api, receiver.api]) {
      const eventIds = new Set((await api.calendarEventsList()).map((event) => event.id));
      assert.ok(eventIds.has(actorEvent.id), '한 창의 전송 대기 중 변경이 다른 창의 일정에 덮어써지지 않는다');
      assert.ok(eventIds.has(receiverEvent.id), '다른 창의 전송 대기 중 변경도 함께 남는다');
    }
  } finally {
    unsubscribeReceiver();
    unsubscribeActor();
    receiver.restore();
    actor.restore();
    restoreBroadcastChannel();
  }
});

test('preview calendar fanout keeps both notification rows when isolated previews create them in the same millisecond', async () => {
  const restoreBroadcastChannel = installPreviewCalendarBroadcastChannel({ deferMessages: true });
  const actor = await createPreviewCalendarNotificationHarness();
  const receiver = await createPreviewCalendarNotificationHarness();
  const unsubscribeActor = actor.api.onCalendarChanged(() => {});
  const unsubscribeReceiver = receiver.api.onCalendarChanged(() => {});
  const previousNow = Date.now;
  try {
    await previewLogin(actor.api, '배한솔');
    await previewLogin(receiver.api, '장삐쭈');
    const sharedCalendar = await actor.api.calendarCreate({
      name: '동시 알림 프리뷰 공유 일정',
      color: '#74B9FF',
      visibility: 'members',
      members: [{ user_id: '2', can_edit: true }],
    });
    restoreBroadcastChannel.flush();

    Date.now = () => 1_800_000_000_000;
    const actorEvent = await actor.api.calendarEventCreate(
      previewNotificationEventInput(sharedCalendar.id, '첫 번째 창의 알림 일정'),
    );
    const receiverEvent = await receiver.api.calendarEventCreate(
      previewNotificationEventInput(sharedCalendar.id, '두 번째 창의 알림 일정'),
    );
    Date.now = previousNow;
    restoreBroadcastChannel.flush();

    await actor.api.logoutCanonicalSession();
    await previewLogin(actor.api, '장삐쭈');
    assert.ok(
      (await actor.api.calendarNotificationsCatchup()).some((row) => row.event_id === actorEvent.id),
      '같은 시각에 만든 알림도 다른 창의 수신함에서 서로 덮어써지지 않는다',
    );

    await receiver.api.logoutCanonicalSession();
    await previewLogin(receiver.api, '배한솔');
    assert.ok(
      (await receiver.api.calendarNotificationsCatchup()).some((row) => row.event_id === receiverEvent.id),
      '다른 창의 알림도 독립된 행으로 유지한다',
    );
  } finally {
    Date.now = previousNow;
    unsubscribeReceiver();
    unsubscribeActor();
    receiver.restore();
    actor.restore();
    restoreBroadcastChannel();
  }
});

test('preview calendar fanout applies members changed through a calendar update', async () => {
  const restoreBroadcastChannel = installPreviewCalendarBroadcastChannel({ deferMessages: true });
  const actor = await createPreviewCalendarNotificationHarness();
  const receiver = await createPreviewCalendarNotificationHarness();
  const unsubscribeActor = actor.api.onCalendarChanged(() => {});
  const unsubscribeReceiver = receiver.api.onCalendarChanged(() => {});
  try {
    await previewLogin(actor.api, '배한솔');
    await previewLogin(receiver.api, '장삐쭈');
    const sharedCalendar = await actor.api.calendarCreate({
      name: '멤버 변경 프리뷰 공유 일정',
      color: '#74B9FF',
      visibility: 'members',
      members: [{ user_id: '2', can_edit: true }],
    });
    restoreBroadcastChannel.flush();

    await actor.api.calendarUpdate(sharedCalendar.id, {
      members: [{ user_id: '2', can_edit: false }],
    });
    restoreBroadcastChannel.flush();

    await assert.rejects(
      receiver.api.calendarEventCreate(
        previewNotificationEventInput(sharedCalendar.id, '수정 권한이 제거된 일정'),
      ),
      /권한/,
      '캘린더 수정과 함께 바뀐 멤버 권한도 다른 프리뷰 창에 적용한다',
    );
  } finally {
    unsubscribeReceiver();
    unsubscribeActor();
    receiver.restore();
    actor.restore();
    restoreBroadcastChannel();
  }
});

test('preview calendar fanout never revives a locally deleted event from an older remote update', async () => {
  const restoreBroadcastChannel = installPreviewCalendarBroadcastChannel({ deferMessages: true });
  const actor = await createPreviewCalendarNotificationHarness();
  const receiver = await createPreviewCalendarNotificationHarness();
  const unsubscribeActor = actor.api.onCalendarChanged(() => {});
  const unsubscribeReceiver = receiver.api.onCalendarChanged(() => {});
  try {
    await previewLogin(actor.api, '배한솔');
    await previewLogin(receiver.api, '장삐쭈');
    const sharedCalendar = await actor.api.calendarCreate({
      name: '삭제 우선 프리뷰 공유 일정',
      color: '#74B9FF',
      visibility: 'members',
      members: [{ user_id: '2', can_edit: true }],
    });
    restoreBroadcastChannel.flush();
    const created = await actor.api.calendarEventCreate(
      previewNotificationEventInput(sharedCalendar.id, '삭제와 수정이 교차한 일정'),
    );
    restoreBroadcastChannel.flush();

    await actor.api.calendarEventUpdate(created.id, { title: '늦게 도착한 수정' });
    await receiver.api.calendarEventDelete(created.id);
    restoreBroadcastChannel.flush();

    for (const api of [actor.api, receiver.api]) {
      assert.equal(
        (await api.calendarEventsList()).some((event) => event.id === created.id),
        false,
        '삭제가 확정된 일정은 전송 대기 중이던 수정 snapshot으로 되살아나지 않는다',
      );
    }
  } finally {
    unsubscribeReceiver();
    unsubscribeActor();
    receiver.restore();
    actor.restore();
    restoreBroadcastChannel();
  }
});

test('preview calendar fanout deterministically converges concurrent updates of one event', async () => {
  const restoreBroadcastChannel = installPreviewCalendarBroadcastChannel({ deferMessages: true });
  const actor = await createPreviewCalendarNotificationHarness();
  const receiver = await createPreviewCalendarNotificationHarness();
  const unsubscribeActor = actor.api.onCalendarChanged(() => {});
  const unsubscribeReceiver = receiver.api.onCalendarChanged(() => {});
  const previousNow = Date.now;
  try {
    await previewLogin(actor.api, '배한솔');
    await previewLogin(receiver.api, '장삐쭈');
    const sharedCalendar = await actor.api.calendarCreate({
      name: '동시 수정 프리뷰 공유 일정',
      color: '#74B9FF',
      visibility: 'members',
      members: [{ user_id: '2', can_edit: true }],
    });
    restoreBroadcastChannel.flush();
    const created = await actor.api.calendarEventCreate(
      previewNotificationEventInput(sharedCalendar.id, '동시 수정 전 일정'),
    );
    restoreBroadcastChannel.flush();

    Date.now = () => 9_000_000_000_000;
    await actor.api.calendarEventUpdate(created.id, { title: '첫 번째 창 수정' });
    await receiver.api.calendarEventUpdate(created.id, { title: '두 번째 창 수정' });
    Date.now = previousNow;
    restoreBroadcastChannel.flush();

    const actorTitle = (await actor.api.calendarEventsList()).find((event) => event.id === created.id)?.title;
    const receiverTitle = (await receiver.api.calendarEventsList()).find((event) => event.id === created.id)?.title;
    assert.equal(actorTitle, receiverTitle, '같은 일정의 동시 수정은 메시지 도착 순서와 무관하게 한 값으로 수렴한다');
    assert.ok(
      actorTitle === '첫 번째 창 수정' || actorTitle === '두 번째 창 수정',
      '수렴 결과는 두 창 중 하나가 실제로 저장한 값이다',
    );
  } finally {
    Date.now = previousNow;
    unsubscribeReceiver();
    unsubscribeActor();
    receiver.restore();
    actor.restore();
    restoreBroadcastChannel();
  }
});

test('preview calendar fanout never revives a locally deleted calendar from an older remote update', async () => {
  const restoreBroadcastChannel = installPreviewCalendarBroadcastChannel({ deferMessages: true });
  const actor = await createPreviewCalendarNotificationHarness();
  const receiver = await createPreviewCalendarNotificationHarness();
  const unsubscribeActor = actor.api.onCalendarChanged(() => {});
  const unsubscribeReceiver = receiver.api.onCalendarChanged(() => {});
  try {
    await previewLogin(actor.api, '배한솔');
    await previewLogin(receiver.api, '배한솔');
    const sharedCalendar = await actor.api.calendarCreate({
      name: '삭제와 수정이 교차한 캘린더',
      color: '#74B9FF',
      visibility: 'members',
    });
    restoreBroadcastChannel.flush();

    await actor.api.calendarUpdate(sharedCalendar.id, { name: '늦게 도착한 캘린더 수정' });
    await receiver.api.calendarDelete(sharedCalendar.id);
    restoreBroadcastChannel.flush();

    for (const api of [actor.api, receiver.api]) {
      assert.equal(
        (await api.calendarList()).some((calendar) => calendar.id === sharedCalendar.id),
        false,
        '삭제된 캘린더는 전송 대기 중이던 수정 snapshot으로 되살아나지 않는다',
      );
    }
  } finally {
    unsubscribeReceiver();
    unsubscribeActor();
    receiver.restore();
    actor.restore();
    restoreBroadcastChannel();
  }
});

test('preview calendar tag saves keep a later valid complete list as one atomic replacement', async () => {
  const restoreBroadcastChannel = installPreviewCalendarBroadcastChannel({
    deferMessages: true,
    sharedStorage: true,
  });
  const actor = await createPreviewCalendarNotificationHarness();
  const receiver = await createPreviewCalendarNotificationHarness();
  const unsubscribeActor = actor.api.onCalendarChanged(() => {});
  const unsubscribeReceiver = receiver.api.onCalendarChanged(() => {});
  try {
    await previewLogin(actor.api, '배한솔');
    await previewLogin(receiver.api, '배한솔');
    const actorTags = await actor.api.calendarTagsList();
    const receiverTags = await receiver.api.calendarTagsList();
    const firstTag = actorTags[0];
    const secondTag = actorTags[1];
    assert.ok(firstTag && secondTag);

    const actorFinalList = actorTags.map((tag) => (
      tag.id === firstTag.id ? { ...tag, name: '먼저 저장한 전체 목록' } : tag
    ));
    const receiverFinalList = receiverTags.map((tag) => (
      tag.id === secondTag.id ? { ...tag, name: '나중에 저장한 전체 목록' } : tag
    ));
    await actor.api.calendarTagsSave(actorFinalList);
    await receiver.api.calendarTagsSave(receiverFinalList);
    restoreBroadcastChannel.flush();

    const actorResult = await actor.api.calendarTagsList();
    const receiverResult = await receiver.api.calendarTagsList();
    assert.deepEqual(actorResult, receiverFinalList, '나중에 직렬화된 유효 목록이 전체 태그 목록을 교체한다');
    assert.deepEqual(receiverResult, receiverFinalList, '두 프리뷰 창은 같은 complete list만 본다');
  } finally {
    unsubscribeReceiver();
    unsubscribeActor();
    receiver.restore();
    actor.restore();
    restoreBroadcastChannel();
  }
});

test('preview calendar tag save rejects a stale complete list that resurrects a deleted tag', async () => {
  const restoreBroadcastChannel = installPreviewCalendarBroadcastChannel({
    deferMessages: true,
    sharedStorage: true,
  });
  const actor = await createPreviewCalendarNotificationHarness();
  const receiver = await createPreviewCalendarNotificationHarness();
  const unsubscribeActor = actor.api.onCalendarChanged(() => {});
  const unsubscribeReceiver = receiver.api.onCalendarChanged(() => {});
  try {
    await previewLogin(actor.api, '배한솔');
    await previewLogin(receiver.api, '배한솔');
    const actorTags = await actor.api.calendarTagsList();
    const staleReceiverList = await receiver.api.calendarTagsList();
    const deletedTag = actorTags[1];
    assert.ok(deletedTag, '삭제될 기존 태그가 있어야 stale save를 재현할 수 있다');
    const committedList = actorTags.filter((tag) => tag.id !== deletedTag.id);

    await actor.api.calendarTagsSave(committedList);
    await assert.rejects(
      receiver.api.calendarTagsSave(staleReceiverList),
      /Unknown calendar tag id/,
      '먼저 삭제된 태그를 다시 포함한 늦은 전체 목록은 운영 RPC처럼 거절한다',
    );
    restoreBroadcastChannel.flush();

    assert.deepEqual(await actor.api.calendarTagsList(), committedList);
    assert.deepEqual(
      await receiver.api.calendarTagsList(),
      committedList,
      '거절된 창도 rollback된 authoritative complete list를 유지한다',
    );
  } finally {
    unsubscribeReceiver();
    unsubscribeActor();
    receiver.restore();
    actor.restore();
    restoreBroadcastChannel();
  }
});

test('preview calendar notification read fans out immediately to another preview of the same user', async () => {
  const restoreBroadcastChannel = installPreviewCalendarBroadcastChannel({ deferMessages: true });
  const actor = await createPreviewCalendarNotificationHarness();
  const receiver = await createPreviewCalendarNotificationHarness();
  const actorChanges: unknown[] = [];
  const receiverChanges: unknown[] = [];
  const unsubscribeActor = actor.api.onCalendarChanged((payload) => actorChanges.push(payload));
  const unsubscribeReceiver = receiver.api.onCalendarChanged((payload) => receiverChanges.push(payload));
  try {
    await previewLogin(actor.api, '배한솔');
    await previewLogin(receiver.api, '배한솔');
    const [row] = await actor.api.calendarNotificationsCatchup();
    assert.ok(row, '읽음 상태를 함께 반영할 초기 알림이 있다');

    await actor.api.calendarNotificationsMarkRead([row.id]);
    restoreBroadcastChannel.flush();

    assert.equal(actorChanges.length, 0, '읽음 처리 창에는 자기 메시지를 되돌려 보내지 않는다');
    assert.equal(
      (await receiver.api.calendarNotificationsCatchup()).some((candidate) => candidate.id === row.id),
      false,
      '같은 사용자의 다른 프리뷰 창도 읽음 상태를 즉시 반영한다',
    );
    assert.deepEqual(receiverChanges.at(-1), {
      table: 'calendar_notifications',
      action: 'UPDATE',
      notificationIds: [row.id],
    });
  } finally {
    unsubscribeReceiver();
    unsubscribeActor();
    receiver.restore();
    actor.restore();
    restoreBroadcastChannel();
  }
});

test('preview calendar fanout never restores a notification that this window already marked read', async () => {
  const restoreBroadcastChannel = installPreviewCalendarBroadcastChannel();
  const actor = await createPreviewCalendarNotificationHarness();
  const receiver = await createPreviewCalendarNotificationHarness();
  const unsubscribeReceiver = receiver.api.onCalendarChanged(() => {});
  try {
    await previewLogin(actor.api, '배한솔');
    await previewLogin(receiver.api, '배한솔');
    const [row] = await receiver.api.calendarNotificationsCatchup();
    assert.ok(row, 'the signed-in preview user has an unread seed row to mark');

    await receiver.api.calendarNotificationsMarkRead([row.id]);
    assert.equal(
      (await receiver.api.calendarNotificationsCatchup()).some((candidate) => candidate.id === row.id),
      false,
      'the receiver records its read state before another window publishes a calendar snapshot',
    );

    await actor.api.calendarBroadcastChange({ table: 'calendar_events', action: 'UPDATE' });
    await Promise.resolve();

    assert.equal(
      (await receiver.api.calendarNotificationsCatchup()).some((candidate) => candidate.id === row.id),
      false,
      'an unrelated remote calendar snapshot must not turn the receiver\'s read notification back into unread',
    );
  } finally {
    unsubscribeReceiver();
    receiver.restore();
    actor.restore();
    restoreBroadcastChannel();
  }
});

test('preview calendar move emits a source delete and target create to their separate recipients', async () => {
  const harness = await createPreviewCalendarNotificationHarness();
  try {
    await previewLogin(harness.api, '배한솔');
    const sourceCalendar = await harness.api.calendarCreate({
      name: '이동 전 공유 일정',
      color: '#74B9FF',
      visibility: 'members',
      members: [{ user_id: '2', can_edit: true }],
    });
    const targetCalendar = await harness.api.calendarCreate({
      name: '이동 후 공유 일정',
      color: '#A29BFE',
      visibility: 'members',
      members: [{ user_id: '3', can_edit: true }],
    });
    const created = await harness.api.calendarEventCreate(
      previewNotificationEventInput(sourceCalendar.id, '다른 캘린더로 이동할 일정'),
    );
    await harness.api.calendarEventUpdate(created.id, { calendar_id: targetCalendar.id });

    await harness.api.logoutCanonicalSession();
    await previewLogin(harness.api, '장삐쭈');
    const sourceRows = (await harness.api.calendarNotificationsCatchup())
      .filter((row) => row.event_id === created.id);
    assert.deepEqual(sourceRows.map((row) => row.action).sort(), ['create', 'delete']);
    assert.equal(sourceRows.find((row) => row.action === 'delete')?.calendar_id, sourceCalendar.id);

    await harness.api.logoutCanonicalSession();
    await previewLogin(harness.api, '허혜원');
    const targetRows = (await harness.api.calendarNotificationsCatchup())
      .filter((row) => row.event_id === created.id);
    assert.deepEqual(targetRows.map((row) => row.action), ['create']);
    assert.equal(targetRows[0]?.calendar_id, targetCalendar.id);
  } finally {
    harness.restore();
  }
});

test('preview privacy migration notifies source deletion and kept replacement creation exactly once', async () => {
  const harness = await createPreviewCalendarNotificationHarness();
  try {
    await previewLogin(harness.api, '배한솔');
    const sourceCalendar = (await harness.api.calendarList())
      .find((calendar) => calendar.name === 'EP 마일스톤');
    assert.ok(sourceCalendar);
    const source = (await harness.api.calendarEventsList())
      .find((event) => event.calendar_id === sourceCalendar.id && event.title === 'EP05 업로드');
    assert.ok(source);
    const targetCalendar = await harness.api.calendarCreate({
      name: '이관 후 수신 일정',
      color: '#A29BFE',
      visibility: 'members',
      members: [{ user_id: '2', can_edit: true }],
    });
    const replacement = await harness.api.calendarPrivacyReplacementCreate({
      storage: 'bflow',
      source: { storage: 'bflow', event_id: source.id },
      event: previewNotificationEventInput(targetCalendar.id, '이관 완료 일정'),
    });
    assert.equal('transition_resolved' in replacement, false);
    if ('transition_resolved' in replacement) throw new Error('unexpected transition resolution');

    assert.equal(await replacement.deleteSource(), 'deleted');
    await replacement.settle('keep');
    await assert.rejects(replacement.settle('keep'), /반대 방식/);

    await harness.api.logoutCanonicalSession();
    await previewLogin(harness.api, '장삐쭈');
    const rows = await harness.api.calendarNotificationsCatchup();
    const sourceRows = rows.filter((row) => row.event_id === source.id);
    assert.deepEqual(sourceRows.map((row) => row.action), ['delete']);
    assert.equal(sourceRows[0]?.calendar_id, sourceCalendar.id);
    const targetRows = rows.filter((row) => row.event_id === replacement.actual_id);
    assert.deepEqual(targetRows.map((row) => row.action), ['create']);
    assert.equal(targetRows[0]?.calendar_id, targetCalendar.id);
  } finally {
    harness.restore();
  }
});

test('preview privacy migration compensation never notifies a replacement that is deleted', async () => {
  const harness = await createPreviewCalendarNotificationHarness();
  try {
    await previewLogin(harness.api, '배한솔');
    const targetCalendar = await harness.api.calendarCreate({
      name: '보상 삭제 수신 일정',
      color: '#A29BFE',
      visibility: 'members',
      members: [{ user_id: '2', can_edit: true }],
    });
    const replacement = await harness.api.calendarPrivacyReplacementCreate({
      storage: 'bflow',
      source: { storage: 'legacy-private', event_id: 'missing-legacy-source' },
      event: previewNotificationEventInput(targetCalendar.id, '보상으로 삭제될 일정'),
    });
    assert.equal('transition_resolved' in replacement, false);
    if ('transition_resolved' in replacement) throw new Error('unexpected transition resolution');

    assert.equal(await replacement.deleteSource(), 'missing');
    await replacement.settle('delete');

    await harness.api.logoutCanonicalSession();
    await previewLogin(harness.api, '장삐쭈');
    assert.equal(
      (await harness.api.calendarNotificationsCatchup())
        .some((row) => row.event_id === replacement.actual_id),
      false,
    );
  } finally {
    harness.restore();
  }
});

test('preview privacy migration fans out the committed target, source deletion, and recipient notifications to another context', async () => {
  const restoreBroadcastChannel = installPreviewCalendarBroadcastChannel({ deferMessages: true });
  const actor = await createPreviewCalendarNotificationHarness();
  const recipient = await createPreviewCalendarNotificationHarness();
  const recipientRealtime: unknown[] = [];
  const unsubscribeActor = actor.api.onCalendarChanged(() => {});
  const unsubscribeRecipientCalendar = recipient.api.onCalendarChanged(() => {});
  const unsubscribeRecipientRealtime = recipient.api.onSupabaseRealtime((event) => recipientRealtime.push(event));
  try {
    await previewLogin(actor.api, '배한솔');
    await previewLogin(recipient.api, '장삐쭈');
    const sourceCalendar = (await actor.api.calendarList())
      .find((calendar) => calendar.name === 'EP 마일스톤');
    assert.ok(sourceCalendar);
    const source = (await actor.api.calendarEventsList())
      .find((event) => event.calendar_id === sourceCalendar.id && event.title === 'EP05 업로드');
    assert.ok(source);
    const targetCalendar = await actor.api.calendarCreate({
      name: '프리뷰 이관 수신 일정',
      color: '#A29BFE',
      visibility: 'members',
      members: [{ user_id: '2', can_edit: true }],
    });
    restoreBroadcastChannel.flush();

    const replacement = await actor.api.calendarPrivacyReplacementCreate({
      storage: 'bflow',
      source: { storage: 'bflow', event_id: source.id },
      event: previewNotificationEventInput(targetCalendar.id, '다른 창에도 보일 이관 일정'),
    });
    assert.equal('transition_resolved' in replacement, false);
    if ('transition_resolved' in replacement) throw new Error('unexpected transition resolution');
    restoreBroadcastChannel.flush();
    assert.equal(
      (await recipient.api.calendarEventsList()).some((event) => event.id === replacement.actual_id),
      true,
      '성공한 replacement 생성은 다른 프리뷰 창에도 target INSERT로 전달한다',
    );

    assert.equal(await replacement.deleteSource(), 'deleted');
    restoreBroadcastChannel.flush();
    assert.equal(
      (await recipient.api.calendarEventsList()).some((event) => event.id === source.id),
      false,
      '확정된 bound source 삭제는 다른 프리뷰 창에도 DELETE로 전달한다',
    );

    await replacement.settle('keep');
    restoreBroadcastChannel.flush();
    const recipientRows = await recipient.api.calendarNotificationsCatchup();
    assert.deepEqual(
      recipientRows
        .filter((row) => row.event_id === source.id || row.event_id === replacement.actual_id)
        .map((row) => ({ eventId: row.event_id, action: row.action }))
        .sort((left, right) => left.eventId!.localeCompare(right.eventId!)),
      [
        { eventId: replacement.actual_id, action: 'create' },
        { eventId: source.id, action: 'delete' },
      ].sort((left, right) => left.eventId.localeCompare(right.eventId)),
      'source 삭제와 확정 target 생성은 수신자 수신함에 각각 한 번씩 남는다',
    );
    assert.deepEqual(
      recipientRealtime.map((event) => (
        event as { payload?: { notification?: { eventTitle?: string; action?: string } } }
      ).payload?.notification).map((notification) => ({
        eventTitle: notification?.eventTitle,
        action: notification?.action,
      })),
      [
        { eventTitle: source.title, action: 'delete' },
        { eventTitle: '다른 창에도 보일 이관 일정', action: 'create' },
      ],
      '수신자 창은 확정된 source 삭제와 target 생성 알림을 realtime으로 받는다',
    );
  } finally {
    unsubscribeRecipientRealtime();
    unsubscribeRecipientCalendar();
    unsubscribeActor();
    recipient.restore();
    actor.restore();
    restoreBroadcastChannel();
  }
});

test('preview privacy migration compensation removes the provisional target without a recipient success notification', async () => {
  const restoreBroadcastChannel = installPreviewCalendarBroadcastChannel({ deferMessages: true });
  const actor = await createPreviewCalendarNotificationHarness();
  const recipient = await createPreviewCalendarNotificationHarness();
  const recipientRealtime: unknown[] = [];
  const unsubscribeActor = actor.api.onCalendarChanged(() => {});
  const unsubscribeRecipientCalendar = recipient.api.onCalendarChanged(() => {});
  const unsubscribeRecipientRealtime = recipient.api.onSupabaseRealtime((event) => recipientRealtime.push(event));
  try {
    await previewLogin(actor.api, '배한솔');
    await previewLogin(recipient.api, '장삐쭈');
    const targetCalendar = await actor.api.calendarCreate({
      name: '프리뷰 이관 보상 일정',
      color: '#A29BFE',
      visibility: 'members',
      members: [{ user_id: '2', can_edit: true }],
    });
    restoreBroadcastChannel.flush();

    const replacement = await actor.api.calendarPrivacyReplacementCreate({
      storage: 'bflow',
      source: { storage: 'legacy-private', event_id: 'missing-legacy-source' },
      event: previewNotificationEventInput(targetCalendar.id, '보상으로 사라질 원격 일정'),
    });
    assert.equal('transition_resolved' in replacement, false);
    if ('transition_resolved' in replacement) throw new Error('unexpected transition resolution');
    restoreBroadcastChannel.flush();
    assert.equal(
      (await recipient.api.calendarEventsList()).some((event) => event.id === replacement.actual_id),
      true,
      '성공한 replacement persistence는 보상 전에도 다른 창에 전달한다',
    );

    assert.equal(await replacement.deleteSource(), 'missing');
    await replacement.settle('delete');
    restoreBroadcastChannel.flush();
    assert.equal(
      (await recipient.api.calendarEventsList()).some((event) => event.id === replacement.actual_id),
      false,
      '원본이 남아 보상된 target은 exact DELETE로 다른 프리뷰 창에서도 제거한다',
    );
    assert.equal(
      (await recipient.api.calendarNotificationsCatchup())
        .some((row) => row.event_id === replacement.actual_id),
      false,
      '보상 경로는 수신자에게 성공한 replacement 생성 알림을 만들지 않는다',
    );
    assert.deepEqual(recipientRealtime, [], '보상 경로는 수신자 realtime 성공 알림을 보내지 않는다');
  } finally {
    unsubscribeRecipientRealtime();
    unsubscribeRecipientCalendar();
    unsubscribeActor();
    recipient.restore();
    actor.restore();
    restoreBroadcastChannel();
  }
});

test('preview realtime helper emits the canonical calendar envelope, isolates listener failures, and unsubscribes', () => {
  const realtime = createDevCalendarNotificationRealtimeListeners(() => {});
  const received: unknown[] = [];
  realtime.subscribe(() => {
    throw new Error('first listener failure');
  });
  const unsubscribe = realtime.subscribe((event) => received.push(event));
  const notification = {
    id: 'mock-calendar-notification-1',
    recipientId: '1',
    actorId: '2',
    actorName: '장삐쭈',
    calendarId: 'calendar-1',
    calendarName: 'EP 마일스톤',
    eventTitle: 'EP06 업로드',
    eventDate: '2026-08-25',
    action: 'create' as const,
    detail: null,
    createdAt: '2026-08-26T00:00:00.000Z',
  };

  realtime.emitCalendarNotification(notification);
  assert.deepEqual(received, [{
    table: 'calendar_notifications',
    payload: { notification },
  }]);

  unsubscribe();
  realtime.emitCalendarNotification({ ...notification, id: 'mock-calendar-notification-2' });
  assert.equal(received.length, 1);
});

test('preview hydrates a late tab from the shared calendar state instead of keeping its seed', async () => {
  const restoreBroadcastChannel = installPreviewCalendarBroadcastChannel({ deferMessages: true });
  const actor = await createPreviewCalendarNotificationHarness();
  const unsubscribeActor = actor.api.onCalendarChanged(() => {});
  let late: Awaited<ReturnType<typeof createPreviewCalendarNotificationHarness>> | undefined;
  let unsubscribeLate: (() => void) | undefined;
  try {
    await previewLogin(actor.api, '배한솔');
    const sharedCalendar = await actor.api.calendarCreate({
      name: '늦게 연 창이 받아야 할 캘린더',
      color: '#74B9FF',
      visibility: 'members',
      members: [{ user_id: '2', can_edit: true }],
    });
    const created = await actor.api.calendarEventCreate(
      previewNotificationEventInput(sharedCalendar.id, '늦게 연 창이 받아야 할 일정'),
    );
    // 아직 아무도 듣고 있지 않은 동안 전파된 변경은 늦게 연 창에 남지 않는다.
    restoreBroadcastChannel.flush();

    late = await createPreviewCalendarNotificationHarness();
    const hydrations: unknown[] = [];
    unsubscribeLate = late.api.onCalendarChanged((payload) => hydrations.push(payload));
    await previewLogin(late.api, '장삐쭈');
    restoreBroadcastChannel.flush();
    restoreBroadcastChannel.flush();

    assert.ok(
      (await late.api.calendarList()).some((calendar) => calendar.id === sharedCalendar.id),
      '늦게 연 프리뷰 창도 그동안 만들어진 공유 캘린더를 받는다',
    );
    assert.deepEqual(
      (await late.api.calendarEventsList()).find((event) => event.id === created.id),
      created,
      '늦게 연 프리뷰 창은 놓친 일정까지 정본 상태로 채운다',
    );
    assert.ok(hydrations.length >= 1, '하이드레이션은 렌더러가 정본을 다시 읽도록 변경 신호를 낸다');
  } finally {
    unsubscribeLate?.();
    unsubscribeActor();
    late?.restore();
    actor.restore();
    restoreBroadcastChannel();
  }
});

test('preview rejects a write authorized by membership that the owner already revoked', async () => {
  const restoreBroadcastChannel = installPreviewCalendarBroadcastChannel({
    deferMessages: true,
    sharedStorage: true,
  });
  const owner = await createPreviewCalendarNotificationHarness();
  const member = await createPreviewCalendarNotificationHarness();
  const unsubscribeOwner = owner.api.onCalendarChanged(() => {});
  const unsubscribeMember = member.api.onCalendarChanged(() => {});
  try {
    await previewLogin(owner.api, '배한솔');
    await previewLogin(member.api, '장삐쭈');
    const sharedCalendar = await owner.api.calendarCreate({
      name: '권한 회수 검증 캘린더',
      color: '#74B9FF',
      visibility: 'members',
      members: [{ user_id: '2', can_edit: true }],
    });
    restoreBroadcastChannel.flush();

    const allowed = await member.api.calendarEventCreate(
      previewNotificationEventInput(sharedCalendar.id, '회수 전에는 쓸 수 있는 일정'),
    );
    assert.ok(allowed.id, '권한이 있는 동안에는 다른 프리뷰 창도 일정을 만들 수 있다');
    restoreBroadcastChannel.flush();

    await owner.api.calendarSetMembers(sharedCalendar.id, [{ user_id: '2', can_edit: false }]);
    // 회수 envelope를 아직 전달하지 않은 상태에서도 운영과 같은 판정이어야 한다.
    await assert.rejects(
      () => member.api.calendarEventCreate(
        previewNotificationEventInput(sharedCalendar.id, '회수 뒤에는 막혀야 하는 일정'),
      ),
      /권한이 없습니다/,
      '권한 회수 전파 전에 시작한 쓰기도 현재 membership으로 거절한다',
    );
  } finally {
    unsubscribeMember();
    unsubscribeOwner();
    member.restore();
    owner.restore();
    restoreBroadcastChannel();
  }
});

test('preview keeps a generated personal calendar identical in every tab of the same user', async () => {
  const restoreBroadcastChannel = installPreviewCalendarBroadcastChannel({ deferMessages: true });
  const first = await createPreviewCalendarNotificationHarness();
  const second = await createPreviewCalendarNotificationHarness();
  const unsubscribeFirst = first.api.onCalendarChanged(() => {});
  const unsubscribeSecond = second.api.onCalendarChanged(() => {});
  try {
    // 장삐쭈는 seed에 개인 캘린더가 없어 각 창이 스스로 만든다.
    await previewLogin(first.api, '장삐쭈');
    await previewLogin(second.api, '장삐쭈');
    const firstPersonal = (await first.api.calendarList()).find((calendar) => calendar.is_personal);
    const secondPersonal = (await second.api.calendarList()).find((calendar) => calendar.is_personal);
    assert.ok(firstPersonal, '개인 캘린더가 없는 사용자도 프리뷰에서 하나를 갖는다');
    assert.equal(
      secondPersonal?.id,
      firstPersonal.id,
      '같은 사용자의 개인 캘린더는 창마다 같은 ID여야 한다',
    );

    const created = await first.api.calendarEventCreate(
      previewNotificationEventInput(firstPersonal.id, '개인 캘린더에 만든 일정'),
    );
    restoreBroadcastChannel.flush();

    assert.deepEqual(
      (await second.api.calendarEventsList()).find((event) => event.id === created.id),
      created,
      '개인 캘린더 일정이 다른 창에서 소속 캘린더 없음으로 걸러지지 않는다',
    );
  } finally {
    unsubscribeSecond();
    unsubscribeFirst();
    second.restore();
    first.restore();
    restoreBroadcastChannel();
  }
});

test('preview merges concurrent calendar edits that touch different fields', async () => {
  const restoreBroadcastChannel = installPreviewCalendarBroadcastChannel({ deferMessages: true });
  const namer = await createPreviewCalendarNotificationHarness();
  const colorer = await createPreviewCalendarNotificationHarness();
  const unsubscribeNamer = namer.api.onCalendarChanged(() => {});
  const unsubscribeColorer = colorer.api.onCalendarChanged(() => {});
  try {
    await previewLogin(namer.api, '배한솔');
    await previewLogin(colorer.api, '배한솔');
    const shared = await namer.api.calendarCreate({
      name: '동시 수정 검증 캘린더',
      color: '#74B9FF',
      visibility: 'team',
      members: [],
    });
    restoreBroadcastChannel.flush();

    // 서로의 변경을 받기 전에 각자 다른 필드를 저장한다.
    await namer.api.calendarUpdate(shared.id, { name: '이름만 바꾼 캘린더' });
    await colorer.api.calendarUpdate(shared.id, { color: '#00B894' });
    restoreBroadcastChannel.flush();
    restoreBroadcastChannel.flush();

    for (const [label, harness] of [['이름 쪽', namer], ['색상 쪽', colorer]] as const) {
      const merged = (await harness.api.calendarList()).find((calendar) => calendar.id === shared.id);
      assert.equal(merged?.name, '이름만 바꾼 캘린더', `${label} 창에서 이름 변경이 남아야 한다`);
      assert.equal(merged?.color, '#00B894', `${label} 창에서 색상 변경이 남아야 한다`);
    }
  } finally {
    unsubscribeColorer();
    unsubscribeNamer();
    colorer.restore();
    namer.restore();
    restoreBroadcastChannel();
  }
});
