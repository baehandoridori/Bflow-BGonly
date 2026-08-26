import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';

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
  resolveBandExpanded(hasTimedBlocks: boolean, userChoice: boolean | null): boolean;
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
    if (id === '@/components/calendar/CalendarGrid') return { layoutEventBars: () => [] };
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

  assert.equal(resolveBandExpanded(true, null), true, '시간 일정이 있으면 최초 기본값은 펼침이다');
  assert.equal(resolveBandExpanded(true, false), false, '사용자가 접으면 시간 일정이 남아도 접힘을 유지한다');
  assert.equal(resolveBandExpanded(false, true), true, '사용자가 펼친 빈 밴드는 열린 상태를 유지한다');
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
  assert.equal(getCurrentTimeMarker(510, 540, 1140, 2), null);
});

test('WeekTimeGridView: 시간 블록은 D10 색조와 왼쪽 경계·시간 라벨을 원본 색으로 그린다', async () => {
  const { getTimedBlockVisualStyle } = await loadWeekTimeGridView();

  assert.deepEqual(getTimedBlockVisualStyle('#6C5CE7'), {
    background: 'rgba(108,92,231,0.18)',
    borderLeft: '3px solid #6C5CE7',
    titleColor: '#ffffff',
    titleFontSize: 11,
    timeColor: '#6C5CE7',
  });
});
