import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

type CalendarEvent = {
  id: string;
  title: string;
  memo: string;
  color: string;
  type: 'custom';
  startDate: string;
  endDate: string;
  createdBy: string;
  createdAt: string;
  allDay?: boolean;
  startTime?: string;
  endTime?: string;
  tagId?: string;
  calendarId?: string;
  source?: 'bflow' | 'google' | 'vacation';
};

type WeekTimeGridModule = {
  splitWeekTimeGridEvents(events: CalendarEvent[]): {
    allDayEvents: CalendarEvent[];
    timedEventsByDate: Map<string, CalendarEvent[]>;
  };
  default(props: {
    weekDays: Date[];
    events: CalendarEvent[];
    today: string;
    onEventClick(event: CalendarEvent): void;
    onSlotClick(date: string, startTime: string, endTime: string): void;
    tagNameById: Record<string, string>;
    calendarNameById: Record<string, string>;
    activeWeekIndex: number;
    weekCount: number;
    onWeekChange(nextIndex: number): void;
  onEventContextMenu?(event: CalendarEvent, mouse: unknown): void;
  timeGridDragPreview?: {
    mode: 'create' | 'move' | 'resize-end';
    startDate: string;
    endDate: string;
    startTime: string;
    endTime: string;
    eventId?: string;
    identityKey?: string;
  } | null;
  }): ReactNode;
  resolveBandExpanded(
    hasTimedBlocks: boolean,
    userChoice: boolean | null,
    nowMin: number,
    bandStartMin: number,
    bandEndMin: number,
    includesToday: boolean,
  ): boolean;
  getTimeSlots(startMin: number, endMin: number): Array<{ startMin: number; endMin: number }>;
  getAllDayBarLabel(bar: {
    event: CalendarEvent;
    isStart: boolean;
    isEnd: boolean;
  }, tagNameById?: Record<string, string>, calendarNameById?: Record<string, string>): string;
  getTimeGridToday(now: Date, dateStrings: string[]): { today: string; todayIndex: number };
  getCurrentTimeMarker(nowMin: number, bandStartMin: number, bandEndMin: number, todayIndex: number): {
    top: number;
    label: string;
    todayIndex: number;
  } | null;
  getTimedBlockVisualStyle(color: string): {
    background: string;
    borderLeft: string;
    titleColor: string;
    titleFontSize: number;
    timeColor: string;
  };
  getTimedBlockStateStyle(color: string, isCurrent: boolean): {
    outline?: string;
    outlineOffset?: number;
    boxShadow?: string;
  };
  getTimedBlockOpacity(isPast: boolean): number;
  getAllDayBarStyle(color: string): {
    background: string;
    borderLeft: string;
    color: string;
  };
  formatKoreanHour(min: number): string;
  getCollapsedBandLabel(label: string, startMin: number, endMin: number): string;
  getNextWeekIndex(activeWeekIndex: number, weekCount: number, delta: -1 | 1): number;
  requestWeekChangeFromWheel(
    event: { shiftKey: boolean; deltaY: number; deltaX: number; preventDefault(): void },
    activeWeekIndex: number,
    weekCount: number,
    onWeekChange: (nextIndex: number) => void,
    gestureLock?: { current: ReturnType<typeof setTimeout> | null },
  ): boolean;
  clearWeekWheelGestureLock(gestureLock: { current: ReturnType<typeof setTimeout> | null }): void;
  getNonTodayCurrentLineStyle(): { background: string; height: number };
  getWeekendCellStyle(isWeekend: boolean): { backgroundImage?: string };
};

