import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { build } from 'esbuild';
import { hasSameCalendarEventIdentity } from '../src/utils/calendarEventIdentity.ts';

type CalendarEvent = {
  id: string;
  title: string;
  memo: string;
  color: string;
  type: 'custom' | 'vacation';
  startDate: string;
  endDate: string;
  createdBy: string;
  createdAt: string;
  source?: 'bflow' | 'google' | 'vacation';
  sourceCalendarId?: string;
  calendarId?: string;
  vacationType?: string;
  vacationUserName?: string;
};

type HookRuntime = ReturnType<typeof createHookRuntime>;

function createHookRuntime() {
  const states: unknown[] = [];
  const refs: Array<{ current: unknown }> = [];
  const pendingEffects: Array<() => void | (() => void)> = [];
  const listeners = new Map<string, Set<(event: Event) => void>>();
  let stateCursor = 0;
  let refCursor = 0;
  let collectEffects = true;

  return {
    states,
    reactMock(react: Record<string, unknown>) {
      return {
        ...react,
        useState(initial: unknown) {
          const slot = stateCursor++;
          if (states[slot] === undefined) {
            states[slot] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
          }
          return [states[slot], (next: unknown) => {
            states[slot] = typeof next === 'function'
              ? (next as (previous: unknown) => unknown)(states[slot])
              : next;
          }];
        },
        useRef(initial: unknown) {
          const slot = refCursor++;
          refs[slot] ??= { current: initial };
          return refs[slot];
        },
        useEffect(effect: () => void | (() => void)) {
          if (collectEffects) pendingEffects.push(effect);
        },
        useMemo: (factory: () => unknown) => factory(),
        useCallback: (callback: unknown) => callback,
      };
    },
    beginRender() {
      stateCursor = 0;
      refCursor = 0;
    },
    stopCollectingEffects() {
      collectEffects = false;
    },
    async flushMountEffects() {
      for (const effect of pendingEffects.splice(0)) effect();
      await settlePromises();
    },
    async flushMountEffectAt(index: number) {
      const effect = pendingEffects[index];
      assert.ok(effect, `mount effect ${index} must exist`);
      pendingEffects.splice(index, 1);
      effect();
      await settlePromises();
    },
    windowMock: {
      addEventListener(type: string, listener: (event: Event) => void) {
        const current = listeners.get(type) ?? new Set();
        current.add(listener);
        listeners.set(type, current);
      },
      removeEventListener(type: string, listener: (event: Event) => void) {
        listeners.get(type)?.delete(listener);
      },
      dispatch(type: string, detail?: unknown) {
        for (const listener of listeners.get(type) ?? []) {
          listener({ type, detail } as unknown as Event);
        }
      },
    },
  };
}

async function settlePromises(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function resolveComponents(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map(resolveComponents);
  if (!isValidElement(node)) return node;
  if (typeof node.type === 'function') {
    return resolveComponents((node.type as (props: unknown) => ReactNode)(node.props));
  }
  const element = node as ReactElement<{ children?: ReactNode }>;
  return {
    ...element,
    props: { ...element.props, children: resolveComponents(element.props.children) },
  };
}

function textContent(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (!isValidElement(node)) return '';
  return textContent((node.props as { children?: ReactNode }).children);
}

function findElements(
  node: ReactNode,
  predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((child) => findElements(child, predicate));
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [
    ...(predicate(element) ? [element] : []),
    ...findElements(element.props.children as ReactNode, predicate),
  ];
}

function calendarEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  const now = new Date();
  const currentDate = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  return {
    id: 'revoked-event',
    title: '회수 전 기밀 일정',
    memo: '회수 전 기밀 메모',
    color: '#6C5CE7',
    type: 'custom',
    startDate: currentDate,
    endDate: currentDate,
    createdBy: 'owner',
    createdAt: '2026-08-24T00:00:00.000Z',
    source: 'bflow',
    sourceCalendarId: 'bflow:revoked-calendar',
    calendarId: 'revoked-calendar',
    ...overrides,
  };
}

test('canonical B flow event identity survives a move between calendars', () => {
  const beforeMove = calendarEvent();
  const afterMove = calendarEvent({
    title: '이동 후 정본 일정',
    sourceCalendarId: 'bflow:other-calendar',
    calendarId: 'other-calendar',
  });

  assert.equal(
    hasSameCalendarEventIdentity(beforeMove, afterMove),
    true,
    'the globally unique canonical row remains open after its mutable calendar changes',
  );
});

