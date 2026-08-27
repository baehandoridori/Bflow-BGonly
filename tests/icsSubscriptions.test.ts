import assert from 'node:assert/strict';
import test from 'node:test';
import { expandIcsToEvents } from '../electron/icsSubscriptions.ts';

const calendar = (...lines: string[]): string => [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//B flow//ICS test//KO',
  ...lines,
  'END:VCALENDAR',
].join('\r\n');

const SINGLE = calendar(
  'BEGIN:VEVENT', 'UID:ev-1',
  'DTSTART;TZID=Asia/Seoul:20260901T140000', 'DTEND;TZID=Asia/Seoul:20260901T150000',
  'SUMMARY:외부 회의', 'END:VEVENT',
);

const ALLDAY = calendar(
  'BEGIN:VEVENT', 'UID:ev-2',
  'DTSTART;VALUE=DATE:20260901', 'DTEND;VALUE=DATE:20260903', // exclusive 종료
  'SUMMARY:출장', 'END:VEVENT',
);

const WEEKLY = calendar(
  'BEGIN:VEVENT', 'UID:ev-3',
  'DTSTART;TZID=Asia/Seoul:20260901T100000', 'DTEND;TZID=Asia/Seoul:20260901T103000',
  'RRULE:FREQ=WEEKLY;COUNT=3', 'SUMMARY:주간 미팅', 'END:VEVENT',
);

const WEEKLY_WITH_EXDATE = calendar(
  'BEGIN:VEVENT', 'UID:ev-4',
  'DTSTART;TZID=Asia/Seoul:20260901T100000', 'DTEND;TZID=Asia/Seoul:20260901T103000',
  'RRULE:FREQ=WEEKLY;COUNT=3',
  'EXDATE;TZID=Asia/Seoul:20260908T100000',
  'SUMMARY:쉬는 주가 있는 미팅', 'END:VEVENT',
);

const UTC_EVENT = calendar(
  'BEGIN:VEVENT', 'UID:ev-5',
  'DTSTART:20260901T010000Z', 'DTEND:20260901T020000Z',
  'SUMMARY:UTC 표기 일정', 'END:VEVENT',
);

const OVERNIGHT = calendar(
  'BEGIN:VEVENT', 'UID:ev-6',
  'DTSTART;TZID=Asia/Seoul:20260901T230000', 'DTEND;TZID=Asia/Seoul:20260902T003000',
  'SUMMARY:자정을 넘는 일정', 'END:VEVENT',
);

const WINDOW = { from: '2026-08-01', to: '2027-02-01' };

test('expandIcsToEvents: 시각 일정을 KST 날짜·시각으로 매핑한다', () => {
  const expanded = expandIcsToEvents(SINGLE, WINDOW);

  assert.equal(expanded.events.length, 1);
  assert.deepEqual(
    [
      expanded.events[0].startDate,
      expanded.events[0].startTime,
      expanded.events[0].endTime,
      expanded.events[0].allDay,
    ],
    ['2026-09-01', '14:00', '15:00', false],
  );
  assert.equal(expanded.events[0].title, '외부 회의');
  assert.equal(expanded.events[0].uid, 'ev-1');
  assert.equal(expanded.truncated, false);
});

test('expandIcsToEvents: 종일 일정의 exclusive 종료를 inclusive로 바꾼다', () => {
  const expanded = expandIcsToEvents(ALLDAY, WINDOW);

  assert.deepEqual(
    [expanded.events[0].startDate, expanded.events[0].endDate, expanded.events[0].allDay],
    ['2026-09-01', '2026-09-02', true],
  );
  assert.equal(expanded.events[0].startTime, null);
  assert.equal(expanded.events[0].endTime, null);
});

test('expandIcsToEvents: 주간 반복을 지정 횟수만큼 전개한다', () => {
  const expanded = expandIcsToEvents(WEEKLY, WINDOW);

  assert.deepEqual(
    expanded.events.map((event) => event.startDate),
    ['2026-09-01', '2026-09-08', '2026-09-15'],
  );
  // node-ical의 rrule은 UTC 기준으로 전개해 벽시계 시각이 밀릴 수 있다.
  assert.deepEqual(
    [...new Set(expanded.events.map((event) => event.startTime))],
    ['10:00'],
    '반복 인스턴스도 원본과 같은 벽시계 시각을 유지한다',
  );
});

