import test from 'node:test';
import assert from 'node:assert/strict';
import { barGeometry, rebaseScroll, zoomScroll } from '../src/features/gantt/geometry.ts';
import type { GanttTask } from '../src/features/gantt/types.ts';

type Bounds = Pick<GanttTask, 'startDate' | 'endDate' | 'startTime' | 'endTime' | 'allDay'>;
const range = (startDate: string, endDate = startDate, extra: Partial<Bounds> = {}): Bounds => ({ startDate, endDate, allDay: true, startTime: '', endTime: '', ...extra });
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} should equal ${expected}`);

test('all-day geometry includes weekends and month-end date with three-pixel end insets', () => {
  const result = barGeometry(range('2026-09-30', '2026-10-03'), 'task', '2026-09-28', 48);
  assert.equal(result.left, 99);
  assert.equal(result.left + result.width, 285); // End of October 3, minus three pixels.
  assert.equal(result.width, 4 * 48 - 6);
  assert.deepEqual(barGeometry(range('2026-12-31', '2027-01-01'), 'group', '2026-12-31', 48), { left: 3, width: 90 });
});

test('timed geometry uses exact fractions across midnight and month boundaries', () => {
  const timed = range('2026-09-30', '2026-10-01', { allDay: false, startTime: '22:30', endTime: '02:15' });
  const result = barGeometry(timed, 'task', '2026-09-30', 240);
  near(result.left, 228);
  near(result.width, 37.5);
});

test('group and project bounds align with a timed child using the same coordinate contract', () => {
  const timed = range('2026-09-04', '2026-09-04', { allDay: false, startTime: '10:00', endTime: '11:30' });
  const child = barGeometry(timed, 'task', '2026-09-01', 480);
  assert.deepEqual(barGeometry(timed, 'group', '2026-09-01', 480), child);
  assert.deepEqual(barGeometry(timed, 'project', '2026-09-01', 480), child);
  near(child.left, 1643);
  near(child.width, 30);
});

test('short timed bars remain visible without shifting their start time', () => {
  const result = barGeometry(range('2026-09-04', '2026-09-04', { allDay: false, startTime: '10:00', endTime: '10:01' }), 'task', '2026-09-04', 48);
  assert.deepEqual(result, { left: 23, width: 6 });
});

test('milestones stay twelve pixels wide and honor either date-only or timed start positions', () => {
  assert.deepEqual(barGeometry(range('2026-10-01'), 'milestone', '2026-09-30', 48), { left: 51, width: 12 });
  assert.deepEqual(barGeometry(range('2026-10-01', '2026-10-01', { allDay: false, startTime: '12:00', endTime: '12:00' }), 'milestone', '2026-09-30', 48), { left: 75, width: 12 });
});

test('rebasing after toggling an earlier project keeps an already visible date fixed', () => {
  const before = barGeometry(range('2026-10-10'), 'task', '2026-09-01', 48);
  const after = barGeometry(range('2026-10-10'), 'task', '2026-10-01', 48);
  const originalScroll = 1500;
  const newScroll = rebaseScroll('2026-09-01', '2026-10-01', originalScroll, 48);
  near(before.left - originalScroll, after.left - newScroll);
  near(rebaseScroll('2026-10-01', '2026-09-01', newScroll, 48), originalScroll);
});

test('rebasing clamps only when the old visible date is before the new axis boundary', () => {
  assert.equal(rebaseScroll('2026-09-01', '2026-09-04', 48, 48), 0);
  assert.equal(rebaseScroll('2026-09-04', '2026-09-01', 0, 48), 144);
});

test('zoom keeps the cursor date fixed with either inline names or a sticky label column', () => {
  for (const labelWidth of [0, 280]) {
    const pointerX = 400, originalScroll = 510, anchor = pointerX - labelWidth;
    const next = zoomScroll(48, 133, originalScroll, pointerX, labelWidth);
    near((originalScroll + anchor) / 48, (next + anchor) / 133);
    near(zoomScroll(133, 48, next, pointerX, labelWidth), originalScroll);
  }
});

test('zoom over the sticky labels anchors the first visible date and never scrolls negative', () => {
  assert.equal(zoomScroll(48, 96, 480, 50, 280), 960);
  assert.equal(zoomScroll(96, 12, 0, 400, 280), 0);
});