test('calendar event identity keeps same-id storage namespaces isolated', () => {
  const selected = calendarEvent();
  assert.equal(hasSameCalendarEventIdentity(selected, { ...selected, title: 'same identity' } as CalendarEvent), true);
  for (const unrelated of [
    calendarEvent({ source: 'google', sourceCalendarId: 'primary', calendarId: undefined }),
    calendarEvent({ source: 'bflow', sourceCalendarId: 'supabase-private', calendarId: undefined }),
    calendarEvent({ source: 'vacation', sourceCalendarId: 'vacation', calendarId: undefined }),
  ]) {
    assert.equal(
      hasSameCalendarEventIdentity(selected, unrelated),
      false,
      `same id from ${unrelated.source}/${unrelated.sourceCalendarId} is a different row`,
    );
  }

  const googlePrimary = calendarEvent({
    source: 'google',
    sourceCalendarId: 'primary',
    calendarId: undefined,
  });
  const googleTeam = calendarEvent({
    source: 'google',
    sourceCalendarId: 'team-calendar',
    calendarId: undefined,
  });
  assert.equal(
    hasSameCalendarEventIdentity(googlePrimary, googleTeam),
    false,
    'Google event IDs remain scoped to their source calendar',
  );
});

async function bundleCalendarConsumer(
  entryPoint: 'calendar' | 'spotlight' | 'week' | 'day' | 'widget',
  runtime: HookRuntime,
  getCanonicalEvents: () => CalendarEvent[],
  options: {
    vacationConnected?: boolean;
    mappedVacationEvents?: CalendarEvent[];
    pendingVacations?: Array<{
      pendingId: string;
      name: string;
      type: string;
      startDate: string;
      endDate: string;
      createdAt: string;
    }>;
  } = {},
): Promise<Record<string, (...args: never[]) => ReactNode>> {
  const root = process.cwd();
  const sourcePath = {
    calendar: path.join(root, 'src/views/CalendarView.tsx'),
    spotlight: path.join(root, 'src/components/spotlight/SpotlightSearch.tsx'),
    week: path.join(root, 'src/components/calendar/WeekScrollView.tsx'),
    day: path.join(root, 'src/components/calendar/DayScrollView.tsx'),
    widget: path.join(root, 'src/components/widgets/CalendarWidget.tsx'),
  }[entryPoint];
  const source = await readFile(sourcePath, 'utf8');
  const sourceWithTestExport = `${source}\n${{
    calendar: 'export { EventGanttChart as __TestEventGanttChart };',
    spotlight: '',
    week: 'export { ActiveWeek as __TestActiveWeek };',
    day: 'export { ActiveDay as __TestActiveDay };',
    widget: '',
  }[entryPoint]}\n`;
  const result = await build({
    stdin: {
      contents: sourceWithTestExport,
      loader: 'tsx',
      resolveDir: path.dirname(sourcePath),
      sourcefile: sourcePath,
    },
    bundle: true,
    format: 'cjs',
    jsx: 'automatic',
    platform: 'node',
    target: 'node22',
    write: false,
    external: [
      'react', 'react/jsx-runtime', 'framer-motion', 'lucide-react',
      '@/stores/useDataStore', '@/stores/useAppStore', '@/stores/useCharacterBoardStore',
      '@/stores/useCalendarStore', '@/stores/useVacationPendingStore',
      '@/utils/calcStats', '@/utils/entityTokens', '@/types', '@/utils/cn',
      '@/services/calendarService', '@/services/googleCalendarService', '@/services/supabaseService', '@/services/vacationService',
      '@/types/calendar', '@/types/vacation', '@/utils/vacationEvents', '@/utils/sceneNavigationAction',
      './Widget',
    ],
  });

  const nodeRequire = createRequire(import.meta.url);
  const react = nodeRequire('react') as Record<string, unknown>;
  const jsxRuntime = nodeRequire('react/jsx-runtime');
  const module = { exports: {} as Record<string, (...args: never[]) => ReactNode> };
  const emptyComponent = () => null;
  const motion = new Proxy({}, { get: (_target, property) => String(property) });
  const evaluate = new Function('require', 'module', 'exports', result.outputFiles[0].text);
  evaluate((id: string) => {
    if (id === 'react') return runtime.reactMock(react);
    if (id === 'react/jsx-runtime') return jsxRuntime;
    if (id === 'framer-motion') return { AnimatePresence: ({ children }: { children: ReactNode }) => children, motion };
    if (id === 'lucide-react') return new Proxy({}, { get: () => emptyComponent });
    if (id === '@/stores/useDataStore') {
      const data = { episodes: [], episodeTitles: {}, episodeMemos: {} };
      return { useDataStore: (selector: (state: typeof data) => unknown) => selector(data) };
    }
    if (id === '@/stores/useAppStore') {
      const app = new Proxy(
        { vacationConnected: options.vacationConnected ?? false },
        { get: (target, property) => property in target ? target[property as keyof typeof target] : () => {} },
      );
      return { useAppStore: (selector?: (state: typeof app) => unknown) => selector ? selector(app) : app };
    }
    if (id === '@/stores/useCharacterBoardStore') {
      const characterState = { characters: [], byCharacter: new Map(), loaded: true, loading: false, load: async () => {} };
      return { useCharacterBoardStore: (selector: (state: typeof characterState) => unknown) => selector(characterState) };
    }
    if (id === '@/stores/useCalendarStore') {
      const calendarState = { tags: [] };
      return { useCalendarStore: (selector: (state: typeof calendarState) => unknown) => selector(calendarState) };
    }
    if (id === '@/stores/useVacationPendingStore') {
      const pendingState = { pending: options.pendingVacations ?? [], hydrated: true, hydrate: async () => {} };
      return { useVacationPendingStore: (selector: (state: typeof pendingState) => unknown) => selector(pendingState) };
    }
    if (id === '@/utils/calcStats') return { sceneProgress: () => 0, isFullyDone: () => false };
    if (id === '@/utils/entityTokens') return { stripEntityTokens: (value: string) => value };
    if (id === '@/types') return { DEPARTMENT_CONFIGS: {}, DEPARTMENTS: [] };
    if (id === '@/utils/cn') return { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') };
    if (id === '@/services/calendarService') return {
      getEvents: async () => getCanonicalEvents(),
      getEventsForDate: (events: CalendarEvent[], date: string) => events.filter((event) => (
        event.startDate <= date && event.endDate >= date
      )),
      loadBflowEvents: async () => {},
      syncAll: async () => {},
    };
    if (id === '@/services/googleCalendarService') return { isAuthenticated: async () => false };
    if (id === '@/services/supabaseService') return { readMetadata: async () => null };
    if (id === '@/services/vacationService') return { fetchAllVacationEvents: async () => [{}] };
    if (id === '@/types/calendar') return { EVENT_COLORS: ['#6C5CE7'] };
    if (id === '@/types/vacation') return { VACATION_COLOR: '#00B894' };
    if (id === '@/utils/vacationEvents') return { mapVacationEvents: () => options.mappedVacationEvents ?? [] };
    if (id === '@/utils/sceneNavigationAction') return { navigateToSceneView() {} };
    if (id === './Widget') return { Widget: ({ children }: { children: ReactNode }) => children };
    return nodeRequire(id);
  }, module, module.exports);
  return module.exports;
}

function currentWeek(): Date[] {
  const today = new Date();
  const sunday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay(), 12);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(sunday);
    date.setDate(sunday.getDate() + index);
    return date;
  });
}

