import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ICS_MAX_REDIRECTS,
  ICS_MAX_RESPONSE_BYTES,
  createIcsSubscriptionStore,
  createIcsTextFetcher,
  expandIcsToEvents,
  normalizeIcsUrl,
} from '../electron/icsSubscriptions.ts';
import {
  ICS_REFRESH_INTERVAL_MS,
  registerIcsSubscriptionIpc,
} from '../electron/icsSubscriptionIpc.ts';

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


/* ── 본문 받아 오기(전송) ─────────────────────────────────────────── */

type FakeResponse = {
  statusCode?: number;
  headers?: Record<string, string>;
  chunks?: string[];
  failWith?: Error;
};

function createFetcherHarness(responses: Record<string, FakeResponse>) {
  const requested: string[] = [];
  let destroyed = 0;

  const fetchText = createIcsTextFetcher({
    get(url, onResponse) {
      requested.push(url);
      const response = responses[url];
      const handlers = new Map<string, ((value?: unknown) => void)[]>();
      const request = {
        on(eventName: string, handler: (value?: unknown) => void) {
          if (eventName === 'error' && response?.failWith) {
            queueMicrotask(() => handler(response.failWith));
          }
          return request;
        },
        destroy() { destroyed += 1; },
      };
      if (!response?.failWith) {
        queueMicrotask(() => {
          onResponse({
            statusCode: response?.statusCode ?? 200,
            headers: response?.headers ?? {},
            setEncoding() {},
            destroy() { destroyed += 1; },
            on(eventName: string, handler: (value?: unknown) => void) {
              const list = handlers.get(eventName) ?? [];
              list.push(handler);
              handlers.set(eventName, list);
              if (eventName === 'end') {
                queueMicrotask(() => {
                  for (const chunk of response?.chunks ?? []) {
                    for (const dataHandler of handlers.get('data') ?? []) dataHandler(chunk);
                  }
                  for (const endHandler of handlers.get('end') ?? []) endHandler();
                });
              }
            },
          });
        });
      }
      return request;
    },
  });

  return { fetchText, requested, destroyedCount: () => destroyed };
}

test('createIcsTextFetcher: 본문을 이어 붙여 돌려준다', async () => {
  const harness = createFetcherHarness({
    'https://example.com/team.ics': { chunks: ['BEGIN:VCALENDAR\r\n', 'END:VCALENDAR'] },
  });

  assert.equal(
    await harness.fetchText('https://example.com/team.ics'),
    'BEGIN:VCALENDAR\r\nEND:VCALENDAR',
  );
  assert.deepEqual(harness.requested, ['https://example.com/team.ics']);
});

test('createIcsTextFetcher: 리다이렉트를 따라가되 횟수를 제한한다', async () => {
  const hop = (to: string): FakeResponse => ({ statusCode: 302, headers: { location: to } });
  const withinLimit = createFetcherHarness({
    'https://a.example/1.ics': hop('https://a.example/2.ics'),
    'https://a.example/2.ics': hop('https://a.example/3.ics'),
    'https://a.example/3.ics': hop('https://a.example/4.ics'),
    'https://a.example/4.ics': { chunks: ['BEGIN:VCALENDAR'] },
  });
  assert.equal(await withinLimit.fetchText('https://a.example/1.ics'), 'BEGIN:VCALENDAR');
  assert.equal(withinLimit.requested.length, ICS_MAX_REDIRECTS + 1);

  const tooMany = createFetcherHarness({
    'https://b.example/1.ics': hop('https://b.example/2.ics'),
    'https://b.example/2.ics': hop('https://b.example/3.ics'),
    'https://b.example/3.ics': hop('https://b.example/4.ics'),
    'https://b.example/4.ics': hop('https://b.example/5.ics'),
    'https://b.example/5.ics': { chunks: ['BEGIN:VCALENDAR'] },
  });
  await assert.rejects(() => tooMany.fetchText('https://b.example/1.ics'), /주소가 너무 여러 번/);
});

test('createIcsTextFetcher: http(s) 밖으로 가는 리다이렉트는 따라가지 않는다', async () => {
  const harness = createFetcherHarness({
    'https://example.com/team.ics': { statusCode: 302, headers: { location: 'file:///etc/passwd' } },
  });

  await assert.rejects(() => harness.fetchText('https://example.com/team.ics'), /http 또는 https/);
});

