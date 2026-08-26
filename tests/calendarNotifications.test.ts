import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeCalendarNotificationRecipients,
  formatCalendarDateShort,
  buildCalendarChangeDetail,
  buildCalendarNotificationText,
} from '../src/shared/calendarNotifications.ts';

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