function keyForEventElement(tree: ReactNode, event: CalendarEvent): string | null {
  return findElements(tree, (element) => element.props.event === event)[0]?.key ?? null;
}

test('WeekScrollView gives same-id Google rows calendar-scoped React keys', async () => {
  const runtime = createHookRuntime();
  const primary = calendarEvent({ title: '주간 기본 캘린더', source: 'google', sourceCalendarId: 'primary', calendarId: undefined });
  const team = calendarEvent({ title: '주간 팀 캘린더', source: 'google', sourceCalendarId: 'team-calendar', calendarId: undefined });
  const module = await bundleCalendarConsumer('week', runtime, () => []);
  const ActiveWeek = module.__TestActiveWeek as unknown as (props: Record<string, unknown>) => ReactNode;

  runtime.beginRender();
  const tree = ActiveWeek({
    week: currentWeek(),
    events: [primary, team],
    today: primary.startDate,
    isoWeek: 35,
    onEventClick: () => {},
    tagNameById: {},
  });

  assert.equal(keyForEventElement(tree, primary), 'google\u0000primary\u0000revoked-event');
  assert.equal(keyForEventElement(tree, team), 'google\u0000team-calendar\u0000revoked-event');
});

test('DayScrollView gives same-id cross-storage cards independent React keys', async () => {
  const runtime = createHookRuntime();
  const bflow = calendarEvent({ title: '일간 B flow' });
  const google = calendarEvent({ title: '일간 구글', source: 'google', sourceCalendarId: 'primary', calendarId: undefined });
  const module = await bundleCalendarConsumer('day', runtime, () => []);
  const ActiveDay = module.__TestActiveDay as unknown as (props: Record<string, unknown>) => ReactNode;
  const date = new Date(`${bflow.startDate}T12:00:00`);

  runtime.beginRender();
  const tree = ActiveDay({
    date,
    dateStr: bflow.startDate,
    events: [bflow, google],
    today: bflow.startDate,
    onEventClick: () => {},
    tagNameById: {},
  });

  assert.equal(keyForEventElement(tree, bflow), 'bflow\u0000revoked-event');
  assert.equal(keyForEventElement(tree, google), 'google\u0000primary\u0000revoked-event');
});