test('createIcsTextFetcher: 실패 응답과 전송 오류를 사유와 함께 알린다', async () => {
  const notFound = createFetcherHarness({ 'https://example.com/a.ics': { statusCode: 404 } });
  await assert.rejects(() => notFound.fetchText('https://example.com/a.ics'), /404/);

  const broken = createFetcherHarness({
    'https://example.com/b.ics': { failWith: new Error('연결이 끊겼습니다') },
  });
  await assert.rejects(() => broken.fetchText('https://example.com/b.ics'), /연결이 끊겼습니다/);
});

test('createIcsTextFetcher: 상한을 넘는 본문은 받다가 끊는다', async () => {
  const oversized = 'x'.repeat(ICS_MAX_RESPONSE_BYTES + 1);
  const harness = createFetcherHarness({
    'https://example.com/huge.ics': { chunks: [oversized] },
  });

  await assert.rejects(() => harness.fetchText('https://example.com/huge.ics'), /너무 큽니다/);
  assert.ok(harness.destroyedCount() > 0, '상한을 넘으면 연결을 끊는다');
});


/* ── IPC 등록 ─────────────────────────────────────────────────────── */

function createIpcHarness() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const warnings: string[] = [];
  const calls: string[] = [];
  let intervalHandler: (() => void) | null = null;
  let cleared = 0;
  let refreshShouldFail = false;

  const store = {
    async list() { calls.push('list'); return []; },
    async add(input: { name: string; url: string; color: string }) {
      calls.push(`add:${input.name}|${input.url}|${input.color}`);
      return {
        id: 'sub-1',
        name: input.name,
        url: input.url,
        color: input.color,
        enabled: true,
        lastFetchedAt: null,
        lastError: null,
      };
    },
    async update(id: string, patch: Record<string, unknown>) {
      calls.push(`update:${id}:${JSON.stringify(patch)}`);
      return null;
    },
    async remove(id: string) { calls.push(`remove:${id}`); },
    async refresh(id: string | null) {
      calls.push(`refresh:${String(id)}`);
      if (refreshShouldFail) throw new Error('주기 갱신이 실패했습니다');
    },
    async events() { calls.push('events'); return []; },
  };

  const registration = registerIcsSubscriptionIpc({
    store,
    handle(channel, handler) { handlers.set(channel, handler); },
    setInterval(handler, intervalMs) {
      calls.push(`setInterval:${intervalMs}`);
      intervalHandler = handler;
      return 'timer';
    },
    clearInterval(handle) {
      calls.push(`clearInterval:${String(handle)}`);
      cleared += 1;
    },
    logWarning(message) { warnings.push(message); },
  });

  return {
    registration,
    handlers,
    calls,
    warnings,
    clearedCount: () => cleared,
    tick: () => intervalHandler?.(),
    failRefresh(value: boolean) { refreshShouldFail = value; },
  };
}

test('ICS IPC: 여섯 채널을 등록하고 입력을 정리해서 넘긴다', async () => {
  const harness = createIpcHarness();

  assert.deepEqual(
    [...harness.handlers.keys()].sort(),
    ['ics:add', 'ics:events', 'ics:list', 'ics:refresh', 'ics:remove', 'ics:update'],
  );

  await harness.handlers.get('ics:add')?.({ name: '팀 일정', url: 'https://example.com/a.ics', color: '#74B9FF' });
  assert.ok(harness.calls.includes('add:팀 일정|https://example.com/a.ics|#74B9FF'));

  // 모양이 어긋난 입력도 빈 값으로 정리해 넘긴다(메인이 최종 판정한다).
  await harness.handlers.get('ics:add')?.({ name: 7, url: null });
  assert.ok(harness.calls.includes('add:||'));

  await harness.handlers.get('ics:update')?.('sub-1', { name: '새 이름', enabled: false, color: 3, 침입: true });
  assert.ok(
    harness.calls.some((call) => call.startsWith('update:sub-1:')
      && call.includes('"name":"새 이름"')
      && call.includes('"enabled":false')
      && !call.includes('침입')
      && !call.includes('"color"')),
    '허용한 키만 통과시킨다',
  );

  await harness.handlers.get('ics:update')?.('', {});
  await harness.handlers.get('ics:remove')?.('');
  assert.equal(
    harness.calls.filter((call) => call.startsWith('update:') || call.startsWith('remove:')).length,
    1,
    '빈 id는 store까지 내려보내지 않는다',
  );

  await harness.handlers.get('ics:refresh')?.(undefined);
  assert.ok(harness.calls.includes('refresh:null'), 'id가 없으면 전체 갱신으로 본다');
  await harness.handlers.get('ics:refresh')?.('sub-1');
  assert.ok(harness.calls.includes('refresh:sub-1'));
});