async function loadWeekTimeGridView(): Promise<WeekTimeGridModule> {
  const result = await build({
    entryPoints: ['src/components/calendar/WeekTimeGridView.tsx'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    write: false,
    external: [
      'react', 'react/jsx-runtime', 'framer-motion',
      '@/components/calendar/CalendarGrid', '@/hooks/useMotionPref',
    ],
  });
  const module = { exports: {} as Record<string, unknown> };
  const nodeRequire = createRequire(import.meta.url);
  const evaluate = new Function('require', 'module', 'exports', result.outputFiles[0].text);
  evaluate((id: string) => {
    if (id === 'react') return nodeRequire('react');
    if (id === 'react/jsx-runtime') return nodeRequire('react/jsx-runtime');
    if (id === 'framer-motion') return { motion: { button: 'button', div: 'div' } };
    if (id === '@/components/calendar/CalendarGrid') {
      return {
        layoutEventBars: (events: CalendarEvent[]) => events.map((item, index) => ({
          event: item,
          row: index,
          startCol: 0,
          span: 1,
          isStart: true,
          isEnd: true,
        })),
      };
    }
    if (id === '@/hooks/useMotionPref') return { useMotionPref: () => ({ reduce: false }) };
    return nodeRequire(id);
  }, module, module.exports);
  return module.exports as unknown as WeekTimeGridModule;
}

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'event',
    title: '일정',
    memo: '',
    color: '#6C5CE7',
    type: 'custom',
    startDate: '2026-08-23',
    endDate: '2026-08-23',
    createdBy: 'user',
    createdAt: '2026-08-20T00:00:00.000Z',
    allDay: false,
    startTime: '09:00',
    endTime: '10:00',
    ...overrides,
  };
}

test('WeekTimeGridView: 종일과 날짜를 넘는 일정은 종일 레인으로, 당일 시간 일정만 시간 그리드로 분리한다', async () => {
  const { splitWeekTimeGridEvents } = await loadWeekTimeGridView();
  const groups = splitWeekTimeGridEvents([
    event({ id: 'all-day', allDay: true }),
    event({ id: 'timed', startDate: '2026-08-24', endDate: '2026-08-24' }),
    event({ id: 'multiday-timed', startDate: '2026-08-25', endDate: '2026-08-26' }),
  ]);

  assert.deepEqual(groups.allDayEvents.map((item) => item.id), ['all-day', 'multiday-timed']);
  assert.deepEqual(groups.timedEventsByDate.get('2026-08-24')?.map((item) => item.id), ['timed']);
  assert.equal(groups.timedEventsByDate.has('2026-08-25'), false);
});

test('WeekTimeGridView: 새벽·저녁 일정은 처음에는 펼치되 사용자의 접기 선택을 우선한다', async () => {
  const { resolveBandExpanded } = await loadWeekTimeGridView();

  assert.equal(resolveBandExpanded(true, null, 600, 0, 540, true), true, '시간 일정이 있으면 최초 기본값은 펼침이다');
  assert.equal(resolveBandExpanded(false, null, 300, 0, 540, true), true, '현재 시각이 새벽 밴드면 일정이 없어도 최초 기본값은 펼침이다');
  assert.equal(resolveBandExpanded(false, false, 300, 0, 540, true), false, '사용자가 접으면 현재 시각이 있어도 접힘을 유지한다');
  assert.equal(resolveBandExpanded(false, null, 540, 0, 540, true), false, '09:00 경계는 다음 밴드에만 속한다');
  assert.equal(resolveBandExpanded(false, true, 600, 0, 540, true), true, '사용자가 펼친 빈 밴드는 열린 상태를 유지한다');
});

test('WeekTimeGridView: 시간 슬롯은 30분 단위 종료 시간을 사용한다', async () => {
  const { getTimeSlots } = await loadWeekTimeGridView();

  assert.deepEqual(getTimeSlots(9 * 60, 10 * 60), [
    { startMin: 540, endMin: 570 },
    { startMin: 570, endMin: 600 },
  ]);
});

test('WeekTimeGridView: 밴드별로 잘라 배치해 새벽 충돌 뒤 본 시간대 조각을 전폭으로 그린다', async () => {
  const module = await loadWeekTimeGridView();
  const markup = renderToStaticMarkup(createElement(module.default, {
    weekDays: Array.from({ length: 7 }, (_, index) => new Date(2026, 7, 23 + index, 12)),
    events: [
      event({ id: 'cross-band', title: '경계 일정', startDate: '2026-08-25', endDate: '2026-08-25', startTime: '08:00', endTime: '10:00' }),
      event({ id: 'dawn-only', title: '새벽 겹침', startDate: '2026-08-25', endDate: '2026-08-25', startTime: '08:30', endTime: '09:00' }),
    ],
    today: '2026-01-01',
    onEventClick() {},
    onSlotClick() {},
    tagNameById: {},
    calendarNameById: {},
    activeWeekIndex: 0,
    weekCount: 4,
    onWeekChange() {},
  }));

  assert.match(
    markup,
    /<button[^>]*style="top:0(?:px)?;height:56px;left:calc\(0% \+ 2px\);width:calc\(100% - 4px\);[^"]*"[^>]*><span[^>]*>08:00 – 10:00<\/span><span[^>]*>경계 일정<\/span><\/button>/,
  );
});