test('CalendarView selects same-id storage rows independently', async () => {
  const runtime = createHookRuntime();
  const bflow = calendarEvent({ title: '간트 B flow', memo: 'B flow 상세' });
  const google = calendarEvent({
    title: '간트 구글',
    memo: '구글 상세',
    source: 'google',
    sourceCalendarId: 'primary',
    calendarId: undefined,
  });
  Object.assign(globalThis, {
    window: runtime.windowMock,
    requestAnimationFrame: (callback: () => void) => callback(),
  });
  const module = await bundleCalendarConsumer('calendar', runtime, () => [bflow, google]);
  const EventGanttChart = module.__TestEventGanttChart;

  runtime.beginRender();
  EventGanttChart();
  await runtime.flushMountEffects();
  runtime.stopCollectingEffects();

  runtime.beginRender();
  let tree = resolveComponents(EventGanttChart());
  const bflowRow = findElements(tree, (element) => (
    typeof element.props.onClick === 'function' && textContent(element) === bflow.title
  ))[0];
  assert.ok(bflowRow);
  (bflowRow.props.onClick as () => void)();

  runtime.beginRender();
  tree = resolveComponents(EventGanttChart());
  assert.match(textContent(tree), /B flow 상세/);
  const googleRow = findElements(tree, (element) => (
    typeof element.props.onClick === 'function' && textContent(element) === google.title
  ))[0];
  assert.ok(googleRow);
  (googleRow.props.onClick as () => void)();

  runtime.beginRender();
  tree = resolveComponents(EventGanttChart());
  assert.match(textContent(tree), /구글 상세/, 'clicking the same raw ID from Google opens that exact row');
  assert.doesNotMatch(textContent(tree), /B flow 상세/);
});

test('CalendarView gives same-person same-id vacation bars source-scoped React keys', async () => {
  const runtime = createHookRuntime();
  const primary = calendarEvent({
    title: '배한솔 연차 A',
    type: 'vacation',
    vacationType: '연차',
    vacationUserName: '배한솔',
    source: 'google',
    sourceCalendarId: 'primary',
    calendarId: undefined,
  });
  const team = calendarEvent({
    title: '배한솔 연차 B',
    type: 'vacation',
    vacationType: '연차',
    vacationUserName: '배한솔',
    source: 'google',
    sourceCalendarId: 'team-calendar',
    calendarId: undefined,
  });
  Object.assign(globalThis, {
    window: runtime.windowMock,
    requestAnimationFrame: (callback: () => void) => callback(),
  });
  const module = await bundleCalendarConsumer('calendar', runtime, () => []);
  const EventGanttChart = module.__TestEventGanttChart;

  runtime.beginRender();
  EventGanttChart();
  await runtime.flushMountEffects();
  runtime.stopCollectingEffects();
  runtime.states[0] = [primary, team];

  runtime.beginRender();
  const tree = resolveComponents(EventGanttChart());
  const vacationKeys = findElements(tree, (element) => (
    typeof element.props.onClick === 'function'
    && String(element.props.className).includes('absolute top-1 h-5')
    && String(element.props.title).startsWith('배한솔 연차:')
  )).map((element) => element.key);

  assert.deepEqual(vacationKeys, [
    'google\u0000primary\u0000revoked-event',
    'google\u0000team-calendar\u0000revoked-event',
  ]);
});

