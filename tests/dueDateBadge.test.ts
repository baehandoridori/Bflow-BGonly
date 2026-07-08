import test from 'node:test';
import assert from 'node:assert/strict';
import { describeDueDate } from '../src/utils/dueDateBadge.ts';

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
