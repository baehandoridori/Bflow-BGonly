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
    anchorMinutes?: number,
  ): { startDate: string; endDate: string; startTime: string; endTime: string };
  getTimeGridFallbackEndTime(startTime?: string, endTime?: string): string;
  shouldStartTimeGridDrag(start: { x: number; y: number }, current: { x: number; y: number }): boolean;
  shouldSuppressTimeGridClick(dragFinishedAt: number, now: number): boolean;
  getTimeGridAutoScrollSpeed(clientY: number, rect: { top: number; bottom: number }): number;
  getTimeGridEventDragMode(isReadOnly: boolean, clientY: number, rectBottom: number): 'move' | 'resize-end' | null;
  getTimeGridDragCompletion(
    state: { mode: 'create' | 'move' | 'resize-end'; hasCrossedThreshold: boolean; eventId?: string; identity?: { id: string; source?: 'bflow' | 'google' | 'vacation'; sourceCalendarId?: string }; original?: { startDate: string; endDate: string; startTime: string; endTime: string } } | null,
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

test('useTimeGridDnD: 15분보다 짧은 외부 일정도 이동하면 원래의 양수 길이를 유지한다', async () => {
  const dnd = await loadTimeGridDnD();
  const importedShortEvent = {
    startDate: '2026-08-24', endDate: '2026-08-24', startTime: '09:00', endTime: '09:10',
  };

  assert.deepEqual(
    dnd.getTimeGridEventPatch('move', importedShortEvent, '2026-08-26', 600),
    { startDate: '2026-08-26', endDate: '2026-08-26', startTime: '10:00', endTime: '10:10' },
    '이동은 생성·리사이즈와 달리 기존 일정의 길이를 늘리지 않는다',
  );
});

test('useTimeGridDnD: 여러 날짜 리사이즈는 날짜를 먼저 비교하고 같은 날에만 최소 길이를 보정한다', async () => {
  const dnd = await loadTimeGridDnD();
  const afternoon = {
    startDate: '2026-08-24', endDate: '2026-08-24', startTime: '15:00', endTime: '16:00',
  };

  assert.deepEqual(
    dnd.getTimeGridEventPatch('resize-end', afternoon, '2026-08-25', 600),
    { startDate: '2026-08-24', endDate: '2026-08-25', startTime: '15:00', endTime: '10:00' },
    '다음 날의 이른 시각은 유효한 종료 시각이다',
  );
  assert.deepEqual(
    dnd.getTimeGridEventPatch('resize-end', {
      ...afternoon,
      startTime: '23:45',
      endTime: '23:59',
    }, '2026-08-25', 0),
    { startDate: '2026-08-24', endDate: '2026-08-25', startTime: '23:45', endTime: '00:00' },
    '월요일 23:45에서 화요일 자정까지의 경계를 보존한다',
  );
  assert.deepEqual(
    dnd.getTimeGridEventPatch('resize-end', afternoon, '2026-08-24', 600),
    { startDate: '2026-08-24', endDate: '2026-08-24', startTime: '15:00', endTime: '15:15' },
    '같은 날 시작 이전으로 줄이면 최소 15분을 유지한다',
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

test('useTimeGridDnD: 임계를 넘겼어도 원위치 드롭이면 완료를 만들지 않는다', async () => {
  const dnd = await loadTimeGridDnD();
  const original = { startDate: '2026-09-01', endDate: '2026-09-01', startTime: '14:00', endTime: '15:00' };

  assert.equal(
    dnd.getTimeGridDragCompletion(
      { mode: 'move', hasCrossedThreshold: true, eventId: 'e1', identity: { id: 'e1' }, original },
      { ...original },
    ),
    null,
    '아무것도 바뀌지 않았으면 저장·알림을 만들지 않는다',
  );
});

test('useTimeGridDnD: 한 슬롯이라도 움직였으면 완료를 만든다', async () => {
  const dnd = await loadTimeGridDnD();
  const original = { startDate: '2026-09-01', endDate: '2026-09-01', startTime: '14:00', endTime: '15:00' };

  assert.notEqual(
    dnd.getTimeGridDragCompletion(
      { mode: 'move', hasCrossedThreshold: true, eventId: 'e1', identity: { id: 'e1' }, original },
      { ...original, startTime: '14:15' },
    ),
    null,
  );
});

test('useTimeGridDnD: 전용 16ms 스크롤은 edge=40에서만 가장자리 속도를 계산한다', async () => {
  const dnd = await loadTimeGridDnD();

  assert.equal(dnd.TIME_GRID_DRAG_EDGE, 40);
  assert.equal(dnd.getTimeGridAutoScrollSpeed(500, { top: 100, bottom: 900 }), 0);
  assert.ok(dnd.getTimeGridAutoScrollSpeed(110, { top: 100, bottom: 900 }) < 0);
  assert.ok(dnd.getTimeGridAutoScrollSpeed(890, { top: 100, bottom: 900 }) > 0);
});

test('useTimeGridDnD: 하루 끝 스냅은 create를 자정으로 넘기고 move·resize도 다음 날짜로 보낸다', async () => {
  const dnd = await loadTimeGridDnD();
  const late = {
    startDate: '2026-08-24', endDate: '2026-08-24', startTime: '23:45', endTime: '23:59',
  };

  assert.deepEqual(dnd.getTimeGridCreateRange(1410, 1440), { startTime: '23:30', endTime: '00:00' });
  assert.deepEqual(dnd.getTimeGridCreateRange(1425, 1425), { startTime: '23:45', endTime: '00:00' });
  assert.deepEqual(
    dnd.getTimeGridEventPatch('move', { ...late, startTime: '23:00', endTime: '23:30' }, '2026-08-24', 1440),
    { startDate: '2026-08-25', endDate: '2026-08-25', startTime: '00:00', endTime: '00:30' },
  );
  assert.deepEqual(
    dnd.getTimeGridEventPatch('resize-end', late, '2026-08-24', 1440),
    { startDate: '2026-08-24', endDate: '2026-08-25', startTime: '23:45', endTime: '00:00' },
  );
});

test('useTimeGridDnD: 종료 시각이 비어 있으면 시간표와 같은 1시간 기본값으로 이동한다', async () => {
  const dnd = await loadTimeGridDnD();

  assert.equal(dnd.getTimeGridFallbackEndTime('14:00', undefined), '15:00');
  assert.equal(dnd.getTimeGridFallbackEndTime('14:00', '14:30'), '14:30');
  assert.equal(dnd.getTimeGridFallbackEndTime(undefined, undefined), '01:00');
  assert.equal(
    dnd.getTimeGridFallbackEndTime('23:30', undefined),
    '24:00',
    '자정에 닿는 기본 종료도 시작보다 뒤여야 길이가 음수가 되지 않는다',
  );

  const original = {
    startDate: '2026-08-24',
    endDate: '2026-08-24',
    startTime: '14:00',
    endTime: dnd.getTimeGridFallbackEndTime('14:00', undefined),
  };
  assert.deepEqual(
    dnd.getTimeGridEventPatch('move', original, '2026-08-25', 600, 840),
    { startDate: '2026-08-25', endDate: '2026-08-25', startTime: '10:00', endTime: '11:00' },
  );
});
