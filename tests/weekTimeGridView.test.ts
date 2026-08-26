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
    activeWeekIndex: number;
    weekCount: number;
    onWeekChange(nextIndex: number): void;
    onEventContextMenu?(event: CalendarEvent, mouse: unknown): void;
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
  }): string;
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
  getNextWeekIndex(activeWeekIndex: number, weekCount: number, delta: -1 | 1): number | null;
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

test('WeekTimeGridView: 종일 레인에 이어진 일정 표시와 강등된 시간 접두를 남긴다', async () => {
  const { getAllDayBarLabel } = await loadWeekTimeGridView();
  const label = getAllDayBarLabel({
    event: event({ title: '이틀 회의', allDay: false, startTime: '08:30', endDate: '2026-08-25' }),
    isStart: false,
    isEnd: false,
  });

  assert.equal(label, '◂ 08:30 이틀 회의 ▸');
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

test('WeekTimeGridView: 상위 주 인덱스 계약으로 한 칸만 이동하고 범위 밖은 요청하지 않는다', async () => {
  const { getNextWeekIndex } = await loadWeekTimeGridView();

  assert.equal(getNextWeekIndex(2, 6, 1), 3);
  assert.equal(getNextWeekIndex(2, 6, -1), 1);
  assert.equal(getNextWeekIndex(0, 6, -1), null);
  assert.equal(getNextWeekIndex(5, 6, 1), null);
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
  const week = Array.from({ length: 7 }, (_, index) => new Date(2026, 7, 23 + index, 12));
  const allDayEvents = [
    event({ id: 'all-1', allDay: true }),
    event({ id: 'all-2', allDay: true }),
    event({ id: 'all-3', allDay: true }),
  ];
  const markup = renderToStaticMarkup(createElement(module.default, {
    weekDays: week,
    events: allDayEvents,
    today: '2026-08-23',
    onEventClick() {},
    onSlotClick() {},
    activeWeekIndex: 0,
    weekCount: 4,
    onWeekChange() {},
    onEventContextMenu() {},
  }));
  const collapsedMarkup = renderToStaticMarkup(createElement(module.default, {
    weekDays: week,
    events: allDayEvents,
    today: '2026-01-01',
    onEventClick() {},
    onSlotClick() {},
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
  assert.match(markup, /aria-label="2026-08-23 종일 일정 만들기" class="[^"]*hover:bg-bg-border\/15[^"]*bg-accent\/\[0\.03\]" style="background-image:linear-gradient\(rgba\(116, 185, 255, 0.06\), rgba\(116, 185, 255, 0.06\)\)"/);
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
    activeWeekIndex: 1,
    weekCount: 4,
    onWeekChange() {},
  }));

  assert.match(markup, /data-time-grid-time="true"[^>]*>09:00–09:30<\/span><span data-time-grid-title="true"[^>]*>오전 회의<\/span>/);
});
