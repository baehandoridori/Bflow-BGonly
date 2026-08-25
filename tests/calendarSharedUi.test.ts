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
type TagManagerPopoverProps = {
  anchorRect: DOMRect;
  onClose(): void;
};
type TagManagerPopoverComponent = (props: TagManagerPopoverProps) => ReactNode;
type ScheduleViewComponent = () => ReactNode;
type CalendarGridProps = {
  weeks: Date[][];
  events: ScheduleCalendarEvent[];
  today: string;
  currentMonth: number;
  maxVisibleBars: number;
  tagNameById: Record<string, string>;
  calendarNameById: Record<string, string>;
  onEventClick(event: ScheduleCalendarEvent): void;
};
type CalendarGridComponent = (props: CalendarGridProps) => ReactNode;
type ScheduleCalendarEvent = {
  id: string;
  title: string;
  memo: string;
  color: string;
  type: 'custom' | 'episode' | 'part' | 'scene' | 'vacation';
  startDate: string;
  endDate: string;
  createdBy: string;
  createdAt: string;
  source?: 'bflow' | 'google' | 'vacation';
  sourceCalendarId?: string;
  calendarId?: string;
  canEdit?: boolean;
  isReadOnly?: boolean;
  allDay?: boolean;
  startTime?: string;
  endTime?: string;
  tagId?: string;
};
type ScheduleGridProps = {
  events: ScheduleCalendarEvent[];
  tagNameById: Record<string, string>;
  calendarNameById: Record<string, string>;
  onEventClick(event: ScheduleCalendarEvent): void;
  onEventContextMenu(event: ScheduleCalendarEvent, mouse: { preventDefault(): void; stopPropagation(): void; clientX: number; clientY: number }): void;
};
type SchedulePanelProps = {
  event: ScheduleCalendarEvent;
  onUpdate(id: string, updates: Partial<ScheduleCalendarEvent>): void | Promise<void>;
};
type ScheduleQuickEditProps = {
  event: ScheduleCalendarEvent;
  onClose(): void;
  onUpdate(id: string, updates: Partial<ScheduleCalendarEvent>): void | Promise<void>;
  onDuplicate(event: ScheduleCalendarEvent): void | Promise<void>;
  [key: string]: unknown;
};
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
type WeekScrollViewProps = {
  currentMonth: number;
  currentYear: number;
  events: ScheduleCalendarEvent[];
  today: string;
  onEventClick(event: ScheduleCalendarEvent): void;
  onDateClick?(date: string): void;
  activeWeekIndex: number;
  onWeekChange(index: number): void;
  mode?: 'week' | '2week';
};
type WeekScrollViewModule = {
  default(props: WeekScrollViewProps): ReactNode;
  generateYearWeeks(year: number): Date[][];
  findWeekIndexForDate(weeks: Date[][], date: string): number;
};
type DayScrollViewProps = {
  events: ScheduleCalendarEvent[];
  activeDayIndex: number;
  onActiveDayChange(index: number): void;
  onEventClick?(event: ScheduleCalendarEvent): void;
  onDateClick?(date: string): void;
  year: number;
};
type DayScrollViewComponent = (props: DayScrollViewProps) => ReactNode;

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
let tagManagerRefSlots: Array<{ current: unknown }> = [];
let tagManagerRefCursor = 0;
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
let bundledTagManagerPopover: Promise<TagManagerPopoverComponent> | undefined;
let bundledScheduleView: Promise<ScheduleViewComponent> | undefined;
let bundledCalendarGrid: Promise<CalendarGridComponent> | undefined;
let bundledEventCreateModal: Promise<EventCreateModalComponent> | undefined;
let bundledCalendarSettingsModal: Promise<CalendarSettingsModalComponent> | undefined;
let bundledWeekScrollView: Promise<WeekScrollViewModule> | undefined;
let bundledDayScrollView: Promise<DayScrollViewComponent> | undefined;
let scheduleTagBarProps: TagBarProps[] = [];
let scheduleTagManagerProps: TagManagerPopoverProps[] = [];
let scheduleGridProps: ScheduleGridProps[] = [];
let schedulePanelProps: SchedulePanelProps[] = [];
let scheduleQuickEditProps: ScheduleQuickEditProps[] = [];
let scheduleCanonicalEvents: ScheduleCalendarEvent[] = [];
let scheduleUpdateCalls: Array<{ id: string; updates: Partial<ScheduleCalendarEvent> }> = [];
let scheduleUpdateHandler: ((id: string, updates: Partial<ScheduleCalendarEvent>) => Promise<void>) | undefined;
let scheduleAddedEvents: ScheduleCalendarEvent[] = [];
let scheduleGetEventsCalls = 0;
let schedulePendingEffects: Array<() => void | (() => void)> = [];
let scheduleLoadAllCalls = 0;
let scheduleLoadBflowEventsCalls = 0;
let settingsCurrentUser: TestUser;
let settingsUsers: TestUser[] = [];
let settingsApiCalls: Array<{ name: string; args: unknown[] }> = [];
let settingsApiFailures = new Set<string>();
let settingsMetadataFreshness = { calendarsFresh: true, tagsFresh: true };
let settingsBflowReloadResult = true;
let settingsCanonicalCalendarsAfterReload: BflowCalendar[] | null = null;
let settingsRefreshCount = 0;
let settingsApiGate: Promise<void> | null = null;
let resolveSettingsApiGate: (() => void) | null = null;
let settingsRefreshGate: Promise<void> | null = null;
let resolveSettingsRefreshGate: (() => void) | null = null;
let settingsConfirmResponses: boolean[] = [];
let settingsConfirmMessages: string[] = [];
let settingsToastErrors: string[] = [];
let settingsToastSuccesses: string[] = [];
let settingsCloseCount = 0;
let tagManagerApiCalls: Array<{ name: string; args: unknown[] }> = [];
let tagManagerApiFailures = new Set<string>();
let tagManagerMetadataFreshness = { calendarsFresh: true, tagsFresh: true };
let tagManagerCanonicalTagsAfterReload: Array<{
  id: string;
  name: string;
  color: string;
  sortOrder: number;
}> | null = null;
let tagManagerLastCommittedTags: Array<{
  id: string;
  name: string;
  color: string;
  sortOrder: number;
}> | null = null;
let tagManagerConfirmResponses: boolean[] = [];
let tagManagerConfirmMessages: string[] = [];
let tagManagerToastErrors: string[] = [];
let tagManagerCloseCount = 0;
let tagManagerGeneratedId = 0;
let tagManagerSaveGate: Promise<void> | null = null;
let resolveTagManagerSaveGate: (() => void) | null = null;
let tagManagerRefreshGate: Promise<void> | null = null;
let resolveTagManagerRefreshGate: (() => void) | null = null;

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

