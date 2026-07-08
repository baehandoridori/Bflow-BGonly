import test from 'node:test';
import assert from 'node:assert/strict';
import { describeDueDate, todayLocalISO } from '../src/utils/dueDateBadge.ts';

const TODAY = '2026-07-08';

test('마감일 배지 — 남은 일수별 라벨/톤', () => {
  assert.equal(describeDueDate(null, TODAY), null);
  assert.equal(describeDueDate(undefined, TODAY), null);
  assert.deepEqual(describeDueDate('2026-07-06', TODAY), { label: '2일 지남', tone: 'overdue', days: -2 });
  assert.deepEqual(describeDueDate('2026-07-08', TODAY), { label: '오늘 마감', tone: 'today', days: 0 });
  assert.deepEqual(describeDueDate('2026-07-10', TODAY), { label: 'D-2', tone: 'soon', days: 2 });
  assert.deepEqual(describeDueDate('2026-07-11', TODAY), { label: 'D-3', tone: 'soon', days: 3 });
  assert.deepEqual(describeDueDate('2026-07-20', TODAY), { label: '07/20', tone: 'normal', days: 12 });
});

test('마감일 배지 — 파싱 실패는 null', () => {
  assert.equal(describeDueDate('not-a-date', TODAY), null);
  assert.equal(describeDueDate('2026-07-10', 'bad'), null);
});

test('todayLocalISO — UTC 아닌 로컬 달력 날짜(코덱스 P2 수정)', () => {
  // 로컬 시각 기준 연/월/일 조합 — 새벽 시각에도 로컬 날짜가 나온다(UTC로 밀리지 않음).
  assert.equal(todayLocalISO(new Date(2026, 6, 8, 2, 30)), '2026-07-08'); // month 6 = 7월
  assert.equal(todayLocalISO(new Date(2026, 0, 1, 23, 59)), '2026-01-01');
  assert.equal(todayLocalISO(new Date(2026, 11, 31, 0, 0)), '2026-12-31');
});
