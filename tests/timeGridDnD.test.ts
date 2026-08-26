import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';

type TimeGridDnDModule = {
  TIME_GRID_DRAG_EDGE: number;
  getTimeGridPointerMinutes(clientY: number, rect: { top: number }, hourPx?: number): number;
  getTimeGridCreateRange(startMinutes: number, currentMinutes: number): { startTime: string; endTime: string };
  getTimeGridEventPatch(
    mode: 'move' | 'resize-end',
    original: { startDate: string; endDate: string; startTime: string; endTime: string },
    targetDate: string,
    targetMinutes: number,
  ): { startDate: string; endDate: string; startTime: string; endTime: string };
  shouldStartTimeGridDrag(start: { x: number; y: number }, current: { x: number; y: number }): boolean;
  shouldSuppressTimeGridClick(dragFinishedAt: number, now: number): boolean;
  getTimeGridAutoScrollSpeed(clientY: number, rect: { top: number; bottom: number }): number;
  getTimeGridEventDragMode(isReadOnly: boolean, clientY: number, rectBottom: number): 'move' | 'resize-end' | null;
  getTimeGridDragCompletion(
    state: { mode: 'create' | 'move' | 'resize-end'; hasCrossedThreshold: boolean; eventId?: string; identity?: { id: string; source?: 'bflow' | 'google' | 'vacation'; sourceCalendarId?: string } } | null,
    preview: { startDate: string; endDate: string; startTime: string; endTime: string } | null,
    cancelled?: boolean,
  ): unknown;
};

async function loadTimeGridDnD(): Promise<TimeGridDnDModule> {
  const result = await build({
    entryPoints: ['src/hooks/useTimeGridDnD.ts'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    write: false,
    external: ['react'],
  });
  const module = { exports: {} as Record<string, unknown> };
  const nodeRequire = createRequire(import.meta.url);
  const evaluate = new Function('require', 'module', 'exports', result.outputFiles[0].text);
  evaluate((id: string) => id === 'react' ? nodeRequire('react') : nodeRequire(id), module, module.exports);
  return module.exports as unknown as TimeGridDnDModule;
}

test('useTimeGridDnD: 포인터 좌표를 15분 단위로 스냅하고 새 일정은 최소 15분을 유지한다', async () => {
  const dnd = await loadTimeGridDnD();

  assert.equal(dnd.getTimeGridPointerMinutes(114, { top: 100 }), 15);
  assert.equal(dnd.getTimeGridPointerMinutes(155, { top: 100 }), 60);
  assert.deepEqual(dnd.getTimeGridCreateRange(600, 600), { startTime: '10:00', endTime: '10:15' });
  assert.deepEqual(dnd.getTimeGridCreateRange(600, 570), { startTime: '09:30', endTime: '10:00' });
});

test('useTimeGridDnD: 이동과 하단 리사이즈는 날짜·시간 patch를 서로 다르게 만든다', async () => {
  const dnd = await loadTimeGridDnD();
  const original = {
    startDate: '2026-08-24', endDate: '2026-08-24', startTime: '09:00', endTime: '10:00',
  };

  assert.deepEqual(
    dnd.getTimeGridEventPatch('move', original, '2026-08-26', 615),
    { startDate: '2026-08-26', endDate: '2026-08-26', startTime: '10:15', endTime: '11:15' },
  );
  assert.deepEqual(
    dnd.getTimeGridEventPatch('resize-end', original, '2026-08-26', 555),
    { startDate: '2026-08-24', endDate: '2026-08-26', startTime: '09:00', endTime: '09:15' },
  );
});

test('useTimeGridDnD: 5px 미만 클릭은 드래그·사후 클릭 억제를 시작하지 않는다', async () => {
  const dnd = await loadTimeGridDnD();

  assert.equal(dnd.shouldStartTimeGridDrag({ x: 10, y: 10 }, { x: 13, y: 13 }), false);
  assert.equal(dnd.shouldStartTimeGridDrag({ x: 10, y: 10 }, { x: 15, y: 10 }), true);
  assert.equal(dnd.shouldSuppressTimeGridClick(100, 120), true);
  assert.equal(dnd.shouldSuppressTimeGridClick(100, 500), false);
});

test('useTimeGridDnD: 하단 8px만 종료 리사이즈이고 읽기 전용·Escape는 완료 payload를 만들지 않는다', async () => {
  const dnd = await loadTimeGridDnD();
  const preview = { startDate: '2026-08-24', endDate: '2026-08-24', startTime: '09:00', endTime: '10:00' };

  assert.equal(dnd.getTimeGridEventDragMode(false, 191, 200), 'move');
  assert.equal(dnd.getTimeGridEventDragMode(false, 192, 200), 'resize-end');
  assert.equal(dnd.getTimeGridEventDragMode(true, 199, 200), null);
  assert.equal(dnd.getTimeGridDragCompletion({ mode: 'create', hasCrossedThreshold: true }, preview, true), null);
  assert.equal(dnd.getTimeGridDragCompletion({ mode: 'move', hasCrossedThreshold: false }, preview), null);
  assert.deepEqual(
    dnd.getTimeGridDragCompletion({
      mode: 'move', hasCrossedThreshold: true, eventId: 'same-id', identity: { id: 'same-id', source: 'google', sourceCalendarId: 'team-a' },
    }, preview),
    {
      type: 'event-change',
      eventId: 'same-id',
      identity: { id: 'same-id', source: 'google', sourceCalendarId: 'team-a' },
      patch: preview,
    },
  );
});

test('useTimeGridDnD: 전용 16ms 스크롤은 edge=40에서만 가장자리 속도를 계산한다', async () => {
  const dnd = await loadTimeGridDnD();

  assert.equal(dnd.TIME_GRID_DRAG_EDGE, 40);
  assert.equal(dnd.getTimeGridAutoScrollSpeed(500, { top: 100, bottom: 900 }), 0);
  assert.ok(dnd.getTimeGridAutoScrollSpeed(110, { top: 100, bottom: 900 }) < 0);
  assert.ok(dnd.getTimeGridAutoScrollSpeed(890, { top: 100, bottom: 900 }) > 0);
});
