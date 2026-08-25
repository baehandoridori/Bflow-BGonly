import test from 'node:test';
import assert from 'node:assert/strict';
import { mapVacationEvents } from '../src/utils/vacationEvents.ts';
import { VACATION_COLOR } from '../src/types/vacation.ts';
import {
  WEEKDAYS, WEEKDAY_SHORT, fmtDate, parseDate, addDays, daysBetween,
  hexToRgba, getISOWeekNumber,
} from '../src/utils/calendarDate.ts';

test('fmtDate/parseDate — 왕복·패딩·정오 정규화', () => {
  assert.equal(fmtDate(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(fmtDate(parseDate('2026-08-24')), '2026-08-24');
  assert.equal(fmtDate(parseDate('2026-12-01')), '2026-12-01');
  assert.equal(parseDate('2026-02-01').getHours(), 12); // 기존 관례: 정오 정규화(경계 오차 방지)
});

test('addDays — 월/년/윤년 경계', () => {
  assert.equal(fmtDate(addDays(parseDate('2026-01-31'), 1)), '2026-02-01');
  assert.equal(fmtDate(addDays(parseDate('2026-12-31'), 1)), '2027-01-01');
  assert.equal(fmtDate(addDays(parseDate('2026-03-01'), -1)), '2026-02-28');
  assert.equal(fmtDate(addDays(parseDate('2028-02-28'), 1)), '2028-02-29');
});

test('daysBetween — 부호 포함 일수 차 (b - a)', () => {
  assert.equal(daysBetween('2026-08-01', '2026-08-24'), 23);
  assert.equal(daysBetween('2026-08-24', '2026-08-01'), -23);
  assert.equal(daysBetween('2026-08-24', '2026-08-24'), 0);
  assert.equal(daysBetween('2026-01-31', '2026-02-01'), 1);
});

test('hexToRgba', () => {
  assert.equal(hexToRgba('#6C5CE7', 0.22), 'rgba(108,92,231,0.22)');
  assert.equal(hexToRgba('#00B894', 1), 'rgba(0,184,148,1)');
});

test('요일 배열', () => {
  assert.equal(WEEKDAYS.length, 7);
  assert.equal(WEEKDAYS[0], '일');
  assert.equal(WEEKDAYS[6], '토');
  assert.deepEqual(WEEKDAY_SHORT, WEEKDAYS);
});

test('getISOWeekNumber — 알려진 값', () => {
  assert.equal(getISOWeekNumber(new Date(2026, 0, 1)), 1);    // 2026-01-01 목 → 1주
  assert.equal(getISOWeekNumber(new Date(2026, 11, 31)), 53); // 2026 은 ISO 53주 해
  assert.equal(getISOWeekNumber(new Date(2025, 11, 29)), 1);  // 2025-12-29 월 → 2026년 1주차에 속함
  // 1/1 이 금요일인 해: 구 WeekScrollView 구현은 2 를 반환하던 케이스(정오 시프트 오차). ISO 정답은 1.
  assert.equal(getISOWeekNumber(new Date(2027, 0, 7)), 1);
});

test('getISOWeekNumber — 구 WeekScrollView 알고리즘과 2025~2026 전 구간 일치 (표시 불변 증명)', () => {
  // 구 구현 사본 (src/components/calendar/WeekScrollView.tsx:36-43 에서 그대로 복사)
  function oldWsvImpl(d: Date): number {
    const date = new Date(d.getTime());
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
    const yearStart = new Date(date.getFullYear(), 0, 1);
    return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  }
  for (let d = new Date(2025, 0, 1, 12); d.getFullYear() <= 2026; d.setDate(d.getDate() + 1)) {
    assert.equal(getISOWeekNumber(d), oldWsvImpl(d), `주차 불일치: ${fmtDate(d)}`);
  }
});

test('mapVacationEvents — 접두별 ID·읽기전용·필드 매핑', () => {
  const raw = [
    { name: '배한솔', type: '연차', startDate: '2026-09-01', endDate: '2026-09-02' },
    { name: '허혜원', type: '오전반차', startDate: '2026-09-03', endDate: '2026-09-03' },
  ];
  for (const prefix of ['vac', 'wvac', 'gvac'] as const) {
    const mapped = mapVacationEvents(raw, prefix);
    assert.equal(mapped.length, 2);
    assert.equal(mapped[0].id, `${prefix}-배한솔-2026-09-01-0`);
    assert.equal(mapped[1].id, `${prefix}-허혜원-2026-09-03-1`);
  }
  const [a] = mapVacationEvents(raw, 'vac');
  assert.equal(a.title, '배한솔 연차');
  assert.equal(a.memo, '');
  assert.equal(a.color, VACATION_COLOR);
  assert.equal(a.type, 'vacation');
  assert.equal(a.source, 'vacation');
  assert.equal(a.startDate, '2026-09-01');
  assert.equal(a.endDate, '2026-09-02');
  assert.equal(a.createdBy, '배한솔');
  assert.equal(a.vacationType, '연차');
  assert.equal(a.vacationUserName, '배한솔');
  assert.equal(a.isReadOnly, true);
});
