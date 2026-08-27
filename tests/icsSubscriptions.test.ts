import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createIcsSubscriptionStore,
  expandIcsToEvents,
  normalizeIcsUrl,
} from '../electron/icsSubscriptions.ts';

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


/* ── 구독 저장·갱신 ─────────────────────────────────────────────── */

test('normalizeIcsUrl: webcal은 https로 바꾸고 그 밖의 프로토콜은 거절한다', () => {
  assert.equal(normalizeIcsUrl('webcal://example.com/team.ics'), 'https://example.com/team.ics');
  assert.equal(normalizeIcsUrl('WEBCAL://example.com/team.ics'), 'https://example.com/team.ics');
  assert.equal(normalizeIcsUrl('https://example.com/team.ics'), 'https://example.com/team.ics');
  assert.equal(normalizeIcsUrl('  https://example.com/team.ics  '), 'https://example.com/team.ics');
  assert.equal(normalizeIcsUrl('http://example.com/team.ics'), 'http://example.com/team.ics');

  for (const rejected of ['file:///etc/passwd', 'javascript:alert(1)', 'ftp://example.com/a.ics', '', '그냥 글자']) {
    assert.equal(normalizeIcsUrl(rejected), null, `${rejected} 는 거절한다`);
  }
});

function createStoreHarness(options: {
  fetchText?: (url: string) => Promise<string>;
  stored?: string | null;
} = {}) {
  const written: string[] = [];
  const fetched: string[] = [];
  const pushed: unknown[] = [];
  let file = options.stored ?? null;
  let idSequence = 0;
  let clock = Date.parse('2026-09-01T00:00:00.000Z');

  const store = createIcsSubscriptionStore({
    readSubscriptionsFile: async () => file,
    writeSubscriptionsFile: async (contents: string) => { file = contents; written.push(contents); },
    fetchText: async (url: string) => {
      fetched.push(url);
      if (options.fetchText) return options.fetchText(url);
      return SINGLE;
    },
    createId: () => `sub-${++idSequence}`,
    now: () => new Date(clock),
    publishChanged: (payload: unknown) => { pushed.push(payload); },
  });

  return {
    store,
    written,
    fetched,
    pushed,
    advance(ms: number) { clock += ms; },
    readFile: () => file,
  };
}

test('구독 추가는 주소를 정규화해 저장하고 곧바로 한 번 조회한다', async () => {
  const harness = createStoreHarness();

  const added = await harness.store.add({ name: '팀 외부 일정', url: 'webcal://example.com/team.ics', color: '#74B9FF' });

  assert.equal(added.url, 'https://example.com/team.ics', 'webcal은 저장 전에 https로 바꾼다');
  assert.equal(added.enabled, true);
  assert.equal(added.lastError, null);
  assert.equal(added.lastFetchedAt, '2026-09-01T00:00:00.000Z');
  assert.deepEqual(harness.fetched, ['https://example.com/team.ics'], '추가 즉시 한 번 받아 온다');
  assert.deepEqual((await harness.store.list()).map((row) => row.id), ['sub-1']);

  const events = await harness.store.events();
  assert.deepEqual(events.map((entry) => entry.subId), ['sub-1']);
  assert.equal(events[0].events[0].title, '외부 회의');
});

test('잘못된 주소는 추가하지 않고 이유를 알려 준다', async () => {
  const harness = createStoreHarness();

  await assert.rejects(
    () => harness.store.add({ name: '이상한 주소', url: 'file:///etc/passwd', color: '#74B9FF' }),
    /http 또는 https/,
  );
  assert.deepEqual(await harness.store.list(), []);
  assert.deepEqual(harness.fetched, [], '거절한 주소는 받아 오지 않는다');
});

