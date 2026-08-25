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
type EventCreateModalProps = {
  initialDate?: string;
  initialEndDate?: string;
  episodes: [];
  googleAuthenticated: boolean;
  onClose(): void;
  onSave(event: Record<string, unknown>): void;
};
type EventCreateModalComponent = (props: EventCreateModalProps) => ReactNode;
type CalendarSettingsModalProps = {
  calendar?: BflowCalendar;
  eventCount: number;
  onClose(): void;
};
type CalendarSettingsModalComponent = (props: CalendarSettingsModalProps) => ReactNode;

type TestUser = {
  id: string;
  name: string;
  slackId: string;
  isInitialPassword: boolean;
  createdAt: string;
  role?: string;
};

type ButtonElement = ReactElement<{
  'aria-label'?: string;
  'aria-pressed'?: boolean;
  children?: ReactNode;
  disabled?: boolean;
  style?: { background?: string };
  title?: string;
  onClick?: (event?: { stopPropagation(): void }) => void | Promise<void>;
}, 'button'>;

type FormElement = ReactElement<{
  'aria-label'?: string;
  checked?: boolean;
  disabled?: boolean;
  step?: number;
  type?: string;
  value?: string;
  children?: ReactNode;
  onChange?: (event: { target: { checked: boolean; value: string } }) => void;
  onFocus?: () => void;
}, 'input' | 'select' | 'textarea'>;

const myUserId = 'user-me';
let stateSlots: unknown[] = [];
let stateCursor = 0;
let modalRefSlots: Array<{ current: unknown }> = [];
let modalRefCursor = 0;
let modalEffectDeps: Array<readonly unknown[] | undefined> = [];
let modalEffectCursor = 0;
let pendingModalEffects: Array<() => void> = [];
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
let bundledEventCreateModal: Promise<EventCreateModalComponent> | undefined;
let bundledCalendarSettingsModal: Promise<CalendarSettingsModalComponent> | undefined;
let scheduleTagBarProps: TagBarProps[] = [];
let settingsCurrentUser: TestUser;
let settingsUsers: TestUser[] = [];
let settingsApiCalls: Array<{ name: string; args: unknown[] }> = [];
let settingsApiFailures = new Set<string>();
let settingsLoadAllFailure = false;
let settingsConfirmResponses: boolean[] = [];
let settingsConfirmMessages: string[] = [];
let settingsToastErrors: string[] = [];
let settingsToastSuccesses: string[] = [];
let settingsCloseCount = 0;

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

function findFormElements(node: ReactNode): FormElement[] {
  if (Array.isArray(node)) return node.flatMap(findFormElements);
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode };
  return [
    ...(['input', 'select', 'textarea'].includes(String(node.type)) ? [node as FormElement] : []),
    ...findFormElements(props.children),
  ];
}

