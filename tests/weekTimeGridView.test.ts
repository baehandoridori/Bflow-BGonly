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
