import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  computeCalendarNotificationRecipients,
  formatCalendarDateShort,
  buildCalendarChangeDetail,
  buildCalendarNotificationText,
  mapCalendarNotificationRow,
} from '../src/shared/calendarNotifications.ts';
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

const previewMockPath = path.join(process.cwd(), 'src', 'mocks', 'devElectronAPI.ts');

function readPreviewApiSource(): string {
  return readFileSync(previewMockPath, 'utf8');
}

test('preview calendar catch-up seeds use the signed-in mock user and visible current-month seed rows', () => {
  const source = readPreviewApiSource();

  assert.match(source, /recipient_id:\s*MOCK_USERS\[0\]\.id/);
  assert.match(source, /createDevCalendarSeed\(\)/);
  assert.match(source, /EP06 업로드/);
  assert.match(source, /EP07 가편 작업/);
  assert.match(source, /action:\s*'create'/);
  assert.match(source, /action:\s*'update'/);
  assert.match(source, /detail:\s*`\$\{.*?\}\/12 → \$\{.*?\}\/13`/s);
  assert.match(source, /calendarNotificationsCatchup:\s*async \(\) => mockCalendarNotifications/);
  assert.match(source, /calendarNotificationsMarkRead:\s*async \(\) => \{\}/);
  assert.match(source, /onSupabaseRealtime:\s*\(callback\) => previewCalendarNotificationRealtime\.subscribe\(callback\)/);
  assert.match(source, /previewCalendarNotificationRealtime\.emitCalendarNotification\(row\)/);
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