test('조회 실패는 마지막 오류로 남기고 직전 성공 결과를 지우지 않는다', async () => {
  let shouldFail = false;
  const harness = createStoreHarness({
    fetchText: async () => {
      if (shouldFail) throw new Error('네트워크가 불안정합니다');
      return SINGLE;
    },
  });

  const added = await harness.store.add({ name: '팀 외부 일정', url: 'https://example.com/team.ics', color: '#74B9FF' });
  const before = await harness.store.events();
  assert.equal(before[0].events.length, 1);

  shouldFail = true;
  harness.advance(60_000);
  await harness.store.refresh(added.id);

  const [row] = await harness.store.list();
  assert.match(String(row.lastError), /네트워크가 불안정합니다/);
  assert.equal(row.lastFetchedAt, '2026-09-01T00:00:00.000Z', '실패는 마지막 성공 시각을 밀지 않는다');

  const after = await harness.store.events();
  assert.deepEqual(after[0].events, before[0].events, '실패해도 직전에 받아 둔 일정은 유지한다');

  shouldFail = false;
  await harness.store.refresh(added.id);
  assert.equal((await harness.store.list())[0].lastError, null, '다시 성공하면 오류 표시를 지운다');
});

test('꺼 둔 구독은 조회도 일정 제공도 하지 않는다', async () => {
  const harness = createStoreHarness();
  const added = await harness.store.add({ name: '팀 외부 일정', url: 'https://example.com/team.ics', color: '#74B9FF' });
  const fetchedAfterAdd = harness.fetched.length;

  await harness.store.update(added.id, { enabled: false });
  await harness.store.refresh(null);

  assert.equal(harness.fetched.length, fetchedAfterAdd, '꺼 둔 구독은 다시 받아 오지 않는다');
  assert.deepEqual(await harness.store.events(), [], '꺼 둔 구독의 일정은 내보내지 않는다');

  await harness.store.update(added.id, { enabled: true });
  await harness.store.refresh(null);
  assert.equal((await harness.store.events()).length, 1, '다시 켜면 일정이 돌아온다');
});

test('이름·색 변경과 구독 해제가 저장 파일에 반영된다', async () => {
  const harness = createStoreHarness();
  const added = await harness.store.add({ name: '옛 이름', url: 'https://example.com/team.ics', color: '#74B9FF' });

  const renamed = await harness.store.update(added.id, { name: '새 이름', color: '#00B894' });
  assert.equal(renamed?.name, '새 이름');
  assert.equal(renamed?.color, '#00B894');
  assert.match(String(harness.readFile()), /새 이름/);

  await harness.store.remove(added.id);
  assert.deepEqual(await harness.store.list(), []);
  assert.deepEqual(await harness.store.events(), [], '해제한 구독의 일정도 함께 사라진다');
  assert.doesNotMatch(String(harness.readFile()), /새 이름/);
});

test('저장 파일이 깨져 있어도 빈 목록으로 시작한다', async () => {
  for (const broken of ['', '{', 'null', '{"subscriptions": 3}', '[1,2,3]']) {
    const harness = createStoreHarness({ stored: broken });
    assert.deepEqual(await harness.store.list(), [], `${broken} 는 빈 목록으로 읽는다`);
  }
});

test('저장된 구독은 다음 실행에서 그대로 복원된다', async () => {
  const first = createStoreHarness();
  await first.store.add({ name: '팀 외부 일정', url: 'https://example.com/team.ics', color: '#74B9FF' });
  const persisted = first.readFile();

  const restored = createStoreHarness({ stored: persisted });
  const rows = await restored.store.list();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, '팀 외부 일정');
  assert.equal(rows[0].url, 'https://example.com/team.ics');
  assert.deepEqual(await restored.store.events(), [], '캐시는 저장하지 않으므로 조회 전에는 비어 있다');

  await restored.store.refresh(null);
  assert.equal((await restored.store.events())[0].events.length, 1);
});

test('갱신이 끝나면 렌더러에 변경을 알린다', async () => {
  const harness = createStoreHarness();
  const added = await harness.store.add({ name: '팀 외부 일정', url: 'https://example.com/team.ics', color: '#74B9FF' });

  assert.ok(harness.pushed.length >= 1, '추가 직후에도 알린다');
  const pushedBefore = harness.pushed.length;
  await harness.store.refresh(added.id);
  assert.ok(harness.pushed.length > pushedBefore, '갱신이 끝나면 다시 알린다');
});