function formElementByLabel(node: ReactNode, label: string): FormElement {
  const element = findFormElements(node).find((candidate) => candidate.props['aria-label'] === label);
  assert.ok(element, `form element '${label}' must be rendered`);
  return element;
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

function buttonByTitle(node: ReactNode, title: string): ButtonElement {
  const button = findButtons(node).find((candidate) => candidate.props.title === title);
  assert.ok(button, `button titled '${title}' must be rendered`);
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
  modalRefSlots = [];
  modalRefCursor = 0;
  modalEffectDeps = [];
  modalEffectCursor = 0;
  pendingModalEffects = [];
  openedSettings = [];
  createdCount = 0;
  appViews = [];
  scheduleTagBarProps = [];
  settingsCurrentUser = {
    id: myUserId,
    name: '배한솔',
    slackId: 'U-ME',
    isInitialPassword: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    role: 'admin',
  };
  settingsUsers = [
    settingsCurrentUser,
    {
      id: 'owner-lead',
      name: '허혜원',
      slackId: 'U-LEAD',
      isInitialPassword: false,
      createdAt: '2026-01-02T00:00:00.000Z',
      role: 'user',
    },
    {
      id: 'user-jang',
      name: '장삐쭈',
      slackId: 'U-JANG',
      isInitialPassword: false,
      createdAt: '2026-01-03T00:00:00.000Z',
      role: 'user',
    },
  ];
  settingsApiCalls = [];
  settingsApiFailures = new Set();
  settingsLoadAllFailure = false;
  settingsConfirmResponses = [];
  settingsConfirmMessages = [];
  settingsToastErrors = [];
  settingsToastSuccesses = [];
  settingsCloseCount = 0;
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
      '@/components/calendar/TagBar', '@/components/calendar/CalendarSettingsModal',
      '@/hooks/useCalendarDragCreate', '@/stores/useCalendarStore',
      '@/utils/sceneNavigationAction', '@/utils/createUuid', '@/utils/calendarDate',
      '@/utils/calendarEventFilter',
    ],
  }).then((result) => {
    const module = { exports: {} as Record<string, unknown> };
    const nodeRequire = createRequire(import.meta.url);
    const react = nodeRequire('react') as Record<string, unknown>;
    const jsxRuntime = nodeRequire('react/jsx-runtime') as { jsx(type: unknown, props: unknown, key?: string): ReactNode };
    const emptyComponent = () => null;
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
      if (id === '@/components/calendar/CalendarRail') {
        return {
          GOOGLE_CALENDAR_ID: 'google',
          CalendarRail: (props: CalendarRailProps) => jsxRuntime.jsx('div', {
            children: [
              jsxRuntime.jsx('button', { 'aria-label': '레일 새 캘린더', onClick: props.onCreateCalendar, children: '새 캘린더' }, 'create'),
              jsxRuntime.jsx('button', {
                'aria-label': '레일 캘린더 설정',
                onClick: () => props.onOpenSettings(calendarState.calendars[0]),
                children: '설정 열기',
              }, 'settings'),
            ],
          }),
        };
      }
      if (id === '@/components/calendar/TagBar') return { TagBar: (props: TagBarProps) => { scheduleTagBarProps.push(props); return jsxRuntime.jsx('div', { children: '태그' }); } };
      if (id === '@/components/calendar/CalendarSettingsModal') {
        return {
          CalendarSettingsModal: (props: CalendarSettingsModalProps) => jsxRuntime.jsx('div', {
            'aria-label': '캘린더 설정 모달',
            children: props.calendar ? `설정 ${props.calendar.name} 일정 ${props.eventCount}개` : '새 캘린더 연결됨',
          }),
        };
      }
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

async function loadEventCreateModal(): Promise<EventCreateModalComponent> {
  bundledEventCreateModal ??= build({
    entryPoints: ['src/components/calendar/EventCreateModal.tsx'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    write: false,
    external: [
      'react', 'react/jsx-runtime', 'framer-motion', 'lucide-react',
      '@/utils/cn', '@/stores/useAuthStore', '@/stores/useDataStore', '@/stores/useAppStore',
      '@/stores/useCalendarStore', '@/types', '@/types/calendar', '@/utils/calendarDate', '@/utils/glassStyles',
    ],
  }).then((result) => {
    const module = { exports: {} as Record<string, unknown> };
    const nodeRequire = createRequire(import.meta.url);
    const react = nodeRequire('react') as Record<string, unknown>;
    const jsxRuntime = nodeRequire('react/jsx-runtime');
    const emptyComponent = () => null;
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
          useRef(initial: unknown) {
            const slot = modalRefCursor++;
            modalRefSlots[slot] ??= { current: initial };
            return modalRefSlots[slot];
          },
          useEffect(effect: () => void, deps?: readonly unknown[]) {
            const slot = modalEffectCursor++;
            const previous = modalEffectDeps[slot];
            const changed = deps === undefined
              || previous === undefined
              || deps.length !== previous.length
              || deps.some((value, index) => !Object.is(value, previous[index]));
            modalEffectDeps[slot] = deps;
            if (changed) pendingModalEffects.push(effect);
          },
          useMemo: (factory: () => unknown) => factory(),
        };
      }
      if (id === 'react/jsx-runtime') return jsxRuntime;
      if (id === 'framer-motion') return { motion: { div: 'div' } };
      if (id === 'lucide-react') return { CalendarDays: emptyComponent, X: emptyComponent };
      if (id === '@/utils/cn') return { cn: (...values: string[]) => values.filter(Boolean).join(' ') };
      if (id === '@/stores/useAuthStore') return { useAuthStore: (selector: (state: { currentUser: { name: string } }) => unknown) => selector({ currentUser: { name: '배한솔' } }) };
      if (id === '@/stores/useDataStore') return { useDataStore: (selector: (state: { episodeTitles: {} }) => unknown) => selector({ episodeTitles: {} }) };
      if (id === '@/stores/useAppStore') return { useAppStore: (selector: (state: { colorMode: string }) => unknown) => selector({ colorMode: 'dark' }) };
      if (id === '@/stores/useCalendarStore') return { useCalendarStore: (selector: (state: typeof calendarState) => unknown) => selector(calendarState) };
      if (id === '@/types') return { DEPARTMENT_CONFIGS: {} };
      if (id === '@/types/calendar') return { EVENT_COLORS: ['#6C5CE7'] };
      if (id === '@/utils/calendarDate') return { fmtDate: () => '2026-08-25' };
      if (id === '@/utils/glassStyles') return { floatingGlassStyle: {} };
      return nodeRequire(id);
    }, module, module.exports);
    return module.exports.EventCreateModal as EventCreateModalComponent;
  });
  return bundledEventCreateModal;
}