test('WeekTimeGridView: 연속 10분 일정은 실제 9.33px hitbox 안에만 그려져 겹치지 않는다', async () => {
  const module = await loadWeekTimeGridView();
  const markup = renderToStaticMarkup(createElement(module.default, {
    weekDays: Array.from({ length: 7 }, (_, index) => new Date(2026, 7, 23 + index, 12)),
    events: [
      event({ id: 'short-first', title: '첫 10분', startDate: '2026-08-25', endDate: '2026-08-25', startTime: '09:00', endTime: '09:10' }),
      event({ id: 'short-second', title: '둘째 10분', startDate: '2026-08-25', endDate: '2026-08-25', startTime: '09:10', endTime: '09:20' }),
    ],
    today: '2026-01-01',
    onEventClick() {},
    onSlotClick() {},
    tagNameById: {},
    calendarNameById: {},
    activeWeekIndex: 0,
    weekCount: 4,
    onWeekChange() {},
  }));
  const hitboxFor = (title: string) => {
    const match = markup.match(new RegExp(`<button[^>]*aria-label="${title}, 2026-08-25 [^"]*"[^>]*style="([^"]*)"`));
    assert.ok(match, `${title} 버튼을 찾을 수 있어야 한다`);
    const top = match[1].match(/top:([\d.]+)(?:px)?/);
    const height = match[1].match(/height:([\d.]+)px/);
    assert.ok(top && height, `${title}의 hitbox top/height가 있어야 한다`);
    return { top: Number(top[1]), height: Number(height[1]) };
  };

  const first = hitboxFor('첫 10분');
  const second = hitboxFor('둘째 10분');
  const tenMinutesPx = 56 / 6;
  const precision = 0.001;
  assert.equal(first.top, 0);
  assert.ok(Math.abs(first.height - tenMinutesPx) < precision);
  assert.ok(Math.abs(second.top - tenMinutesPx) < precision);
  assert.ok(Math.abs(second.height - tenMinutesPx) < precision);
  assert.ok(first.top + first.height <= second.top + precision, '첫 블록 hitbox가 둘째 블록 영역을 침범하지 않는다');
  assert.match(markup, /aria-label="첫 10분, 2026-08-25 09:00부터 09:10까지"/);
  assert.doesNotMatch(markup, /data-time-grid-title="true"[^>]*>첫 10분<\/span>/, '읽을 수 없는 짧은 블록의 제목은 시각적으로 자르지 않는다');
});

test('WeekTimeGridView: 종일 레인에 이어진 일정 표시와 강등된 시간 접두를 남긴다', async () => {
  const { getAllDayBarLabel } = await loadWeekTimeGridView();
  const label = getAllDayBarLabel({
    event: event({ title: '이틀 회의', allDay: false, startTime: '08:30', endDate: '2026-08-25' }),
    isStart: false,
    isEnd: false,
  });

  assert.equal(label, '◂ 08:30 이틀 회의 ▸');
});

test('WeekTimeGridView: 분 단위 현재 시각이 자정을 넘으면 실제 오늘 열도 함께 바뀐다', async () => {
  const { getTimeGridToday } = await loadWeekTimeGridView();
  const dateStrings = ['2026-08-23', '2026-08-24'];

  assert.deepEqual(getTimeGridToday(new Date(2026, 7, 23, 23, 59), dateStrings), {
    today: '2026-08-23',
    todayIndex: 0,
  });
  assert.deepEqual(getTimeGridToday(new Date(2026, 7, 24, 0, 0), dateStrings), {
    today: '2026-08-24',
    todayIndex: 1,
  });
});

test('WeekTimeGridView: 빈 종일 레인은 timed 슬롯 callback을 만들지 않는다', async () => {
  const module = await loadWeekTimeGridView();
  const markup = renderToStaticMarkup(createElement(module.default, {
    weekDays: Array.from({ length: 7 }, (_, index) => new Date(2026, 7, 23 + index, 12)),
    events: [],
    today: '2026-08-23',
    onEventClick() {},
    onSlotClick() {},
    tagNameById: {},
    calendarNameById: {},
    activeWeekIndex: 0,
    weekCount: 4,
    onWeekChange() {},
  }));

  assert.match(markup, /data-time-grid-all-day-empty="true"/);
  assert.doesNotMatch(markup, /종일 일정 만들기/);
});

