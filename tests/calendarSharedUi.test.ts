import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';
import { build } from 'esbuild';

type BflowCalendar = {
  id: string;
  name: string;
  color: string;
  visibility: 'private' | 'members' | 'team';
  ownerId: string;
  isPersonal: boolean;
  members: Array<{ userId: string; canEdit: boolean }>;
  canEdit: boolean;
  canManage: boolean;
  createdAt: string;
};

type CalendarRailProps = {
  isAuthenticated: boolean;
  onOpenSettings(calendar: BflowCalendar): void;
  onCreateCalendar(): void;
};

type CalendarRailComponent = (props: CalendarRailProps) => ReactNode;

type TagBarProps = {
  vacationConnected: boolean;
  onOpenTagManager(anchorRect: DOMRect): void;
};

type TagBarComponent = (props: TagBarProps) => ReactNode;
type ScheduleViewComponent = () => ReactNode;

type ButtonElement = ReactElement<{
  'aria-label'?: string;
  'aria-pressed'?: boolean;
  children?: ReactNode;
  onClick?: (event?: { stopPropagation(): void }) => void;
}, 'button'>;

const myUserId = 'user-me';
let stateSlots: unknown[] = [];
let stateCursor = 0;
let calendarState: {
  calendars: BflowCalendar[];
  tags: Array<{ id: string; name: string; color: string; sortOrder: number }>;
  visibleCalendarIds: Record<string, boolean>;
  enabledTagIds: Record<string, boolean>;
  mutedCalendarIds: string[];
  toggleCalendarVisible(id: string): void;
  toggleTag(id: string): void;
  resetTagsAllOn(): void;
  toggleMuted(id: string): void;
};
let openedSettings: BflowCalendar[] = [];
let createdCount = 0;
let appViews: string[] = [];
let bundledRail: Promise<CalendarRailComponent> | undefined;
let bundledTagBar: Promise<TagBarComponent> | undefined;
let bundledScheduleView: Promise<ScheduleViewComponent> | undefined;
let scheduleTagBarProps: TagBarProps[] = [];

function resolveComponents(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map(resolveComponents);
  if (!isValidElement(node)) return node;
  if (typeof node.type === 'function') {
    return resolveComponents((node.type as (props: unknown) => ReactNode)(node.props));
  }
  const props = node.props as { children?: ReactNode };
  return {
    ...node,
    props: { ...props, children: resolveComponents(props.children) },
  } as ReactNode;
}

function textContent(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (!isValidElement(node)) return '';
  return textContent((node.props as { children?: ReactNode }).children);
}

function findButtons(node: ReactNode): ButtonElement[] {
  if (Array.isArray(node)) return node.flatMap(findButtons);
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode };
  return [
    ...(node.type === 'button' ? [node as ButtonElement] : []),
    ...findButtons(props.children),
  ];
}

function nodeByAriaLabel(node: ReactNode, label: string): ReactElement<{ 'aria-label'?: string }> {
  if (Array.isArray(node)) {
    for (const child of node) {
      try { return nodeByAriaLabel(child, label); } catch { /* keep looking */ }
    }
  } else if (isValidElement(node)) {
    if ((node.props as { 'aria-label'?: string })['aria-label'] === label) return node;
    return nodeByAriaLabel((node.props as { children?: ReactNode }).children, label);
  }
  throw new Error(`node '${label}' must be rendered`);
}

function buttonByLabel(node: ReactNode, label: string): ButtonElement {
  const button = findButtons(node).find((candidate) => candidate.props['aria-label'] === label);
  assert.ok(button, `button '${label}' must be rendered`);
  return button;
}

function buttonByText(node: ReactNode, label: string): ButtonElement {
  const button = findButtons(node).find((candidate) => textContent(candidate).includes(label));
  assert.ok(button, `button '${label}' must be rendered`);
  return button;
}

function calendar(overrides: Partial<BflowCalendar>): BflowCalendar {
  return {
    id: 'calendar-1',
    name: '개인 캘린더',
    color: '#6C5CE7',
    visibility: 'private',
    ownerId: myUserId,
    isPersonal: false,
    members: [],
    canEdit: true,
    canManage: true,
    createdAt: '2026-08-24T00:00:00.000Z',
    ...overrides,
  };
}

