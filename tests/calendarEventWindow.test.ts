import assert from 'node:assert/strict';
import test from 'node:test';
import { scheduleEventWindow, widgetEventWindow, readCalendarWindowWithToday } from '../src/utils/calendarEventWindow.ts';
test('navigation windows include remote year and adjacent month cells', () => {
  assert.deepEqual(scheduleEventWindow('month', 2040, 0), { from: '2040-01-01', to: '2040-02-11' });
  assert.deepEqual(scheduleEventWindow('month', 2040, 1), { from: '2040-01-29', to: '2040-03-10' });
  assert.deepEqual(scheduleEventWindow('week', 2040, 0), { from: '2039-12-25', to: '2041-01-07' });
});
test('a remote widget month retains today details and deduplicates spanning events', async () => {
  const calls: unknown[] = [];
  const read = async (range: { from: string; to: string }) => { calls.push(range); return range.from === '2026-09-20' ? [{ id: 'today' }, { id: 'long' }] : [{ id: 'future' }, { id: 'long' }]; };
  const result = await readCalendarWindowWithToday(read, { from: '2040-01-01', to: '2040-02-11' }, '2026-09-20', row => row.id);
  assert.deepEqual(result.map(row => row.id), ['future', 'long', 'today']); assert.equal(calls.length, 2);
  calls.length = 0;
  await readCalendarWindowWithToday(read, { from: '2026-09-01', to: '2026-10-12' }, '2026-09-20', row => row.id); assert.equal(calls.length, 1);
});
test('widget windows follow carousel offsets and include surrounding dimmed rows', () => {
  assert.deepEqual(widgetEventWindow('today', 2026, 8, 0, 4000, '2026-09-20'), { from: '2037-09-01', to: '2037-09-03' });
  assert.deepEqual(widgetEventWindow('week', 2026, 8, 1, 0, '2026-09-20'), { from: '2026-09-13', to: '2026-10-17' });
  assert.deepEqual(widgetEventWindow('2week', 2026, 8, 1, 0, '2026-09-20'), { from: '2026-09-27', to: '2026-10-31' });
});