function directElementChildren(node: ReactElement<Record<string, unknown>>): ReactElement<Record<string, unknown>>[] {
  const flatten = (value: ReactNode): ReactElement<Record<string, unknown>>[] => {
    if (Array.isArray(value)) return value.flatMap(flatten);
    return isValidElement(value) ? [value as ReactElement<Record<string, unknown>>] : [];
  };
  return flatten(node.props.children as ReactNode);
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
  tagManagerRefSlots = [];
  tagManagerRefCursor = 0;
  openedSettings = [];
  createdCount = 0;
  appViews = [];
  scheduleTagBarProps = [];
  scheduleTagManagerProps = [];
  scheduleGridProps = [];
  schedulePanelProps = [];
  scheduleQuickEditProps = [];
  scheduleCanonicalEvents = [];
  scheduleUpdateCalls = [];
  scheduleUpdateHandler = undefined;
  scheduleAddedEvents = [];
  scheduleGetEventsCalls = 0;
  schedulePendingEffects = [];
  scheduleLoadAllCalls = 0;
  scheduleLoadBflowEventsCalls = 0;
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
  settingsMetadataFreshness = { calendarsFresh: true, tagsFresh: true };
  settingsBflowReloadResult = true;
  settingsCanonicalCalendarsAfterReload = null;
  settingsRefreshCount = 0;
  settingsApiGate = null;
  resolveSettingsApiGate = null;
  settingsRefreshGate = null;
  resolveSettingsRefreshGate = null;
  settingsConfirmResponses = [];
  settingsConfirmMessages = [];
  settingsToastErrors = [];
  settingsToastSuccesses = [];
  settingsCloseCount = 0;
  bundledCalendarSettingsModal = undefined;
  tagManagerApiCalls = [];
  tagManagerApiFailures = new Set();
  tagManagerMetadataFreshness = { calendarsFresh: true, tagsFresh: true };
  tagManagerCanonicalTagsAfterReload = null;
  tagManagerLastCommittedTags = null;
  tagManagerConfirmResponses = [];
  tagManagerConfirmMessages = [];
  tagManagerToastErrors = [];
  tagManagerCloseCount = 0;
  tagManagerGeneratedId = 0;
  tagManagerSaveGate = null;
  resolveTagManagerSaveGate = null;
  tagManagerRefreshGate = null;
  resolveTagManagerRefreshGate = null;
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

async function loadTagManagerPopover(): Promise<TagManagerPopoverComponent> {
  bundledTagManagerPopover ??= build({
    entryPoints: ['src/components/calendar/TagManagerPopover.tsx'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    write: false,
    external: [
      'react', 'react/jsx-runtime', 'react-dom', 'lucide-react', 'sonner',
      '@/components/common/ConfirmDialog', '@/stores/useAuthStore', '@/stores/useCalendarStore',
      '@/services/calendarService',
      '@/types/calendar', '@/utils/glassStyles',
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
          tags: calendarState.tags,
          async loadAll() {
            tagManagerApiCalls.push({ name: 'loadAll', args: [] });
            if (tagManagerRefreshGate) await tagManagerRefreshGate;
            const canonicalTags = tagManagerCanonicalTagsAfterReload ?? tagManagerLastCommittedTags;
            if (tagManagerMetadataFreshness.tagsFresh && canonicalTags) {
              calendarState.tags = canonicalTags.map((tag) => ({ ...tag }));
            }
            return tagManagerMetadataFreshness;
          },
        }),
      },
    );
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
          useLayoutEffect: () => {},
          useRef(initial: unknown) {
            const slot = tagManagerRefCursor++;
            tagManagerRefSlots[slot] ??= { current: initial };
            return tagManagerRefSlots[slot];
          },
          useCallback: (fn: unknown) => fn,
          useMemo: (factory: () => unknown) => factory(),
          useSyncExternalStore: (
            _subscribe: (listener: () => void) => () => void,
            getSnapshot: () => unknown,
          ) => getSnapshot(),
        };
      }
      if (id === 'react/jsx-runtime') return jsxRuntime;
      if (id === 'react-dom') return { createPortal: (children: ReactNode) => children };
      if (id === 'lucide-react') {
        return {
          Check: emptyComponent, ChevronDown: emptyComponent, ChevronUp: emptyComponent,
          Pencil: emptyComponent, Plus: emptyComponent, Trash2: emptyComponent, X: emptyComponent,
        };
      }
      if (id === 'sonner') return { toast: { error: (message: string) => tagManagerToastErrors.push(message) } };
      if (id === '@/components/common/ConfirmDialog') {
        return {
          ConfirmDialog: {
            async show(options: { message: string }) {
              tagManagerConfirmMessages.push(options.message);
              return tagManagerConfirmResponses.shift() ?? false;
            },
          },
        };
      }
      if (id === '@/stores/useAuthStore') {
        return {
          useAuthStore: (selector: (state: { currentUser: TestUser }) => unknown) => selector({ currentUser: settingsCurrentUser }),
        };
      }
      if (id === '@/stores/useCalendarStore') return { useCalendarStore: useCalendarStoreMock };
      if (id === '@/services/calendarService') {
        return {
          async loadBflowEvents(...args: unknown[]) {
            tagManagerApiCalls.push({ name: 'loadBflowEvents', args });
            if (tagManagerRefreshGate) await tagManagerRefreshGate;
            const options = args[0] as { requireTagsFresh?: boolean } | undefined;
            const refreshed = options?.requireTagsFresh !== true || tagManagerMetadataFreshness.tagsFresh;
            const canonicalTags = tagManagerCanonicalTagsAfterReload ?? tagManagerLastCommittedTags;
            if (refreshed && canonicalTags) {
              calendarState.tags = canonicalTags.map((tag) => ({ ...tag }));
            }
            return refreshed;
          },
        };
      }
      if (id === '@/types/calendar') {
        return {
          EVENT_COLORS: [
            '#6C5CE7', '#74B9FF', '#00B894', '#FDCB6E', '#E17055',
            '#FF6B6B', '#A29BFE', '#55EFC4', '#FF9FF3', '#48DBFB',
          ],
        };
      }
      if (id === '@/utils/glassStyles') return { floatingGlassStyle: {} };
      return nodeRequire(id);
    }, module, module.exports);
    Object.assign(globalThis, {
      document: { body: {}, addEventListener() {}, removeEventListener() {} },
      window: {
        innerWidth: 1120,
        innerHeight: 720,
        electronAPI: {
          async calendarTagsSave(...args: unknown[]) {
            tagManagerApiCalls.push({ name: 'calendarTagsSave', args });
            if (tagManagerSaveGate) await tagManagerSaveGate;
            if (tagManagerApiFailures.has('calendarTagsSave')) throw new Error('save failed');
            const submitted = args[0] as Array<{
              id?: string;
              name: string;
              color: string;
              sort_order: number;
            }>;
            const saved = submitted.map((tag) => ({
              ...tag,
              id: tag.id ?? `tag-generated-${++tagManagerGeneratedId}`,
            }));
            tagManagerLastCommittedTags = saved.map((tag) => ({
              id: tag.id,
              name: tag.name,
              color: tag.color,
              sortOrder: tag.sort_order,
            }));
            return saved;
          },
        },
      },
    });
    return module.exports.TagManagerPopover as TagManagerPopoverComponent;
  });
  return bundledTagManagerPopover;
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
      '@/components/calendar/TagBar', '@/components/calendar/TagManagerPopover', '@/components/calendar/CalendarSettingsModal',
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
          useEffect(effect: () => void | (() => void)) {
            schedulePendingEffects.push(effect);
          },
          useMemo: (factory: () => unknown) => factory(), useCallback: (fn: unknown) => fn,
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
      if (id === '@/services/calendarService') return {
        getEvents: async () => {
          scheduleGetEventsCalls += 1;
          return scheduleCanonicalEvents;
        },
        isGoogleCacheReady: () => true,
        loadBflowEvents: async () => {
          scheduleLoadBflowEventsCalls += 1;
          return true;
        },
        addEvent: async (event: ScheduleCalendarEvent) => { scheduleAddedEvents.push(event); },
        updateEvent: async (id: string, updates: Partial<ScheduleCalendarEvent>) => {
          scheduleUpdateCalls.push({ id, updates });
          await scheduleUpdateHandler?.(id, updates);
        },
        deleteEvent: async () => {},
      };
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
      if (id === '@/components/calendar/TagManagerPopover') {
        return {
          TagManagerPopover: (props: TagManagerPopoverProps) => {
            scheduleTagManagerProps.push(props);
            return jsxRuntime.jsx('div', { 'aria-label': '태그 관리 팝오버 연결됨', children: '태그 관리 팝오버' });
          },
        };
      }
      if (id === '@/components/calendar/CalendarSettingsModal') {
        return {
          CalendarSettingsModal: (props: CalendarSettingsModalProps) => jsxRuntime.jsx('div', {
            'aria-label': '캘린더 설정 모달',
            children: props.calendar ? `설정 ${props.calendar.name} 일정 ${props.eventCount}개` : '새 캘린더 연결됨',
          }),
        };
      }
      if (id === '@/hooks/useCalendarDragCreate') return { useCalendarDragCreate: () => ({ handleCellMouseDown() {}, isDateInRange: () => false }) };
      if (id === '@/stores/useCalendarStore') {
        const useCalendarStore = Object.assign(
          (selector: (state: typeof calendarState) => unknown) => selector(calendarState),
          {
            getState: () => ({
              ...calendarState,
              async loadAll() {
                scheduleLoadAllCalls += 1;
                return { calendarsFresh: true, tagsFresh: true };
              },
            }),
          },
        );
        return { useCalendarStore };
      }
      if (id === '@/utils/sceneNavigationAction') return { navigateToSceneView() {} };
      if (id === '@/utils/createUuid') return { createUuid: () => 'new-id' };
      if (id === '@/utils/calendarDate') return { fmtDate: () => '2026-08-25', parseDate: (date: string) => new Date(`${date}T12:00:00`), addDays: (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12) };
      if (id === '@/utils/calendarEventFilter') return { filterCalendarEvents: (events: unknown[]) => events };
      if (id === '@/components/calendar/CalendarGrid') {
        return { CalendarGrid: (props: ScheduleGridProps) => { scheduleGridProps.push(props); return jsxRuntime.jsx('div', { children: '캘린더 그리드' }); } };
      }
      if (id === '@/components/calendar/EventSidePanel') {
        return { EventSidePanel: (props: SchedulePanelProps) => { schedulePanelProps.push(props); return jsxRuntime.jsx('div', { 'aria-label': '일정 상세 패널 연결됨', children: props.event.title }); } };
      }
      if (id === '@/components/calendar/EventQuickEdit') {
        return { EventQuickEdit: (props: ScheduleQuickEditProps) => { scheduleQuickEditProps.push(props); return jsxRuntime.jsx('div', { 'aria-label': '일정 퀵에디트 연결됨', children: props.event.title }); } };
      }
      if (id.startsWith('@/components/calendar/')) return Object.fromEntries([[id.split('/').at(-1)?.replace(/\.tsx$/, ''), emptyComponent]]);
      return nodeRequire(id);
    }, module, module.exports);
    Object.assign(globalThis, {
      document: { addEventListener() {}, removeEventListener() {} },
      window: {
        addEventListener() {},
        removeEventListener() {},
        electronAPI: { async gcalIsAuthenticated() { return false; } },
      },
    });
    return module.exports.ScheduleView as ScheduleViewComponent;
  });
  return bundledScheduleView;
}