function resetHarness(): void {
  stateSlots = [];
  stateCursor = 0;
  openedSettings = [];
  createdCount = 0;
  appViews = [];
  scheduleTagBarProps = [];
  calendarState = {
    calendars: [
      calendar({ id: 'mine', name: 'EP 마일스톤', isPersonal: true }),
      calendar({ id: 'team', name: '스튜디오 공지', visibility: 'team', ownerId: 'owner-team' }),
      calendar({ id: 'editable-share', name: '리드 회의', visibility: 'members', ownerId: 'lead', canEdit: true, canManage: false }),
      calendar({ id: 'view-share', name: '외부 보기', visibility: 'members', ownerId: 'lead', canEdit: false, canManage: false }),
    ],
    tags: [
      { id: 'tag-meeting', name: '회의', color: '#FDCB6E', sortOrder: 20 },
      { id: 'tag-review', name: '검수', color: '#00B894', sortOrder: 10 },
    ],
    visibleCalendarIds: {},
    enabledTagIds: {},
    mutedCalendarIds: [],
    toggleCalendarVisible(id) {
      if (calendarState.visibleCalendarIds[id] === false) delete calendarState.visibleCalendarIds[id];
      else calendarState.visibleCalendarIds[id] = false;
    },
    toggleTag(id) {
      if (calendarState.enabledTagIds[id] === false) delete calendarState.enabledTagIds[id];
      else calendarState.enabledTagIds[id] = false;
    },
    resetTagsAllOn() {
      calendarState.enabledTagIds = {};
    },
    toggleMuted(id) {
      calendarState.mutedCalendarIds = calendarState.mutedCalendarIds.includes(id)
        ? calendarState.mutedCalendarIds.filter((calendarId) => calendarId !== id)
        : [...calendarState.mutedCalendarIds, id];
    },
  };
}

