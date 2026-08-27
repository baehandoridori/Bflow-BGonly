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

type PreviewCalendarBroadcastChannelCleanup = (() => void) & {
  flush(): void;
};

function installPreviewCalendarBroadcastChannel(options?: {
  deferMessages?: boolean;
}): PreviewCalendarBroadcastChannelCleanup {
  const globalScope = globalThis as Record<string, unknown>;
  const hadBroadcastChannel = Object.prototype.hasOwnProperty.call(globalScope, 'BroadcastChannel');
  const previousBroadcastChannel = globalScope.BroadcastChannel;
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

  const localStorageValues = new Map<string, string>();
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

    await actor.api.calendarBroadcastChange({ eventId: created.id, action: 'update' });
    await Promise.resolve();

    assert.deepEqual(actorChanges, [], '명시적 브로드캐스트도 송신자에게 echo하지 않는다');
    assert.deepEqual(receiverChanges.at(-1), {
      table: 'calendar_events',
      action: 'UPDATE',
      eventId: created.id,
    });
  } finally {
    unsubscribeReceiver();
    unsubscribeActor();
    receiver.restore();
    actor.restore();
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

test('preview calendar fanout merges concurrent tag changes by tag id instead of replacing the full tag list', async () => {
  const restoreBroadcastChannel = installPreviewCalendarBroadcastChannel({ deferMessages: true });
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

    await actor.api.calendarTagsSave(actorTags.map((tag) => (
      tag.id === firstTag.id ? { ...tag, name: '첫 번째 창 태그' } : tag
    )));
    await receiver.api.calendarTagsSave(receiverTags.map((tag) => (
      tag.id === secondTag.id ? { ...tag, name: '두 번째 창 태그' } : tag
    )));
    restoreBroadcastChannel.flush();

    for (const api of [actor.api, receiver.api]) {
      const namesById = new Map((await api.calendarTagsList()).map((tag) => [tag.id, tag.name]));
      assert.equal(namesById.get(firstTag.id), '첫 번째 창 태그');
      assert.equal(namesById.get(secondTag.id), '두 번째 창 태그');
    }
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