test('WeekTimeGridView: D10 라벨은 공용 태그·캘린더·시간 범위 포맷을 사용한다', async () => {
  const module = await loadWeekTimeGridView();
  const tagNameById = { 'tag-meeting': '회의' };
  const calendarNameById = { team: '스튜디오 공지' };
  const allDay = event({ id: 'all-day-label', title: '종일 일정', allDay: true, tagId: 'tag-meeting', calendarId: 'team' });
  const markup = renderToStaticMarkup(createElement(module.default, {
    weekDays: Array.from({ length: 7 }, (_, index) => new Date(2026, 7, 23 + index, 12)),
    events: [allDay, event({ id: 'timed-label-shared', title: '시간 일정', startDate: '2026-08-25', endDate: '2026-08-25', startTime: '09:00', endTime: '09:30', tagId: 'tag-meeting' })],
    today: '2026-08-23',
    onEventClick() {},
    onSlotClick() {},
    tagNameById,
    calendarNameById,
    activeWeekIndex: 0,
    weekCount: 4,
    onWeekChange() {},
  }));

  assert.equal(module.getAllDayBarLabel({ event: allDay, isStart: true, isEnd: true }, tagNameById, calendarNameById), '회의 · 종일 일정');
  assert.match(markup, /회의 · 종일 일정/);
  assert.match(markup, /09:00 – 09:30 · 회의/);
});

test('WeekTimeGridView: 현재 시각선은 56px 시간 눈금 기준 위치와 레이블을 계산한다', async () => {
  const { getCurrentTimeMarker } = await loadWeekTimeGridView();

  assert.deepEqual(getCurrentTimeMarker(570, 540, 1140, 2), {
    top: 28,
    label: '09:30',
    todayIndex: 2,
  });
  assert.equal(getCurrentTimeMarker(540, 0, 540, 2), null, '09:00은 새벽 밴드에 중복 표시하지 않는다');
  assert.equal(getCurrentTimeMarker(540, 540, 1140, 2)?.label, '09:00', '09:00은 본 시간대에만 표시한다');
  assert.equal(getCurrentTimeMarker(1140, 540, 1140, 2), null, '19:00은 본 시간대에 중복 표시하지 않는다');
  assert.equal(getCurrentTimeMarker(1140, 1140, 1440, 2)?.label, '19:00', '19:00은 저녁 밴드에만 표시한다');
});

test('WeekTimeGridView: 시간 블록은 D10 색조와 왼쪽 경계·시간 라벨을 원본 색으로 그린다', async () => {
  const { getTimedBlockVisualStyle } = await loadWeekTimeGridView();

  assert.deepEqual(getTimedBlockVisualStyle('#6C5CE7'), {
    background: 'rgb(41, 40, 74)',
    borderLeft: '3px solid #6C5CE7',
    titleColor: '#E8E8EE',
    titleFontSize: 11,
    timeColor: '#6C5CE7',
  });
});

test('WeekTimeGridView: 현재 블록만 원본색 1px 윤곽과 강한 그림자를 가진다', async () => {
  const { getTimedBlockStateStyle, getTimedBlockOpacity } = await loadWeekTimeGridView();

  assert.deepEqual(getTimedBlockStateStyle('#6C5CE7', false), {});
  assert.deepEqual(getTimedBlockStateStyle('#6C5CE7', true), {
    outline: '1px solid #6C5CE7',
    outlineOffset: 1,
    boxShadow: '0 0 16px rgba(108,92,231,0.75)',
  });
  assert.equal(getTimedBlockOpacity(true), 0.5);
  assert.equal(getTimedBlockOpacity(false), 1);
});

test('WeekTimeGridView: 한국어 시간 눈금과 접힌 밴드의 범위·상태·화살표를 만든다', async () => {
  const { formatKoreanHour, getCollapsedBandLabel } = await loadWeekTimeGridView();

  assert.equal(formatKoreanHour(0), '오전 12시');
  assert.equal(formatKoreanHour(540), '오전 9시');
  assert.equal(formatKoreanHour(1140), '오후 7시');
  assert.equal(getCollapsedBandLabel('새벽 시간대', 0, 540), '▸ 새벽 시간대 · 오전 12시–오전 9시 · 접힘');
});