test('CalendarView treats only source=vacation rows as external vacation cache data', async (t) => {
  const canonicalVacation = calendarEvent({
    id: 'canonical-vacation',
    title: 'Google 정본 휴가',
    type: 'vacation',
    vacationType: '연차',
    vacationUserName: '배한솔',
    source: 'google',
    sourceCalendarId: 'primary',
    calendarId: undefined,
  });
  const oldExternal = calendarEvent({
    id: 'external-old',
    title: '기존 외부 휴가',
    type: 'vacation',
    vacationType: '연차',
    vacationUserName: '허혜원',
    source: 'vacation',
    sourceCalendarId: undefined,
    calendarId: undefined,
  });
  const refreshedExternal = { ...oldExternal, id: 'external-new', title: '새 외부 휴가' };

  await t.test('disconnect removes external rows without deleting canonical vacation rows', async () => {
    const runtime = createHookRuntime();
    Object.assign(globalThis, { window: runtime.windowMock, requestAnimationFrame: (callback: () => void) => callback() });
    const module = await bundleCalendarConsumer('calendar', runtime, () => [canonicalVacation], {
      vacationConnected: false,
    });
    const EventGanttChart = module.__TestEventGanttChart;
    runtime.beginRender();
    EventGanttChart();
    runtime.states[0] = [canonicalVacation, oldExternal];
    await runtime.flushMountEffectAt(1);
    assert.deepEqual(runtime.states[0], [canonicalVacation]);
  });

  await t.test('external refresh replaces only external rows', async () => {
    const runtime = createHookRuntime();
    Object.assign(globalThis, { window: runtime.windowMock, requestAnimationFrame: (callback: () => void) => callback() });
    const module = await bundleCalendarConsumer('calendar', runtime, () => [canonicalVacation], {
      vacationConnected: true,
      mappedVacationEvents: [refreshedExternal],
    });
    const EventGanttChart = module.__TestEventGanttChart;
    runtime.beginRender();
    EventGanttChart();
    runtime.states[0] = [canonicalVacation, oldExternal];
    await runtime.flushMountEffectAt(1);
    assert.deepEqual(runtime.states[0], [canonicalVacation, refreshedExternal]);
  });
});

test('CalendarView canonical refresh drops revoked provider vacation while preserving external vacation', async () => {
  const runtime = createHookRuntime();
  const canonicalVacation = calendarEvent({
    id: 'canonical-vacation-selection',
    title: '회수될 Google 휴가',
    memo: '회수될 Google 휴가 상세',
    type: 'vacation',
    vacationType: '연차',
    vacationUserName: '배한솔',
    source: 'google',
    sourceCalendarId: 'primary',
    calendarId: undefined,
  });
  const externalVacation = calendarEvent({
    id: 'external-vacation-selection',
    title: '유지할 외부 휴가',
    memo: '외부 휴가 상세',
    type: 'vacation',
    vacationType: '연차',
    vacationUserName: '허혜원',
    source: 'vacation',
    sourceCalendarId: undefined,
    calendarId: undefined,
  });
  let canonicalEvents = [canonicalVacation];
  Object.assign(globalThis, {
    window: runtime.windowMock,
    requestAnimationFrame: (callback: () => void) => callback(),
  });
  const module = await bundleCalendarConsumer('calendar', runtime, () => canonicalEvents);
  const EventGanttChart = module.__TestEventGanttChart;

  runtime.beginRender();
  EventGanttChart();
  await runtime.flushMountEffects();
  runtime.stopCollectingEffects();
  runtime.states[0] = [canonicalVacation, externalVacation];

  runtime.beginRender();
  let tree = resolveComponents(EventGanttChart());
  const canonicalRow = findElements(tree, (element) => (
    typeof element.props.onClick === 'function'
    && String(element.props.title).startsWith('배한솔 연차:')
  ))[0];
  assert.ok(canonicalRow);
  (canonicalRow.props.onClick as () => void)();

  canonicalEvents = [];
  runtime.windowMock.dispatch('bflow:calendar-changed');
  await settlePromises();
  runtime.beginRender();
  tree = resolveComponents(EventGanttChart());
  assert.deepEqual(runtime.states[0], [externalVacation], 'only external vacation survives canonical refresh');
  assert.equal(runtime.states[1], null, 'revoked provider vacation selection closes');
  assert.ok(findElements(tree, (element) => String(element.props.title).startsWith('허혜원 연차:')).length > 0);
  assert.doesNotMatch(textContent(tree), /회수될 Google 휴가|회수될 Google 휴가 상세/);
});