test('ICS IPC: 시작 시 한 번 채우고 30분마다 갱신하며 실패해도 멈추지 않는다', async () => {
  const harness = createIpcHarness();

  assert.ok(
    harness.calls.includes(`setInterval:${ICS_REFRESH_INTERVAL_MS}`),
    '주기 갱신 타이머를 건다',
  );

  await harness.registration.primeOnStartup();
  assert.ok(harness.calls.includes('refresh:null'), '앱 시작 직후 한 번 채운다');

  harness.failRefresh(true);
  harness.tick();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(harness.warnings, ['[ICS] 주기 갱신 실패'], '실패는 남기되 던지지 않는다');

  await harness.registration.primeOnStartup();
  assert.equal(harness.warnings.length, 2, '시작 갱신 실패도 같은 방식으로 남긴다');

  harness.registration.dispose();
  assert.equal(harness.clearedCount(), 1, '정리하면 주기 갱신 타이머를 해제한다');
});

/* ── 자체 리뷰에서 찾은 결함 ─────────────────────────────────────── */

test('구독 추가와 목록 조회가 겹쳐도 추가한 구독이 저장에서 빠지지 않는다', async () => {
  // 첫 로드가 끝나기 전에 두 호출이 겹치면, 나중에 끝난 읽기가 앞선 호출의 결과를
  // 통째로 덮어쓴다. 앱 시작 시 주기 갱신과 렌더러의 목록 조회가 실제로 겹친다.
  let releaseSecondRead: (() => void) | undefined;
  const secondReadGate = new Promise<void>((resolve) => { releaseSecondRead = resolve; });
  let readCount = 0;
  let file: string | null = null;

  const store = createIcsSubscriptionStore({
    readSubscriptionsFile: async () => {
      readCount += 1;
      if (readCount === 2) await secondReadGate;
      return file;
    },
    writeSubscriptionsFile: async (contents: string) => { file = contents; },
    fetchText: async () => SINGLE,
    createId: () => 'sub-1',
    now: () => new Date('2026-09-01T00:00:00.000Z'),
  });

  const adding = store.add({ name: '겹친 구독', url: 'https://example.com/a.ics', color: '#74B9FF' });
  const listing = store.list();
  await Promise.resolve();
  releaseSecondRead?.();
  await Promise.all([adding, listing]);

  assert.equal((await store.list()).length, 1, '추가한 구독이 목록에 남는다');
  assert.match(String(file), /겹친 구독/, '저장 파일에도 추가한 구독이 들어간다');
  assert.equal((await store.events()).length, 1, '받아 온 일정도 유지된다');
});

test('expandIcsToEvents: 상한을 넘기면 지난 회차를 버리고 다가오는 회차를 남긴다', () => {
  const daily = calendar(
    'BEGIN:VEVENT', 'UID:ev-long',
    'DTSTART;TZID=Asia/Seoul:20250101T090000', 'DTEND;TZID=Asia/Seoul:20250101T093000',
    'RRULE:FREQ=DAILY;COUNT=900', 'SUMMARY:매일 스탠드업', 'END:VEVENT',
  );
  // 창 안 회차가 약 550개라 상한(500)을 넘는다.
  const expanded = expandIcsToEvents(
    daily,
    { from: '2025-03-01', to: '2026-09-01' },
    { today: '2025-09-01' },
  );

  assert.equal(expanded.truncated, true);
  assert.equal(expanded.events.length, 500);
  assert.equal(
    expanded.events.at(-1)?.startDate,
    '2026-09-01',
    '지난 회차를 채우느라 창 끝의 다가오는 회차를 잘라 내면 안 된다',
  );
  assert.deepEqual(
    expanded.events.map((event) => event.startDate),
    [...expanded.events.map((event) => event.startDate)].sort(),
    '출력은 여전히 날짜순이다',
  );
});