test('WeekTimeGridView: Shift+wheel은 연도 경계 sentinel을 부모로 전달하고 Shift 없이는 이동하지 않는다', async () => {
  const { getNextWeekIndex, requestWeekChangeFromWheel } = await loadWeekTimeGridView();

  assert.equal(getNextWeekIndex(2, 6, 1), 3);
  assert.equal(getNextWeekIndex(2, 6, -1), 1);
  assert.equal(getNextWeekIndex(0, 6, -1), -1);
  assert.equal(getNextWeekIndex(5, 6, 1), 6);

  const requestedIndices: number[] = [];
  let preventDefaultCount = 0;
  const makeWheel = (shiftKey: boolean, deltaY: number) => ({
    shiftKey,
    deltaY,
    deltaX: 0,
    preventDefault() {
      preventDefaultCount += 1;
    },
  });
  const onWeekChange = (nextIndex: number) => requestedIndices.push(nextIndex);

  assert.equal(requestWeekChangeFromWheel(makeWheel(true, -1), 0, 6, onWeekChange), true);
  assert.equal(requestWeekChangeFromWheel(makeWheel(true, 1), 5, 6, onWeekChange), true);
  assert.equal(requestWeekChangeFromWheel(makeWheel(true, 1), 2, 6, onWeekChange), true);
  assert.equal(requestWeekChangeFromWheel(makeWheel(false, -1), 0, 6, onWeekChange), false);
  assert.equal(requestWeekChangeFromWheel(makeWheel(true, 0), 2, 6, onWeekChange), false);

  assert.deepEqual(requestedIndices, [-1, 6, 3]);
  assert.equal(preventDefaultCount, 3);
});

test('WeekTimeGridView: Shift+wheel 한 번의 150ms 제스처는 한 번만 주 이동을 요청한다', async () => {
  const { requestWeekChangeFromWheel, clearWeekWheelGestureLock } = await loadWeekTimeGridView();
  const requestedIndices: number[] = [];
  let preventDefaultCount = 0;
  const gestureLock = { current: null as ReturnType<typeof setTimeout> | null };
  const makeWheel = (deltaY: number) => ({
    shiftKey: true,
    deltaY,
    deltaX: 0,
    preventDefault() {
      preventDefaultCount += 1;
    },
  });
  const onWeekChange = (nextIndex: number) => requestedIndices.push(nextIndex);

  assert.equal(requestWeekChangeFromWheel(makeWheel(-1), 0, 6, onWeekChange, gestureLock), true);
  assert.notEqual(gestureLock.current, null);
  assert.equal(requestWeekChangeFromWheel(makeWheel(1), 5, 6, onWeekChange, gestureLock), false);
  assert.deepEqual(requestedIndices, [-1]);

  await new Promise((resolve) => setTimeout(resolve, 170));
  assert.equal(gestureLock.current, null);
  assert.equal(requestWeekChangeFromWheel(makeWheel(1), 5, 6, onWeekChange, gestureLock), true);
  assert.deepEqual(requestedIndices, [-1, 6]);
  assert.equal(preventDefaultCount, 3);

  clearWeekWheelGestureLock(gestureLock);
  assert.equal(gestureLock.current, null);
});

test('WeekTimeGridView: 오늘 외 열의 현재 시각선은 28% 빨강 1px을 사용한다', async () => {
  const { getNonTodayCurrentLineStyle } = await loadWeekTimeGridView();

  assert.deepEqual(getNonTodayCurrentLineStyle(), {
    background: 'rgba(255, 107, 107, 0.28)',
    height: 1,
  });
});