test('CalendarWidget gives same-id visible rows independent React keys', async () => {
  const runtime = createHookRuntime();
  const bflow = calendarEvent({ title: '위젯 B flow' });
  const google = calendarEvent({
    title: '위젯 구글',
    source: 'google',
    sourceCalendarId: 'primary',
    calendarId: undefined,
  });
  Object.assign(globalThis, { window: runtime.windowMock });
  const module = await bundleCalendarConsumer('widget', runtime, () => [bflow, google]);
  const CalendarWidget = module.CalendarWidget;

  runtime.beginRender();
  CalendarWidget();
  await runtime.flushMountEffects();
  runtime.stopCollectingEffects();

  runtime.beginRender();
  const tree = resolveComponents(CalendarWidget());
  const rowFor = (title: string) => findElements(tree, (element) => (
    element.props.className === 'flex items-center gap-1.5' && textContent(element) === title
  ))[0];
  assert.equal(rowFor(bflow.title)?.key, 'bflow\u0000revoked-event');
  assert.equal(rowFor(google.title)?.key, 'google\u0000primary\u0000revoked-event');
});

test('CalendarWidget scopes pending vacation identity away from a same-id legacy local row', async () => {
  const runtime = createHookRuntime();
  const pendingId = 'pending-source-fence';
  const rawId = `wvac-pending-${pendingId}`;
  const legacyLocal = calendarEvent({
    id: rawId,
    title: '같은 ID 로컬 일정',
    source: undefined,
    sourceCalendarId: undefined,
    calendarId: undefined,
  });
  Object.assign(globalThis, { window: runtime.windowMock });
  const module = await bundleCalendarConsumer('widget', runtime, () => [legacyLocal], {
    pendingVacations: [{
      pendingId,
      name: '배한솔',
      type: '연차',
      startDate: legacyLocal.startDate,
      endDate: legacyLocal.endDate,
      createdAt: '2026-08-24T00:00:00.000Z',
    }],
  });
  const CalendarWidget = module.CalendarWidget;

  runtime.beginRender();
  CalendarWidget();
  await runtime.flushMountEffects();
  runtime.stopCollectingEffects();

  runtime.beginRender();
  const tree = resolveComponents(CalendarWidget());
  const rowFor = (title: string) => findElements(tree, (element) => (
    element.props.className === 'flex items-center gap-1.5' && textContent(element) === title
  ))[0];
  assert.equal(rowFor(legacyLocal.title)?.key, `\u0000\u0000${rawId}`);
  assert.equal(rowFor('배한솔 연차 (등록 중)')?.key, `vacation\u0000\u0000${rawId}`);
});

test('SpotlightSearch gives same-id Google results calendar-scoped React keys', async () => {
  const runtime = createHookRuntime();
  const primary = calendarEvent({ title: '중복 기본 검색', source: 'google', sourceCalendarId: 'primary', calendarId: undefined });
  const team = calendarEvent({ title: '중복 팀 검색', source: 'google', sourceCalendarId: 'team-calendar', calendarId: undefined });
  Object.assign(globalThis, { window: runtime.windowMock, document: { activeElement: null } });
  const module = await bundleCalendarConsumer('spotlight', runtime, () => [primary, team]);
  const SpotlightSearch = module.SpotlightSearch;

  runtime.beginRender();
  SpotlightSearch();
  await runtime.flushMountEffects();
  runtime.stopCollectingEffects();
  runtime.states[0] = true;
  runtime.states[1] = '중복';

  runtime.beginRender();
  const tree = resolveComponents(SpotlightSearch());
  const buttonFor = (title: string) => findElements(tree, (element) => (
    element.type === 'button' && textContent(element).includes(title)
  ))[0];
  assert.equal(buttonFor(primary.title)?.key, 'event-google\u0000primary\u0000revoked-event');
  assert.equal(buttonFor(team.title)?.key, 'event-google\u0000team-calendar\u0000revoked-event');
});