test('expandIcsToEvents: 조회 창 밖 인스턴스를 제외한다', () => {
  const expanded = expandIcsToEvents(WEEKLY, { from: '2026-09-05', to: '2026-09-10' });

  assert.equal(expanded.events.length, 1);
  assert.equal(expanded.events[0].startDate, '2026-09-08');
});

test('expandIcsToEvents: EXDATE로 제외된 회차는 전개하지 않는다', () => {
  const expanded = expandIcsToEvents(WEEKLY_WITH_EXDATE, WINDOW);

  assert.deepEqual(
    expanded.events.map((event) => event.startDate),
    ['2026-09-01', '2026-09-15'],
  );
});

test('expandIcsToEvents: UTC 표기 일정도 KST 벽시계로 옮긴다', () => {
  const expanded = expandIcsToEvents(UTC_EVENT, WINDOW);

  assert.deepEqual(
    [expanded.events[0].startDate, expanded.events[0].startTime, expanded.events[0].endTime],
    ['2026-09-01', '10:00', '11:00'],
  );
});

test('expandIcsToEvents: 자정을 넘는 일정은 종료 날짜를 다음 날로 둔다', () => {
  const expanded = expandIcsToEvents(OVERNIGHT, WINDOW);

  assert.deepEqual(
    [
      expanded.events[0].startDate,
      expanded.events[0].startTime,
      expanded.events[0].endDate,
      expanded.events[0].endTime,
    ],
    ['2026-09-01', '23:00', '2026-09-02', '00:30'],
  );
});

test('expandIcsToEvents: 구독당 상한을 넘으면 미래 우선으로 자르고 알린다', () => {
  const daily = calendar(
    'BEGIN:VEVENT', 'UID:ev-many',
    'DTSTART;TZID=Asia/Seoul:20260901T090000', 'DTEND;TZID=Asia/Seoul:20260901T093000',
    'RRULE:FREQ=DAILY;COUNT=800', 'SUMMARY:매일 스탠드업', 'END:VEVENT',
  );
  const expanded = expandIcsToEvents(daily, { from: '2026-08-01', to: '2030-01-01' });

  assert.equal(expanded.events.length, 500, '한 구독이 만드는 일정 수를 제한한다');
  assert.equal(expanded.truncated, true);
  assert.deepEqual(
    expanded.events.map((event) => event.startDate),
    [...expanded.events.map((event) => event.startDate)].sort(),
    '잘라낸 뒤에도 날짜 순서를 유지한다',
  );
  assert.equal(expanded.events[0].startDate, '2026-09-01', '이른 회차부터 채운다');
});

test('expandIcsToEvents: 제목 없는 일정과 깨진 입력에도 무너지지 않는다', () => {
  const untitled = calendar(
    'BEGIN:VEVENT', 'UID:ev-untitled',
    'DTSTART;TZID=Asia/Seoul:20260901T140000', 'DTEND;TZID=Asia/Seoul:20260901T150000',
    'END:VEVENT',
  );

  assert.equal(expandIcsToEvents(untitled, WINDOW).events[0].title, '(제목 없음)');
  assert.deepEqual(expandIcsToEvents('', WINDOW), { events: [], truncated: false });
  assert.deepEqual(expandIcsToEvents('그냥 텍스트', WINDOW), { events: [], truncated: false });
});

test('expandIcsToEvents: 종료가 없는 일정은 시각 1시간·종일 하루로 채운다', () => {
  const noEnd = calendar(
    'BEGIN:VEVENT', 'UID:ev-no-end',
    'DTSTART;TZID=Asia/Seoul:20260901T140000',
    'SUMMARY:종료 없는 일정', 'END:VEVENT',
  );
  const noEndAllDay = calendar(
    'BEGIN:VEVENT', 'UID:ev-no-end-allday',
    'DTSTART;VALUE=DATE:20260901',
    'SUMMARY:종료 없는 종일', 'END:VEVENT',
  );

  assert.deepEqual(
    [expandIcsToEvents(noEnd, WINDOW).events[0].startTime, expandIcsToEvents(noEnd, WINDOW).events[0].endTime],
    ['14:00', '15:00'],
  );
  assert.deepEqual(
    [
      expandIcsToEvents(noEndAllDay, WINDOW).events[0].startDate,
      expandIcsToEvents(noEndAllDay, WINDOW).events[0].endDate,
    ],
    ['2026-09-01', '2026-09-01'],
  );
});
