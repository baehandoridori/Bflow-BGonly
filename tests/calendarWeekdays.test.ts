import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isWeekendDate,
  visibleWeekDays,
  layoutEventBars,
} from '../src/utils/calendarWeekdays.ts';
import type { CalendarEvent } from '../src/types/calendar';

/** 2026-08-23(일) ~ 2026-08-29(토) 한 주. */
const WEEK = Array.from({ length: 7 }, (_, offset) => new Date(2026, 7, 23 + offset, 12));

function event(overrides: Partial<CalendarEvent> & { id: string; startDate: string; endDate: string }): CalendarEvent {
  return {
    title: '일정',
    memo: '',
    color: '#6C5CE7',
    type: 'custom',
    createdBy: '배한솔',
    createdAt: '2026-08-20T00:00:00.000Z',
    ...overrides,
  } as CalendarEvent;
}

test('isWeekendDate — 일요일과 토요일만 주말이다', () => {
  assert.deepEqual(
    WEEK.map(isWeekendDate),
    [true, false, false, false, false, false, true],
  );
});

test('visibleWeekDays — 주말 숨김이면 5일, 표시면 원본 배열 그대로', () => {
  const weekdaysOnly = visibleWeekDays(WEEK, false);
  assert.equal(weekdaysOnly.length, 5);
  assert.deepEqual(
    weekdaysOnly.map((day) => day.getDay()),
    [1, 2, 3, 4, 5],
    '월~금만 남는다',
  );

  assert.equal(visibleWeekDays(WEEK, true), WEEK, '주말을 보여줄 때는 원본 참조를 그대로 쓴다');
});

test('layoutEventBars — 주말을 숨기면 금~월 일정이 끊기지 않은 막대 하나가 된다', () => {
  // 8/28(금) ~ 8/31(월). 이 주에서 보이는 건 금요일 한 칸뿐이고, 8/31은 다음 주다.
  const spanning = event({ id: 'fri-mon', startDate: '2026-08-28', endDate: '2026-08-31' });
  const weekdays = visibleWeekDays(WEEK, false);

  const bars = layoutEventBars([spanning], weekdays);

  assert.equal(bars.length, 1);
  assert.equal(bars[0].startCol, 4, '금요일은 월~금 중 다섯 번째 칸이다');
  assert.equal(bars[0].span, 1);
  assert.equal(bars[0].isStart, true, '이 주에서 시작한다');
  assert.equal(bars[0].isEnd, false, '다음 주로 이어지므로 끝나지 않는다');
});

test('layoutEventBars — 주말을 건너뛴 일정도 격자에서는 맞붙은 한 막대다', () => {
  // 8/23(일)이 속한 주에서 목~다음주 화까지 가는 일정: 보이는 칸은 목·금 두 칸.
  const thuToNextTue = event({ id: 'thu-tue', startDate: '2026-08-27', endDate: '2026-09-01' });
  const bars = layoutEventBars([thuToNextTue], visibleWeekDays(WEEK, false));

  assert.equal(bars.length, 1);
  assert.equal(bars[0].startCol, 3, '목요일 칸에서 시작');
  assert.equal(bars[0].span, 2, '목·금 두 칸을 채운다');
});

test('layoutEventBars — 주말에만 있는 일정은 숨기면 아예 빠진다', () => {
  const saturdayOnly = event({ id: 'sat', startDate: '2026-08-29', endDate: '2026-08-29' });
  const sundayOnly = event({ id: 'sun', startDate: '2026-08-23', endDate: '2026-08-23' });
  const weekend = event({ id: 'weekend', startDate: '2026-08-29', endDate: '2026-08-30' });

  assert.deepEqual(
    layoutEventBars([saturdayOnly, sundayOnly, weekend], visibleWeekDays(WEEK, false)),
    [],
    '보일 칸이 없는 일정은 막대를 만들지 않는다',
  );

  assert.equal(
    layoutEventBars([saturdayOnly, sundayOnly, weekend], visibleWeekDays(WEEK, true)).length,
    3,
    '주말을 보여주면 그대로 다 나온다',
  );
});

test('layoutEventBars — 주말을 보여줄 때는 예전 7칸 계산과 같은 결과다', () => {
  const events = [
    event({ id: 'week-long', startDate: '2026-08-23', endDate: '2026-08-29' }),
    event({ id: 'mid', startDate: '2026-08-25', endDate: '2026-08-26' }),
    event({ id: 'overlap', startDate: '2026-08-25', endDate: '2026-08-27' }),
  ];

  const bars = layoutEventBars(events, WEEK);
  const byId = new Map(bars.map((bar) => [bar.event.id, bar]));

  assert.deepEqual(
    [byId.get('week-long')?.startCol, byId.get('week-long')?.span],
    [0, 7],
    '한 주 전체 일정은 0번 칸에서 7칸',
  );
  assert.deepEqual([byId.get('mid')?.startCol, byId.get('mid')?.span], [2, 2]);
  assert.deepEqual([byId.get('overlap')?.startCol, byId.get('overlap')?.span], [2, 3]);
  assert.notEqual(
    byId.get('mid')?.row,
    byId.get('overlap')?.row,
    '겹치는 일정은 다른 줄에 쌓는다',
  );
});

test('layoutEventBars — 보이는 날짜가 없으면 빈 결과', () => {
  assert.deepEqual(layoutEventBars([event({ id: 'x', startDate: '2026-08-25', endDate: '2026-08-25' })], []), []);
});