test('CalendarView reloads canonical events on calendar-changed and clears revoked row details', async () => {
  const runtime = createHookRuntime();
  const stale = calendarEvent();
  let canonicalEvents = [stale];
  Object.assign(globalThis, {
    window: runtime.windowMock,
    requestAnimationFrame: (callback: () => void) => callback(),
  });
  const module = await bundleCalendarConsumer('calendar', runtime, () => canonicalEvents);
  const EventGanttChart = module.__TestEventGanttChart;

  runtime.beginRender();
  EventGanttChart();
  await runtime.flushMountEffects();
  runtime.stopCollectingEffects();

  runtime.beginRender();
  let tree = resolveComponents(EventGanttChart());
  const staleRow = findElements(tree, (element) => (
    typeof element.props.onClick === 'function' && textContent(element) === stale.title
  ))[0];
  assert.ok(staleRow, 'the stale canonical row initially renders');
  (staleRow.props.onClick as () => void)();

  runtime.beginRender();
  tree = resolveComponents(EventGanttChart());
  assert.match(textContent(tree), new RegExp(stale.memo), 'the selected stale memo initially renders');

  const replacement = calendarEvent({ title: '정본 교체 일정', memo: '정본 교체 메모' });
  canonicalEvents = [replacement];
  runtime.windowMock.dispatch('bflow:calendar-changed');
  await settlePromises();
  runtime.beginRender();
  tree = resolveComponents(EventGanttChart());
  assert.doesNotMatch(textContent(tree), /회수 전 기밀 일정|회수 전 기밀 메모/);
  assert.match(textContent(tree), /정본 교체 일정|정본 교체 메모/, 'the open detail follows the replacement canonical row');

  const unrelatedGoogle = calendarEvent({
    title: '동일 ID 구글 일정',
    memo: '다른 출처 메모',
    source: 'google',
    sourceCalendarId: 'primary',
    calendarId: undefined,
  });
  canonicalEvents = [unrelatedGoogle];
  runtime.windowMock.dispatch('bflow:calendar-changed');
  await settlePromises();
  runtime.beginRender();
  tree = resolveComponents(EventGanttChart());
  assert.match(textContent(tree), /동일 ID 구글 일정/, 'the unrelated canonical row may remain in the list');
  assert.doesNotMatch(textContent(tree), /이벤트 상세|정본 교체 메모|다른 출처 메모/, 'same-id data from another source cannot replace the selected B flow row');

  canonicalEvents = [];
  runtime.windowMock.dispatch('bflow:calendar-changed');
  await settlePromises();
  runtime.beginRender();
  tree = resolveComponents(EventGanttChart());
  assert.doesNotMatch(textContent(tree), /정본 교체 일정|정본 교체 메모/, 'revocation closes the long-lived detail state');
});

test('SpotlightSearch reloads canonical events on calendar-changed and drops revoked title and memo', async () => {
  const runtime = createHookRuntime();
  const stale = calendarEvent();
  let canonicalEvents = [stale];
  Object.assign(globalThis, { window: runtime.windowMock, document: { activeElement: null } });
  const module = await bundleCalendarConsumer('spotlight', runtime, () => canonicalEvents);
  const SpotlightSearch = module.SpotlightSearch;

  runtime.beginRender();
  SpotlightSearch();
  await runtime.flushMountEffects();
  runtime.stopCollectingEffects();
  runtime.states[0] = true;
  runtime.states[1] = '기밀';

  runtime.beginRender();
  let tree = resolveComponents(SpotlightSearch());
  assert.match(textContent(tree), /회수 전 기밀 일정/);
  assert.match(textContent(tree), /회수 전 기밀 메모/);

  canonicalEvents = [];
  runtime.windowMock.dispatch('bflow:calendar-changed');
  await settlePromises();
  runtime.beginRender();
  tree = resolveComponents(SpotlightSearch());
  assert.doesNotMatch(textContent(tree), /회수 전 기밀 일정|회수 전 기밀 메모/, 'revoked search data is removed from long-lived state');
});