async function loadRail(): Promise<CalendarRailComponent> {
  bundledRail ??= build({
    entryPoints: ['src/components/calendar/CalendarRail.tsx'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    write: false,
    external: [
      'react',
      'react/jsx-runtime',
      'lucide-react',
      '@/stores/useCalendarStore',
      '@/stores/useAuthStore',
      '@/stores/useAppStore',
    ],
  }).then((result) => {
    const module = { exports: {} as Record<string, unknown> };
    const nodeRequire = createRequire(import.meta.url);
    const react = nodeRequire('react') as Record<string, unknown>;
    const evaluate = new Function('require', 'module', 'exports', result.outputFiles[0].text);
    evaluate((id: string) => {
      if (id === 'react') {
        return {
          ...react,
          useState(initial: unknown) {
            const slot = stateCursor++;
            if (stateSlots[slot] === undefined) {
              stateSlots[slot] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
            }
            return [stateSlots[slot], (next: unknown) => {
              stateSlots[slot] = typeof next === 'function'
                ? (next as (value: unknown) => unknown)(stateSlots[slot])
                : next;
            }];
          },
          useEffect: () => {},
          useRef: (initial: unknown) => ({ current: initial }),
          useMemo: (factory: () => unknown) => factory(),
        };
      }
      if (id === 'react/jsx-runtime') return nodeRequire('react/jsx-runtime');
      if (id === 'lucide-react') {
        const Icon = () => null;
        return { BellOff: Icon, Check: Icon, ChevronDown: Icon, MoreHorizontal: Icon, Plus: Icon, Settings: Icon };
      }
      if (id === '@/stores/useCalendarStore') return { useCalendarStore: (selector: (state: typeof calendarState) => unknown) => selector(calendarState) };
      if (id === '@/stores/useAuthStore') return { useAuthStore: (selector: (state: { currentUser: { id: string } }) => unknown) => selector({ currentUser: { id: myUserId } }) };
      if (id === '@/stores/useAppStore') return { useAppStore: (selector: (state: { setView(view: string): void }) => unknown) => selector({ setView: (view) => appViews.push(view) }) };
      return nodeRequire(id);
    }, module, module.exports);
    return module.exports.CalendarRail as CalendarRailComponent;
  });
  return bundledRail;
}

async function loadTagBar(): Promise<TagBarComponent> {
  bundledTagBar ??= build({
    entryPoints: ['src/components/calendar/TagBar.tsx'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    write: false,
    external: ['react', 'react/jsx-runtime', 'lucide-react', '@/stores/useCalendarStore'],
  }).then((result) => {
    const module = { exports: {} as Record<string, unknown> };
    const nodeRequire = createRequire(import.meta.url);
    const react = nodeRequire('react') as Record<string, unknown>;
    const evaluate = new Function('require', 'module', 'exports', result.outputFiles[0].text);
    evaluate((id: string) => {
      if (id === 'react') return { ...react, useMemo: (factory: () => unknown) => factory() };
      if (id === 'react/jsx-runtime') return nodeRequire('react/jsx-runtime');
      if (id === 'lucide-react') return { Settings: () => null };
      if (id === '@/stores/useCalendarStore') {
        return { useCalendarStore: (selector: (state: typeof calendarState) => unknown) => selector(calendarState) };
      }
      return nodeRequire(id);
    }, module, module.exports);
    return module.exports.TagBar as TagBarComponent;
  });
  return bundledTagBar;
}

async function loadScheduleView(): Promise<ScheduleViewComponent> {
  bundledScheduleView ??= build({
    entryPoints: ['src/views/ScheduleView.tsx'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    write: false,
    external: [
      'react', 'react/jsx-runtime', 'framer-motion', 'lucide-react',
      '@/utils/cn', '@/stores/useDataStore', '@/stores/useAppStore', '@/services/calendarService',
      '@/services/vacationService', '@/hooks/useCalendarDnD', '@/utils/vacationEvents',
      '@/components/calendar/MiniCalendar', '@/components/calendar/EventSidePanel',
      '@/components/calendar/EventQuickEdit', '@/components/calendar/CalendarGrid',
      '@/components/calendar/EventCreateModal', '@/components/calendar/WeekScrollView',
      '@/components/calendar/WeekSidebar', '@/components/calendar/DayScrollView',
      '@/components/calendar/DaySidebar', '@/components/calendar/CalendarRail',
      '@/components/calendar/TagBar', '@/hooks/useCalendarDragCreate', '@/stores/useCalendarStore',
      '@/utils/sceneNavigationAction', '@/utils/createUuid', '@/utils/calendarDate',
      '@/utils/calendarEventFilter',
    ],
  }).then((result) => {
    const module = { exports: {} as Record<string, unknown> };
    const nodeRequire = createRequire(import.meta.url);
    const react = nodeRequire('react') as Record<string, unknown>;
    const jsxRuntime = nodeRequire('react/jsx-runtime') as { jsx(type: unknown, props: unknown): ReactNode };
    const emptyComponent = () => null;
    const evaluate = new Function('require', 'module', 'exports', result.outputFiles[0].text);
    evaluate((id: string) => {
      if (id === 'react') {
        return {
          ...react,
          useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, () => {}],
          useEffect: () => {}, useMemo: (factory: () => unknown) => factory(), useCallback: (fn: unknown) => fn,
          useRef: (initial: unknown) => ({ current: initial }),
        };
      }
      if (id === 'react/jsx-runtime') return jsxRuntime;
      if (id === 'framer-motion') return { AnimatePresence: ({ children }: { children: ReactNode }) => children, motion: { div: 'div' } };
      if (id === 'lucide-react') return { CalendarDays: emptyComponent, ChevronLeft: emptyComponent, ChevronRight: emptyComponent, Plus: emptyComponent };
      if (id === '@/utils/cn') return { cn: (...values: string[]) => values.filter(Boolean).join(' ') };
      if (id === '@/stores/useDataStore') return { useDataStore: (selector: (state: { episodes: []; episodeTitles: {} }) => unknown) => selector({ episodes: [], episodeTitles: {} }) };
      if (id === '@/stores/useAppStore') {
        const appState = { setView() {}, vacationConnected: false };
        return { useAppStore: (selector?: (state: typeof appState) => unknown) => selector ? selector(appState) : appState };
      }
      if (id === '@/services/calendarService') return { getEvents: async () => [], isGoogleCacheReady: () => true, loadBflowEvents: async () => {}, addEvent: async () => {}, updateEvent: async () => {}, deleteEvent: async () => {} };
      if (id === '@/services/vacationService') return { fetchAllVacationEvents: async () => [] };
      if (id === '@/hooks/useCalendarDnD') return { useCalendarDnD: () => ({ isDragging: false, preview: null, startDrag() {} }) };
      if (id === '@/utils/vacationEvents') return { mapVacationEvents: () => [] };
      if (id === '@/components/calendar/WeekScrollView') return { default: emptyComponent, generateYearWeeks: () => [], findWeekIndexForDate: () => 0 };
      if (id === '@/components/calendar/CalendarRail') return { CalendarRail: emptyComponent, GOOGLE_CALENDAR_ID: 'google' };
      if (id === '@/components/calendar/TagBar') return { TagBar: (props: TagBarProps) => { scheduleTagBarProps.push(props); return jsxRuntime.jsx('div', { children: '태그' }); } };
      if (id === '@/hooks/useCalendarDragCreate') return { useCalendarDragCreate: () => ({ handleCellMouseDown() {}, isDateInRange: () => false }) };
      if (id === '@/stores/useCalendarStore') return { useCalendarStore: (selector: (state: typeof calendarState) => unknown) => selector(calendarState), getState: () => ({ loadAll: async () => {} }) };
      if (id === '@/utils/sceneNavigationAction') return { navigateToSceneView() {} };
      if (id === '@/utils/createUuid') return { createUuid: () => 'new-id' };
      if (id === '@/utils/calendarDate') return { fmtDate: () => '2026-08-25', parseDate: (date: string) => new Date(`${date}T12:00:00`), addDays: (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12) };
      if (id === '@/utils/calendarEventFilter') return { filterCalendarEvents: (events: unknown[]) => events };
      if (id.startsWith('@/components/calendar/')) return Object.fromEntries([[id.split('/').at(-1)?.replace(/\.tsx$/, ''), emptyComponent]]);
      return nodeRequire(id);
    }, module, module.exports);
    return module.exports.ScheduleView as ScheduleViewComponent;
  });
  return bundledScheduleView;
}

async function renderRail(isAuthenticated: boolean): Promise<ReactNode> {
  const CalendarRail = await loadRail();
  stateCursor = 0;
  return resolveComponents(CalendarRail({
    isAuthenticated,
    onOpenSettings: (value) => openedSettings.push(value),
    onCreateCalendar: () => { createdCount += 1; },
  }));
}

async function renderTagBar(vacationConnected: boolean, onOpenTagManager: (anchorRect: DOMRect) => void): Promise<ReactNode> {
  const TagBar = await loadTagBar();
  return resolveComponents(TagBar({ vacationConnected, onOpenTagManager }));
}

async function renderScheduleView(): Promise<ReactNode> {
  const ScheduleView = await loadScheduleView();
  return resolveComponents(ScheduleView());
}

test('CalendarRail renders four grouped sections and drives visibility, menu permissions, callbacks, and Google settings navigation', async () => {
  resetHarness();

  let tree = await renderRail(false);
  const initialText = textContent(tree);
  for (const label of ['내 캘린더', '팀 전체', '나에게 공유됨', '내 구글', 'EP 마일스톤', '스튜디오 공지', '리드 회의']) {
    assert.match(initialText, new RegExp(label), `${label} must be visible in the rendered rail`);
  }
  assert.match(initialText, /구글 캘린더 연동 안 됨/);

  buttonByLabel(tree, 'EP 마일스톤 표시').props.onClick?.();
  assert.equal(calendarState.visibleCalendarIds.mine, false, 'color checkbox turns a visible calendar off through the store action');
  tree = await renderRail(false);
  assert.equal(buttonByLabel(tree, 'EP 마일스톤 표시').props['aria-pressed'], false);

  buttonByLabel(tree, '리드 회의 메뉴 열기').props.onClick?.({ stopPropagation() {} });
  tree = await renderRail(false);
  assert.ok(findButtons(tree).some((button) => textContent(button).includes('알림 끄기')), 'non-manageable shared calendar keeps its mute action');
  assert.equal(findButtons(tree).some((button) => textContent(button).includes('설정 열기')), false, 'non-manageable shared calendar has no settings action');
  buttonByText(tree, '알림 끄기').props.onClick?.();
  assert.deepEqual(calendarState.mutedCalendarIds, ['editable-share']);
  tree = await renderRail(false);
  assert.ok(nodeByAriaLabel(tree, '리드 회의 알림이 꺼짐'), 'muted calendar exposes its BellOff state');

  buttonByLabel(tree, 'EP 마일스톤 메뉴 열기').props.onClick?.({ stopPropagation() {} });
  tree = await renderRail(false);
  buttonByText(tree, '설정 열기').props.onClick?.();
  assert.deepEqual(openedSettings, [calendarState.calendars[0]], 'manageable calendar settings invokes the supplied callback with the calendar');

  buttonByText(tree, '설정에서 연동하기').props.onClick?.();
  assert.deepEqual(appViews, ['settings'], 'unlinked Google row navigates to settings');
  buttonByText(tree, '새 캘린더').props.onClick?.();
  assert.equal(createdCount, 1, 'new calendar invokes the supplied callback');

  tree = await renderRail(true);
  assert.match(textContent(tree), /연동됨/, 'linked Google row is rendered');
  buttonByLabel(tree, '내 구글 표시').props.onClick?.();
  assert.equal(calendarState.visibleCalendarIds.google, false, 'Google visibility uses the shared explicit-false record');
});

test('TagBar independently toggles tags, resets every chip, and forwards the clicked manager anchor', async () => {
  resetHarness();
  const openedAnchors: DOMRect[] = [];

  let tree = await renderTagBar(true, (anchorRect) => openedAnchors.push(anchorRect));
  assert.deepEqual(
    findButtons(tree).map((button) => textContent(button)).filter((label) => label === '검수' || label === '회의'),
    ['검수', '회의'],
    'tags render in their sortOrder so the bar matches the saved team order',
  );
  assert.equal(buttonByLabel(tree, '회의 태그').props['aria-pressed'], true);
  assert.equal(buttonByLabel(tree, '휴가 태그').props['aria-pressed'], true);

  buttonByLabel(tree, '회의 태그').props.onClick?.();
  assert.equal(calendarState.enabledTagIds['tag-meeting'], false, 'a chip writes only its own explicit-false state');
  assert.equal(calendarState.enabledTagIds['tag-review'], undefined, 'turning one chip off leaves another chip enabled');

  tree = await renderTagBar(true, (anchorRect) => openedAnchors.push(anchorRect));
  assert.equal(buttonByLabel(tree, '전체 태그 켜기').props['aria-pressed'], false, '전체 is not highlighted while one chip is off');
  buttonByLabel(tree, '전체 태그 켜기').props.onClick?.();
  assert.deepEqual(calendarState.enabledTagIds, {}, '전체 restores every tag using the store reset action');

  tree = await renderTagBar(true, (anchorRect) => openedAnchors.push(anchorRect));
  const anchor = { left: 17, top: 29, width: 84, height: 28 } as DOMRect;
  buttonByLabel(tree, '태그 관리').props.onClick?.({
    currentTarget: { getBoundingClientRect: () => anchor },
  });
  assert.deepEqual(openedAnchors, [anchor], 'tag manager receives the clicked button rectangle instead of querying the document');
});

test('ScheduleView replaces legacy controls with the tag bar and reports visible rail calendars', async () => {
  resetHarness();
  const tree = await renderScheduleView();
  const labels = findButtons(tree).map(textContent);

  for (const removedControl of ['일반', 'EP', '파트', '씬', 'BG', 'ACT']) {
    assert.equal(labels.includes(removedControl), false, `${removedControl} is no longer a separate legacy filter`);
  }
  assert.ok(scheduleTagBarProps[0], 'ScheduleView renders TagBar instead of the legacy type, department, and vacation controls');
  assert.equal(typeof scheduleTagBarProps[0].onOpenTagManager, 'function', 'ScheduleView keeps the tag manager anchoring callback wired');
  assert.ok(labels.includes('일정'), 'the creation action uses the shared calendar wording');
  assert.match(textContent(tree), /이번 달 0개.*오늘 0개.*켜진 캘린더 4\/4/, 'statistics describe the filtered view and rail visibility instead of total and vacation counts');
});