async function loadCalendarSettingsModal(): Promise<CalendarSettingsModalComponent> {
  bundledCalendarSettingsModal ??= build({
    entryPoints: ['src/components/calendar/CalendarSettingsModal.tsx'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    write: false,
    external: [
      'react', 'react/jsx-runtime', 'framer-motion', 'lucide-react', 'sonner',
      '@/components/common/ConfirmDialog', '@/stores/useAuthStore', '@/stores/useCalendarStore',
      '@/types/calendar', '@/utils/avatarColor', '@/utils/cn', '@/utils/glassStyles',
    ],
  }).then((result) => {
    const module = { exports: {} as Record<string, unknown> };
    const nodeRequire = createRequire(import.meta.url);
    const react = nodeRequire('react') as Record<string, unknown>;
    const jsxRuntime = nodeRequire('react/jsx-runtime');
    const emptyComponent = () => null;
    const useCalendarStoreMock = Object.assign(
      (selector: (state: typeof calendarState) => unknown) => selector(calendarState),
      {
        getState: () => ({
          async loadAll() {
            settingsApiCalls.push({ name: 'loadAll', args: [] });
            if (settingsLoadAllFailure) throw new Error('load all failed');
          },
        }),
      },
    );
    const callApi = async (name: string, args: unknown[]) => {
      settingsApiCalls.push({ name, args });
      if (settingsApiFailures.has(name)) throw new Error(`${name} failed`);
      return {
        id: 'created-calendar',
        name: String((args[0] as { name?: string } | undefined)?.name ?? ''),
        color: '#6C5CE7',
        visibility: 'members',
        owner_id: settingsCurrentUser.id,
        is_personal: false,
        created_at: '2026-08-25T00:00:00.000Z',
        updated_at: '2026-08-25T00:00:00.000Z',
      };
    };
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
          useRef(initial: unknown) {
            const slot = modalRefCursor++;
            modalRefSlots[slot] ??= { current: initial };
            return modalRefSlots[slot];
          },
          useEffect: () => {},
          useMemo: (factory: () => unknown) => factory(),
          useCallback: (fn: unknown) => fn,
        };
      }
      if (id === 'react/jsx-runtime') return jsxRuntime;
      if (id === 'framer-motion') return { motion: { div: 'div' } };
      if (id === 'lucide-react') {
        return {
          Check: emptyComponent, Crown: emptyComponent, Search: emptyComponent,
          Settings: emptyComponent, Trash2: emptyComponent, X: emptyComponent,
        };
      }
      if (id === 'sonner') {
        return {
          toast: {
            error(message: string) { settingsToastErrors.push(message); },
            success(message: string) { settingsToastSuccesses.push(message); },
          },
        };
      }
      if (id === '@/components/common/ConfirmDialog') {
        return {
          ConfirmDialog: {
            async show(options: { message: string }) {
              settingsConfirmMessages.push(options.message);
              return settingsConfirmResponses.shift() ?? false;
            },
          },
        };
      }
      if (id === '@/stores/useAuthStore') {
        return {
          useAuthStore: (selector: (state: { currentUser: TestUser; users: TestUser[] }) => unknown) => selector({
            currentUser: settingsCurrentUser,
            users: settingsUsers,
          }),
        };
      }
      if (id === '@/stores/useCalendarStore') return { useCalendarStore: useCalendarStoreMock };
      if (id === '@/types/calendar') {
        return {
          EVENT_COLORS: [
            '#6C5CE7', '#74B9FF', '#00B894', '#FDCB6E', '#E17055',
            '#FF6B6B', '#A29BFE', '#55EFC4', '#FF9FF3', '#48DBFB',
          ],
        };
      }
      if (id === '@/utils/avatarColor') return { avatarColor: () => '#6C5CE7' };
      if (id === '@/utils/cn') return { cn: (...values: string[]) => values.filter(Boolean).join(' ') };
      if (id === '@/utils/glassStyles') return { floatingGlassStyle: {} };
      return nodeRequire(id);
    }, module, module.exports);
    Object.assign(globalThis, {
      window: {
        electronAPI: {
          calendarCreate: (...args: unknown[]) => callApi('calendarCreate', args),
          calendarUpdate: (...args: unknown[]) => callApi('calendarUpdate', args),
          calendarDelete: (...args: unknown[]) => callApi('calendarDelete', args),
          calendarSetMembers: (...args: unknown[]) => callApi('calendarSetMembers', args),
        },
      },
    });
    return module.exports.CalendarSettingsModal as CalendarSettingsModalComponent;
  });
  return bundledCalendarSettingsModal;
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
  stateCursor = 0;
  return resolveComponents(ScheduleView());
}

