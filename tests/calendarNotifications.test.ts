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

test('catch-up exclusion input keeps only unique UUID calendar ids and has a bounded payload', () => {
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
  assert.equal(normalized.excludedCalendarIds.length, 100);
  assert.deepEqual(normalized.excludedCalendarIds.slice(0, 2), validIds.slice(0, 2));
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

type PreviewCalendarNotificationApi = {
  loginCanonicalSession(input: { name: string; password: string; rememberMe: boolean }): Promise<{ ok: boolean }>;
  logoutCanonicalSession(): Promise<unknown>;
  calendarNotificationsCatchup(input?: { excludedCalendarIds?: string[] }): Promise<PreviewCalendarNotificationRow[]>;
  calendarNotificationsMarkRead(ids: string[]): Promise<void>;
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

    assert.deepEqual(
      await harness.api.calendarNotificationsCatchup({ excludedCalendarIds: [mutedSeedCalendarId!] }),
      [],
      'the actual UUID-shaped seed calendar is removed before the cap without marking its rows read',
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
