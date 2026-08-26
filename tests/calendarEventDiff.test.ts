import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEventSnapshot, diffEventSnapshots } from '../src/utils/calendarEventDiff.ts';

const ev = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: '회의', startDate: '2026-08-26', endDate: '2026-08-26',
  startTime: '14:00', endTime: '15:00', allDay: false,
  calendarId: 'cal-1', tagId: null, source: 'bflow', sourceCalendarId: 'bflow:cal-1',
  ...over,
});

test('변경 없음 → added/changed 모두 빈 배열', () => {
  const a = buildEventSnapshot([ev('e1')] as never);
  const b = buildEventSnapshot([ev('e1')] as never);
  assert.deepEqual(diffEventSnapshots(a, b), { added: [], changed: [] });
});

test('시각 변경 → changed에 identity 키', () => {
  const a = buildEventSnapshot([ev('e1')] as never);
  const b = buildEventSnapshot([ev('e1', { startTime: '15:00', endTime: '16:00' })] as never);
  const d = diffEventSnapshots(a, b);
  assert.equal(d.changed.length, 1);
  assert.equal(d.added.length, 0);
});

test('신규 이벤트 → added', () => {
  const a = buildEventSnapshot([ev('e1')] as never);
  const b = buildEventSnapshot([ev('e1'), ev('e2')] as never);
  const d = diffEventSnapshots(a, b);
  assert.equal(d.added.length, 1);
});

test('삭제는 무시(하이라이트 대상 아님)', () => {
  const a = buildEventSnapshot([ev('e1'), ev('e2')] as never);
  const b = buildEventSnapshot([ev('e1')] as never);
  assert.deepEqual(diffEventSnapshots(a, b), { added: [], changed: [] });
});