async function renderEventCreateModal(
  googleAuthenticated: boolean,
  onSave: (event: Record<string, unknown>) => void,
  initialDate = '2026-08-25',
): Promise<ReactNode> {
  const EventCreateModal = await loadEventCreateModal();
  stateCursor = 0;
  modalRefCursor = 0;
  modalEffectCursor = 0;
  return resolveComponents(EventCreateModal({
    initialDate,
    initialEndDate: initialDate,
    episodes: [],
    googleAuthenticated,
    onClose() {},
    onSave,
  }));
}

function flushEventCreateEffects(): void {
  const effects = pendingModalEffects.splice(0);
  for (const effect of effects) effect();
}

async function renderCalendarSettingsModal(
  calendarValue?: BflowCalendar,
  eventCount = 4,
): Promise<ReactNode> {
  const CalendarSettingsModal = await loadCalendarSettingsModal();
  stateCursor = 0;
  modalRefCursor = 0;
  return resolveComponents(CalendarSettingsModal({
    calendar: calendarValue,
    eventCount,
    onClose: () => { settingsCloseCount += 1; },
  }));
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

test('ScheduleView opens calendar settings from both rail entry points', async () => {
  resetHarness();

  let tree = await renderScheduleView();
  buttonByTitle(tree, '사이드바 펼치기').props.onClick?.();
  tree = await renderScheduleView();
  buttonByLabel(tree, '레일 새 캘린더').props.onClick?.();
  tree = await renderScheduleView();
  assert.match(textContent(nodeByAriaLabel(tree, '캘린더 설정 모달')), /새 캘린더 연결됨/);

  resetHarness();
  tree = await renderScheduleView();
  buttonByTitle(tree, '사이드바 펼치기').props.onClick?.();
  tree = await renderScheduleView();
  buttonByLabel(tree, '레일 캘린더 설정').props.onClick?.();
  tree = await renderScheduleView();
  assert.match(
    textContent(nodeByAriaLabel(tree, '캘린더 설정 모달')),
    /설정 EP 마일스톤 일정 0개/,
    'ScheduleView passes the selected calendar and counts its current events',
  );
});

test('CalendarSettingsModal creates a members calendar atomically and reloads before closing', async () => {
  resetHarness();
  let tree = await renderCalendarSettingsModal();

  assert.match(textContent(tree), /새 캘린더/);
  assert.doesNotMatch(textContent(tree), /만든 날|일정 4개/, 'create mode has no metadata badge row');
  assert.equal(
    findButtons(tree).filter((button) => button.props['aria-label']?.startsWith('색상 ')).length,
    10,
    'the shared ten-color preset is available',
  );

  formElementByLabel(tree, '캘린더 이름').props.onChange?.({ target: { value: '컴포 TF', checked: false } });
  formElementByLabel(tree, '멤버 검색').props.onFocus?.();
  tree = await renderCalendarSettingsModal();
  buttonByLabel(tree, '장삐쭈 추가').props.onClick?.();
  tree = await renderCalendarSettingsModal();
  assert.match(textContent(tree), /2명 · 편집 0 · 보기 1/);
  assert.match(textContent(tree), /배한솔.*소유자.*변경 불가/);
  assert.ok(buttonByLabel(tree, '장삐쭈 제거'));

  await buttonByText(tree, '저장').props.onClick?.();

  assert.deepEqual(settingsApiCalls.map((call) => call.name), ['calendarCreate', 'loadAll']);
  assert.deepEqual(settingsApiCalls[0].args, [{
    name: '컴포 TF',
    color: '#6C5CE7',
    visibility: 'members',
    members: [{ user_id: 'user-jang', can_edit: false }],
  }]);
  assert.equal(settingsCloseCount, 1, 'the modal closes only after the canonical list reload succeeds');
});

test('CalendarSettingsModal edits visibility and members in permission-safe order', async (t) => {
  const shared = calendar({
    id: 'shared-settings',
    name: '리드 회의',
    ownerId: 'owner-lead',
    visibility: 'members',
    members: [
      { userId: myUserId, canEdit: true },
      { userId: 'user-jang', canEdit: false },
    ],
    canManage: true,
  });

  await t.test('a non-admin team owner saves name and color without resending guarded visibility or unchanged members', async () => {
    resetHarness();
    settingsCurrentUser = { ...settingsCurrentUser, role: 'user' };
    settingsUsers = [settingsCurrentUser, ...settingsUsers.filter((user) => user.id !== myUserId)];
    const ownedTeam = calendar({
      id: 'owned-team',
      name: '스튜디오 공지',
      ownerId: myUserId,
      visibility: 'team',
      members: [{ userId: 'user-jang', canEdit: true }],
      canManage: true,
    });
    let tree = await renderCalendarSettingsModal(ownedTeam, 9);

    formElementByLabel(tree, '캘린더 이름').props.onChange?.({ target: { value: '스튜디오 공지 수정', checked: false } });
    buttonByLabel(tree, '색상 #74B9FF').props.onClick?.();
    tree = await renderCalendarSettingsModal(ownedTeam, 9);
    await buttonByText(tree, '저장').props.onClick?.();

    assert.deepEqual(settingsApiCalls.map((call) => call.name), ['calendarUpdate', 'loadAll']);
    assert.deepEqual(settingsApiCalls[0].args, [
      'owned-team',
      { name: '스튜디오 공지 수정', color: '#74B9FF' },
    ]);
    assert.equal(settingsCloseCount, 1);
  });

  await t.test('a failed calendar update never starts the member replacement', async () => {
    resetHarness();
    settingsApiFailures.add('calendarUpdate');
    const tree = await renderCalendarSettingsModal(shared, 14);

    assert.match(textContent(tree), /소유자 허혜원.*만든 날 2026-08-24.*일정 14개/);
    assert.match(textContent(tree), /3명 · 편집 1 · 보기 1/);
    await buttonByText(tree, '저장').props.onClick?.();

    assert.deepEqual(settingsApiCalls.map((call) => call.name), ['calendarUpdate', 'loadAll']);
    assert.equal(settingsCloseCount, 0);
    assert.equal(settingsToastErrors.length, 1);
  });

  await t.test('a successful shared edit updates first, then replaces members, then reloads', async () => {
    resetHarness();
    let tree = await renderCalendarSettingsModal(shared, 14);
    buttonByLabel(tree, '장삐쭈 편집 권한').props.onClick?.();
    tree = await renderCalendarSettingsModal(shared, 14);
    await buttonByText(tree, '저장').props.onClick?.();

    assert.deepEqual(settingsApiCalls.map((call) => call.name), [
      'calendarUpdate', 'calendarSetMembers', 'loadAll',
    ]);
    assert.deepEqual(settingsApiCalls[1].args, [
      'shared-settings',
      [
        { user_id: myUserId, can_edit: true },
        { user_id: 'user-jang', can_edit: true },
      ],
    ]);
    assert.equal(settingsCloseCount, 1);
  });

  await t.test('switching to private relies on the atomic update and skips member replacement', async () => {
    resetHarness();
    let tree = await renderCalendarSettingsModal(shared, 14);
    formElementByLabel(tree, '나만').props.onChange?.({ target: { value: 'private', checked: true } });
    tree = await renderCalendarSettingsModal(shared, 14);
    await buttonByText(tree, '저장').props.onClick?.();

    assert.deepEqual(settingsApiCalls.map((call) => call.name), ['calendarUpdate', 'loadAll']);
    assert.deepEqual(settingsApiCalls[0].args, [
      'shared-settings',
      { visibility: 'private' },
    ]);
  });
});

test('CalendarSettingsModal hides personal sharing controls and gates team visibility to admins', async () => {
  resetHarness();
  const personal = calendar({ id: 'personal-settings', isPersonal: true, canManage: true });
  let tree = await renderCalendarSettingsModal(personal, 3);

  assert.ok(formElementByLabel(tree, '캘린더 이름'));
  assert.doesNotMatch(textContent(tree), /공개 범위|멤버|캘린더 삭제/);
  assert.equal(findFormElements(tree).some((element) => element.props.type === 'radio'), false);
  formElementByLabel(tree, '캘린더 이름').props.onChange?.({ target: { value: '내 일정', checked: false } });
  tree = await renderCalendarSettingsModal(personal, 3);
  await buttonByText(tree, '저장').props.onClick?.();
  assert.deepEqual(settingsApiCalls.map((call) => call.name), ['calendarUpdate', 'loadAll']);
  assert.deepEqual(
    settingsApiCalls[0].args,
    ['personal-settings', { name: '내 일정' }],
    'personal saves expose only fields that actually changed',
  );

  resetHarness();
  settingsCurrentUser = { ...settingsCurrentUser, role: 'user' };
  settingsUsers = [settingsCurrentUser, ...settingsUsers.filter((user) => user.id !== myUserId)];
  tree = await renderCalendarSettingsModal();
  assert.equal(formElementByLabel(tree, '팀 전체').props.disabled, true);
  assert.match(textContent(tree), /관리자만/);

  resetHarness();
  tree = await renderCalendarSettingsModal();
  assert.equal(formElementByLabel(tree, '팀 전체').props.disabled, false);
});

test('CalendarSettingsModal confirms destructive deletion and reloads on success or failure', async (t) => {
  const editable = calendar({ id: 'delete-me', name: '컴포 TF', canManage: true });

  await t.test('cancel leaves the calendar untouched; confirm deletes and reloads', async () => {
    resetHarness();
    settingsConfirmResponses = [false, true];
    const tree = await renderCalendarSettingsModal(editable, 7);

    await buttonByText(tree, '캘린더 삭제').props.onClick?.();
    assert.deepEqual(settingsApiCalls, []);
    await buttonByText(tree, '캘린더 삭제').props.onClick?.();

    assert.match(settingsConfirmMessages[0], /일정 7개가 함께 삭제돼요/);
    assert.deepEqual(settingsApiCalls.map((call) => call.name), ['calendarDelete', 'loadAll']);
    assert.deepEqual(settingsApiCalls[0].args, ['delete-me']);
    assert.equal(settingsCloseCount, 1);
  });

  await t.test('delete failure still reloads and keeps the modal open', async () => {
    resetHarness();
    settingsConfirmResponses = [true];
    settingsApiFailures.add('calendarDelete');
    const tree = await renderCalendarSettingsModal(editable, 7);
    await buttonByText(tree, '캘린더 삭제').props.onClick?.();

    assert.deepEqual(settingsApiCalls.map((call) => call.name), ['calendarDelete', 'loadAll']);
    assert.equal(settingsCloseCount, 0);
    assert.equal(settingsToastErrors.length, 1);
  });
});

test('CalendarSettingsModal treats reload failure as a save failure and keeps edits open', async () => {
  resetHarness();
  settingsLoadAllFailure = true;
  let tree = await renderCalendarSettingsModal();
  formElementByLabel(tree, '캘린더 이름').props.onChange?.({ target: { value: '재시도 캘린더', checked: false } });
  tree = await renderCalendarSettingsModal();
  await buttonByText(tree, '저장').props.onClick?.();

  assert.deepEqual(settingsApiCalls.map((call) => call.name), ['calendarCreate', 'loadAll']);
  assert.equal(settingsCloseCount, 0);
  assert.equal(settingsToastErrors.length, 1);
});

test('EventCreateModal shows editable calendars in field order, defaults personal, and removes legacy privacy and color controls', async () => {
  resetHarness();
  const tree = await renderEventCreateModal(true, () => {});
  const calendarSelect = formElementByLabel(tree, '캘린더');
  const optionText = textContent(calendarSelect);

  assert.equal(calendarSelect.props.value, 'mine', 'the personal calendar is the initial destination');
  assert.match(optionText, /EP 마일스톤/);
  assert.match(optionText, /리드 회의/);
  assert.match(optionText, /내 구글 캘린더/);
  assert.ok(optionText.endsWith('내 구글 캘린더'), 'Google stays after every editable B flow calendar');
  assert.doesNotMatch(optionText, /외부 보기/, 'view-only calendars cannot be selected for creation');

  const renderedText = textContent(tree);
  const fieldLabels = ['캘린더', '제목', '종일', '태그', '연결', '메모'];
  const fieldPositions = fieldLabels.map((label) => renderedText.indexOf(label));
  assert.ok(fieldPositions.every((position) => position >= 0), 'every required field is visible');
  assert.deepEqual(fieldPositions, [...fieldPositions].sort((a, b) => a - b), 'required fields stay in the specified order');
  assert.match(renderedText, /편집 권한이 있는 캘린더만 보여요/);
  assert.doesNotMatch(renderedText, /나만 보기/);
  assert.doesNotMatch(renderedText, /색상/);
  assert.equal(formElementByLabel(tree, '종일 일정').props.checked, true, 'all-day is enabled by default');
  assert.equal(findFormElements(tree).some((element) => element.props.type === 'time'), false, 'time fields stay hidden for all-day events');
  assert.doesNotMatch(renderedText, /팀 전원에게 알림이 가요|이 캘린더 멤버/, 'personal calendars do not show team notification copy');
});

test('EventCreateModal creates a tagged timed B flow event and rolls an empty end time into the next day', async () => {
  resetHarness();
  const saved: Record<string, unknown>[] = [];
  let tree = await renderEventCreateModal(false, (event) => saved.push(event), '2026-08-31');
  assert.doesNotMatch(textContent(formElementByLabel(tree, '캘린더')), /내 구글 캘린더/, 'Google is hidden while Task 3.3 reports unauthenticated');

  formElementByLabel(tree, '캘린더').props.onChange?.({ target: { value: 'team', checked: false } });
  tree = await renderEventCreateModal(false, (event) => saved.push(event), '2026-08-31');
  assert.match(textContent(tree), /팀 전원에게 알림이 가요/);

  formElementByLabel(tree, '캘린더').props.onChange?.({ target: { value: 'editable-share', checked: false } });
  tree = await renderEventCreateModal(false, (event) => saved.push(event), '2026-08-31');
  assert.match(textContent(tree), /이 캘린더 멤버 0명에게 알림이 가요/);

  formElementByLabel(tree, '종일 일정').props.onChange?.({ target: { checked: false, value: '' } });
  tree = await renderEventCreateModal(false, (event) => saved.push(event), '2026-08-31');
  assert.deepEqual(
    findFormElements(tree).filter((element) => element.props.type === 'time').map((element) => element.props.step),
    [600, 600],
    'both time controls use ten-minute steps',
  );

  formElementByLabel(tree, '시작 시각').props.onChange?.({ target: { value: '14:00', checked: false } });
  tree = await renderEventCreateModal(false, (event) => saved.push(event), '2026-08-31');
  assert.equal(formElementByLabel(tree, '종료 시각').props.value, '15:00', 'an empty end time defaults to one hour later');

  formElementByLabel(tree, '종료 시각').props.onChange?.({ target: { value: '', checked: false } });
  tree = await renderEventCreateModal(false, (event) => saved.push(event), '2026-08-31');
  formElementByLabel(tree, '시작 시각').props.onChange?.({ target: { value: '23:30', checked: false } });
  tree = await renderEventCreateModal(false, (event) => saved.push(event), '2026-08-31');
  assert.equal(formElementByLabel(tree, '종료 시각').props.value, '00:30');
  assert.equal(formElementByLabel(tree, '종료일').props.value, '2026-09-01', 'midnight rollover advances the end date');

  formElementByLabel(tree, '제목').props.onChange?.({ target: { value: '리드 회의', checked: false } });
  buttonByLabel(tree, '회의 태그').props.onClick?.();
  tree = await renderEventCreateModal(false, (event) => saved.push(event), '2026-08-31');
  assert.match(buttonByLabel(tree, '회의 태그').props.style?.background ?? '', /#FDCB6E/, 'the selected tag uses its saved color tint');
  buttonByText(tree, '만들기').props.onClick?.();

  assert.equal(saved.length, 1);
  assert.equal(saved[0].calendarId, 'editable-share');
  assert.equal(saved[0].tagId, 'tag-meeting');
  assert.equal(saved[0].allDay, false);
  assert.equal(saved[0].startTime, '23:30');
  assert.equal(saved[0].endTime, '00:30');
  assert.equal(saved[0].endDate, '2026-09-01');
});

test('EventCreateModal routes Google without a calendar ID and clears the disabled team tag choice', async () => {
  resetHarness();
  const saved: Record<string, unknown>[] = [];
  let tree = await renderEventCreateModal(true, (event) => saved.push(event));

  buttonByLabel(tree, '회의 태그').props.onClick?.();
  tree = await renderEventCreateModal(true, (event) => saved.push(event));
  formElementByLabel(tree, '캘린더').props.onChange?.({ target: { value: 'google', checked: false } });
  tree = await renderEventCreateModal(true, (event) => saved.push(event));

  assert.match(textContent(tree), /Google 일정에는 팀 태그를 붙일 수 없어요/);
  assert.equal(buttonByLabel(tree, '회의 태그').props.disabled, true);
  assert.equal(buttonByLabel(tree, '검수 태그').props.disabled, true);
  formElementByLabel(tree, '제목').props.onChange?.({ target: { value: '구글 일정', checked: false } });
  tree = await renderEventCreateModal(true, (event) => saved.push(event));
  buttonByText(tree, '만들기').props.onClick?.();

  assert.equal(saved.length, 1);
  assert.equal(Object.hasOwn(saved[0], 'calendarId'), false, 'Google uses the public route instead of the sentinel as a B flow ID');
  assert.equal(saved[0].tagId, undefined, 'Google submissions cannot keep an ignored team tag');
  assert.equal(saved[0].allDay, true);
  assert.equal(saved[0].startTime, undefined);
  assert.equal(saved[0].endTime, undefined);
});

test('EventCreateModal replaces only an untouched Google fallback when the personal calendar loads later', async () => {
  resetHarness();
  const loadedCalendars = calendarState.calendars;
  calendarState.calendars = [];

  let tree = await renderEventCreateModal(true, () => {});
  assert.equal(formElementByLabel(tree, '캘린더').props.value, 'google', 'Google is the temporary empty-store fallback');
  flushEventCreateEffects();

  calendarState.calendars = loadedCalendars;
  tree = await renderEventCreateModal(true, () => {});
  assert.equal(formElementByLabel(tree, '캘린더').props.value, 'google', 'the loading render still exposes the prior selection');
  flushEventCreateEffects();
  tree = await renderEventCreateModal(true, () => {});
  assert.equal(formElementByLabel(tree, '캘린더').props.value, 'mine', 'the first loaded personal calendar replaces the untouched fallback');

  flushEventCreateEffects();
  tree = await renderEventCreateModal(true, () => {});
  assert.equal(formElementByLabel(tree, '캘린더').props.value, 'mine', 'the correction stabilizes after one state transition');
});

test('EventCreateModal never overwrites an explicit Google or shared-calendar choice during later calendar loads', async (t) => {
  await t.test('explicit Google choice', async () => {
    resetHarness();
    const loadedCalendars = calendarState.calendars;
    calendarState.calendars = [];
    let tree = await renderEventCreateModal(true, () => {});
    formElementByLabel(tree, '캘린더').props.onChange?.({ target: { value: 'google', checked: false } });
    flushEventCreateEffects();

    calendarState.calendars = loadedCalendars;
    await renderEventCreateModal(true, () => {});
    flushEventCreateEffects();
    tree = await renderEventCreateModal(true, () => {});
    assert.equal(formElementByLabel(tree, '캘린더').props.value, 'google');
  });

  await t.test('explicit shared-calendar choice', async () => {
    resetHarness();
    const personal = calendarState.calendars.find((item) => item.id === 'mine');
    assert.ok(personal);
    calendarState.calendars = calendarState.calendars.filter((item) => item.id !== 'mine');
    let tree = await renderEventCreateModal(true, () => {});
    formElementByLabel(tree, '캘린더').props.onChange?.({ target: { value: 'editable-share', checked: false } });

    calendarState.calendars = [personal, ...calendarState.calendars];
    await renderEventCreateModal(true, () => {});
    flushEventCreateEffects();
    tree = await renderEventCreateModal(true, () => {});
    assert.equal(formElementByLabel(tree, '캘린더').props.value, 'editable-share');
  });
});