async function loadCalendarGrid(): Promise<CalendarGridComponent> {
  bundledCalendarGrid ??= build({
    entryPoints: ['src/components/calendar/CalendarGrid.tsx'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    write: false,
    external: [
      'react', 'react/jsx-runtime', 'react-dom', 'framer-motion', 'lucide-react',
      '@/utils/cn',
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
          useMemo: (factory: () => unknown) => factory(),
          useRef: (initial: unknown) => ({ current: initial }),
        };
      }
      if (id === 'react/jsx-runtime') return jsxRuntime;
      if (id === 'react-dom') return { createPortal: (children: ReactNode) => children };
      if (id === 'framer-motion') return {
        AnimatePresence: ({ children }: { children: ReactNode }) => children,
        motion: { div: 'div' },
      };
      if (id === 'lucide-react') return { CheckSquare: emptyComponent, Palmtree: emptyComponent, X: emptyComponent };
      if (id === '@/utils/cn') return { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') };
      return nodeRequire(id);
    }, module, module.exports);
    return module.exports.CalendarGrid as CalendarGridComponent;
  });
  return bundledCalendarGrid;
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
      '@/services/calendarService',
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
          calendars: calendarState.calendars,
          async loadAll() {
            settingsApiCalls.push({ name: 'loadAll', args: [] });
            if (settingsRefreshGate) await settingsRefreshGate;
            settingsRefreshCount += 1;
            if (settingsMetadataFreshness.calendarsFresh && settingsCanonicalCalendarsAfterReload) {
              calendarState.calendars = settingsCanonicalCalendarsAfterReload.map((item) => ({
                ...item,
                members: item.members.map((member) => ({ ...member })),
              }));
            }
            return settingsMetadataFreshness;
          },
        }),
      },
    );
    const callApi = async (name: string, args: unknown[]) => {
      settingsApiCalls.push({ name, args });
      if (settingsApiGate) await settingsApiGate;
      if (settingsApiFailures.has(name)) throw new Error(`${name} failed`);
      const input = args[0] as { name?: string; color?: string; visibility?: BflowCalendar['visibility'] } | undefined;
      return {
        id: 'created-calendar',
        name: String(input?.name ?? ''),
        color: input?.color ?? '#6C5CE7',
        visibility: input?.visibility ?? 'members',
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
          useSyncExternalStore: (
            _subscribe: (listener: () => void) => () => void,
            getSnapshot: () => unknown,
          ) => getSnapshot(),
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
        const useAuthStoreMock = Object.assign(
          (selector: (state: { currentUser: TestUser; users: TestUser[] }) => unknown) => selector({
            currentUser: settingsCurrentUser,
            users: settingsUsers,
          }),
          {
            getState: () => ({
              currentUser: settingsCurrentUser,
              users: settingsUsers,
            }),
          },
        );
        return { useAuthStore: useAuthStoreMock };
      }
      if (id === '@/stores/useCalendarStore') return { useCalendarStore: useCalendarStoreMock };
      if (id === '@/services/calendarService') {
        return {
          async loadBflowEvents() {
            settingsApiCalls.push({ name: 'loadBflowEvents', args: [] });
            if (settingsRefreshGate) await settingsRefreshGate;
            settingsRefreshCount += 1;
            if (settingsBflowReloadResult && settingsCanonicalCalendarsAfterReload) {
              calendarState.calendars = settingsCanonicalCalendarsAfterReload.map((item) => ({
                ...item,
                members: item.members.map((member) => ({ ...member })),
              }));
            }
            return settingsBflowReloadResult;
          },
        };
      }
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

async function loadWeekScrollView(): Promise<WeekScrollViewModule> {
  bundledWeekScrollView ??= build({
    entryPoints: ['src/components/calendar/WeekScrollView.tsx'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    write: false,
    external: [
      'react', 'react/jsx-runtime', 'framer-motion', 'lucide-react',
      '@/stores/useCalendarStore',
    ],
  }).then((result) => {
    const module = { exports: {} as Record<string, unknown> };
    const nodeRequire = createRequire(import.meta.url);
    const react = nodeRequire('react') as Record<string, unknown>;
    const jsxRuntime = nodeRequire('react/jsx-runtime');
    const evaluate = new Function('require', 'module', 'exports', result.outputFiles[0].text);
    evaluate((id: string) => {
      if (id === 'react') {
        return {
          ...react,
          useMemo: (factory: () => unknown) => factory(),
          useRef: (initial: unknown) => ({ current: initial }),
          useCallback: (fn: unknown) => fn,
        };
      }
      if (id === 'react/jsx-runtime') return jsxRuntime;
      if (id === 'framer-motion') {
        return {
          AnimatePresence: ({ children }: { children: ReactNode }) => children,
          motion: { div: 'div' },
        };
      }
      if (id === 'lucide-react') return { CalendarDays: () => null };
      if (id === '@/stores/useCalendarStore') {
        return { useCalendarStore: (selector: (state: typeof calendarState) => unknown) => selector(calendarState) };
      }
      return nodeRequire(id);
    }, module, module.exports);
    return module.exports as unknown as WeekScrollViewModule;
  });
  return bundledWeekScrollView;
}

async function loadDayScrollView(): Promise<DayScrollViewComponent> {
  bundledDayScrollView ??= build({
    entryPoints: ['src/components/calendar/DayScrollView.tsx'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    write: false,
    external: [
      'react', 'react/jsx-runtime', 'framer-motion', 'lucide-react',
      '@/stores/useCalendarStore',
    ],
  }).then((result) => {
    const module = { exports: {} as Record<string, unknown> };
    const nodeRequire = createRequire(import.meta.url);
    const react = nodeRequire('react') as Record<string, unknown>;
    const jsxRuntime = nodeRequire('react/jsx-runtime');
    const evaluate = new Function('require', 'module', 'exports', result.outputFiles[0].text);
    evaluate((id: string) => {
      if (id === 'react') {
        return {
          ...react,
          useMemo: (factory: () => unknown) => factory(),
          useRef: (initial: unknown) => ({ current: initial }),
          useCallback: (fn: unknown) => fn,
        };
      }
      if (id === 'react/jsx-runtime') return jsxRuntime;
      if (id === 'framer-motion') {
        return {
          AnimatePresence: ({ children }: { children: ReactNode }) => children,
          motion: { div: 'div' },
        };
      }
      if (id === 'lucide-react') return { CalendarDays: () => null };
      if (id === '@/stores/useCalendarStore') {
        return { useCalendarStore: (selector: (state: typeof calendarState) => unknown) => selector(calendarState) };
      }
      return nodeRequire(id);
    }, module, module.exports);
    return module.exports.default as DayScrollViewComponent;
  });
  return bundledDayScrollView;
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

async function renderTagManagerPopover(
  anchorRect = { left: 940, right: 1028, top: 640, bottom: 668, width: 88, height: 28 } as DOMRect,
): Promise<ReactNode> {
  const TagManagerPopover = await loadTagManagerPopover();
  stateCursor = 0;
  tagManagerRefCursor = 0;
  return resolveComponents(TagManagerPopover({
    anchorRect,
    onClose: () => { tagManagerCloseCount += 1; },
  }));
}

async function renderScheduleView(): Promise<ReactNode> {
  const ScheduleView = await loadScheduleView();
  stateCursor = 0;
  return resolveComponents(ScheduleView());
}

async function flushScheduleMountEffects(): Promise<void> {
  const effects = schedulePendingEffects.splice(0);
  const cleanups: Array<() => void> = [];
  for (const effect of effects) {
    const cleanup = effect();
    if (typeof cleanup === 'function') cleanups.push(cleanup);
  }
  await new Promise<void>((resolve) => setImmediate(resolve));
  for (const cleanup of cleanups.reverse()) cleanup();
}

async function renderCalendarGrid(events: ScheduleCalendarEvent[]): Promise<ReactNode> {
  const CalendarGrid = await loadCalendarGrid();
  stateSlots = [];
  stateCursor = 0;
  const week = Array.from({ length: 7 }, (_, index) => new Date(2026, 7, 23 + index, 12));
  return resolveComponents(CalendarGrid({
    weeks: [week],
    events,
    today: '2026-08-25',
    currentMonth: 7,
    maxVisibleBars: 6,
    tagNameById: { 'tag-meeting': '회의' },
    calendarNameById: { mine: 'EP 마일스톤', team: '스튜디오 공지' },
    onEventClick() {},
  }));
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
  onClose: () => void = () => { settingsCloseCount += 1; },
): Promise<ReactNode> {
  const CalendarSettingsModal = await loadCalendarSettingsModal();
  if (
    calendarValue
    && settingsRefreshCount === 0
    && !calendarState.calendars.some((item) => item.id === calendarValue.id)
  ) {
    calendarState.calendars = [...calendarState.calendars, {
      ...calendarValue,
      members: calendarValue.members.map((member) => ({ ...member })),
    }];
  }
  stateCursor = 0;
  modalRefCursor = 0;
  return resolveComponents(CalendarSettingsModal({
    calendar: calendarValue,
    eventCount,
    onClose,
  }));
}

function calendarListEvent(overrides: Partial<ScheduleCalendarEvent>): ScheduleCalendarEvent {
  return {
    id: 'list-event',
    title: '목록 일정',
    memo: '',
    color: '#6C5CE7',
    type: 'scene',
    startDate: '2026-08-25',
    endDate: '2026-08-25',
    createdBy: myUserId,
    createdAt: '2026-08-24T00:00:00.000Z',
    source: 'bflow',
    calendarId: 'mine',
    allDay: true,
    ...overrides,
  };
}

function activeDayIndex(year: number, month: number, day: number): number {
  const jan1 = new Date(year, 0, 1, 12, 0, 0, 0);
  const target = new Date(year, month, day, 12, 0, 0, 0);
  return Math.round((target.getTime() - jan1.getTime()) / 86_400_000);
}

function assertCalendarListCards(
  tree: ReactNode,
  events: ScheduleCalendarEvent[],
  subtitleFontSize: number,
): ReactElement<Record<string, unknown>>[] {
  const scrollLists = findElements(tree, (element) => element.props['data-scroll-events'] === true);
  assert.equal(scrollLists.length, 1, 'only the active card list owns the scroll marker');
  const cards = directElementChildren(scrollLists[0]).slice(0, events.length);
  const titles = events.map((event) => event.title);

  assert.deepEqual(
    cards.map((card) => titles.find((title) => textContent(card).includes(title))),
    ['A 종일 태그', 'B 종일 없음', 'C 오전 회의', 'D 오후 회의'],
    'all-day cards precede timed cards and timed cards sort by start time',
  );

  const subtitles = cards.map((card) => {
    const candidates = findElements(card, (element) => {
      const style = element.props.style as { fontSize?: number } | undefined;
      return style?.fontSize === subtitleFontSize;
    });
    assert.ok(candidates.length <= 1, 'each card has at most one subtitle');
    return candidates[0] ? textContent(candidates[0]) : null;
  });
  assert.deepEqual(subtitles, [
    '회의',
    null,
    '09:00 – 10:00 · 회의',
    '14:00 – 15:00 · 회의',
  ]);
  assert.doesNotMatch(textContent(scrollLists[0]), /scene|종일 ·|8\/25|→/);
  return cards;
}

test('WeekScrollView and DayScrollView sort active cards and render tag-aware time subtitles', async (t) => {
  const late = calendarListEvent({
    id: 'late', title: 'D 오후 회의', allDay: false,
    startTime: '14:00', endTime: '15:00', tagId: 'tag-meeting',
  });
  const allDayWithoutTag = calendarListEvent({ id: 'all-none', title: 'B 종일 없음' });
  const early = calendarListEvent({
    id: 'early', title: 'C 오전 회의', allDay: false,
    startTime: '09:00', endTime: '10:00', tagId: 'tag-meeting',
  });
  const allDayWithTag = calendarListEvent({ id: 'all-tag', title: 'A 종일 태그', tagId: 'tag-meeting' });
  const events = [late, allDayWithoutTag, early, allDayWithTag];

  await t.test('week active list', async () => {
    resetHarness();
    const weekModule = await loadWeekScrollView();
    const weeks = weekModule.generateYearWeeks(2026);
    const clicked: ScheduleCalendarEvent[] = [];
    let stopped = false;
    const tree = resolveComponents(weekModule.default({
      currentMonth: 7,
      currentYear: 2026,
      events,
      today: '2026-08-25',
      onEventClick: (event) => clicked.push(event),
      activeWeekIndex: weekModule.findWeekIndexForDate(weeks, '2026-08-25'),
      onWeekChange() {},
    }));

    const cards = assertCalendarListCards(tree, events, 9);
    (cards[2].props.onClick as (event: { stopPropagation(): void }) => void)({
      stopPropagation: () => { stopped = true; },
    });
    assert.equal(stopped, true);
    assert.equal(clicked[0], early, 'the sorted card still forwards the original event object');
  });

  await t.test('day active list', async () => {
    resetHarness();
    const DayScrollView = await loadDayScrollView();
    const clicked: ScheduleCalendarEvent[] = [];
    let stopped = false;
    const tree = resolveComponents(DayScrollView({
      events,
      activeDayIndex: activeDayIndex(2026, 7, 25),
      onActiveDayChange() {},
      onEventClick: (event) => clicked.push(event),
      year: 2026,
    }));

    const cards = assertCalendarListCards(tree, events, 10);
    (cards[2].props.onClick as (event: { stopPropagation(): void }) => void)({
      stopPropagation: () => { stopped = true; },
    });
    assert.equal(stopped, true);
    assert.equal(clicked[0], early, 'the sorted card still forwards the original event object');
  });
});

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

test('TagManagerPopover lets admins edit, reorder, and add tags with canonical full-list saves', async (t) => {
  await t.test('editing one row sends every tag in the visible order and reloads', async () => {
    resetHarness();
    let tree = await renderTagManagerPopover();
    const initialText = textContent(tree);
    assert.ok(initialText.indexOf('검수') < initialText.indexOf('회의'), 'saved sort order controls the row order');
    assert.match(initialText, /휴가는 자동 태그라 여기서 바꿀 수 없어요/);
    assert.equal(initialText.match(/휴가/g)?.length, 1, 'vacation is guidance, not a managed tag row');

    buttonByLabel(tree, '회의 태그 편집').props.onClick?.();
    tree = await renderTagManagerPopover();
    formElementByLabel(tree, '회의 태그 이름').props.onChange?.({ target: { value: '회의록', checked: false } });
    tree = await renderTagManagerPopover();
    await buttonByLabel(tree, '회의 태그 저장').props.onClick?.();

    assert.deepEqual(tagManagerApiCalls.map((call) => call.name), ['calendarTagsSave', 'loadAll']);
    assert.deepEqual(tagManagerApiCalls[0].args, [[
      { id: 'tag-review', name: '검수', color: '#00B894', sort_order: 0 },
      { id: 'tag-meeting', name: '회의록', color: '#FDCB6E', sort_order: 1 },
    ]]);
    assert.equal(tagManagerCloseCount, 0, 'row saves keep the manager open');
  });

  await t.test('reordering renumbers the canonical payload', async () => {
    resetHarness();
    const tree = await renderTagManagerPopover();
    assert.equal(buttonByLabel(tree, '검수 태그 위로').props.disabled, true);
    await buttonByLabel(tree, '회의 태그 위로').props.onClick?.();

    assert.deepEqual(tagManagerApiCalls.map((call) => call.name), ['calendarTagsSave', 'loadAll']);
    assert.deepEqual(tagManagerApiCalls[0].args, [[
      { id: 'tag-meeting', name: '회의', color: '#FDCB6E', sort_order: 0 },
      { id: 'tag-review', name: '검수', color: '#00B894', sort_order: 1 },
    ]]);
  });

  await t.test('adding a row omits a fake id and preserves the selected preset color', async () => {
    resetHarness();
    let tree = await renderTagManagerPopover();
    buttonByText(tree, '새 태그').props.onClick?.();
    tree = await renderTagManagerPopover();
    formElementByLabel(tree, '새 태그 이름').props.onChange?.({ target: { value: '리뷰', checked: false } });
    tree = await renderTagManagerPopover();
    buttonByLabel(tree, '#E17055 태그 색상').props.onClick?.();
    tree = await renderTagManagerPopover();
    await buttonByLabel(tree, '새 태그 저장').props.onClick?.();

    assert.deepEqual(tagManagerApiCalls.map((call) => call.name), ['calendarTagsSave', 'loadAll']);
    assert.deepEqual(tagManagerApiCalls[0].args, [[
      { id: 'tag-review', name: '검수', color: '#00B894', sort_order: 0 },
      { id: 'tag-meeting', name: '회의', color: '#FDCB6E', sort_order: 1 },
      { name: '리뷰', color: '#E17055', sort_order: 2 },
    ]]);
  });

  await t.test('a warmed tag-list failure reports an error but keeps the committed reorder', async () => {
    resetHarness();
    tagManagerMetadataFreshness = { calendarsFresh: true, tagsFresh: false };
    let tree = await renderTagManagerPopover();
    await buttonByLabel(tree, '회의 태그 위로').props.onClick?.();
    tree = await renderTagManagerPopover();

    assert.deepEqual(tagManagerApiCalls.map((call) => call.name), ['calendarTagsSave', 'loadAll']);
    assert.equal(tagManagerToastErrors.length, 1);
    const committedText = textContent(tree);
    assert.ok(
      committedText.indexOf('회의') < committedText.indexOf('검수'),
      'a committed reorder is not rolled back only because reconciliation failed',
    );
    assert.ok(buttonByLabel(tree, '최신 태그 목록 다시 불러오기'));

    tagManagerMetadataFreshness = { calendarsFresh: true, tagsFresh: true };
    tagManagerCanonicalTagsAfterReload = [
      { id: 'tag-meeting', name: '회의', color: '#FDCB6E', sortOrder: 0 },
      { id: 'tag-review', name: '검수', color: '#00B894', sortOrder: 1 },
    ];
    await buttonByLabel(tree, '최신 태그 목록 다시 불러오기').props.onClick?.();
  });

  await t.test('a committed new tag adopts its returned UUID before a failed reconciliation', async () => {
    resetHarness();
    tagManagerMetadataFreshness = { calendarsFresh: true, tagsFresh: false };
    let tree = await renderTagManagerPopover();
    buttonByText(tree, '새 태그').props.onClick?.();
    tree = await renderTagManagerPopover();
    formElementByLabel(tree, '새 태그 이름').props.onChange?.({ target: { value: '리뷰', checked: false } });
    tree = await renderTagManagerPopover();
    await buttonByLabel(tree, '새 태그 저장').props.onClick?.();
    tree = await renderTagManagerPopover();

    assert.equal(tagManagerToastErrors.length, 1);
    assert.match(tagManagerToastErrors[0], /저장됐지만/, 'the message distinguishes commit from reload failure');
    assert.ok(buttonByLabel(tree, '리뷰 태그 편집'), 'the committed row remains rendered after reload failure');

    tagManagerMetadataFreshness = { calendarsFresh: true, tagsFresh: true };
    await buttonByLabel(tree, '리뷰 태그 위로').props.onClick?.();
    assert.deepEqual(tagManagerApiCalls.at(-2)?.args, [[
      { id: 'tag-review', name: '검수', color: '#00B894', sort_order: 0 },
      { id: 'tag-generated-1', name: '리뷰', color: '#6C5CE7', sort_order: 1 },
      { id: 'tag-meeting', name: '회의', color: '#FDCB6E', sort_order: 2 },
    ]], 'the next save reuses the authoritative UUID instead of resubmitting a fake new row');
  });

  await t.test('a lost save response adopts a fresh canonical UUID and exits the editor', async () => {
    resetHarness();
    tagManagerApiFailures.add('calendarTagsSave');
    tagManagerCanonicalTagsAfterReload = [
      { id: 'tag-review', name: '검수', color: '#00B894', sortOrder: 0 },
      { id: 'tag-meeting', name: '회의', color: '#FDCB6E', sortOrder: 1 },
      { id: 'tag-server-new', name: '서버 정본', color: '#6C5CE7', sortOrder: 2 },
    ];
    let tree = await renderTagManagerPopover();
    buttonByText(tree, '새 태그').props.onClick?.();
    tree = await renderTagManagerPopover();
    formElementByLabel(tree, '새 태그 이름').props.onChange?.({ target: { value: '응답 유실', checked: false } });
    tree = await renderTagManagerPopover();
    await buttonByLabel(tree, '새 태그 저장').props.onClick?.();
    tree = await renderTagManagerPopover();

    assert.deepEqual(tagManagerApiCalls.map((call) => call.name), ['calendarTagsSave', 'loadAll']);
    assert.match(tagManagerToastErrors[0], /저장 결과.*최신 목록/);
    assert.ok(buttonByLabel(tree, '서버 정본 태그 편집'), 'fresh canonical rows replace the ambiguous intent');
    assert.equal(
      findFormElements(tree).some((element) => element.props['aria-label'] === '새 태그 이름'),
      false,
      'fresh reconciliation closes the idless editor',
    );

    tagManagerApiFailures.delete('calendarTagsSave');
    tagManagerCanonicalTagsAfterReload = null;
    await buttonByLabel(tree, '서버 정본 태그 위로').props.onClick?.();
    assert.deepEqual(tagManagerApiCalls.at(-2)?.args, [[
      { id: 'tag-review', name: '검수', color: '#00B894', sort_order: 0 },
      { id: 'tag-server-new', name: '서버 정본', color: '#6C5CE7', sort_order: 1 },
      { id: 'tag-meeting', name: '회의', color: '#FDCB6E', sort_order: 2 },
    ]], 'the next mutation reuses only the canonical server UUID');
  });

  await t.test('an in-flight save locks a forced remount until its authoritative UUID settles', async () => {
    resetHarness();
    tagManagerCanonicalTagsAfterReload = [
      { id: 'tag-review', name: '검수', color: '#00B894', sortOrder: 0 },
      { id: 'tag-meeting', name: '회의', color: '#FDCB6E', sortOrder: 1 },
      { id: 'tag-generated-1', name: '동시 추가', color: '#6C5CE7', sortOrder: 2 },
    ];
    tagManagerSaveGate = new Promise<void>((resolve) => {
      resolveTagManagerSaveGate = resolve;
    });
    tagManagerRefreshGate = new Promise<void>((resolve) => {
      resolveTagManagerRefreshGate = resolve;
    });
    let tree = await renderTagManagerPopover();
    buttonByText(tree, '새 태그').props.onClick?.();
    tree = await renderTagManagerPopover();
    formElementByLabel(tree, '새 태그 이름').props.onChange?.({ target: { value: '동시 추가', checked: false } });
    tree = await renderTagManagerPopover();
    const firstSave = buttonByLabel(tree, '새 태그 저장').props.onClick?.();

    assert.equal(tagManagerApiCalls.filter((call) => call.name === 'calendarTagsSave').length, 1);
    stateSlots = [];
    tagManagerRefSlots = [];
    tree = await renderTagManagerPopover();
    assert.match(textContent(tree), /동시 추가/, 'the remount renders the exact in-flight full list');
    assert.equal(buttonByLabel(tree, '동시 추가 태그 편집').props.disabled, true);
    assert.equal(buttonByLabel(tree, '회의 태그 위로').props.disabled, true);
    assert.equal(buttonByText(tree, '새 태그').props.disabled, true);

    buttonByLabel(tree, '동시 추가 태그 편집').props.onClick?.();
    buttonByLabel(tree, '회의 태그 위로').props.onClick?.();
    tree = await renderTagManagerPopover();
    assert.equal(
      findFormElements(tree).some((element) => element.props['aria-label'] === '동시 추가 태그 이름'),
      false,
      'programmatic handlers cannot bypass the module flight from a remounted instance',
    );
    assert.equal(
      tagManagerApiCalls.filter((call) => call.name === 'calendarTagsSave').length,
      1,
      'no second full-list save starts before the first save and refresh settle',
    );

    resolveTagManagerSaveGate?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(
      tagManagerApiCalls.map((call) => call.name),
      ['calendarTagsSave', 'loadAll'],
      'the module flight remains active after persistence while canonical refresh is pending',
    );
    tree = await renderTagManagerPopover();
    assert.equal(buttonByLabel(tree, '동시 추가 태그 편집').props.disabled, true);
    buttonByLabel(tree, '회의 태그 위로').props.onClick?.();
    assert.equal(tagManagerApiCalls.filter((call) => call.name === 'calendarTagsSave').length, 1);

    resolveTagManagerRefreshGate?.();
    await firstSave;
    tree = await renderTagManagerPopover();
    assert.equal(buttonByLabel(tree, '동시 추가 태그 편집').props.disabled, false);
    assert.equal(buttonByText(tree, '새 태그').props.disabled, false);

    tagManagerSaveGate = null;
    tagManagerRefreshGate = null;
    tagManagerCanonicalTagsAfterReload = null;
    await buttonByLabel(tree, '동시 추가 태그 위로').props.onClick?.();
    assert.deepEqual(tagManagerApiCalls.at(-2)?.args, [[
      { id: 'tag-review', name: '검수', color: '#00B894', sort_order: 0 },
      { id: 'tag-generated-1', name: '동시 추가', color: '#6C5CE7', sort_order: 1 },
      { id: 'tag-meeting', name: '회의', color: '#FDCB6E', sort_order: 2 },
    ]], 'the remounted instance converges to the settled server UUID before its next save');
  });
});

test('TagManagerPopover confirms deletion and reloads after both successful and failed saves', async (t) => {
  await t.test('cancel is inert, while confirmation deletes from the canonical list', async () => {
    resetHarness();
    tagManagerConfirmResponses = [false, true];
    const tree = await renderTagManagerPopover();

    await buttonByLabel(tree, '회의 태그 삭제').props.onClick?.();
    assert.deepEqual(tagManagerApiCalls, []);
    await buttonByLabel(tree, '회의 태그 삭제').props.onClick?.();

    assert.equal(tagManagerConfirmMessages[0], "이 태그를 쓰는 일정은 '태그 없음'으로 바뀌어요");
    assert.deepEqual(tagManagerApiCalls.map((call) => call.name), ['calendarTagsSave', 'loadBflowEvents']);
    assert.deepEqual(tagManagerApiCalls[0].args, [[
      { id: 'tag-review', name: '검수', color: '#00B894', sort_order: 0 },
    ]]);
  });

  await t.test('save failure still reloads, reports the error, and keeps the popover open', async () => {
    resetHarness();
    tagManagerApiFailures.add('calendarTagsSave');
    tagManagerConfirmResponses = [true];
    const tree = await renderTagManagerPopover();
    await buttonByLabel(tree, '회의 태그 삭제').props.onClick?.();

    assert.deepEqual(tagManagerApiCalls.map((call) => call.name), ['calendarTagsSave', 'loadBflowEvents']);
    assert.equal(tagManagerToastErrors.length, 1);
    assert.equal(tagManagerCloseCount, 0);
  });

  await t.test('a tag-sensitive reload failure keeps the already committed deletion', async () => {
    resetHarness();
    tagManagerMetadataFreshness = { calendarsFresh: true, tagsFresh: false };
    tagManagerConfirmResponses = [true];
    let tree = await renderTagManagerPopover();
    await buttonByLabel(tree, '회의 태그 삭제').props.onClick?.();
    tree = await renderTagManagerPopover();

    assert.deepEqual(tagManagerApiCalls.map((call) => call.name), ['calendarTagsSave', 'loadBflowEvents']);
    assert.equal(tagManagerToastErrors.length, 1);
    assert.equal(tagManagerCloseCount, 0);
    assert.match(textContent(tree), /검수/);
    assert.doesNotMatch(
      textContent(tree),
      /회의/,
      'a deleted UUID must not be resurrected after only the reconciliation step fails',
    );
    assert.ok(buttonByLabel(tree, '최신 태그 목록 다시 불러오기'));
    assert.equal(
      buttonByLabel(tree, '검수 태그 편집').props.disabled,
      false,
      'authoritative saved rows remain editable while only reconciliation needs a retry',
    );

    stateSlots = [];
    tagManagerRefSlots = [];
    tree = await renderTagManagerPopover();
    assert.doesNotMatch(textContent(tree), /회의/, 'reopening keeps the authoritative committed delete');
    assert.ok(buttonByLabel(tree, '최신 태그 목록 다시 불러오기'));

    tagManagerMetadataFreshness = { calendarsFresh: true, tagsFresh: true };
    tagManagerCanonicalTagsAfterReload = [
      { id: 'tag-review', name: '검수', color: '#00B894', sortOrder: 0 },
    ];
    tagManagerRefreshGate = new Promise<void>((resolve) => {
      resolveTagManagerRefreshGate = resolve;
    });
    const retry = buttonByLabel(tree, '최신 태그 목록 다시 불러오기').props.onClick?.();
    tree = await renderTagManagerPopover();
    assert.equal(buttonByLabel(tree, '최신 태그 목록 다시 불러오기').props.disabled, true);
    assert.equal(buttonByLabel(tree, '검수 태그 편집').props.disabled, true);
    buttonByLabel(tree, '최신 태그 목록 다시 불러오기').props.onClick?.();
    assert.equal(
      tagManagerApiCalls.filter((call) => call.name === 'loadBflowEvents').length,
      2,
      'a remounted retry handler cannot start a second canonical refresh during module flight',
    );
    resolveTagManagerRefreshGate?.();
    await retry;
    tagManagerRefreshGate = null;
    tree = await renderTagManagerPopover();
    assert.equal(
      findButtons(tree).some((button) => button.props['aria-label'] === '최신 태그 목록 다시 불러오기'),
      false,
      'a fresh retry clears the non-locking reconciliation state',
    );
  });

  await t.test('a later metadata save cannot clear an unresolved event reconciliation', async () => {
    resetHarness();
    tagManagerMetadataFreshness = { calendarsFresh: true, tagsFresh: false };
    tagManagerConfirmResponses = [true];
    let tree = await renderTagManagerPopover();
    await buttonByLabel(tree, '회의 태그 삭제').props.onClick?.();
    tree = await renderTagManagerPopover();
    assert.ok(buttonByLabel(tree, '최신 태그 목록 다시 불러오기'));

    tagManagerMetadataFreshness = { calendarsFresh: true, tagsFresh: true };
    buttonByLabel(tree, '검수 태그 편집').props.onClick?.();
    tree = await renderTagManagerPopover();
    formElementByLabel(tree, '검수 태그 이름').props.onChange?.({ target: { value: '검수 수정', checked: false } });
    tree = await renderTagManagerPopover();
    await buttonByLabel(tree, '검수 태그 저장').props.onClick?.();
    tree = await renderTagManagerPopover();

    assert.deepEqual(
      tagManagerApiCalls.map((call) => call.name),
      ['calendarTagsSave', 'loadBflowEvents', 'calendarTagsSave', 'loadAll'],
      'the safe follow-up mutation may refresh metadata but does not pretend events were refreshed',
    );
    assert.ok(
      buttonByLabel(tree, '최신 태그 목록 다시 불러오기'),
      'the stronger unresolved event reconciliation survives the metadata save',
    );
    assert.match(textContent(tree), /검수 수정/);
    assert.doesNotMatch(textContent(tree), /회의/);

    stateSlots = [];
    tagManagerRefSlots = [];
    tree = await renderTagManagerPopover();
    assert.ok(buttonByLabel(tree, '최신 태그 목록 다시 불러오기'));
    assert.match(textContent(tree), /검수 수정/, 'the latest committed drafts survive remount with the event latch');

    tagManagerCanonicalTagsAfterReload = [
      { id: 'tag-review', name: '검수 수정', color: '#00B894', sortOrder: 0 },
    ];
    await buttonByLabel(tree, '최신 태그 목록 다시 불러오기').props.onClick?.();
    tree = await renderTagManagerPopover();
    assert.deepEqual(tagManagerApiCalls.map((call) => call.name).slice(-1), ['loadBflowEvents']);
    assert.equal(
      findButtons(tree).some((button) => button.props['aria-label'] === '최신 태그 목록 다시 불러오기'),
      false,
      'only a fresh event reconciliation clears the inherited strongest mode',
    );
  });

  await t.test('an ambiguous delete locks mutations until an explicit fresh event reconciliation', async () => {
    resetHarness();
    calendarState.tags.push({ id: 'tag-third', name: '세번째', color: '#74B9FF', sortOrder: 30 });
    tagManagerApiFailures.add('calendarTagsSave');
    tagManagerMetadataFreshness = { calendarsFresh: true, tagsFresh: false };
    tagManagerConfirmResponses = [true];
    let tree = await renderTagManagerPopover();
    await buttonByLabel(tree, '회의 태그 삭제').props.onClick?.();
    tree = await renderTagManagerPopover();

    assert.doesNotMatch(textContent(tree), /회의/, 'the exact submitted delete remains visible while commit is unknown');
    assert.ok(buttonByLabel(tree, '최신 태그 목록 다시 불러오기'));
    assert.equal(buttonByLabel(tree, '세번째 태그 위로').props.disabled, true, 'reordering is locked');
    assert.equal(buttonByLabel(tree, '검수 태그 편집').props.disabled, true, 'editing is locked');
    assert.equal(buttonByLabel(tree, '검수 태그 삭제').props.disabled, true, 'deletion is locked');
    assert.equal(buttonByText(tree, '새 태그').props.disabled, true, 'creation is locked');

    stateSlots = [];
    tagManagerRefSlots = [];
    tree = await renderTagManagerPopover();
    assert.ok(
      buttonByLabel(tree, '최신 태그 목록 다시 불러오기'),
      'closing and reopening cannot discard the ambiguous-write lock',
    );
    assert.doesNotMatch(textContent(tree), /회의/, 'reopening cannot resurrect the submitted delete UUID');

    buttonByLabel(tree, '검수 태그 편집').props.onClick?.();
    tree = await renderTagManagerPopover();
    assert.equal(
      findFormElements(tree).some((element) => element.props['aria-label'] === '검수 태그 이름'),
      false,
      'a programmatic click cannot bypass the mutation lock',
    );

    await buttonByLabel(tree, '최신 태그 목록 다시 불러오기').props.onClick?.();
    tree = await renderTagManagerPopover();
    assert.ok(buttonByLabel(tree, '최신 태그 목록 다시 불러오기'), 'a stale retry stays locked');
    assert.deepEqual(
      tagManagerApiCalls.map((call) => call.name),
      ['calendarTagsSave', 'loadBflowEvents', 'loadBflowEvents'],
      'delete reconciliation keeps requiring fresh events as well as tags',
    );

    tagManagerMetadataFreshness = { calendarsFresh: true, tagsFresh: true };
    tagManagerCanonicalTagsAfterReload = [
      { id: 'tag-review', name: '검수', color: '#00B894', sortOrder: 0 },
      { id: 'tag-third', name: '세번째', color: '#74B9FF', sortOrder: 1 },
    ];
    await buttonByLabel(tree, '최신 태그 목록 다시 불러오기').props.onClick?.();
    tree = await renderTagManagerPopover();

    assert.equal(
      findButtons(tree).some((button) => button.props['aria-label'] === '최신 태그 목록 다시 불러오기'),
      false,
      'fresh canonical reconciliation unlocks the manager',
    );
    assert.equal(buttonByLabel(tree, '세번째 태그 위로').props.disabled, false);
    assert.doesNotMatch(textContent(tree), /회의/, 'a UUID absent from the canonical rows is never resurrected');
  });
});

test('TagManagerPopover gives non-admins the same tag list as a read-only view', async () => {
  resetHarness();
  settingsCurrentUser = { ...settingsCurrentUser, role: 'user' };
  const tree = await renderTagManagerPopover();
  const renderedText = textContent(tree);

  assert.match(renderedText, /태그 관리/);
  assert.match(renderedText, /관리자만 편집/);
  assert.match(renderedText, /검수/);
  assert.match(renderedText, /회의/);
  assert.doesNotMatch(renderedText, /새 태그/);
  for (const forbidden of ['검수 태그 편집', '검수 태그 삭제', '검수 태그 아래로']) {
    assert.equal(findButtons(tree).some((button) => button.props['aria-label'] === forbidden), false);
  }
});

test('ScheduleView mount delegates B flow metadata and events through one canonical loader', async () => {
  resetHarness();
  await renderScheduleView();
  await flushScheduleMountEffects();

  assert.equal(scheduleLoadBflowEventsCalls, 1, 'the canonical B flow loader runs exactly once on mount');
  assert.equal(scheduleLoadAllCalls, 0, 'ScheduleView must not start a competing direct metadata generation');
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

test('CalendarGrid renders tag-aware chip text while keeping each event color as the tint and border source', async () => {
  resetHarness();
  const events = [
    calendarListEvent({
      id: 'tagged-all-day',
      title: 'EP05 업로드',
      color: '#74B9FF',
      tagId: 'tag-meeting',
      calendarId: 'mine',
    }),
    calendarListEvent({
      id: 'calendar-all-day',
      title: '전체 회식',
      color: '#FDCB6E',
      tagId: undefined,
      calendarId: 'team',
    }),
    calendarListEvent({
      id: 'timed-event',
      title: '리드 회의',
      color: '#00B894',
      allDay: false,
      startTime: '14:00',
      endTime: '15:00',
      calendarId: 'mine',
    }),
  ];

  const tree = await renderCalendarGrid(events);
  const chip = (id: string) => {
    const element = findElements(tree, (candidate) => candidate.props['data-event-id'] === id)[0];
    assert.ok(element, `event chip '${id}' must be rendered by the real CalendarGrid`);
    return element;
  };

  assert.equal(textContent(chip('tagged-all-day')), '회의 · EP05 업로드');
  assert.equal(textContent(chip('calendar-all-day')), '스튜디오 공지 · 전체 회식');
  assert.equal(textContent(chip('timed-event')), '14:00 리드 회의');

  const tintedChipBody = directElementChildren(chip('tagged-all-day'))[0];
  const tintStyle = tintedChipBody.props.style as { background?: string; borderLeft?: string };
  assert.match(tintStyle.background ?? '', /#74B9FF/, 'the chip tint still comes from event.color');
  assert.equal(tintStyle.borderLeft, '3px solid #74B9FF', 'the chip border still comes from event.color');
});

test('ScheduleView passes tag and calendar lookup maps to its only month grid', async () => {
  resetHarness();
  await renderScheduleView();

  assert.equal(scheduleGridProps.length, 1, 'the month view has one CalendarGrid wiring point');
  assert.deepEqual(scheduleGridProps[0].tagNameById, {
    'tag-meeting': '회의',
    'tag-review': '검수',
  });
  assert.deepEqual(scheduleGridProps[0].calendarNameById, {
    mine: 'EP 마일스톤',
    team: '스튜디오 공지',
    'editable-share': '리드 회의',
    'view-share': '외부 보기',
  });
});

test('ScheduleView opens TagManagerPopover with the exact TagBar anchor', async () => {
  resetHarness();
  let tree = await renderScheduleView();
  const anchor = { left: 111, right: 207, top: 52, bottom: 80, width: 96, height: 28 } as DOMRect;
  scheduleTagBarProps[0].onOpenTagManager(anchor);
  tree = await renderScheduleView();

  assert.ok(nodeByAriaLabel(tree, '태그 관리 팝오버 연결됨'));
  assert.deepEqual(scheduleTagManagerProps.at(-1)?.anchorRect, anchor);
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

test('ScheduleView refreshes panel state from the authoritative event cache after an update', async () => {
  resetHarness();
  const before: ScheduleCalendarEvent = {
    id: 'event-move',
    title: '리드 회의',
    memo: '',
    color: '#6C5CE7',
    type: 'custom',
    startDate: '2026-08-25',
    endDate: '2026-08-25',
    createdBy: '배한솔',
    createdAt: '2026-08-24T00:00:00.000Z',
    source: 'bflow',
    sourceCalendarId: 'bflow:mine',
    calendarId: 'mine',
    canEdit: true,
    isReadOnly: false,
  };
  scheduleCanonicalEvents = [{
    ...before,
    color: '#74B9FF',
    sourceCalendarId: 'bflow:editable-share',
    calendarId: 'editable-share',
    canEdit: false,
    isReadOnly: true,
  }];

  await renderScheduleView();
  stateSlots[0] = [before];
  await renderScheduleView();
  scheduleGridProps.at(-1)?.onEventClick(before);
  await renderScheduleView();
  const panel = schedulePanelProps.at(-1);
  assert.ok(panel);
  await panel.onUpdate(before.id, { calendarId: 'editable-share' });
  await renderScheduleView();

  assert.deepEqual(scheduleUpdateCalls, [{ id: before.id, updates: { calendarId: 'editable-share' } }]);
  assert.equal(scheduleGetEventsCalls, 1, 'a successful write is followed by a canonical cache read');
  assert.deepEqual(schedulePanelProps.at(-1)?.event, scheduleCanonicalEvents[0], 'panel uses re-derived color, source and permissions');

  await panel.onUpdate(before.id, { startDate: '2026-08-26', endDate: '2026-08-25' });

  assert.deepEqual(scheduleUpdateCalls.at(-1), {
    id: before.id,
    updates: { startDate: '2026-08-25', endDate: '2026-08-26' },
  }, 'a complete crossing date pair reaches the existing ScheduleView swap');
  assert.equal(scheduleGetEventsCalls, 2);
});

test('ScheduleView reconciles a remounted quick edit after optimistic persistence rolls back', async () => {
  resetHarness();
  const before: ScheduleCalendarEvent = {
    id: 'event-rollback',
    title: '팀 회의',
    memo: '',
    color: '#6C5CE7',
    type: 'custom',
    startDate: '2026-08-25',
    endDate: '2026-08-25',
    createdBy: '배한솔',
    createdAt: '2026-08-24T00:00:00.000Z',
    source: 'bflow',
    sourceCalendarId: 'bflow:mine',
    calendarId: 'mine',
    tagId: 'tag-meeting',
    canEdit: true,
    isReadOnly: false,
  };
  const optimistic = {
    ...before,
    color: '#74B9FF',
    sourceCalendarId: 'bflow:editable-share',
    calendarId: 'editable-share',
    tagId: 'tag-review',
  };
  const persistenceError = new Error('calendar persistence failed');
  let rejectUpdate!: (reason: Error) => void;
  const pendingUpdate = new Promise<void>((_resolve, reject) => {
    rejectUpdate = reject;
  });
  scheduleUpdateHandler = async () => pendingUpdate;
  scheduleCanonicalEvents = [before];

  await renderScheduleView();
  stateSlots[0] = [before];
  await renderScheduleView();
  scheduleGridProps.at(-1)?.onEventContextMenu(before, {
    preventDefault() {},
    stopPropagation() {},
    clientX: 120,
    clientY: 180,
  });
  await renderScheduleView();
  const originalQuickEdit = scheduleQuickEditProps.at(-1);
  assert.ok(originalQuickEdit);
  const updateResult = originalQuickEdit.onUpdate(before.id, {
    calendarId: optimistic.calendarId,
    tagId: optimistic.tagId,
  });
  assert.ok(updateResult instanceof Promise);

  originalQuickEdit.onClose();
  stateSlots[0] = [optimistic];
  await renderScheduleView();
  scheduleGridProps.at(-1)?.onEventClick(optimistic);
  scheduleGridProps.at(-1)?.onEventContextMenu(optimistic, {
    preventDefault() {},
    stopPropagation() {},
    clientX: 160,
    clientY: 220,
  });
  await renderScheduleView();
  assert.deepEqual(schedulePanelProps.at(-1)?.event, optimistic);
  assert.deepEqual(scheduleQuickEditProps.at(-1)?.event, optimistic, 'the reopened popup starts from the optimistic broadcast');

  rejectUpdate(persistenceError);
  await assert.rejects(updateResult, (error) => {
    assert.equal(error, persistenceError, 'the original persistence error reaches EventQuickEdit');
    return true;
  });
  await renderScheduleView();

  assert.equal(scheduleGetEventsCalls, 1, 'a rejected write still reads the rolled-back canonical cache');
  assert.deepEqual(scheduleGridProps.at(-1)?.events, [before], 'the calendar list returns to the canonical event');
  assert.deepEqual(schedulePanelProps.at(-1)?.event, before, 'an open panel returns to the canonical event');
  assert.deepEqual(scheduleQuickEditProps.at(-1)?.event, before, 'the remounted popup returns to the canonical event');
});

test('ScheduleView quick edit removes the color callback and duplicates a read-only B flow event into the editable personal calendar', async () => {
  resetHarness();
  const readOnly: ScheduleCalendarEvent = {
    id: 'event-read-only',
    title: '전체 회식',
    memo: '',
    color: '#8B8DA3',
    type: 'custom',
    startDate: '2026-08-25',
    endDate: '2026-08-25',
    createdBy: '허혜원',
    createdAt: '2026-08-24T00:00:00.000Z',
    source: 'bflow',
    sourceCalendarId: 'bflow:view-share',
    calendarId: 'view-share',
    canEdit: false,
    isReadOnly: true,
  };

  await renderScheduleView();
  stateSlots[0] = [readOnly];
  await renderScheduleView();
  scheduleGridProps.at(-1)?.onEventContextMenu(readOnly, {
    preventDefault() {},
    stopPropagation() {},
    clientX: 100,
    clientY: 120,
  });
  await renderScheduleView();
  const quickEdit = scheduleQuickEditProps.at(-1);
  assert.ok(quickEdit);
  assert.equal(Object.hasOwn(quickEdit, 'onUpdateColor'), false, 'individual event color updates are no longer wired');
  await quickEdit.onDuplicate(readOnly);

  assert.equal(scheduleAddedEvents.length, 1);
  assert.equal(scheduleAddedEvents[0].calendarId, 'mine', 'read-only duplicates target the editable personal calendar');
  assert.notEqual(scheduleAddedEvents[0].calendarId, readOnly.calendarId);
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

    assert.deepEqual(settingsApiCalls.map((call) => call.name), ['calendarUpdate', 'loadBflowEvents']);
    assert.deepEqual(settingsApiCalls[0].args, [
      'owned-team',
      { name: '스튜디오 공지 수정', color: '#74B9FF' },
    ]);
    assert.equal(settingsCloseCount, 1);
  });

  await t.test('a failed calendar update never starts the member replacement', async () => {
    resetHarness();
    settingsApiFailures.add('calendarUpdate');
    let tree = await renderCalendarSettingsModal(shared, 14);

    assert.match(textContent(tree), /소유자 허혜원.*만든 날 2026-08-24.*일정 14개/);
    assert.match(textContent(tree), /3명 · 편집 1 · 보기 1/);
    buttonByLabel(tree, '색상 #74B9FF').props.onClick?.();
    tree = await renderCalendarSettingsModal(shared, 14);
    await buttonByText(tree, '저장').props.onClick?.();

    assert.deepEqual(settingsApiCalls.map((call) => call.name), ['calendarUpdate', 'loadBflowEvents']);
    assert.equal(settingsCloseCount, 0);
    assert.equal(settingsToastErrors.length, 1);
  });

  await t.test('a successful shared edit sends fields and members in one atomic update before reloading events', async () => {
    resetHarness();
    let tree = await renderCalendarSettingsModal(shared, 14);
    buttonByLabel(tree, '장삐쭈 편집 권한').props.onClick?.();
    tree = await renderCalendarSettingsModal(shared, 14);
    await buttonByText(tree, '저장').props.onClick?.();

    assert.deepEqual(settingsApiCalls.map((call) => call.name), [
      'calendarUpdate', 'loadBflowEvents',
    ]);
    assert.deepEqual(settingsApiCalls[0].args, [
      'shared-settings',
      {
        members: [
          { user_id: myUserId, can_edit: true },
          { user_id: 'user-jang', can_edit: true },
        ],
      },
    ]);
    assert.equal(settingsCloseCount, 1);
  });

  await t.test('switching a team calendar to private atomically clears members before reloading permissions', async () => {
    resetHarness();
    const team = calendar({
      ...shared,
      id: 'team-settings',
      visibility: 'team',
    });
    let tree = await renderCalendarSettingsModal(team, 14);
    formElementByLabel(tree, '나만').props.onChange?.({ target: { value: 'private', checked: true } });
    tree = await renderCalendarSettingsModal(team, 14);
    await buttonByText(tree, '저장').props.onClick?.();

    assert.deepEqual(settingsApiCalls.map((call) => call.name), ['calendarUpdate', 'loadBflowEvents']);
    assert.deepEqual(settingsApiCalls[0].args, [
      'team-settings',
      { visibility: 'private', members: [] },
    ]);
  });

  await t.test('an admin removing their own edit membership treats a false event reload as failure', async () => {
    resetHarness();
    settingsBflowReloadResult = false;
    let tree = await renderCalendarSettingsModal(shared, 14);
    buttonByLabel(tree, '배한솔 제거').props.onClick?.();
    tree = await renderCalendarSettingsModal(shared, 14);
    await buttonByText(tree, '저장').props.onClick?.();

    assert.deepEqual(settingsApiCalls.map((call) => call.name), [
      'calendarUpdate', 'loadBflowEvents',
    ]);
    assert.deepEqual(settingsApiCalls[0].args, [
      'shared-settings',
      { members: [{ user_id: 'user-jang', can_edit: false }] },
    ]);
    assert.equal(settingsCloseCount, 0);
    assert.equal(settingsToastSuccesses.length, 0);
    assert.equal(settingsToastErrors.length, 1);
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
    assert.deepEqual(settingsApiCalls.map((call) => call.name), ['calendarDelete', 'loadBflowEvents']);
    assert.deepEqual(settingsApiCalls[0].args, ['delete-me']);
    assert.equal(settingsCloseCount, 1);
  });

  await t.test('delete failure still reloads and keeps the modal open', async () => {
    resetHarness();
    settingsConfirmResponses = [true];
    settingsApiFailures.add('calendarDelete');
    const tree = await renderCalendarSettingsModal(editable, 7);
    await buttonByText(tree, '캘린더 삭제').props.onClick?.();

    assert.deepEqual(settingsApiCalls.map((call) => call.name), ['calendarDelete', 'loadBflowEvents']);
    assert.equal(settingsCloseCount, 0);
    assert.equal(settingsToastErrors.length, 1);
  });
});

test('CalendarSettingsModal reconciles confirmed commits and ambiguous response loss without duplicate mutations', async (t) => {
  await t.test('a committed create with a failed reload survives remount and cannot be submitted twice', async () => {
    resetHarness();
    settingsMetadataFreshness = { calendarsFresh: false, tagsFresh: true };
    let tree = await renderCalendarSettingsModal();
    formElementByLabel(tree, '캘린더 이름').props.onChange?.({ target: { value: '재시도 캘린더', checked: false } });
    tree = await renderCalendarSettingsModal();
    await buttonByText(tree, '저장').props.onClick?.();

    assert.deepEqual(settingsApiCalls.map((call) => call.name), ['calendarCreate', 'loadAll']);
    assert.equal(settingsCloseCount, 0);
    assert.match(settingsToastErrors[0], /저장됐지만|만들어졌지만/);

    stateSlots = [];
    modalRefSlots = [];
    tree = await renderCalendarSettingsModal();
    assert.ok(buttonByLabel(tree, '최신 캘린더 목록 다시 불러오기'));
    assert.equal(buttonByText(tree, '저장').props.disabled, true, 'the confirmed create stays mutation-locked after remount');
    await buttonByText(tree, '저장').props.onClick?.();
    assert.equal(
      settingsApiCalls.filter((call) => call.name === 'calendarCreate').length,
      1,
      'a programmatic second click cannot create a duplicate',
    );

    settingsMetadataFreshness = { calendarsFresh: true, tagsFresh: true };
    await buttonByLabel(tree, '최신 캘린더 목록 다시 불러오기').props.onClick?.();
    assert.equal(settingsCloseCount, 1, 'a fresh canonical retry finishes the already confirmed create');
  });

  await t.test('a settled old create cannot close an unrelated settings modal opened while persistence was pending', async () => {
    resetHarness();
    const closeCalls: string[] = [];
    settingsApiGate = new Promise<void>((resolve) => {
      resolveSettingsApiGate = resolve;
    });
    let tree = await renderCalendarSettingsModal(undefined, 4, () => { closeCalls.push('create'); });
    formElementByLabel(tree, '캘린더 이름').props.onChange?.({ target: { value: '느린 생성', checked: false } });
    tree = await renderCalendarSettingsModal(undefined, 4, () => { closeCalls.push('create'); });
    const pendingSave = buttonByText(tree, '저장').props.onClick?.();
    assert.equal(settingsApiCalls.filter((call) => call.name === 'calendarCreate').length, 1);

    buttonByLabel(tree, '닫기').props.onClick?.();
    assert.deepEqual(closeCalls, ['create']);
    stateSlots = [];
    modalRefSlots = [];
    const unrelated = calendar({ id: 'unrelated-settings', name: '다른 캘린더', canManage: true });
    tree = await renderCalendarSettingsModal(unrelated, 1, () => { closeCalls.push('unrelated'); });
    assert.equal(buttonByText(tree, '저장').props.disabled, true, 'the unrelated modal stays globally locked during the old write');

    resolveSettingsApiGate?.();
    await pendingSave;
    assert.deepEqual(
      closeCalls,
      ['create'],
      'the unmounted create continuation must not invoke either its stale close or the unrelated modal close',
    );
    tree = await renderCalendarSettingsModal(unrelated, 1, () => { closeCalls.push('unrelated'); });
    assert.equal(buttonByText(tree, '저장').props.disabled, false, 'the unrelated modal unlocks after the old write settles');
  });

  await t.test('an A reconciliation does not lock B and returns only when actor A signs back in', async () => {
    resetHarness();
    const closeCalls: string[] = [];
    const actorA = settingsCurrentUser;
    const actorB = settingsUsers.find((user) => user.id === 'user-jang');
    assert.ok(actorB);
    const calendarA = calendar({ id: 'actor-a-calendar', ownerId: actorA.id, canManage: true });
    const calendarB = calendar({ id: 'actor-b-calendar', ownerId: actorB.id, canManage: true });
    settingsBflowReloadResult = false;
    let tree = await renderCalendarSettingsModal(calendarA, 1, () => { closeCalls.push('A'); });
    buttonByLabel(tree, '색상 #74B9FF').props.onClick?.();
    tree = await renderCalendarSettingsModal(calendarA, 1, () => { closeCalls.push('A'); });
    await buttonByText(tree, '저장').props.onClick?.();
    assert.ok(buttonByLabel(await renderCalendarSettingsModal(calendarA), '최신 캘린더 목록 다시 불러오기'));

    settingsCurrentUser = actorB;
    settingsBflowReloadResult = true;
    stateSlots = [];
    modalRefSlots = [];
    tree = await renderCalendarSettingsModal(calendarB, 1, () => { closeCalls.push('B'); });
    assert.equal(
      findButtons(tree).some((button) => button.props['aria-label'] === '최신 캘린더 목록 다시 불러오기'),
      false,
      'actor B never sees actor A reconciliation',
    );
    assert.equal(buttonByText(tree, '저장').props.disabled, false, 'actor B mutations remain usable');
    formElementByLabel(tree, '캘린더 이름').props.onChange?.({ target: { value: 'B 수정', checked: false } });
    tree = await renderCalendarSettingsModal(calendarB, 1, () => { closeCalls.push('B'); });
    await buttonByText(tree, '저장').props.onClick?.();
    assert.deepEqual(closeCalls, ['B']);
    assert.equal(settingsApiCalls.filter((call) => call.name === 'calendarUpdate').length, 2);

    settingsCurrentUser = actorA;
    stateSlots = [];
    modalRefSlots = [];
    tree = await renderCalendarSettingsModal(calendarA, 1, () => { closeCalls.push('A'); });
    assert.ok(buttonByLabel(tree, '최신 캘린더 목록 다시 불러오기'));
    assert.equal(buttonByLabel(tree, '색상 #74B9FF').props['aria-pressed'], true, 'actor A intent draft is restored');
    await buttonByLabel(tree, '최신 캘린더 목록 다시 불러오기').props.onClick?.();
    assert.deepEqual(closeCalls, ['B', 'A']);
  });

  await t.test('an actor switch during deferred refresh preserves A latch without verifying against B data', async () => {
    resetHarness();
    const closeCalls: string[] = [];
    const actorA = settingsCurrentUser;
    const actorB = settingsUsers.find((user) => user.id === 'user-jang');
    assert.ok(actorB);
    const calendarA = calendar({ id: 'deferred-actor-a', ownerId: actorA.id, canManage: true });
    const calendarB = calendar({ id: 'deferred-actor-b', ownerId: actorB.id, canManage: true });
    settingsRefreshGate = new Promise<void>((resolve) => {
      resolveSettingsRefreshGate = resolve;
    });
    let tree = await renderCalendarSettingsModal(calendarA, 1, () => { closeCalls.push('A'); });
    buttonByLabel(tree, '색상 #74B9FF').props.onClick?.();
    tree = await renderCalendarSettingsModal(calendarA, 1, () => { closeCalls.push('A'); });
    const pendingSave = buttonByText(tree, '저장').props.onClick?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(settingsApiCalls.map((call) => call.name), ['calendarUpdate', 'loadBflowEvents']);

    settingsCurrentUser = actorB;
    stateSlots = [];
    modalRefSlots = [];
    tree = await renderCalendarSettingsModal(calendarB, 1, () => { closeCalls.push('B'); });
    assert.equal(buttonByText(tree, '저장').props.disabled, false);
    assert.equal(
      findButtons(tree).some((button) => button.props['aria-label'] === '최신 캘린더 목록 다시 불러오기'),
      false,
    );

    resolveSettingsRefreshGate?.();
    await pendingSave;
    assert.deepEqual(closeCalls, [], 'A async continuation cannot close actor B');
    tree = await renderCalendarSettingsModal(calendarB, 1, () => { closeCalls.push('B'); });
    assert.equal(buttonByText(tree, '저장').props.disabled, false);

    settingsCurrentUser = actorA;
    settingsRefreshGate = null;
    stateSlots = [];
    modalRefSlots = [];
    tree = await renderCalendarSettingsModal(calendarA, 1, () => { closeCalls.push('A'); });
    assert.ok(
      buttonByLabel(tree, '최신 캘린더 목록 다시 불러오기'),
      'actor A returns to a safe confirmed-write reconciliation instead of a B-filtered verification',
    );
    await buttonByLabel(tree, '최신 캘린더 목록 다시 불러오기').props.onClick?.();
    assert.deepEqual(closeCalls, ['A']);
  });

  await t.test('a create response loss closes only when one new exact canonical calendar verifies the intent', async () => {
    resetHarness();
    const before = calendarState.calendars.map((item) => ({ ...item, members: item.members.map((member) => ({ ...member })) }));
    settingsApiFailures.add('calendarCreate');
    settingsCanonicalCalendarsAfterReload = [...before, calendar({
      id: 'server-created',
      name: '응답 유실 캘린더',
      color: '#6C5CE7',
      visibility: 'members',
      ownerId: myUserId,
      members: [],
      isPersonal: false,
    })];
    let tree = await renderCalendarSettingsModal();
    formElementByLabel(tree, '캘린더 이름').props.onChange?.({ target: { value: '응답 유실 캘린더', checked: false } });
    tree = await renderCalendarSettingsModal();
    await buttonByText(tree, '저장').props.onClick?.();

    assert.deepEqual(settingsApiCalls.map((call) => call.name), ['calendarCreate', 'loadAll']);
    assert.equal(settingsCloseCount, 1, 'the exact post-call ID candidate proves the response-lost create committed');
    tree = await renderCalendarSettingsModal();
    assert.equal(
      findButtons(tree).some((button) => button.props['aria-label'] === '최신 캘린더 목록 다시 불러오기'),
      false,
      'verified response loss leaves no retry latch',
    );
  });

  await t.test('dual create failure survives remount and unlocks only after an explicit fresh no-commit proof', async () => {
    resetHarness();
    settingsApiFailures.add('calendarCreate');
    settingsMetadataFreshness = { calendarsFresh: false, tagsFresh: true };
    let tree = await renderCalendarSettingsModal();
    formElementByLabel(tree, '캘린더 이름').props.onChange?.({ target: { value: '모호한 캘린더', checked: false } });
    tree = await renderCalendarSettingsModal();
    await buttonByText(tree, '저장').props.onClick?.();

    stateSlots = [];
    modalRefSlots = [];
    tree = await renderCalendarSettingsModal();
    assert.ok(buttonByLabel(tree, '최신 캘린더 목록 다시 불러오기'));
    assert.equal(buttonByText(tree, '저장').props.disabled, true);
    await buttonByText(tree, '저장').props.onClick?.();
    assert.equal(settingsApiCalls.filter((call) => call.name === 'calendarCreate').length, 1);

    settingsMetadataFreshness = { calendarsFresh: true, tagsFresh: true };
    settingsCanonicalCalendarsAfterReload = calendarState.calendars.map((item) => ({
      ...item,
      members: item.members.map((member) => ({ ...member })),
    }));
    await buttonByLabel(tree, '최신 캘린더 목록 다시 불러오기').props.onClick?.();
    tree = await renderCalendarSettingsModal();
    assert.equal(settingsCloseCount, 0, 'a no-commit proof keeps the draft open for a deliberate retry');
    assert.equal(
      findButtons(tree).some((button) => button.props['aria-label'] === '최신 캘린더 목록 다시 불러오기'),
      false,
    );
    assert.equal(buttonByText(tree, '저장').props.disabled, false, 'only the explicit canonical retry unlocks creation');
  });

  await t.test('an update response loss closes when fresh target fields and normalized members exactly match', async () => {
    resetHarness();
    const editable = calendar({
      id: 'update-response-loss',
      name: '리드 회의',
      visibility: 'members',
      ownerId: 'owner-lead',
      members: [{ userId: 'user-jang', canEdit: false }],
      canManage: true,
    });
    settingsApiFailures.add('calendarUpdate');
    settingsCanonicalCalendarsAfterReload = [...calendarState.calendars, {
      ...editable,
      name: '리드 회의 수정',
      members: [{ userId: 'user-jang', canEdit: true }],
    }];
    let tree = await renderCalendarSettingsModal(editable, 2);
    formElementByLabel(tree, '캘린더 이름').props.onChange?.({ target: { value: '리드 회의 수정', checked: false } });
    buttonByLabel(tree, '장삐쭈 편집 권한').props.onClick?.();
    tree = await renderCalendarSettingsModal(editable, 2);
    await buttonByText(tree, '저장').props.onClick?.();

    assert.deepEqual(settingsApiCalls.map((call) => call.name), ['calendarUpdate', 'loadBflowEvents']);
    assert.equal(settingsCloseCount, 1);
  });

  await t.test('a delete response loss closes when the fresh canonical list proves the target absent', async () => {
    resetHarness();
    const editable = calendar({ id: 'delete-response-loss', name: '삭제 응답 유실', canManage: true });
    settingsApiFailures.add('calendarDelete');
    settingsConfirmResponses = [true];
    settingsCanonicalCalendarsAfterReload = calendarState.calendars.map((item) => ({
      ...item,
      members: item.members.map((member) => ({ ...member })),
    }));
    const tree = await renderCalendarSettingsModal(editable, 7);
    await buttonByText(tree, '캘린더 삭제').props.onClick?.();

    assert.deepEqual(settingsApiCalls.map((call) => call.name), ['calendarDelete', 'loadBflowEvents']);
    assert.equal(settingsCloseCount, 1);
  });
});

test('CalendarSettingsModal keeps an ordinary failed update open and mutation-locked until reconciliation', async () => {
  resetHarness();
  settingsApiFailures.add('calendarUpdate');
  const editable = calendar({ id: 'ordinary-update-failure', canManage: true });
  let tree = await renderCalendarSettingsModal(editable, 2);
  buttonByLabel(tree, '색상 #74B9FF').props.onClick?.();
  tree = await renderCalendarSettingsModal(editable, 2);
  await buttonByText(tree, '저장').props.onClick?.();

  assert.deepEqual(settingsApiCalls.map((call) => call.name), ['calendarUpdate', 'loadBflowEvents']);
  assert.equal(settingsCloseCount, 0);
  assert.equal(settingsToastSuccesses.length, 0);
  assert.equal(settingsToastErrors.length, 1);
  tree = await renderCalendarSettingsModal(editable, 2);
  assert.ok(buttonByLabel(tree, '최신 캘린더 목록 다시 불러오기'));
  assert.equal(buttonByText(tree, '저장').props.disabled, true);
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