test('WeekTimeGridView: weekend-today accent를 보존하는 주말 tint와 종일 칩 표기를 실제 마크업에 남긴다', async () => {
  const module = await loadWeekTimeGridView();
  const liveNow = new Date();
  // 부모가 전달한 today가 오래되어도 minute-updated clock의 실제 오늘을 써야 한다.
  const week = Array.from(
    { length: 7 },
    (_, index) => new Date(liveNow.getFullYear(), liveNow.getMonth(), liveNow.getDate() + index, 12),
  );
  const weekOutsideToday = Array.from({ length: 7 }, (_, index) => new Date(2000, 0, 2 + index, 12));
  const allDayEvents = [
    event({ id: 'all-1', allDay: true }),
    event({ id: 'all-2', allDay: true }),
    event({ id: 'all-3', allDay: true }),
  ];
  const markup = renderToStaticMarkup(createElement(module.default, {
    weekDays: week,
    events: allDayEvents,
    today: '1900-01-01',
    onEventClick() {},
    onSlotClick() {},
    tagNameById: {},
    calendarNameById: {},
    activeWeekIndex: 0,
    weekCount: 4,
    onWeekChange() {},
    onEventContextMenu() {},
  }));
  const collapsedMarkup = renderToStaticMarkup(createElement(module.default, {
    weekDays: weekOutsideToday,
    events: allDayEvents,
    today: '1900-01-01',
    onEventClick() {},
    onSlotClick() {},
    tagNameById: {},
    calendarNameById: {},
    activeWeekIndex: 0,
    weekCount: 4,
    onWeekChange() {},
  }));

  assert.deepEqual(module.getAllDayBarStyle('#6C5CE7'), {
    background: 'rgb(41, 40, 74)',
    borderLeft: '3px solid #6C5CE7',
    color: '#E8E8EE',
  });
  assert.deepEqual(module.getWeekendCellStyle(true), {
    backgroundImage: 'linear-gradient(rgba(116, 185, 255, 0.06), rgba(116, 185, 255, 0.06))',
  });
  assert.deepEqual(module.getWeekendCellStyle(false), {});
  assert.match(markup, /\+1개/);
  assert.doesNotMatch(markup, /opacity-60/);
  assert.match(markup, /class="min-w-0[^"]*bg-accent\/10" style="background-image:linear-gradient\(rgba\(116, 185, 255, 0.06\), rgba\(116, 185, 255, 0.06\)\)"/);
  assert.match(markup, /data-time-grid-all-day-empty="true" class="[^"]*hover:bg-bg-border\/15[^"]*bg-accent\/\[0\.03\]" style="background-image:linear-gradient\(rgba\(116, 185, 255, 0.06\), rgba\(116, 185, 255, 0.06\)\)"/);
  assert.match(markup, /class="relative border-r border-bg-border\/20 bg-accent\/\[0\.035\]" style="background-image:linear-gradient\(rgba\(116, 185, 255, 0.06\), rgba\(116, 185, 255, 0.06\)\)"/);
  assert.match(markup, /hover:bg-bg-border\/15/);
  assert.doesNotMatch(markup, /hover:bg-accent\/\[0.08\]/);
  assert.match(markup, /background:rgb\(41, 40, 74\)/);
  assert.match(collapsedMarkup, /▸ 새벽 시간대 · 오전 12시–오전 9시 · 접힘/);
});

test('WeekTimeGridView: 30분 이상 시간 블록은 원본색 시각을 제목보다 먼저 마크업에 둔다', async () => {
  const module = await loadWeekTimeGridView();
  const weekDays = Array.from({ length: 7 }, (_, index) => new Date(2026, 7, 23 + index, 12));
  const markup = renderToStaticMarkup(createElement(module.default, {
    weekDays,
    events: [event({ id: 'timed-label', title: '오전 회의', startDate: '2026-08-25', endDate: '2026-08-25', startTime: '09:00', endTime: '09:30' })],
    today: '2026-01-01',
    onEventClick() {},
    onSlotClick() {},
    tagNameById: {},
    calendarNameById: {},
    activeWeekIndex: 1,
    weekCount: 4,
    onWeekChange() {},
  }));

  assert.match(markup, /data-time-grid-time="true"[^>]*>09:00 – 09:30<\/span><span data-time-grid-title="true"[^>]*>오전 회의<\/span>/);
});

test('WeekTimeGridView: 외부 시간표 preview는 해당 날짜 열의 생성 ghost와 실시간 범위를 표시한다', async () => {
  const module = await loadWeekTimeGridView();
  const markup = renderToStaticMarkup(createElement(module.default, {
    weekDays: Array.from({ length: 7 }, (_, index) => new Date(2026, 7, 23 + index, 12)),
    events: [],
    today: '2026-01-01',
    onEventClick() {},
    onSlotClick() {},
    tagNameById: {},
    calendarNameById: {},
    activeWeekIndex: 1,
    weekCount: 4,
    onWeekChange() {},
    timeGridDragPreview: {
      mode: 'create', startDate: '2026-08-25', endDate: '2026-08-25', startTime: '10:15', endTime: '10:45',
    },
  }));

  assert.match(markup, /data-time-grid-column="true" data-date="2026-08-25"/);
  assert.match(markup, /data-time-grid-create-ghost="true"/);
  assert.match(markup, /data-time-grid-live-label="true">10:15 – 10:45/);
});
