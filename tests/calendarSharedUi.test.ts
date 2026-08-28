import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
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

type SettingsCalendarOptimisticOverlay = {
  kind: 'create';
  beforeCalendarIds: string[];
  calendar: BflowCalendar;
} | {
  kind: 'update';
  calendarId: string;
  beforeCalendar: BflowCalendar;
  patch: Partial<BflowCalendar>;
} | {
  kind: 'delete';
  calendarId: string;
  beforeCalendar: BflowCalendar;
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
type ShortcutHelpOverlayComponent = (props: { onClose(): void }) => ReactNode;
type CalendarGridProps = {
  weeks: Date[][];
  events: ScheduleCalendarEvent[];
  today: string;
  currentMonth: number;
  maxVisibleBars: number;
  tagNameById: Record<string, string>;
  calendarNameById: Record<string, string>;
  onEventClick(event: ScheduleCalendarEvent): void;
  onDragStart?(event: ScheduleCalendarEvent, mode: 'move' | 'resize-start' | 'resize-end', anchorDate: string): void;
  dragPreview?: {
    eventId: string;
    newStartDate: string;
    newEndDate: string;
  } | null;
  draggedEventIdentity?: ScheduleEventIdentity | null;
  isDragging?: boolean;
  highlightedEventIdentities?: ReadonlySet<string>;
  reduceMotion?: boolean;
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
  linkedTodoId?: string;
};
type ScheduleEventIdentity = Pick<ScheduleCalendarEvent, 'id' | 'source' | 'sourceCalendarId'>;
type ScheduleGridProps = {
  events: ScheduleCalendarEvent[];
  tagNameById: Record<string, string>;
  calendarNameById: Record<string, string>;
  focusedDate?: string | null;
  pulseDate?: string | null;
  instantTransition?: boolean;
  highlightedEventIdentities?: ReadonlySet<string>;
  reduceMotion?: boolean;
  onEventClick(event: ScheduleCalendarEvent): void;
  onDragStart(event: ScheduleCalendarEvent, mode: 'move' | 'resize-start' | 'resize-end', anchorDate: string): void;
  onEventContextMenu(event: ScheduleCalendarEvent, mouse: { preventDefault(): void; stopPropagation(): void; clientX: number; clientY: number }): void;
};
type ScheduleDateNavigationRequest = {
  id: number;
  date: string;
  todoId?: string;
};
type SchedulePanelProps = {
  event: ScheduleCalendarEvent;
  onUpdate(id: string, updates: Partial<ScheduleCalendarEvent>): void | Promise<void>;
  onDelete(id: string): void | Promise<void>;
};
type ScheduleQuickEditProps = {
  event: ScheduleCalendarEvent;
  onClose(): void;
  onUpdate(id: string, updates: Partial<ScheduleCalendarEvent>): void | Promise<void>;
  onDelete(id: string): void | Promise<void>;
  onDuplicate(event: ScheduleCalendarEvent): void | Promise<void>;
  [key: string]: unknown;
};
type EventCreateModalProps = {
  initialDate?: string;
  initialEndDate?: string;
  initialStartTime?: string;
  initialEndTime?: string;
  episodes: Array<{
    episodeNumber: number;
    title: string;
    parts: Array<{
      partId: string;
      sheetName: string;
      department: string;
      scenes: Array<{ sceneId: string; no: number }>;
    }>;
  }>;
  googleAuthenticated: boolean;
  onClose(): void;
  onSave(event: Record<string, unknown>): void | Promise<void>;
};
type EventCreateModalComponent = (props: EventCreateModalProps) => ReactNode;
type EventSidePanelComponent = (props: {
  event: ScheduleCalendarEvent;
  onClose(): void;
  onDelete(id: string): void;
  onUpdate(id: string, updates: Partial<ScheduleCalendarEvent>): void;
  onNavigate(event: ScheduleCalendarEvent): void;
}) => ReactNode;
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
  onEventContextMenu?(event: ScheduleCalendarEvent, mouse: { preventDefault(): void; stopPropagation(): void; clientX: number; clientY: number }): void;
  onDateClick?(date: string): void;
  activeWeekIndex: number;
  onWeekChange(index: number): void;
  pulseDate?: string | null;
  mode?: 'week' | '2week';
  highlightedEventIdentities?: ReadonlySet<string>;
  reduceMotion?: boolean;
  instantScroll?: boolean;
};
type WeekScrollViewModule = {
  default(props: WeekScrollViewProps): ReactNode;
  generateYearWeeks(year: number): Date[][];
  findWeekIndexForDate(weeks: Date[][], date: string): number;
};
type WeekTimeGridViewProps = {
  weekDays: Date[];
  events: ScheduleCalendarEvent[];
  today: string;
  onEventClick(event: ScheduleCalendarEvent): void;
  onEventContextMenu?(event: ScheduleCalendarEvent, mouse: { preventDefault(): void; stopPropagation(): void; clientX: number; clientY: number }): void;
  onSlotClick(date: string, startTime: string, endTime: string): void;
  activeWeekIndex: number;
  weekCount: number;
  onWeekChange(index: number): void;
  onTimeGridCreate?(date: string, startTime: string, endTime: string): void;
  onTimeGridEventChange?(
    eventId: string,
    identity: ScheduleEventIdentity,
    patch: Required<Pick<ScheduleCalendarEvent, 'startDate' | 'endDate' | 'startTime' | 'endTime'>>,
  ): void;
  highlightedEventIdentities?: ReadonlySet<string>;
};
type DayScrollViewProps = {
  events: ScheduleCalendarEvent[];
  activeDayIndex: number;
  onActiveDayChange(index: number): void;
  onEventClick?(event: ScheduleCalendarEvent): void;
  onEventContextMenu?(event: ScheduleCalendarEvent, mouse: { preventDefault(): void; stopPropagation(): void; clientX: number; clientY: number }): void;
  onDateClick?(date: string): void;
  pulseDate?: string | null;
  year: number;
  highlightedEventIdentities?: ReadonlySet<string>;
  reduceMotion?: boolean;
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
  'aria-controls'?: string;
  'aria-pressed'?: boolean;
  children?: ReactNode;
  disabled?: boolean;
  style?: { background?: string; backgroundColor?: string };
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
  onKeyDown?: (event: {
    key: string;
    preventDefault(): void;
    stopPropagation(): void;
  }) => void;
}, 'input' | 'select' | 'textarea'>;

const myUserId = 'user-me';
let stateSlots: unknown[] = [];
let stateCursor = 0;
let eventSidePanelRefSlots: Array<{ current: unknown }> = [];
let eventSidePanelRefCursor = 0;
let scheduleRefSlots: Array<{ current: unknown }> = [];
let scheduleRefCursor = 0;
let modalRefSlots: Array<{ current: unknown }> = [];
let modalRefCursor = 0;
let modalEffectDeps: Array<readonly unknown[] | undefined> = [];
let modalEffectCursor = 0;
let pendingModalEffects: Array<() => void> = [];
let pendingCalendarGridEffects: Array<() => void | (() => void)> = [];
let calendarGridEffectCleanups: Array<() => void> = [];
let tagManagerRefSlots: Array<{ current: unknown }> = [];
let tagManagerRefCursor = 0;
let calendarState: {
  calendars: BflowCalendar[];
  loaded: boolean;
  tags: Array<{ id: string; name: string; color: string; sortOrder: number }>;
  optimisticDeletedCalendarIds: string[];
  optimisticDeletedTagIds: string[];
  visibleCalendarIds: Record<string, boolean>;
  enabledTagIds: Record<string, boolean>;
  mutedCalendarIds: string[];
  toggleCalendarVisible(id: string): void;
  toggleTag(id: string): void;
  resetTagsAllOn(): void;
  toggleMuted(id: string): void;
  upsertCalendarOptimistically(actorId: string, calendar: BflowCalendar): void;
  removeCalendarOptimistically(actorId: string, calendarId: string): void;
  setCalendarOptimisticOverlay(
    actorId: string,
    token: number,
    overlay: SettingsCalendarOptimisticOverlay,
  ): void;
  clearCalendarOptimisticOverlay(actorId: string, token: number): void;
  setTagOptimisticOverlay(
    actorId: string,
    token: number,
    tags: Array<{ id: string; name: string; color: string; sortOrder: number }>,
  ): void;
  clearTagOptimisticOverlay(actorId: string, token: number): void;
};
let openedSettings: BflowCalendar[] = [];
let createdCount = 0;
let appViews: string[] = [];
let bundledRail: Promise<CalendarRailComponent> | undefined;
let bundledTagBar: Promise<TagBarComponent> | undefined;
let bundledTagManagerPopover: Promise<TagManagerPopoverComponent> | undefined;
let bundledScheduleView: Promise<ScheduleViewComponent> | undefined;
let bundledShortcutHelpOverlay: Promise<ShortcutHelpOverlayComponent> | undefined;
let bundledCalendarGrid: Promise<CalendarGridComponent> | undefined;
let bundledEventCreateModal: Promise<EventCreateModalComponent> | undefined;
let bundledEventSidePanel: Promise<EventSidePanelComponent> | undefined;
let bundledCalendarSettingsModal: Promise<CalendarSettingsModalComponent> | undefined;
let bundledWeekScrollView: Promise<WeekScrollViewModule> | undefined;
let bundledDayScrollView: Promise<DayScrollViewComponent> | undefined;
let scheduleTagBarProps: TagBarProps[] = [];
let scheduleTagManagerProps: TagManagerPopoverProps[] = [];
let scheduleGridProps: ScheduleGridProps[] = [];
let schedulePanelProps: SchedulePanelProps[] = [];
let scheduleQuickEditProps: ScheduleQuickEditProps[] = [];
let scheduleWeekScrollProps: WeekScrollViewProps[] = [];
let scheduleTimeGridProps: WeekTimeGridViewProps[] = [];
type MiniCalendarProps = {
  currentMonth: Date;
  onMonthChange(month: Date): void;
  onDateSelect(dateStr: string): void;
  activeWeekStart?: string;
  selectedDate?: string;
};
let scheduleMiniCalendarProps: MiniCalendarProps[] = [];
let scheduleDayScrollProps: DayScrollViewProps[] = [];
let scheduleCreateModalProps: EventCreateModalProps[] = [];
let scheduleReducedMotion = false;
let shortcutOverlayRefs: Array<{ current: unknown }> = [];
let shortcutOverlayEffects: Array<() => void | (() => void)> = [];
const scheduleLocalStorage = new Map<string, string>();
let scheduleCanonicalEvents: ScheduleCalendarEvent[] = [];
let scheduleUpdateCalls: Array<{
  id: string;
  updates: Partial<ScheduleCalendarEvent>;
  targetIdentity?: ScheduleEventIdentity;
}> = [];
let scheduleUpdateHandler: ((id: string, updates: Partial<ScheduleCalendarEvent>) => Promise<void>) | undefined;
let scheduleDeleteCalls: Array<{ id: string; targetIdentity?: ScheduleEventIdentity }> = [];
let scheduleDeleteHandler: ((id: string, targetIdentity?: ScheduleEventIdentity) => Promise<void>) | undefined;
let scheduleDragDoneHandler: ((eventId: string, newStart: string, newEnd: string) => void | Promise<void>) | undefined;
let scheduleTodoSyncCalls: Array<{ todoId: string; patch: Record<string, unknown> }> = [];
let scheduleAddedEvents: ScheduleCalendarEvent[] = [];
let schedulePersistedAddIdentities: ScheduleEventIdentity[] = [];
let scheduleCreateUuidValues: string[] = [];
let scheduleGetEventsCalls = 0;
let scheduleGetEventsGate: Promise<void> | null = null;
let resolveScheduleGetEventsGate: (() => void) | null = null;
let schedulePendingEffects: Array<() => void | (() => void)> = [];
let scheduleMountedEffectCleanups: Array<() => void> = [];
let scheduleEffectDeps: Array<readonly unknown[] | undefined> = [];
let scheduleEffectCursor = 0;
let scheduleCallbackSlots: unknown[] = [];
let scheduleCallbackDeps: Array<readonly unknown[] | undefined> = [];
let scheduleCallbackCursor = 0;
const scheduleWindowListeners = new Map<string, Set<(event: Event) => void>>();
const scheduleDocumentListeners = new Map<string, Set<(event: Event) => void>>();
let scheduleGlobalModalOpen = false;
const scheduleDocumentMock = {
  addEventListener(type: string, listener: (event: Event) => void) {
    const listeners = scheduleDocumentListeners.get(type) ?? new Set();
    listeners.add(listener);
    scheduleDocumentListeners.set(type, listeners);
  },
  removeEventListener(type: string, listener: (event: Event) => void) {
    scheduleDocumentListeners.get(type)?.delete(listener);
  },
  querySelector(selector: string) {
    return scheduleGlobalModalOpen && selector === '[role="dialog"][aria-modal="true"]'
      ? { role: 'dialog' }
      : null;
  },
};

function scheduleFmtDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function scheduleGenerateYearWeeks(year: number): Date[][] {
  const jan1 = new Date(year, 0, 1, 12, 0, 0, 0);
  const firstSunday = new Date(year, 0, 1 - jan1.getDay(), 12, 0, 0, 0);
  const endDate = new Date(year + 1, 0, 7, 12, 0, 0, 0);
  const weeks: Date[][] = [];
  for (let current = firstSunday; current.getTime() < endDate.getTime(); current = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 7, 12, 0, 0, 0)) {
    weeks.push(Array.from({ length: 7 }, (_, day) => (
      new Date(current.getFullYear(), current.getMonth(), current.getDate() + day, 12, 0, 0, 0)
    )));
  }
  return weeks;
}

function scheduleFindWeekIndexForDate(weeks: Date[][], date: string): number {
  const index = weeks.findIndex((week) => date >= scheduleFmtDate(week[0]) && date <= scheduleFmtDate(week[6]));
  return index >= 0 ? index : 0;
}

let scheduleCurrentView = 'schedule';
let schedulePendingDateNavigation: ScheduleDateNavigationRequest | null = null;
let scheduleDateNavigationConsumeIds: number[] = [];
let schedulePendingTodoPanelNavigation: ScheduleDateNavigationRequest | null = null;
let scheduleTodoPanelNavigationConsumeIds: number[] = [];
let scheduleLoadAllCalls = 0;
let scheduleLoadBflowEventsCalls = 0;
let scheduleLoadBflowEventsHandler: (() => void | Promise<void>) | undefined;
let settingsCurrentUser: TestUser;
let settingsUsers: TestUser[] = [];
let settingsApiCalls: Array<{ name: string; args: unknown[] }> = [];
let settingsApiFailures = new Set<string>();
let settingsMetadataFreshness = { calendarsFresh: true, tagsFresh: true };
let settingsBflowReloadResult = true;
let settingsBflowMetadataFresh = true;
let settingsCanonicalCalendarsAfterReload: BflowCalendar[] | null = null;
let settingsCanonicalCalendars: BflowCalendar[] = [];
let settingsCanonicalRevision = 0;
let settingsCanonicalByActor = new Map<string, { revision: number; calendars: BflowCalendar[] }>();
let settingsOptimisticByActor = new Map<string, { token: number; overlay: SettingsCalendarOptimisticOverlay }>();
let settingsCachedEvents: ScheduleCalendarEvent[] = [];
let settingsPresentationRefreshCount = 0;
let settingsRefreshCount = 0;
let settingsApiGate: Promise<void> | null = null;
let resolveSettingsApiGate: (() => void) | null = null;
let settingsRefreshGate: Promise<void> | null = null;
let resolveSettingsRefreshGate: (() => void) | null = null;
let settingsConfirmGate: Promise<void> | null = null;
let resolveSettingsConfirmGate: (() => void) | null = null;
let settingsConfirmResponses: boolean[] = [];
let settingsConfirmMessages: string[] = [];
let settingsToastErrors: string[] = [];
let settingsToastSuccesses: string[] = [];
let settingsCloseCount = 0;
let tagManagerApiCalls: Array<{ name: string; args: unknown[] }> = [];
let tagManagerApiFailures = new Set<string>();
let tagManagerMetadataFreshness = { calendarsFresh: true, tagsFresh: true };
let tagManagerBflowReloadResult = true;
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
let tagManagerConfirmGate: Promise<void> | null = null;
let resolveTagManagerConfirmGate: (() => void) | null = null;
let tagManagerToastErrors: string[] = [];
let tagManagerCloseCount = 0;
let tagManagerGeneratedId = 0;
let tagManagerSaveGate: Promise<void> | null = null;
let resolveTagManagerSaveGate: (() => void) | null = null;
let tagManagerRefreshGate: Promise<void> | null = null;
let resolveTagManagerRefreshGate: (() => void) | null = null;
let tagManagerCanonicalRevision = 0;
let tagManagerCanonicalByActor = new Map<string, {
  revision: number;
  tags: Array<{ id: string; name: string; color: string; sortOrder: number }>;
}>();
let tagManagerStoreOverlay: {
  actorId: string;
  token: number;
  tags: Array<{ id: string; name: string; color: string; sortOrder: number }>;
  deletedTagIds: string[];
} | null = null;
type TagManagerDocumentListener = {
  capture: boolean;
  listener: (event: Record<string, unknown>) => void;
};
const tagManagerDocumentListeners = new Map<string, TagManagerDocumentListener[]>();
const tagManagerDocumentMock = {
  body: {},
  addEventListener(
    type: string,
    listener: (event: Record<string, unknown>) => void,
    options?: boolean | { capture?: boolean },
  ) {
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
    const listeners = tagManagerDocumentListeners.get(type) ?? [];
    listeners.push({ capture, listener });
    tagManagerDocumentListeners.set(type, listeners);
  },
  removeEventListener(
    type: string,
    listener: (event: Record<string, unknown>) => void,
    options?: boolean | { capture?: boolean },
  ) {
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
    tagManagerDocumentListeners.set(
      type,
      (tagManagerDocumentListeners.get(type) ?? [])
        .filter((entry) => entry.listener !== listener || entry.capture !== capture),
    );
  },
};
let tagManagerEffectCursor = 0;
let tagManagerEffectDeps: unknown[][] = [];
let tagManagerEffectCleanup: (() => void) | undefined;

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

function formElementByOptionText(node: ReactNode, label: string): FormElement {
  const element = findFormElements(node).find((candidate) => textContent(candidate).includes(label));
  assert.ok(element, `form element containing option '${label}' must be rendered`);
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

function cloneSettingsCalendars(calendars: BflowCalendar[]): BflowCalendar[] {
  return calendars.map((item) => ({
    ...item,
    members: item.members.map((member) => ({ ...member })),
  }));
}

function applySettingsCalendarOverlay(
  actorId: string,
  calendars: BflowCalendar[],
  overlay: SettingsCalendarOptimisticOverlay,
): BflowCalendar[] {
  const base = cloneSettingsCalendars(calendars);
  if (overlay.kind === 'create') {
    const beforeIds = new Set(overlay.beforeCalendarIds);
    const exact = base.some((item) => (
      !beforeIds.has(item.id)
      && item.id !== overlay.calendar.id
      && item.ownerId === actorId
      && item.name === overlay.calendar.name
      && item.color === overlay.calendar.color
      && item.visibility === overlay.calendar.visibility
    ));
    if (exact) return base;
    return base.some((item) => item.id === overlay.calendar.id)
      ? base.map((item) => item.id === overlay.calendar.id ? { ...overlay.calendar } : item)
      : [...base, { ...overlay.calendar }];
  }
  if (overlay.kind === 'delete') return base.filter((item) => item.id !== overlay.calendarId);
  const current = base.find((item) => item.id === overlay.calendarId) ?? overlay.beforeCalendar;
  const patched = {
    ...current,
    ...overlay.patch,
    members: overlay.patch.members?.map((member) => ({ ...member })) ?? current.members,
  };
  return base.some((item) => item.id === overlay.calendarId)
    ? base.map((item) => item.id === overlay.calendarId ? patched : item)
    : [...base, patched];
}

function publishSettingsCanonicalSnapshot(actorId: string, calendars: BflowCalendar[]): void {
  settingsCanonicalByActor.set(actorId, {
    revision: ++settingsCanonicalRevision,
    calendars: cloneSettingsCalendars(calendars),
  });
}

function resetHarness(): void {
  for (const cleanup of scheduleMountedEffectCleanups.splice(0).reverse()) cleanup();
  scheduleWindowListeners.clear();
  scheduleDocumentListeners.clear();
  tagManagerEffectCleanup?.();
  tagManagerEffectCleanup = undefined;
  tagManagerEffectCursor = 0;
  tagManagerEffectDeps = [];
  tagManagerDocumentListeners.clear();
  stateSlots = [];
  stateCursor = 0;
  eventSidePanelRefSlots = [];
  eventSidePanelRefCursor = 0;
  scheduleRefSlots = [];
  scheduleRefCursor = 0;
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
  scheduleWeekScrollProps = [];
  scheduleTimeGridProps = [];
  scheduleMiniCalendarProps = [];
  scheduleDayScrollProps = [];
  scheduleCreateModalProps = [];
  scheduleReducedMotion = false;
  scheduleGlobalModalOpen = false;
  scheduleLocalStorage.clear();
  scheduleCanonicalEvents = [];
  scheduleUpdateCalls = [];
  scheduleUpdateHandler = undefined;
  scheduleDeleteCalls = [];
  scheduleDeleteHandler = undefined;
  scheduleDragDoneHandler = undefined;
  scheduleTodoSyncCalls = [];
  (globalThis as typeof globalThis & { __scheduleTodoSyncCalls?: typeof scheduleTodoSyncCalls }).__scheduleTodoSyncCalls = scheduleTodoSyncCalls;
  scheduleAddedEvents = [];
  schedulePersistedAddIdentities = [];
  scheduleCreateUuidValues = [];
  scheduleGetEventsCalls = 0;
  scheduleGetEventsGate = null;
  resolveScheduleGetEventsGate = null;
  schedulePendingEffects = [];
  scheduleEffectDeps = [];
  scheduleEffectCursor = 0;
  scheduleCallbackSlots = [];
  scheduleCallbackDeps = [];
  scheduleCallbackCursor = 0;
  scheduleCurrentView = 'schedule';
  schedulePendingDateNavigation = null;
  scheduleDateNavigationConsumeIds = [];
  schedulePendingTodoPanelNavigation = null;
  scheduleTodoPanelNavigationConsumeIds = [];
  scheduleLoadAllCalls = 0;
  scheduleLoadBflowEventsCalls = 0;
  scheduleLoadBflowEventsHandler = undefined;
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
  settingsBflowMetadataFresh = true;
  settingsCanonicalCalendarsAfterReload = null;
  settingsCanonicalCalendars = [];
  settingsCanonicalRevision = 0;
  settingsCanonicalByActor = new Map();
  settingsOptimisticByActor = new Map();
  settingsCachedEvents = [];
  settingsPresentationRefreshCount = 0;
  settingsRefreshCount = 0;
  settingsApiGate = null;
  resolveSettingsApiGate = null;
  settingsRefreshGate = null;
  resolveSettingsRefreshGate = null;
  settingsConfirmGate = null;
  resolveSettingsConfirmGate = null;
  settingsConfirmResponses = [];
  settingsConfirmMessages = [];
  settingsToastErrors = [];
  settingsToastSuccesses = [];
  settingsCloseCount = 0;
  bundledCalendarSettingsModal = undefined;
  tagManagerApiCalls = [];
  tagManagerApiFailures = new Set();
  tagManagerMetadataFreshness = { calendarsFresh: true, tagsFresh: true };
  tagManagerBflowReloadResult = true;
  tagManagerCanonicalTagsAfterReload = null;
  tagManagerLastCommittedTags = null;
  tagManagerConfirmResponses = [];
  tagManagerConfirmMessages = [];
  tagManagerConfirmGate = null;
  resolveTagManagerConfirmGate = null;
  tagManagerToastErrors = [];
  tagManagerCloseCount = 0;
  tagManagerGeneratedId = 0;
  tagManagerSaveGate = null;
  resolveTagManagerSaveGate = null;
  tagManagerRefreshGate = null;
  resolveTagManagerRefreshGate = null;
  tagManagerCanonicalRevision = 0;
  tagManagerCanonicalByActor = new Map();
  tagManagerStoreOverlay = null;
  calendarState = {
    loaded: true,
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
    optimisticDeletedCalendarIds: [],
    optimisticDeletedTagIds: [],
    visibleCalendarIds: {},
    enabledTagIds: {},
    mutedCalendarIds: [],
    toggleCalendarVisible(id) {
      if (calendarState.visibleCalendarIds[id] === false) delete calendarState.visibleCalendarIds[id];
      else calendarState.visibleCalendarIds[id] = false;
    },
    toggleTag(id) {
      if (id.startsWith('optimistic-tag:')) return;
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
    upsertCalendarOptimistically(actorId, value) {
      if (settingsCurrentUser.id !== actorId) return;
      const existingIndex = calendarState.calendars.findIndex((item) => item.id === value.id);
      const cloned = { ...value, members: value.members.map((member) => ({ ...member })) };
      calendarState.calendars = existingIndex >= 0
        ? calendarState.calendars.map((item, index) => index === existingIndex ? cloned : item)
        : [...calendarState.calendars, cloned];
    },
    removeCalendarOptimistically(actorId, calendarId) {
      if (settingsCurrentUser.id !== actorId) return;
      calendarState.calendars = calendarState.calendars.filter((item) => item.id !== calendarId);
    },
    setCalendarOptimisticOverlay(actorId, token, overlay) {
      if (settingsCurrentUser.id !== actorId) return;
      settingsOptimisticByActor.set(actorId, { token, overlay });
      const canonical = settingsCanonicalByActor.get(actorId)?.calendars ?? calendarState.calendars;
      calendarState.calendars = applySettingsCalendarOverlay(actorId, canonical, overlay);
      calendarState.optimisticDeletedCalendarIds = overlay.kind === 'delete' ? [overlay.calendarId] : [];
    },
    clearCalendarOptimisticOverlay(actorId, token) {
      const registered = settingsOptimisticByActor.get(actorId);
      if (!registered || registered.token !== token) return;
      settingsOptimisticByActor.delete(actorId);
      if (settingsCurrentUser.id !== actorId) return;
      calendarState.calendars = cloneSettingsCalendars(
        settingsCanonicalByActor.get(actorId)?.calendars ?? settingsCanonicalCalendars,
      );
      calendarState.optimisticDeletedCalendarIds = [];
    },
    setTagOptimisticOverlay(actorId, token, tags) {
      if (settingsCurrentUser.id !== actorId && (
        tagManagerStoreOverlay?.actorId !== actorId || tagManagerStoreOverlay.token !== token
      )) return;
      const priorDeleted = tagManagerStoreOverlay?.actorId === actorId
        && tagManagerStoreOverlay.token === token
        ? tagManagerStoreOverlay.deletedTagIds
        : [];
      const baseline = tagManagerCanonicalByActor.get(actorId)?.tags
        ?? (settingsCurrentUser.id === actorId ? calendarState.tags : []);
      const tagIds = new Set(tags.map(({ id }) => id));
      const deletedTagIds = [...new Set([
        ...priorDeleted,
        ...baseline.filter(({ id }) => !tagIds.has(id)).map(({ id }) => id),
      ])];
      tagManagerStoreOverlay = {
        actorId,
        token,
        tags: tags.map((tag) => ({ ...tag })),
        deletedTagIds,
      };
      if (settingsCurrentUser.id !== actorId) return;
      calendarState.tags = tags.map((tag) => ({ ...tag }));
      calendarState.optimisticDeletedTagIds = deletedTagIds;
    },
    clearTagOptimisticOverlay(actorId, token) {
      if (tagManagerStoreOverlay?.actorId !== actorId || tagManagerStoreOverlay.token !== token) return;
      tagManagerStoreOverlay = null;
      if (settingsCurrentUser.id !== actorId) return;
      calendarState.tags = (tagManagerCanonicalByActor.get(actorId)?.tags ?? []).map((tag) => ({ ...tag }));
      calendarState.optimisticDeletedTagIds = [];
    },
  };
  settingsCanonicalCalendars = calendarState.calendars.map((item) => ({
    ...item,
    members: item.members.map((member) => ({ ...member })),
  }));
  settingsCanonicalByActor.set(settingsCurrentUser.id, {
    revision: settingsCanonicalRevision,
    calendars: cloneSettingsCalendars(settingsCanonicalCalendars),
  });
  tagManagerCanonicalByActor.set(settingsCurrentUser.id, {
    revision: tagManagerCanonicalRevision,
    tags: calendarState.tags.map((tag) => ({ ...tag })),
  });
}

let railSubscribeFormProps: Record<string, unknown>[] = [];
let railConfirmResult = true;
const jsxRuntimeForRail = createRequire(import.meta.url)('react/jsx-runtime') as {
  jsx(type: unknown, props: unknown, key?: string): ReactNode;
};

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
      '@/components/common/ConfirmDialog',
      '@/components/calendar/IcsSubscribeForm',
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
          useCallback: (callback: unknown) => callback,
          useRef: (initial: unknown) => ({ current: initial }),
          useMemo: (factory: () => unknown) => factory(),
        };
      }
      if (id === 'react/jsx-runtime') return nodeRequire('react/jsx-runtime');
      if (id === 'lucide-react') {
        const Icon = () => null;
        return {
          AlertTriangle: Icon, BellOff: Icon, Check: Icon, ChevronDown: Icon, Info: Icon,
          MoreHorizontal: Icon, Plus: Icon, RefreshCw: Icon, Settings: Icon, Trash2: Icon,
        };
      }
      if (id === '@/components/common/ConfirmDialog') {
        return { ConfirmDialog: { show: async () => railConfirmResult } };
      }
      if (id === '@/components/calendar/IcsSubscribeForm') {
        return {
          IcsSubscribeForm: (props: Record<string, unknown>) => {
            railSubscribeFormProps.push(props);
            return jsxRuntimeForRail.jsx('div', {
              'aria-label': props.initial ? '구독 이름·색 바꾸기' : '주소로 구독 추가',
            });
          },
        };
      }
      if (id === '@/stores/useCalendarStore') return {
        useCalendarStore: (selector: (state: typeof calendarState) => unknown) => selector(calendarState),
        isOptimisticCalendarTagId: (idValue: string) => idValue.startsWith('optimistic-tag:'),
      };
      if (id === '@/stores/useAuthStore') return { useAuthStore: (selector: (state: { currentUser: { id: string } }) => unknown) => selector({ currentUser: { id: myUserId } }) };
      if (id === '@/stores/useAppStore') return { useAppStore: (selector: (state: { setView(view: string): void }) => unknown) => selector({ setView: (view) => appViews.push(view) }) };
      return nodeRequire(id);
    }, module, module.exports);
    return module.exports.CalendarRail as CalendarRailComponent;
  });
  return bundledRail;
}

let tagBarReducedMotion = false;

async function loadTagBar(): Promise<TagBarComponent> {
  bundledTagBar ??= build({
    entryPoints: ['src/components/calendar/TagBar.tsx'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    write: false,
    external: [
      'react', 'react/jsx-runtime', 'framer-motion', 'lucide-react',
      '@/hooks/useMotionPref', '@/stores/useCalendarStore',
    ],
  }).then((result) => {
    const module = { exports: {} as Record<string, unknown> };
    const nodeRequire = createRequire(import.meta.url);
    const react = nodeRequire('react') as Record<string, unknown>;
    const evaluate = new Function('require', 'module', 'exports', result.outputFiles[0].text);
    evaluate((id: string) => {
      if (id === 'react') return { ...react, useMemo: (factory: () => unknown) => factory() };
      if (id === 'react/jsx-runtime') return nodeRequire('react/jsx-runtime');
      if (id === 'framer-motion') return { motion: { button: 'button' } };
      if (id === '@/hooks/useMotionPref') return { useMotionPref: () => ({ reduce: tagBarReducedMotion }) };
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
          setTagOptimisticOverlay: calendarState.setTagOptimisticOverlay,
          clearTagOptimisticOverlay: calendarState.clearTagOptimisticOverlay,
          async loadAll() {
            tagManagerApiCalls.push({ name: 'loadAll', args: [] });
            if (tagManagerRefreshGate) await tagManagerRefreshGate;
            const canonicalTags = tagManagerCanonicalTagsAfterReload
              ?? tagManagerLastCommittedTags
              ?? tagManagerCanonicalByActor.get(settingsCurrentUser.id)?.tags
              ?? [];
            if (tagManagerMetadataFreshness.tagsFresh) {
              tagManagerCanonicalByActor.set(settingsCurrentUser.id, {
                revision: ++tagManagerCanonicalRevision,
                tags: canonicalTags.map((tag) => ({ ...tag })),
              });
              calendarState.tags = tagManagerStoreOverlay?.actorId === settingsCurrentUser.id
                ? tagManagerStoreOverlay.tags.map((tag) => ({ ...tag }))
                : canonicalTags.map((tag) => ({ ...tag }));
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
          useEffect(effect: () => void | (() => void), deps?: unknown[]) {
            const slot = tagManagerEffectCursor++;
            if (slot === 2) {
              const previous = tagManagerEffectDeps[slot];
              tagManagerEffectDeps[slot] = deps ? [...deps] : [];
              if (
                previous === undefined
                || deps === undefined
                || previous.length !== deps.length
                || deps.some((dependency, index) => !Object.is(dependency, previous[index]))
              ) effect();
              return;
            }
            if (slot !== 3) return;
            tagManagerEffectCleanup?.();
            tagManagerEffectCleanup = effect() ?? undefined;
          },
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
              if (tagManagerConfirmGate) await tagManagerConfirmGate;
              return tagManagerConfirmResponses.shift() ?? false;
            },
          },
        };
      }
      if (id === '@/stores/useAuthStore') {
        const useAuthStore = Object.assign(
          (selector: (state: { currentUser: TestUser }) => unknown) => selector({ currentUser: settingsCurrentUser }),
          { getState: () => ({ currentUser: settingsCurrentUser }) },
        );
        return {
          useAuthStore,
        };
      }
      if (id === '@/stores/useCalendarStore') {
        return {
          useCalendarStore: useCalendarStoreMock,
          getTagCanonicalSnapshot(actorId: string | undefined) {
            if (!actorId || settingsCurrentUser.id !== actorId) return null;
            const snapshot = tagManagerCanonicalByActor.get(actorId);
            return snapshot ? {
              revision: snapshot.revision,
              tags: snapshot.tags.map((tag) => ({ ...tag })),
            } : null;
          },
        };
      }
      if (id === '@/services/calendarService') {
        return {
          async loadBflowEvents(...args: unknown[]) {
            tagManagerApiCalls.push({ name: 'loadBflowEvents', args });
            if (tagManagerRefreshGate) await tagManagerRefreshGate;
            const options = args[0] as { requireTagsFresh?: boolean } | undefined;
            const refreshed = options?.requireTagsFresh !== true || tagManagerMetadataFreshness.tagsFresh;
            const canonicalTags = tagManagerCanonicalTagsAfterReload
              ?? tagManagerLastCommittedTags
              ?? tagManagerCanonicalByActor.get(settingsCurrentUser.id)?.tags
              ?? [];
            if (refreshed) {
              tagManagerCanonicalByActor.set(settingsCurrentUser.id, {
                revision: ++tagManagerCanonicalRevision,
                tags: canonicalTags.map((tag) => ({ ...tag })),
              });
              calendarState.tags = tagManagerStoreOverlay?.actorId === settingsCurrentUser.id
                ? tagManagerStoreOverlay.tags.map((tag) => ({ ...tag }))
                : canonicalTags.map((tag) => ({ ...tag }));
            }
            return refreshed && tagManagerBflowReloadResult;
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
      document: tagManagerDocumentMock,
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
    plugins: [{
      name: 'schedule-todo-sync-double',
      setup(buildContext) {
        buildContext.onResolve({ filter: /^@\/services\/supabaseService$/ }, () => ({
          path: 'schedule-todo-sync-double',
          namespace: 'schedule-test',
        }));
        buildContext.onLoad({ filter: /^schedule-todo-sync-double$/, namespace: 'schedule-test' }, () => ({
          contents: `
            export async function applyCalendarToTodoPatch(todoId, patch) {
              globalThis.__scheduleTodoSyncCalls.push({ todoId, patch });
            }
          `,
          loader: 'js',
        }));
      },
    }],
    external: [
      'react', 'react/jsx-runtime', 'framer-motion', 'lucide-react',
      '@/utils/cn', '@/stores/useDataStore', '@/stores/useAppStore', '@/services/calendarService',
      '@/services/vacationService', '@/hooks/useCalendarDnD', '@/utils/vacationEvents',
      '@/components/calendar/MiniCalendar', '@/components/calendar/EventSidePanel',
      '@/components/calendar/EventQuickEdit', '@/components/calendar/CalendarGrid',
      '@/components/calendar/EventCreateModal', '@/components/calendar/WeekScrollView',
      '@/components/calendar/WeekTimeGridView',
      '@/components/calendar/WeekSidebar', '@/components/calendar/DayScrollView',
      '@/components/calendar/DaySidebar', '@/components/calendar/CalendarRail',
      '@/components/calendar/TagBar', '@/components/calendar/TagManagerPopover', '@/components/calendar/CalendarSettingsModal',
      '@/hooks/useCalendarDragCreate', '@/stores/useCalendarStore',
      '@/hooks/useMotionPref',
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
          useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
            const slot = scheduleEffectCursor++;
            const previous = scheduleEffectDeps[slot];
            const changed = deps === undefined
              || previous === undefined
              || deps.length !== previous.length
              || deps.some((value, index) => !Object.is(value, previous[index]));
            scheduleEffectDeps[slot] = deps;
            if (changed) schedulePendingEffects.push(effect);
          },
          useMemo: (factory: () => unknown) => factory(),
          useCallback<T>(fn: T, deps?: readonly unknown[]) {
            const slot = scheduleCallbackCursor++;
            const previousDeps = scheduleCallbackDeps[slot];
            const changed = deps === undefined
              || previousDeps === undefined
              || deps.length !== previousDeps.length
              || deps.some((dependency, index) => !Object.is(dependency, previousDeps[index]));
            if (changed) {
              scheduleCallbackSlots[slot] = fn;
              scheduleCallbackDeps[slot] = deps;
            }
            return scheduleCallbackSlots[slot] as T;
          },
          useRef(initial: unknown) {
            const slot = scheduleRefCursor++;
            scheduleRefSlots[slot] ??= { current: initial };
            return scheduleRefSlots[slot];
          },
        };
      }
      if (id === 'react/jsx-runtime') return jsxRuntime;
      if (id === 'framer-motion') {
        return {
          AnimatePresence: ({ children }: { children: ReactNode }) => children,
          MotionConfig: ({ children, reducedMotion }: { children: ReactNode; reducedMotion?: string }) => jsxRuntime.jsx('motion-config', {
            'data-testid': 'schedule-motion-config',
            'data-reduced-motion': reducedMotion,
            children,
          }),
          motion: { div: 'div' },
        };
      }
      if (id === 'lucide-react') return { CalendarDays: emptyComponent, ChevronLeft: emptyComponent, ChevronRight: emptyComponent, Plus: emptyComponent };
      if (id === '@/utils/cn') return { cn: (...values: string[]) => values.filter(Boolean).join(' ') };
      if (id === '@/stores/useDataStore') return { useDataStore: (selector: (state: { episodes: []; episodeTitles: {} }) => unknown) => selector({ episodes: [], episodeTitles: {} }) };
      if (id === '@/stores/useAppStore') {
        const appState = {
          setView() {},
          get currentView() {
            return scheduleCurrentView;
          },
          vacationConnected: false,
          get pendingScheduleDateNavigationRequest() {
            return schedulePendingDateNavigation;
          },
          get pendingScheduleTodoPanelNavigationRequest() {
            return schedulePendingTodoPanelNavigation;
          },
          consumeScheduleDateNavigationRequest(requestId: number) {
            if (schedulePendingDateNavigation?.id !== requestId) return null;
            const request = schedulePendingDateNavigation;
            schedulePendingDateNavigation = null;
            scheduleDateNavigationConsumeIds.push(requestId);
            return request;
          },
          consumeScheduleTodoPanelNavigationRequest(requestId: number) {
            if (schedulePendingTodoPanelNavigation?.id !== requestId) return null;
            const request = schedulePendingTodoPanelNavigation;
            schedulePendingTodoPanelNavigation = null;
            scheduleTodoPanelNavigationConsumeIds.push(requestId);
            return request;
          },
        };
        return { useAppStore: (selector?: (state: typeof appState) => unknown) => selector ? selector(appState) : appState };
      }
      if (id === '@/services/calendarService') return {
        getEvents: async () => {
          scheduleGetEventsCalls += 1;
          if (scheduleGetEventsGate) await scheduleGetEventsGate;
          return scheduleCanonicalEvents;
        },
        isGoogleCacheReady: () => true,
        loadBflowEvents: async () => {
          scheduleLoadBflowEventsCalls += 1;
          await scheduleLoadBflowEventsHandler?.();
          return true;
        },
        addEvent: async (
          event: ScheduleCalendarEvent,
          options?: { onPersistedIdentity?: (identity: ScheduleEventIdentity) => void },
        ) => {
          scheduleAddedEvents.push(event);
          const persistedIdentity = schedulePersistedAddIdentities.shift();
          if (persistedIdentity) options?.onPersistedIdentity?.(persistedIdentity);
        },
        updateEvent: async (
          id: string,
          updates: Partial<ScheduleCalendarEvent>,
          targetIdentity?: ScheduleEventIdentity,
        ) => {
          scheduleUpdateCalls.push({ id, updates, targetIdentity });
          await scheduleUpdateHandler?.(id, updates);
        },
        deleteEvent: async (id: string, targetIdentity?: ScheduleEventIdentity) => {
          scheduleDeleteCalls.push({ id, targetIdentity });
          await scheduleDeleteHandler?.(id, targetIdentity);
        },
      };
      if (id === '@/services/vacationService') return { fetchAllVacationEvents: async () => [] };
      if (id === '@/hooks/useCalendarDnD') {
        return {
          useCalendarDnD: (onEventMove: typeof scheduleDragDoneHandler) => {
            scheduleDragDoneHandler = onEventMove;
            return { isDragging: false, preview: null, startDrag() {} };
          },
        };
      }
      if (id === '@/utils/vacationEvents') return { mapVacationEvents: () => [] };
      if (id === '@/components/calendar/MiniCalendar') {
        return {
          MiniCalendar: (props: MiniCalendarProps) => {
            scheduleMiniCalendarProps.push(props);
            return jsxRuntime.jsx('div', { 'data-testid': 'mini-calendar', children: '미니 캘린더' });
          },
        };
      }
      if (id === '@/components/calendar/WeekScrollView') {
        return {
          __esModule: true,
          default: (props: WeekScrollViewProps) => {
            scheduleWeekScrollProps.push(props);
            return jsxRuntime.jsx('div', { 'data-testid': 'week-scroll-view', children: '주간 카드 본체' });
          },
          generateYearWeeks: scheduleGenerateYearWeeks,
          findWeekIndexForDate: scheduleFindWeekIndexForDate,
        };
      }
      if (id === '@/components/calendar/WeekTimeGridView') {
        return {
          WeekTimeGridView: (props: WeekTimeGridViewProps) => {
            scheduleTimeGridProps.push(props);
            return jsxRuntime.jsx('div', { 'data-testid': 'week-time-grid-view', children: '주간 시간표 본체' });
          },
        };
      }
      if (id === '@/components/calendar/DayScrollView') {
        return {
          __esModule: true,
          default: (props: DayScrollViewProps) => {
            scheduleDayScrollProps.push(props);
            return jsxRuntime.jsx('div', { 'data-testid': 'day-scroll-view', children: '오늘 카드 본체' });
          },
        };
      }
      if (id === '@/components/calendar/WeekSidebar') {
        return { __esModule: true, default: () => jsxRuntime.jsx('div', { 'data-testid': 'week-sidebar', children: '주간 사이드바' }) };
      }
      if (id === '@/components/calendar/DaySidebar') {
        return { __esModule: true, default: () => jsxRuntime.jsx('div', { 'data-testid': 'day-sidebar', children: '일간 사이드바' }) };
      }
      if (id === '@/hooks/useMotionPref') return { useMotionPref: () => ({ reduce: scheduleReducedMotion }) };
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
      if (id === '@/utils/createUuid') {
        return { createUuid: () => scheduleCreateUuidValues.shift() ?? 'new-id' };
      }
      if (id === '@/utils/calendarDate') {
        const getISOWeekNumber = (value: Date) => {
          const date = new Date(value.getFullYear(), value.getMonth(), value.getDate());
          date.setDate(date.getDate() + 4 - (date.getDay() || 7));
          const yearStart = new Date(date.getFullYear(), 0, 1);
          return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
        };
        return {
          fmtDate: scheduleFmtDate,
          parseDate: (date: string) => new Date(`${date}T12:00:00`),
          addDays: (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12),
          getISOWeekNumber,
          formatWeekHeaderLabel: (startWeek: readonly Date[], endWeek: readonly Date[]) => {
            const first = startWeek[0];
            const last = endWeek[6];
            const anchor = startWeek[4];
            if (!first || !last || !anchor) return '';
            const range = `${first.getMonth() + 1}.${first.getDate()} – ${last.getMonth() + 1}.${last.getDate()}`;
            return `${anchor.getFullYear()}년 ${anchor.getMonth() + 1}월 · ${getISOWeekNumber(anchor)}주차 · ${range}`;
          },
        };
      }
      if (id === '@/utils/calendarEventFilter') return { filterCalendarEvents: (events: unknown[]) => events };
      if (id === '@/components/calendar/CalendarGrid') {
        return { CalendarGrid: (props: ScheduleGridProps) => { scheduleGridProps.push(props); return jsxRuntime.jsx('div', { 'data-testid': 'calendar-grid', children: '캘린더 그리드' }); } };
      }
      if (id === '@/components/calendar/EventSidePanel') {
        return { EventSidePanel: (props: SchedulePanelProps) => { schedulePanelProps.push(props); return jsxRuntime.jsx('div', { 'aria-label': '일정 상세 패널 연결됨', children: props.event.title }); } };
      }
      if (id === '@/components/calendar/EventCreateModal') {
        return {
          EventCreateModal: (props: EventCreateModalProps) => {
            scheduleCreateModalProps.push(props);
            return jsxRuntime.jsx('div', { 'aria-label': '일정 생성 모달 연결됨', children: props.initialDate ?? '오늘' });
          },
        };
      }
      if (id === '@/components/calendar/EventQuickEdit') {
        return { EventQuickEdit: (props: ScheduleQuickEditProps) => { scheduleQuickEditProps.push(props); return jsxRuntime.jsx('div', { 'aria-label': '일정 퀵에디트 연결됨', children: props.event.title }); } };
      }
      if (id.startsWith('@/components/calendar/')) return Object.fromEntries([[id.split('/').at(-1)?.replace(/\.tsx$/, ''), emptyComponent]]);
      return nodeRequire(id);
    }, module, module.exports);
    Object.assign(globalThis, {
      document: scheduleDocumentMock,
      window: {
        addEventListener(type: string, listener: (event: Event) => void) {
          const listeners = scheduleWindowListeners.get(type) ?? new Set();
          listeners.add(listener);
          scheduleWindowListeners.set(type, listeners);
        },
        removeEventListener(type: string, listener: (event: Event) => void) {
          scheduleWindowListeners.get(type)?.delete(listener);
        },
        localStorage: {
          getItem(key: string) { return scheduleLocalStorage.get(key) ?? null; },
          setItem(key: string, value: string) { scheduleLocalStorage.set(key, value); },
        },
        electronAPI: { async gcalIsAuthenticated() { return false; } },
      },
    });
    return module.exports.ScheduleView as ScheduleViewComponent;
  });
  return bundledScheduleView;
}

async function loadShortcutHelpOverlay(): Promise<ShortcutHelpOverlayComponent> {
  bundledShortcutHelpOverlay ??= build({
    entryPoints: ['src/components/calendar/ShortcutHelpOverlay.tsx'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    write: false,
    external: ['react', 'react/jsx-runtime', '@/utils/cn', '@/hooks/useMotionPref'],
  }).then((result) => {
    const module = { exports: {} as Record<string, unknown> };
    const nodeRequire = createRequire(import.meta.url);
    const react = nodeRequire('react') as Record<string, unknown>;
    const jsxRuntime = nodeRequire('react/jsx-runtime');
    let refCursor = 0;
    const evaluate = new Function('require', 'module', 'exports', result.outputFiles[0].text);
    evaluate((id: string) => {
      if (id === 'react') {
        return {
          ...react,
          useEffect(effect: () => void | (() => void)) {
            shortcutOverlayEffects.push(effect);
          },
          useRef(initial: unknown) {
            const slot = refCursor++;
            shortcutOverlayRefs[slot] ??= { current: initial };
            return shortcutOverlayRefs[slot];
          },
        };
      }
      if (id === 'react/jsx-runtime') return jsxRuntime;
      if (id === '@/utils/cn') return { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') };
      if (id === '@/hooks/useMotionPref') return { useMotionPref: () => ({ reduce: false }) };
      return nodeRequire(id);
    }, module, module.exports);
    return module.exports.ShortcutHelpOverlay as ShortcutHelpOverlayComponent;
  });
  return bundledShortcutHelpOverlay;
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
          useEffect: (effect: () => void | (() => void)) => { pendingCalendarGridEffects.push(effect); },
        };
      }
      if (id === 'react/jsx-runtime') return jsxRuntime;
      if (id === 'react-dom') return { createPortal: (children: ReactNode) => children };
      if (id === 'framer-motion') return {
        AnimatePresence: ({ children }: { children: ReactNode }) => children,
        motion: { div: 'div' },
      };
      if (id === 'lucide-react') return {
        CheckSquare: () => jsxRuntime.jsx('span', { 'data-linked-todo-icon': true }),
        Palmtree: emptyComponent,
        X: emptyComponent,
      };
      if (id === '@/utils/cn') return { cn: (...values: unknown[]) => values.filter(Boolean).join(' ') };
      return nodeRequire(id);
    }, module, module.exports);
    return module.exports.CalendarGrid as CalendarGridComponent;
  });
  return bundledCalendarGrid;
}

async function loadEventSidePanel(): Promise<EventSidePanelComponent> {
  bundledEventSidePanel ??= build({
    entryPoints: ['src/components/calendar/EventSidePanel.tsx'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    write: false,
    external: [
      'react', 'react/jsx-runtime', 'framer-motion', 'lucide-react',
      '@/stores/useDataStore', '@/stores/useAppStore', '@/stores/useAuthStore',
      '@/stores/useCalendarStore', '@/components/common/EntityAwareInput',
      '@/components/common/EntityText', '@/types', '@/types/calendar',
      '@/utils/glassStyles', '@/utils/calendarDate',
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
          useEffect() {},
          useMemo: (factory: () => unknown) => factory(),
          useRef(initial: unknown) {
            const slot = eventSidePanelRefCursor++;
            eventSidePanelRefSlots[slot] ??= { current: initial };
            return eventSidePanelRefSlots[slot];
          },
        };
      }
      if (id === 'react/jsx-runtime') return jsxRuntime;
      if (id === 'framer-motion') return {
        AnimatePresence: ({ children }: { children: ReactNode }) => children,
        motion: { div: 'div' },
      };
      if (id === 'lucide-react') return new Proxy({}, { get: () => emptyComponent });
      if (id === '@/stores/useDataStore') {
        return { useDataStore: (selector: (state: { episodeTitles: {} }) => unknown) => selector({ episodeTitles: {} }) };
      }
      if (id === '@/stores/useAppStore') {
        const appState = { colorMode: 'dark', setView: (view: string) => appViews.push(view) };
        return { useAppStore: (selector: (state: typeof appState) => unknown) => selector(appState) };
      }
      if (id === '@/stores/useAuthStore') {
        const authState = { users: [], currentUser: settingsCurrentUser };
        return { useAuthStore: (selector: (state: typeof authState) => unknown) => selector(authState) };
      }
      if (id === '@/stores/useCalendarStore') return {
        useCalendarStore: (selector: (state: typeof calendarState) => unknown) => selector(calendarState),
        isOptimisticCalendarTagId: (idValue: string) => idValue.startsWith('optimistic-tag:'),
        getTagCanonicalSnapshot: () => null,
      };
      if (id === '@/components/common/EntityAwareInput') return { EntityAwareInput: () => null };
      if (id === '@/components/common/EntityText') {
        return { EntityText: ({ text }: { text?: string }) => text ?? null };
      }
      if (id === '@/types') return { DEPARTMENT_CONFIGS: {} };
      if (id === '@/types/calendar') return { EVENT_COLORS: ['#6C5CE7'] };
      if (id === '@/utils/glassStyles') return { floatingGlassStyle: {} };
      if (id === '@/utils/calendarDate') return { parseDate: (date: string) => new Date(`${date}T12:00:00`) };
      return nodeRequire(id);
    }, module, module.exports);
    return module.exports.EventSidePanel as EventSidePanelComponent;
  });
  return bundledEventSidePanel;
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
      if (id === '@/stores/useAuthStore') return { useAuthStore: (selector: (state: { currentUser: { id: string; name: string } }) => unknown) => selector({ currentUser: { id: settingsCurrentUser.id, name: '배한솔' } }) };
      if (id === '@/stores/useDataStore') return { useDataStore: (selector: (state: { episodeTitles: {} }) => unknown) => selector({ episodeTitles: {} }) };
      if (id === '@/stores/useAppStore') return { useAppStore: (selector: (state: { colorMode: string }) => unknown) => selector({ colorMode: 'dark' }) };
      if (id === '@/stores/useCalendarStore') return {
        useCalendarStore: (selector: (state: typeof calendarState) => unknown) => selector(calendarState),
        isOptimisticCalendarTagId: (idValue: string) => idValue.startsWith('optimistic-tag:'),
        getTagCanonicalSnapshot(actorId: string | undefined) {
          if (!actorId || actorId !== settingsCurrentUser.id) return null;
          const snapshot = tagManagerCanonicalByActor.get(actorId);
          return snapshot ? {
            revision: snapshot.revision,
            tags: snapshot.tags.map((tag) => ({ ...tag })),
          } : null;
        },
      };
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
          upsertCalendarOptimistically: calendarState.upsertCalendarOptimistically,
          removeCalendarOptimistically: calendarState.removeCalendarOptimistically,
          setCalendarOptimisticOverlay: calendarState.setCalendarOptimisticOverlay,
          clearCalendarOptimisticOverlay: calendarState.clearCalendarOptimisticOverlay,
          async loadAll() {
            settingsApiCalls.push({ name: 'loadAll', args: [] });
            if (settingsRefreshGate) await settingsRefreshGate;
            settingsRefreshCount += 1;
            if (settingsMetadataFreshness.calendarsFresh) {
              const canonical = settingsCanonicalCalendarsAfterReload ?? settingsCanonicalCalendars;
              publishSettingsCanonicalSnapshot(settingsCurrentUser.id, canonical);
              const overlay = settingsOptimisticByActor.get(settingsCurrentUser.id)?.overlay;
              calendarState.calendars = overlay
                ? applySettingsCalendarOverlay(settingsCurrentUser.id, canonical, overlay)
                : cloneSettingsCalendars(canonical);
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
      const created = {
        id: 'created-calendar',
        name: String(input?.name ?? ''),
        color: input?.color ?? '#6C5CE7',
        visibility: input?.visibility ?? 'members',
        owner_id: settingsCurrentUser.id,
        is_personal: false,
        created_at: '2026-08-25T00:00:00.000Z',
        updated_at: '2026-08-25T00:00:00.000Z',
      };
      if (name === 'calendarCreate') {
        const createInput = args[0] as {
          name: string;
          color: string;
          visibility: BflowCalendar['visibility'];
          members?: Array<{ user_id: string; can_edit: boolean }>;
        };
        settingsCanonicalCalendars = [...settingsCanonicalCalendars, {
          id: created.id,
          name: createInput.name,
          color: createInput.color,
          visibility: createInput.visibility,
          ownerId: settingsCurrentUser.id,
          isPersonal: false,
          members: (createInput.members ?? []).map((member) => ({
            userId: member.user_id,
            canEdit: member.can_edit,
          })),
          canEdit: true,
          canManage: true,
          createdAt: created.created_at,
        }];
      } else if (name === 'calendarUpdate') {
        const calendarId = args[0] as string;
        const updates = args[1] as {
          name?: string;
          color?: string;
          visibility?: BflowCalendar['visibility'];
          members?: Array<{ user_id: string; can_edit: boolean }>;
        };
        settingsCanonicalCalendars = settingsCanonicalCalendars.map((item) => (
          item.id === calendarId
            ? {
                ...item,
                ...updates,
                ...(updates.members === undefined ? {} : {
                  members: updates.members.map((member) => ({
                    userId: member.user_id,
                    canEdit: member.can_edit,
                  })),
                }),
              }
            : item
        ));
      } else if (name === 'calendarDelete') {
        const calendarId = args[0] as string;
        settingsCanonicalCalendars = settingsCanonicalCalendars.filter((item) => item.id !== calendarId);
      }
      return created;
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
              if (settingsConfirmGate) await settingsConfirmGate;
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
      if (id === '@/stores/useCalendarStore') {
        return {
          useCalendarStore: useCalendarStoreMock,
          getCalendarCanonicalSnapshot(actorId: string) {
            const snapshot = settingsCanonicalByActor.get(actorId);
            return snapshot ? {
              revision: snapshot.revision,
              calendars: cloneSettingsCalendars(snapshot.calendars),
            } : null;
          },
        };
      }
      if (id === '@/services/calendarService') {
        return {
          refreshCalendarPresentationFromMetadata() {
            settingsPresentationRefreshCount += 1;
            const calendarsById = new Map(calendarState.calendars.map((item) => [item.id, item]));
            settingsCachedEvents = settingsCachedEvents.flatMap((event) => {
              if (event.source !== 'bflow' || !event.calendarId) return [event];
              const eventCalendar = calendarsById.get(event.calendarId);
              return eventCalendar ? [{ ...event, color: eventCalendar.color }] : [];
            });
          },
          async loadBflowEvents() {
            settingsApiCalls.push({ name: 'loadBflowEvents', args: [] });
            if (settingsRefreshGate) await settingsRefreshGate;
            settingsRefreshCount += 1;
            if (settingsBflowMetadataFresh) {
              const canonical = settingsCanonicalCalendarsAfterReload ?? settingsCanonicalCalendars;
              publishSettingsCanonicalSnapshot(settingsCurrentUser.id, canonical);
              const overlay = settingsOptimisticByActor.get(settingsCurrentUser.id)?.overlay;
              calendarState.calendars = overlay
                ? applySettingsCalendarOverlay(settingsCurrentUser.id, canonical, overlay)
                : cloneSettingsCalendars(canonical);
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
      '@/stores/useCalendarStore', '@/hooks/useMotionPref',
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
      if (id === '@/hooks/useMotionPref') return { useMotionPref: () => ({ reduce: scheduleReducedMotion }) };
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

async function renderRail(
  isAuthenticated: boolean,
  options: { resetState?: boolean } = {},
): Promise<ReactNode> {
  const CalendarRail = await loadRail();
  // stateSlots는 컴포넌트 사이에 공유된다. 다른 컴포넌트를 먼저 렌더한 테스트는
  // 남은 값이 레일의 훅 슬롯으로 새지 않도록 resetState를 켜야 한다. 레일을 연달아
  // 렌더하며 열린 메뉴 같은 상태를 이어 보는 테스트는 기본값(유지)을 쓴다.
  if (options.resetState) stateSlots = [];
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
  tagManagerEffectCursor = 0;
  globalThis.document = tagManagerDocumentMock as unknown as Document;
  return resolveComponents(TagManagerPopover({
    anchorRect,
    onClose: () => { tagManagerCloseCount += 1; },
  }));
}

function dispatchTagManagerEscape(target?: FormElement): void {
  let propagationStopped = false;
  let immediatePropagationStopped = false;
  const event = {
    key: 'Escape',
    clientX: 0,
    clientY: 0,
    target: {},
    preventDefault() {},
    stopPropagation() { propagationStopped = true; },
    stopImmediatePropagation() {
      propagationStopped = true;
      immediatePropagationStopped = true;
    },
  };
  const listeners = [...(tagManagerDocumentListeners.get('keydown') ?? [])];
  for (const entry of listeners.filter(({ capture }) => capture)) {
    entry.listener(event);
    if (immediatePropagationStopped) return;
  }
  if (!propagationStopped) target?.props.onKeyDown?.(event);
  if (propagationStopped) return;
  for (const entry of listeners.filter(({ capture }) => !capture)) {
    entry.listener(event);
    if (immediatePropagationStopped) return;
  }
}

async function renderScheduleView(): Promise<ReactNode> {
  const ScheduleView = await loadScheduleView();
  globalThis.document = scheduleDocumentMock as unknown as Document;
  stateCursor = 0;
  scheduleRefCursor = 0;
  scheduleEffectCursor = 0;
  scheduleCallbackCursor = 0;
  return resolveComponents(ScheduleView());
}

async function rerenderScheduleViewWithFreshEffects(): Promise<ReactNode> {
  for (const cleanup of scheduleMountedEffectCleanups.splice(0).reverse()) cleanup();
  schedulePendingEffects = [];
  scheduleEffectDeps = [];
  const tree = await renderScheduleView();
  await flushScheduleMountEffects();
  return tree;
}

async function flushScheduleMountEffects(): Promise<void> {
  const effects = schedulePendingEffects.splice(0);
  for (const effect of effects) {
    const cleanup = effect();
    if (typeof cleanup === 'function') scheduleMountedEffectCleanups.push(cleanup);
  }
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function dispatchScheduleKeydown(
  key: string,
  target: { tagName: string; isContentEditable?: boolean } = { tagName: 'DIV' },
  modifiers: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {},
): void {
  const event = {
    key,
    target,
    ...modifiers,
    preventDefault() {},
    stopPropagation() {},
  } as unknown as Event;
  for (const listener of scheduleDocumentListeners.get('keydown') ?? []) listener(event);
}

async function dispatchScheduleWindowEvent(type: string, detail?: Record<string, unknown>): Promise<void> {
  for (const listener of scheduleWindowListeners.get(type) ?? []) {
    listener({ type, detail } as unknown as Event);
  }
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function installScheduleFakeClock(initialNow = 1_000): {
  advance(ms: number): void;
  restore(): void;
} {
  const realDateNow = Date.now;
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  let now = initialNow;
  let nextTimerId = 0;
  const timers = new Map<number, { due: number; callback: () => void }>();

  Date.now = () => now;
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay = 0, ...args: unknown[]) => {
    const id = ++nextTimerId;
    timers.set(id, { due: now + Number(delay), callback: () => callback(...args) });
    return id as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((handle: ReturnType<typeof setTimeout>) => {
    timers.delete(handle as unknown as number);
  }) as typeof clearTimeout;

  return {
    advance(ms: number) {
      now += ms;
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.due <= now)
          .sort((left, right) => left[1].due - right[1].due)[0];
        if (!due) break;
        timers.delete(due[0]);
        due[1].callback();
      }
    },
    restore() {
      Date.now = realDateNow;
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    },
  };
}

async function renderCalendarGrid(
  events: ScheduleCalendarEvent[],
  overrides: Partial<CalendarGridProps> = {},
  preserveState = false,
): Promise<ReactNode> {
  const CalendarGrid = await loadCalendarGrid();
  if (!preserveState) {
    stateSlots = [];
    calendarGridEffectCleanups.splice(0).forEach((cleanup) => cleanup());
  }
  pendingCalendarGridEffects = [];
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
    ...overrides,
  }));
}

async function renderEventSidePanel(event: ScheduleCalendarEvent): Promise<ReactNode> {
  const EventSidePanel = await loadEventSidePanel();
  stateSlots = [];
  stateCursor = 0;
  eventSidePanelRefSlots = [];
  eventSidePanelRefCursor = 0;
  return resolveComponents(EventSidePanel({
    event,
    onClose() {},
    onDelete() {},
    onUpdate() {},
    onNavigate() {},
  }));
}

async function renderEventCreateModal(
  googleAuthenticated: boolean,
  onSave: (event: Record<string, unknown>) => void | Promise<void>,
  initialDate = '2026-08-25',
  episodes: EventCreateModalProps['episodes'] = [],
  prefill: Pick<EventCreateModalProps, 'initialEndDate' | 'initialStartTime' | 'initialEndTime'> = {},
): Promise<ReactNode> {
  const EventCreateModal = await loadEventCreateModal();
  stateCursor = 0;
  modalRefCursor = 0;
  modalEffectCursor = 0;
  return resolveComponents(EventCreateModal({
    initialDate,
    initialEndDate: initialDate,
    ...prefill,
    episodes,
    googleAuthenticated,
    onClose() {},
    onSave,
  }));
}

function flushEventCreateEffects(): void {
  const effects = pendingModalEffects.splice(0);
  for (const effect of effects) effect();
}

function flushCalendarGridEffects(): void {
  for (const effect of pendingCalendarGridEffects.splice(0)) {
    const cleanup = effect();
    if (typeof cleanup === 'function') calendarGridEffectCleanups.push(cleanup);
  }
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
    const added = {
      ...calendarValue,
      members: calendarValue.members.map((member) => ({ ...member })),
    };
    calendarState.calendars = [...calendarState.calendars, added];
    if (!settingsCanonicalCalendars.some((item) => item.id === calendarValue.id)) {
      settingsCanonicalCalendars = [...settingsCanonicalCalendars, {
        ...added,
        members: added.members.map((member) => ({ ...member })),
      }];
      const existingSnapshot = settingsCanonicalByActor.get(settingsCurrentUser.id);
      settingsCanonicalByActor.set(settingsCurrentUser.id, {
        revision: existingSnapshot?.revision ?? settingsCanonicalRevision,
        calendars: cloneSettingsCalendars(settingsCanonicalCalendars),
      });
    }
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

test('WeekScrollView and DayScrollView render an exact realtime target on active event cards', async (t) => {
  const event = calendarListEvent({
    id: 'card-realtime-target',
    title: '다른 팀원의 변경',
    source: 'google',
    sourceCalendarId: 'primary',
    calendarId: undefined,
  });
  const identityKey = 'google\u0000primary\u0000card-realtime-target';
  const highlighted = new Set([identityKey]);

  await t.test('week card view', async () => {
    resetHarness();
    const weekModule = await loadWeekScrollView();
    const weeks = weekModule.generateYearWeeks(2026);
    const tree = resolveComponents(weekModule.default({
      currentMonth: 7,
      currentYear: 2026,
      events: [event],
      today: '2026-08-25',
      onEventClick() {},
      activeWeekIndex: weekModule.findWeekIndexForDate(weeks, '2026-08-25'),
      onWeekChange() {},
      highlightedEventIdentities: highlighted,
    }));
    const card = findElements(tree, (candidate) => candidate.props['data-event-identity'] === identityKey)[0];
    assert.ok(card, 'the active weekly card keeps its source-aware identity');
    assert.equal(card.props['data-realtime-highlight'], 'true');
    assert.match(String(card.props.className), /calendar-realtime-highlight/);
  });

  await t.test('today card view', async () => {
    resetHarness();
    const DayScrollView = await loadDayScrollView();
    const tree = resolveComponents(DayScrollView({
      events: [event],
      activeDayIndex: activeDayIndex(2026, 7, 25),
      onActiveDayChange() {},
      year: 2026,
      highlightedEventIdentities: highlighted,
    }));
    const card = findElements(tree, (candidate) => candidate.props['data-event-identity'] === identityKey)[0];
    assert.ok(card, 'the active daily card keeps its source-aware identity');
    assert.equal(card.props['data-realtime-highlight'], 'true');
    assert.match(String(card.props.className), /calendar-realtime-highlight/);
  });
});

test('WeekScrollView keeps every event card while exposing a linked +N overflow control after five bars', async () => {
  resetHarness();
  const weekModule = await loadWeekScrollView();
  const weeks = weekModule.generateYearWeeks(2026);
  const activeWeekIndex = weekModule.findWeekIndexForDate(weeks, '2026-08-25');
  const events = Array.from({ length: 6 }, (_, index) => calendarListEvent({
    id: `overflow-${index + 1}`,
    title: `넘침 일정 ${index + 1}`,
    startDate: '2026-08-23',
    endDate: '2026-08-23',
  }));

  const tree = resolveComponents(weekModule.default({
    currentMonth: 7,
    currentYear: 2026,
    events,
    today: '2026-08-25',
    onEventClick() {},
    activeWeekIndex,
    onWeekChange() {},
  }));

  const overflowButton = buttonByLabel(tree, '숨은 일정 1개 보기');
  assert.equal(textContent(overflowButton), '+1개');
  const eventList = findElements(tree, (element) => element.props['data-scroll-events'] === true)[0];
  assert.ok(eventList, 'the active week still contains the full card list');
  assert.equal(overflowButton.props['aria-controls'], eventList.props.id, 'the overflow control targets the card list it reveals');
  assert.equal(directElementChildren(eventList).length, 6, 'only the bar strip is capped; every event remains available as a card');
});

test('WeekScrollView respects reduced motion when +N reveals the full event card list', async (t) => {
  for (const scenario of [
    { reduce: false, behavior: 'smooth' },
    { reduce: true, behavior: 'auto' },
  ] as const) {
    await t.test(scenario.reduce ? 'reduced motion uses an instant jump' : 'normal motion keeps a smooth jump', async () => {
      resetHarness();
      scheduleReducedMotion = scenario.reduce;
      const weekModule = await loadWeekScrollView();
      const weeks = weekModule.generateYearWeeks(2026);
      const events = Array.from({ length: 6 }, (_, index) => calendarListEvent({
        id: `motion-overflow-${index + 1}`,
        title: `모션 넘침 일정 ${index + 1}`,
        startDate: '2026-08-23',
        endDate: '2026-08-23',
      }));
      const tree = resolveComponents(weekModule.default({
        currentMonth: 7,
        currentYear: 2026,
        events,
        today: '2026-08-25',
        onEventClick() {},
        activeWeekIndex: weekModule.findWeekIndexForDate(weeks, '2026-08-25'),
        onWeekChange() {},
      }));

      const eventList = findElements(tree, (element) => element.props['data-scroll-events'] === true)[0];
      assert.ok(eventList, 'the reveal target remains the complete card list');
      const eventListRef = (eventList as unknown as {
        ref: {
          current: {
            scrollIntoView(options: Record<string, unknown>): void;
            focus(options: Record<string, unknown>): void;
          } | null;
        };
      }).ref;
      assert.ok(eventListRef, 'the card list is reachable through its reveal ref');
      const scrollCalls: Array<Record<string, unknown>> = [];
      const focusCalls: Array<Record<string, unknown>> = [];
      eventListRef.current = {
        scrollIntoView(options) { scrollCalls.push(options); },
        focus(options) { focusCalls.push(options); },
      };

      buttonByLabel(tree, '숨은 일정 1개 보기').props.onClick?.({ stopPropagation() {} });
      assert.deepEqual(scrollCalls, [{ behavior: scenario.behavior, block: 'nearest' }]);
      assert.deepEqual(focusCalls, [{ preventScroll: true }]);
    });
  }
});

test('WeekScrollView delegates a boundary wheel step so ScheduleView can change the year', async () => {
  resetHarness();
  const weekModule = await loadWeekScrollView();
  const requestedIndices: number[] = [];
  const tree = resolveComponents(weekModule.default({
    currentMonth: 7,
    currentYear: 2026,
    events: [],
    today: '2026-08-25',
    onEventClick() {},
    activeWeekIndex: 0,
    onWeekChange: (index) => requestedIndices.push(index),
  }));
  const wheelSurface = findElements(tree, (element) => typeof element.props.onWheel === 'function')[0];
  assert.ok(wheelSurface, 'the weekly card surface owns its wheel policy');
  (wheelSurface.props.onWheel as (event: { deltaY: number; target: { closest(): null } }) => void)({
    deltaY: -1,
    target: { closest: () => null },
  });
  assert.deepEqual(requestedIndices, [-1], 'the previous-year boundary is passed to the parent instead of being silently clamped');
});

test('DayScrollView delegates the December 31 wheel step so ScheduleView can advance to January 1', async () => {
  resetHarness();
  const DayScrollView = await loadDayScrollView();
  const requestedIndices: number[] = [];
  const tree = resolveComponents(DayScrollView({
    events: [],
    activeDayIndex: 364,
    onActiveDayChange: (index) => requestedIndices.push(index),
    year: 2026,
  }));
  const wheelSurface = findElements(tree, (element) => typeof element.props.onWheel === 'function')[0];
  assert.ok(wheelSurface, 'the daily card surface owns its wheel policy');
  (wheelSurface.props.onWheel as (event: { deltaY: number; target: { closest(): null } }) => void)({
    deltaY: 1,
    target: { closest: () => null },
  });
  assert.deepEqual(
    requestedIndices,
    [365],
    'December 31 forwards the next-day sentinel to ScheduleView instead of silently clamping',
  );
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

  await t.test('Escape cancels an active inline edit before a later Escape closes the popover', async () => {
    resetHarness();
    let tree = await renderTagManagerPopover();
    buttonByLabel(tree, '회의 태그 편집').props.onClick?.();
    tree = await renderTagManagerPopover();
    const input = formElementByLabel(tree, '회의 태그 이름');

    dispatchTagManagerEscape(input);
    assert.equal(tagManagerCloseCount, 0, '입력창의 첫 Escape는 팝오버를 닫지 않는다');
    tree = await renderTagManagerPopover();
    assert.equal(
      findFormElements(tree).some((element) => element.props['aria-label'] === '회의 태그 이름'),
      false,
      '첫 Escape는 인라인 편집만 취소한다',
    );

    dispatchTagManagerEscape();
    assert.equal(tagManagerCloseCount, 1, '편집이 없을 때의 다음 Escape는 팝오버를 닫는다');
  });

  await t.test('Escape from a color preset cancels the active edit before closing the popover', async () => {
    resetHarness();
    let tree = await renderTagManagerPopover();
    buttonByLabel(tree, '회의 태그 편집').props.onClick?.();
    tree = await renderTagManagerPopover();
    assert.ok(buttonByLabel(tree, '#6C5CE7 태그 색상'), '편집 중 색상 프리셋이 렌더링된다');

    dispatchTagManagerEscape();
    assert.equal(tagManagerCloseCount, 0, '색상 버튼에서의 첫 Escape는 팝오버를 닫지 않는다');
    tree = await renderTagManagerPopover();
    assert.equal(
      findFormElements(tree).some((element) => element.props['aria-label'] === '회의 태그 이름'),
      false,
      '입력창 밖에서의 첫 Escape도 인라인 편집만 취소한다',
    );

    dispatchTagManagerEscape();
    assert.equal(tagManagerCloseCount, 1, '편집 취소 후 다음 Escape는 팝오버를 닫는다');
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
    assert.equal(
      buttonByLabel(tree, '리뷰 태그 편집').props.disabled,
      true,
      'a returned UUID remains visible but full-list writes stay locked until a fresh rebase',
    );

    tagManagerMetadataFreshness = { calendarsFresh: true, tagsFresh: true };
    tagManagerCanonicalTagsAfterReload = tagManagerLastCommittedTags;
    await buttonByLabel(tree, '최신 태그 목록 다시 불러오기').props.onClick?.();
    tree = await renderTagManagerPopover();
    await buttonByLabel(tree, '리뷰 태그 위로').props.onClick?.();
    assert.deepEqual(tagManagerApiCalls.at(-2)?.args, [[
      { id: 'tag-review', name: '검수', color: '#00B894', sort_order: 0 },
      { id: 'tag-generated-1', name: '리뷰', color: '#6C5CE7', sort_order: 1 },
      { id: 'tag-meeting', name: '회의', color: '#FDCB6E', sort_order: 2 },
    ]], 'the next save reuses the authoritative UUID instead of resubmitting a fake new row');
  });

  await t.test('a lost save response settles as committed when fresh canonical rows exactly match the submitted rename', async () => {
    resetHarness();
    tagManagerApiFailures.add('calendarTagsSave');
    tagManagerCanonicalTagsAfterReload = [
      { id: 'tag-review', name: '검수', color: '#00B894', sortOrder: 0 },
      { id: 'tag-meeting', name: '회의 응답유실', color: '#FDCB6E', sortOrder: 1 },
    ];
    let tree = await renderTagManagerPopover();
    buttonByLabel(tree, '회의 태그 편집').props.onClick?.();
    tree = await renderTagManagerPopover();
    formElementByLabel(tree, '회의 태그 이름').props.onChange?.({
      target: { value: '회의 응답유실', checked: false },
    });
    tree = await renderTagManagerPopover();
    await buttonByLabel(tree, '회의 태그 저장').props.onClick?.();
    tree = await renderTagManagerPopover();

    assert.deepEqual(tagManagerApiCalls.map((call) => call.name), ['calendarTagsSave', 'loadAll']);
    assert.match(tagManagerToastErrors[0], /최신 목록에서 태그 변경을 확인했/);
    assert.ok(buttonByLabel(tree, '회의 응답유실 태그 편집'));
    assert.equal(
      findFormElements(tree).some((element) => element.props['aria-label'] === '회의 태그 이름'),
      false,
      'an exactly verified commit closes the editor and leaves no retry draft',
    );
    assert.equal(
      findButtons(tree).some((button) => button.props['aria-label'] === '최신 태그 목록 다시 불러오기'),
      false,
      'an exactly verified commit clears the reconciliation latch',
    );
  });

  await t.test('a lost save response keeps the inline draft retryable when fresh canonical rows exactly match the before snapshot', async () => {
    resetHarness();
    tagManagerApiFailures.add('calendarTagsSave');
    tagManagerCanonicalTagsAfterReload = [
      { id: 'tag-review', name: '검수', color: '#00B894', sortOrder: 0 },
      { id: 'tag-meeting', name: '회의', color: '#FDCB6E', sortOrder: 1 },
    ];
    let tree = await renderTagManagerPopover();
    buttonByLabel(tree, '회의 태그 편집').props.onClick?.();
    tree = await renderTagManagerPopover();
    formElementByLabel(tree, '회의 태그 이름').props.onChange?.({
      target: { value: '회의 재시도', checked: false },
    });
    tree = await renderTagManagerPopover();
    await buttonByLabel(tree, '회의 태그 저장').props.onClick?.();
    tree = await renderTagManagerPopover();

    assert.deepEqual(tagManagerApiCalls.map((call) => call.name), ['calendarTagsSave', 'loadAll']);
    assert.match(tagManagerToastErrors[0], /저장되지 않은 것을 확인했/);
    assert.deepEqual(calendarState.tags, tagManagerCanonicalTagsAfterReload);
    assert.equal(
      formElementByLabel(tree, '회의 태그 이름').props.value,
      '회의 재시도',
      'the attempted value stays in the editor for an intentional retry',
    );
    assert.equal(buttonByLabel(tree, '회의 태그 저장').props.disabled, false);
    assert.equal(
      findButtons(tree).some((button) => button.props['aria-label'] === '최신 태그 목록 다시 불러오기'),
      false,
      'an exact before-state proves no commit and does not leave a global write lock',
    );
    buttonByLabel(tree, '회의 태그 편집 취소').props.onClick?.();
  });

  await t.test('a lost save response keeps an intent overlay locked when fresh canonical rows are unrelated', async () => {
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
    assert.match(tagManagerToastErrors[0], /확정하지 못했/);
    assert.ok(buttonByLabel(tree, '응답 유실 태그 편집'), 'an unrelated canonical list cannot erase the submitted intent');
    assert.equal(buttonByLabel(tree, '응답 유실 태그 편집').props.disabled, true);
    assert.ok(buttonByLabel(tree, '최신 태그 목록 다시 불러오기'));
    assert.equal(
      findFormElements(tree).some((element) => element.props['aria-label'] === '새 태그 이름'),
      false,
      'the ambiguous full-list intent is retained as a locked projection instead of an active editor',
    );

    tagManagerCanonicalTagsAfterReload = [
      { id: 'tag-review', name: '검수', color: '#00B894', sortOrder: 0 },
      { id: 'tag-meeting', name: '회의', color: '#FDCB6E', sortOrder: 1 },
      { id: 'tag-server-new', name: '응답 유실', color: '#6C5CE7', sortOrder: 2 },
    ];
    await buttonByLabel(tree, '최신 태그 목록 다시 불러오기').props.onClick?.();
    tree = await renderTagManagerPopover();
    tagManagerApiFailures.delete('calendarTagsSave');
    await buttonByLabel(tree, '응답 유실 태그 위로').props.onClick?.();
    assert.deepEqual(tagManagerApiCalls.at(-2)?.args, [[
      { id: 'tag-review', name: '검수', color: '#00B894', sort_order: 0 },
      { id: 'tag-server-new', name: '응답 유실', color: '#6C5CE7', sort_order: 1 },
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

test('TagManagerPopover publishes tag mutations to the shared store across persistence outcomes', async (t) => {
  const clearTagReconciliation = async (
    canonicalTags: Array<{ id: string; name: string; color: string; sortOrder: number }>,
  ) => {
    tagManagerSaveGate = null;
    tagManagerRefreshGate = null;
    tagManagerMetadataFreshness = { calendarsFresh: true, tagsFresh: true };
    tagManagerCanonicalTagsAfterReload = canonicalTags;
    stateSlots = [];
    tagManagerRefSlots = [];
    const retryTree = await renderTagManagerPopover();
    const retryButton = findButtons(retryTree).find((button) => (
      button.props['aria-label'] === '최신 태그 목록 다시 불러오기'
    ));
    await retryButton?.props.onClick?.();
    tagManagerCanonicalTagsAfterReload = null;
  };

  await t.test('rename and recolor stay shared during slow persistence and after a committed refresh failure', async () => {
    resetHarness();
    tagManagerMetadataFreshness = { calendarsFresh: true, tagsFresh: false };
    tagManagerSaveGate = new Promise<void>((resolve) => {
      resolveTagManagerSaveGate = resolve;
    });
    tagManagerRefreshGate = new Promise<void>((resolve) => {
      resolveTagManagerRefreshGate = resolve;
    });
    let tree = await renderTagManagerPopover();
    buttonByLabel(tree, '회의 태그 편집').props.onClick?.();
    tree = await renderTagManagerPopover();
    formElementByLabel(tree, '회의 태그 이름').props.onChange?.({ target: { value: '회의록', checked: false } });
    tree = await renderTagManagerPopover();
    buttonByLabel(tree, '#74B9FF 태그 색상').props.onClick?.();
    tree = await renderTagManagerPopover();
    const pendingSave = buttonByLabel(tree, '회의 태그 저장').props.onClick?.();
    const committed = [
      { id: 'tag-review', name: '검수', color: '#00B894', sortOrder: 0 },
      { id: 'tag-meeting', name: '회의록', color: '#74B9FF', sortOrder: 1 },
    ];
    try {
      assert.deepEqual(calendarState.tags, committed, 'the shared store changes before the IPC promise settles');
      const tagBar = await renderTagBar(false, () => {});
      assert.match(textContent(tagBar), /회의록/, 'TagBar reads the optimistic shared tag name');

      resolveTagManagerSaveGate?.();
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.deepEqual(
        calendarState.tags,
        committed,
        'the authoritative save response replaces the optimistic draft before refresh settles',
      );

      resolveTagManagerRefreshGate?.();
      await pendingSave;
      assert.deepEqual(
        calendarState.tags,
        committed,
        'a refresh failure cannot roll back rows already confirmed by persistence',
      );
    } finally {
      resolveTagManagerSaveGate?.();
      resolveTagManagerRefreshGate?.();
      await pendingSave;
      await clearTagReconciliation(committed);
    }
  });

  await t.test('a failed save publishes the reorder immediately and fresh canonical metadata rolls it back', async () => {
    resetHarness();
    tagManagerApiFailures.add('calendarTagsSave');
    tagManagerCanonicalTagsAfterReload = [
      { id: 'tag-review', name: '검수', color: '#00B894', sortOrder: 0 },
      { id: 'tag-meeting', name: '회의', color: '#FDCB6E', sortOrder: 1 },
    ];
    tagManagerSaveGate = new Promise<void>((resolve) => {
      resolveTagManagerSaveGate = resolve;
    });
    const tree = await renderTagManagerPopover();
    const pendingSave = buttonByLabel(tree, '회의 태그 위로').props.onClick?.();
    try {
      assert.deepEqual(calendarState.tags.map(({ id, sortOrder }) => ({ id, sortOrder })), [
        { id: 'tag-meeting', sortOrder: 0 },
        { id: 'tag-review', sortOrder: 1 },
      ], 'reordering is shared while persistence is unresolved');

      resolveTagManagerSaveGate?.();
      await pendingSave;
      assert.deepEqual(calendarState.tags, [
        { id: 'tag-review', name: '검수', color: '#00B894', sortOrder: 0 },
        { id: 'tag-meeting', name: '회의', color: '#FDCB6E', sortOrder: 1 },
      ], 'fresh canonical metadata replaces an unconfirmed optimistic reorder');
    } finally {
      resolveTagManagerSaveGate?.();
      await pendingSave;
      tagManagerSaveGate = null;
    }
  });

  await t.test('an ambiguous delete remains shared when persistence and canonical refresh both fail', async () => {
    resetHarness();
    tagManagerApiFailures.add('calendarTagsSave');
    tagManagerMetadataFreshness = { calendarsFresh: true, tagsFresh: false };
    tagManagerConfirmResponses = [true];
    const tree = await renderTagManagerPopover();
    await buttonByLabel(tree, '회의 태그 삭제').props.onClick?.();
    const ambiguous = [
      { id: 'tag-review', name: '검수', color: '#00B894', sortOrder: 0 },
    ];
    try {
      assert.deepEqual(
        calendarState.tags,
        ambiguous,
        'the shared views keep the exact ambiguous delete intent until reconciliation',
      );
    } finally {
      await clearTagReconciliation(ambiguous);
    }
  });

  await t.test('a new tag uses a non-persistable shared temp id until save returns its server UUID', async () => {
    resetHarness();
    tagManagerMetadataFreshness = { calendarsFresh: true, tagsFresh: false };
    tagManagerSaveGate = new Promise<void>((resolve) => {
      resolveTagManagerSaveGate = resolve;
    });
    tagManagerRefreshGate = new Promise<void>((resolve) => {
      resolveTagManagerRefreshGate = resolve;
    });
    let tree = await renderTagManagerPopover();
    buttonByText(tree, '새 태그').props.onClick?.();
    tree = await renderTagManagerPopover();
    formElementByLabel(tree, '새 태그 이름').props.onChange?.({ target: { value: '신규 공유', checked: false } });
    tree = await renderTagManagerPopover();
    const pendingSave = buttonByLabel(tree, '새 태그 저장').props.onClick?.();

    const optimisticTag = calendarState.tags.find(({ name }) => name === '신규 공유');
    assert.match(optimisticTag?.id ?? '', /^optimistic-tag:/);
    const tagBar = await renderTagBar(false, () => {});
    buttonByLabel(tagBar, '신규 공유 태그').props.onClick?.();
    assert.equal(calendarState.enabledTagIds[optimisticTag!.id], undefined, 'temp ids never enter tag preferences');

    resolveTagManagerSaveGate?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(
      calendarState.tags.find(({ name }) => name === '신규 공유')?.id,
      'tag-generated-1',
      'the authoritative response replaces the temp id before refresh settles',
    );
    resolveTagManagerRefreshGate?.();
    await pendingSave;

    tagManagerMetadataFreshness = { calendarsFresh: true, tagsFresh: true };
    tagManagerCanonicalTagsAfterReload = tagManagerLastCommittedTags;
    stateSlots = [];
    tagManagerRefSlots = [];
    tree = await renderTagManagerPopover();
    await buttonByLabel(tree, '최신 태그 목록 다시 불러오기').props.onClick?.();
    tagManagerSaveGate = null;
    tagManagerRefreshGate = null;
  });
});

test('TagManagerPopover keeps module flights and confirmations inside the captured actor session', async (t) => {
  await t.test('an A save flight never renders A drafts in actor B', async () => {
    resetHarness();
    tagManagerSaveGate = new Promise<void>((resolve) => {
      resolveTagManagerSaveGate = resolve;
    });
    let tree = await renderTagManagerPopover();
    buttonByLabel(tree, '회의 태그 편집').props.onClick?.();
    tree = await renderTagManagerPopover();
    formElementByLabel(tree, '회의 태그 이름').props.onChange?.({ target: { value: 'A 비공개 초안', checked: false } });
    tree = await renderTagManagerPopover();
    const pendingSave = buttonByLabel(tree, '회의 태그 저장').props.onClick?.();
    try {
      settingsCurrentUser = { ...settingsCurrentUser, id: 'user-b', name: 'B 사용자' };
      calendarState.tags = [{ id: 'tag-b', name: 'B 정본', color: '#74B9FF', sortOrder: 0 }];
      stateSlots = [];
      tagManagerRefSlots = [];
      tree = await renderTagManagerPopover();
      assert.match(textContent(tree), /B 정본/);
      assert.doesNotMatch(textContent(tree), /A 비공개 초안/, 'actor B never renders actor A module drafts');
      assert.equal(buttonByText(tree, '새 태그').props.disabled, true, 'the global full-list write mutex still locks B');
    } finally {
      settingsCurrentUser = { ...settingsCurrentUser, id: myUserId, name: '배한솔' };
      resolveTagManagerSaveGate?.();
      await pendingSave;
      tagManagerSaveGate = null;
    }
  });

  await t.test('an auth change immediately cancels an actor-local inline editor', async () => {
    resetHarness();
    let tree = await renderTagManagerPopover();
    buttonByText(tree, '새 태그').props.onClick?.();
    tree = await renderTagManagerPopover();
    assert.ok(formElementByLabel(tree, '새 태그 이름'));

    settingsCurrentUser = { ...settingsCurrentUser, id: 'user-b', name: 'B 사용자', role: 'user' };
    tree = await renderTagManagerPopover();
    assert.equal(
      findFormElements(tree).some((element) => element.props['aria-label'] === '새 태그 이름'),
      false,
      'the previous actor cannot leave an editable draft mounted in the next session',
    );
  });

  await t.test('a save completion while B is active keeps the global full-list write lock without exposing A drafts', async () => {
    resetHarness();
    tagManagerMetadataFreshness = { calendarsFresh: true, tagsFresh: false };
    tagManagerSaveGate = new Promise<void>((resolve) => {
      resolveTagManagerSaveGate = resolve;
    });
    let tree = await renderTagManagerPopover();
    buttonByLabel(tree, '회의 태그 편집').props.onClick?.();
    tree = await renderTagManagerPopover();
    formElementByLabel(tree, '회의 태그 이름').props.onChange?.({ target: { value: 'A 커밋', checked: false } });
    tree = await renderTagManagerPopover();
    const pendingSave = buttonByLabel(tree, '회의 태그 저장').props.onClick?.();

    settingsCurrentUser = { ...settingsCurrentUser, id: 'user-b', name: 'B 사용자' };
    calendarState.tags = [{ id: 'tag-b', name: 'B 정본', color: '#74B9FF', sortOrder: 0 }];
    stateSlots = [];
    tagManagerRefSlots = [];
    await renderTagManagerPopover();
    resolveTagManagerSaveGate?.();
    await pendingSave;
    assert.deepEqual(
      tagManagerApiCalls.map(({ name }) => name),
      ['calendarTagsSave'],
      'the stale A continuation must not start a canonical load in actor B',
    );

    stateSlots = [];
    tagManagerRefSlots = [];
    tree = await renderTagManagerPopover();
    assert.match(textContent(tree), /B 정본/);
    assert.equal(
      buttonByText(tree, '새 태그').props.disabled,
      true,
      'an unresolved A full-list write keeps B from overwriting it with stale rows',
    );
    buttonByText(tree, '새 태그').props.onClick?.();
    tree = await renderTagManagerPopover();
    assert.equal(
      findFormElements(tree).some((element) => element.props['aria-label'] === '새 태그 이름'),
      false,
      'a direct handler invocation cannot bypass the cross-actor full-list lock',
    );
    assert.equal(
      tagManagerApiCalls.filter(({ name }) => name === 'calendarTagsSave').length,
      1,
      'B cannot start an additional full-list save while A remains unresolved',
    );

    settingsCurrentUser = { ...settingsCurrentUser, id: myUserId, name: '배한솔' };
    assert.equal(tagManagerStoreOverlay?.actorId, myUserId);
    calendarState.tags = tagManagerStoreOverlay?.tags.map((tag) => ({ ...tag })) ?? [];
    calendarState.optimisticDeletedTagIds = [...(tagManagerStoreOverlay?.deletedTagIds ?? [])];
    stateSlots = [];
    tagManagerRefSlots = [];
    tree = await renderTagManagerPopover();
    assert.match(textContent(tree), /A 커밋/);
    assert.ok(buttonByLabel(tree, '최신 태그 목록 다시 불러오기'));
    assert.equal(buttonByText(tree, '새 태그').props.disabled, true, 'A remains locked until its own fresh retry');

    tagManagerMetadataFreshness = { calendarsFresh: true, tagsFresh: true };
    tagManagerCanonicalTagsAfterReload = tagManagerStoreOverlay?.tags.map((tag) => ({ ...tag })) ?? [];
    await buttonByLabel(tree, '최신 태그 목록 다시 불러오기').props.onClick?.();

    settingsCurrentUser = { ...settingsCurrentUser, id: 'user-b', name: 'B 사용자' };
    calendarState.tags = [{ id: 'tag-b', name: 'B 정본', color: '#74B9FF', sortOrder: 0 }];
    stateSlots = [];
    tagManagerRefSlots = [];
    tree = await renderTagManagerPopover();
    assert.equal(buttonByText(tree, '새 태그').props.disabled, false, 'A fresh settlement releases the global mutex');
    tagManagerSaveGate = null;
  });

  await t.test('a delete confirmation captured by A becomes inert after switching to B', async () => {
    resetHarness();
    tagManagerConfirmResponses = [true];
    tagManagerConfirmGate = new Promise<void>((resolve) => {
      resolveTagManagerConfirmGate = resolve;
    });
    const tree = await renderTagManagerPopover();
    const pendingDelete = buttonByLabel(tree, '회의 태그 삭제').props.onClick?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    settingsCurrentUser = { ...settingsCurrentUser, id: 'user-b', name: 'B 사용자' };
    calendarState.tags = [{ id: 'tag-b', name: 'B 정본', color: '#74B9FF', sortOrder: 0 }];
    resolveTagManagerConfirmGate?.();
    await pendingDelete;

    assert.deepEqual(tagManagerApiCalls, [], 'the stale A confirmation cannot persist B-session data');
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
      true,
      'authoritative saved rows stay visible but full-list writes wait for a fresh rebase',
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
      'a fresh retry clears the committed-write reconciliation state',
    );
  });

  await t.test('a stronger event reconciliation cannot be bypassed by a later full-list metadata save', async () => {
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
    assert.equal(
      findFormElements(tree).some((element) => element.props['aria-label'] === '검수 태그 이름'),
      false,
      'a stale full-list editor cannot open before event reconciliation',
    );
    assert.deepEqual(
      tagManagerApiCalls.map((call) => call.name),
      ['calendarTagsSave', 'loadBflowEvents'],
      'no second full-list save can bypass the stronger event reconciliation',
    );
    assert.doesNotMatch(textContent(tree), /회의/);

    tagManagerCanonicalTagsAfterReload = [
      { id: 'tag-review', name: '검수', color: '#00B894', sortOrder: 0 },
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

  await t.test('a tag revision without fresh event rows keeps delete reconciliation and its tombstone locked', async () => {
    resetHarness();
    tagManagerConfirmResponses = [true];
    tagManagerBflowReloadResult = false;
    tagManagerCanonicalTagsAfterReload = [
      { id: 'tag-review', name: '검수', color: '#00B894', sortOrder: 0 },
    ];
    let tree = await renderTagManagerPopover();
    await buttonByLabel(tree, '회의 태그 삭제').props.onClick?.();
    tree = await renderTagManagerPopover();

    assert.deepEqual(tagManagerApiCalls.map((call) => call.name), ['calendarTagsSave', 'loadBflowEvents']);
    assert.ok(buttonByLabel(tree, '최신 태그 목록 다시 불러오기'));
    assert.equal(buttonByLabel(tree, '검수 태그 편집').props.disabled, true);
    assert.deepEqual(
      calendarState.optimisticDeletedTagIds,
      ['tag-meeting'],
      'stale event rows keep treating the deleted tag as tagless until event reconciliation succeeds',
    );

    tagManagerBflowReloadResult = true;
    await buttonByLabel(tree, '최신 태그 목록 다시 불러오기').props.onClick?.();
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

test('ScheduleView waits for its initial B flow and Google sync before treating changes as teammate updates', async () => {
  resetHarness();
  const bflow = calendarListEvent({
    id: 'initial-bflow-event',
    title: '초기 B flow 일정',
    source: 'bflow',
    sourceCalendarId: 'bflow:mine',
    calendarId: 'mine',
  });
  const google = calendarListEvent({
    id: 'initial-google-event',
    title: '초기 Google 일정',
    source: 'google',
    sourceCalendarId: 'primary',
    calendarId: undefined,
  });
  let finishInitialSync!: () => void;
  const initialSyncFinished = new Promise<void>((resolve) => { finishInitialSync = resolve; });
  scheduleLoadBflowEventsHandler = async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    scheduleCanonicalEvents = [bflow];
    await dispatchScheduleWindowEvent('bflow:calendar-changed');
    scheduleCanonicalEvents = [bflow, google];
    finishInitialSync();
  };

  await renderScheduleView();
  await flushScheduleMountEffects();
  await Promise.race([
    initialSyncFinished,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('initial calendar sync did not finish')), 500)),
  ]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await renderScheduleView();
  assert.deepEqual(
    [...(scheduleGridProps.at(-1)?.highlightedEventIdentities ?? [])],
    [],
    'cache preparation rows establish one baseline instead of looking like teammate edits',
  );

  scheduleCanonicalEvents = [{ ...bflow, title: '동료의 실제 수정' }, google];
  await dispatchScheduleWindowEvent('bflow:calendar-changed');
  await renderScheduleView();
  assert.deepEqual(
    [...(scheduleGridProps.at(-1)?.highlightedEventIdentities ?? [])],
    ['bflow\u0000initial-bflow-event'],
    'the first update after preparation still highlights the actual teammate change',
  );
});

test('ScheduleView calendar-changed listener replaces or closes long-lived event state from the canonical cache', async () => {
  resetHarness();
  const stale: ScheduleCalendarEvent = {
    id: 'revoked-event',
    title: '회수 전 기밀 일정',
    memo: '회수 전 기밀 메모',
    color: '#6C5CE7',
    type: 'custom',
    startDate: '2026-08-25',
    endDate: '2026-08-25',
    createdBy: 'owner',
    createdAt: '2026-08-24T00:00:00.000Z',
    source: 'bflow',
    sourceCalendarId: 'bflow:revoked-calendar',
    calendarId: 'revoked-calendar',
    canEdit: true,
    isReadOnly: false,
  };
  scheduleCanonicalEvents = [stale];

  await renderScheduleView();
  await flushScheduleMountEffects();
  await renderScheduleView();
  scheduleGridProps.at(-1)?.onEventClick(stale);
  scheduleGridProps.at(-1)?.onEventContextMenu(stale, {
    preventDefault() {},
    stopPropagation() {},
    clientX: 120,
    clientY: 180,
  });
  await renderScheduleView();
  assert.equal(schedulePanelProps.at(-1)?.event.memo, stale.memo);
  assert.equal(scheduleQuickEditProps.at(-1)?.event.memo, stale.memo);

  const replacement = { ...stale, title: '정본 교체 일정', memo: '정본 교체 메모', canEdit: false, isReadOnly: true };
  scheduleCanonicalEvents = [replacement];
  await dispatchScheduleWindowEvent('bflow:calendar-changed');
  schedulePanelProps = [];
  scheduleQuickEditProps = [];
  await renderScheduleView();

  assert.deepEqual(scheduleGridProps.at(-1)?.events, [replacement]);
  assert.deepEqual(schedulePanelProps.at(-1)?.event, replacement, 'the open panel follows title, memo and permission changes');
  assert.deepEqual(scheduleQuickEditProps.at(-1)?.event, replacement, 'the open quick edit follows the same canonical row');

  scheduleCanonicalEvents = [];
  await dispatchScheduleWindowEvent('bflow:calendar-changed');
  schedulePanelProps = [];
  scheduleQuickEditProps = [];
  await renderScheduleView();

  assert.deepEqual(scheduleGridProps.at(-1)?.events, [], 'the revoked row leaves the visible event list');
  assert.equal(schedulePanelProps.length, 0, 'the revoked row closes the detail panel');
  assert.equal(scheduleQuickEditProps.length, 0, 'the revoked row closes quick edit');
});

test('ScheduleView keeps the same event object when an unrelated refresh brings identical content', async () => {
  resetHarness();
  const original = calendarListEvent({
    id: 'editing-target',
    title: '내가 열어 둔 일정',
    memo: '메모',
    source: 'bflow',
    sourceCalendarId: 'bflow:mine',
    calendarId: 'mine',
    canEdit: true,
    isReadOnly: false,
  });
  scheduleCanonicalEvents = [original];

  await renderScheduleView();
  await flushScheduleMountEffects();
  await renderScheduleView();
  scheduleGridProps.at(-1)?.onEventClick(original);
  scheduleGridProps.at(-1)?.onEventContextMenu(original, {
    preventDefault() {}, stopPropagation() {}, clientX: 120, clientY: 180,
  });
  await renderScheduleView();
  const panelBefore = schedulePanelProps.at(-1)?.event;
  const quickEditBefore = scheduleQuickEditProps.at(-1)?.event;
  assert.ok(panelBefore && quickEditBefore);

  // 팀원이 '다른' 일정을 바꿔 재조회가 돌았다. 내 일정 내용은 그대로지만
  // getEvents()가 매번 새 객체를 만들어 준다.
  scheduleCanonicalEvents = [{ ...original }];
  await dispatchScheduleWindowEvent('bflow:calendar-changed');
  schedulePanelProps = [];
  scheduleQuickEditProps = [];
  await renderScheduleView();

  assert.equal(
    schedulePanelProps.at(-1)?.event,
    panelBefore,
    '내용이 같으면 패널에 같은 객체를 유지해 편집 초안이 풀리지 않는다',
  );
  assert.equal(
    scheduleQuickEditProps.at(-1)?.event,
    quickEditBefore,
    '퀵에디트도 같은 객체를 유지한다',
  );

  // 내용이 실제로 바뀌면 기존대로 정본을 따라간다.
  const changed = { ...original, title: '팀원이 바꾼 제목' };
  scheduleCanonicalEvents = [changed];
  await dispatchScheduleWindowEvent('bflow:calendar-changed');
  schedulePanelProps = [];
  scheduleQuickEditProps = [];
  await renderScheduleView();

  assert.deepEqual(schedulePanelProps.at(-1)?.event, changed, '실제 변경은 그대로 반영한다');
  assert.deepEqual(scheduleQuickEditProps.at(-1)?.event, changed);
});

test('ScheduleView highlights only later external additions and changes, then clears the newest pulse after two seconds', async () => {
  resetHarness();
  const baseline = calendarListEvent({
    id: 'external-change',
    title: '변경 전 회의',
    source: 'bflow',
    sourceCalendarId: 'bflow:mine',
    calendarId: 'mine',
  });
  scheduleCanonicalEvents = [baseline];
  await renderScheduleView();
  await flushScheduleMountEffects();
  await renderScheduleView();
  assert.deepEqual(
    [...(scheduleGridProps.at(-1)?.highlightedEventIdentities ?? [])],
    [],
    'the initial canonical load establishes a baseline without pulsing every event',
  );

  const clock = installScheduleFakeClock();
  try {
    scheduleCanonicalEvents = [{ ...baseline, title: '1차 외부 수정' }];
    await dispatchScheduleWindowEvent('bflow:calendar-changed');
    await renderScheduleView();
    assert.deepEqual(
      [...(scheduleGridProps.at(-1)?.highlightedEventIdentities ?? [])],
      ['bflow\u0000external-change'],
      'an external title change targets the exact B flow identity',
    );

    clock.advance(1_000);
    const added = calendarListEvent({
      id: 'external-added',
      title: '외부에서 추가',
      source: 'google',
      sourceCalendarId: 'primary',
      calendarId: undefined,
    });
    scheduleCanonicalEvents = [{ ...baseline, title: '1차 외부 수정' }, added];
    await dispatchScheduleWindowEvent('bflow:calendar-changed');
    await renderScheduleView();
    assert.deepEqual(
      [...(scheduleGridProps.at(-1)?.highlightedEventIdentities ?? [])].sort(),
      ['bflow\u0000external-change', 'google\u0000primary\u0000external-added'].sort(),
      'a later unrelated refresh keeps the earlier event highlighted for its own full duration',
    );

    clock.advance(1_000);
    await renderScheduleView();
    assert.deepEqual(
      [...(scheduleGridProps.at(-1)?.highlightedEventIdentities ?? [])],
      ['google\u0000primary\u0000external-added'],
      'the first event expires on its own schedule without clearing the later highlight',
    );
    clock.advance(1_001);
    await renderScheduleView();
    assert.equal(scheduleGridProps.at(-1)?.highlightedEventIdentities?.size, 0, 'the later event also clears after its own two seconds');
  } finally {
    clock.restore();
  }
});

test('ScheduleView treats its optimistic calendar metadata refresh as local before highlighting a later external change', async () => {
  resetHarness();
  const baseline = calendarListEvent({
    id: 'metadata-refresh',
    title: '색상 변경 전 일정',
    source: 'bflow',
    sourceCalendarId: 'bflow:mine',
    calendarId: 'mine',
    color: '#6C5CE7',
    canEdit: true,
  });
  scheduleCanonicalEvents = [baseline];
  await renderScheduleView();
  await flushScheduleMountEffects();

  const clock = installScheduleFakeClock();
  try {
    scheduleCanonicalEvents = [{ ...baseline, color: '#00B894', canEdit: false }];
    await dispatchScheduleWindowEvent('bflow:calendar-changed', { action: 'optimistic-metadata' });
    await renderScheduleView();
    assert.deepEqual(
      [...(scheduleGridProps.at(-1)?.highlightedEventIdentities ?? [])],
      [],
      'the current user\'s colour or membership presentation refresh does not impersonate an external edit',
    );

    scheduleCanonicalEvents = [{
      ...baseline,
      color: '#00B894',
      canEdit: false,
      title: '다른 사용자가 수정한 일정',
    }];
    await dispatchScheduleWindowEvent('bflow:calendar-changed', { action: 'update' });
    await renderScheduleView();
    assert.deepEqual(
      [...(scheduleGridProps.at(-1)?.highlightedEventIdentities ?? [])],
      ['bflow\u0000metadata-refresh'],
      'a later non-local calendar change still highlights the exact affected event',
    );
  } finally {
    clock.restore();
  }
});

test('ScheduleView does not flash a subscription refresh as a teammate change', async () => {
  resetHarness();
  const baseline = calendarListEvent({
    id: 'ics-baseline',
    title: '기존 일정',
    source: 'bflow',
    sourceCalendarId: 'bflow:mine',
    calendarId: 'mine',
    canEdit: true,
  });
  scheduleCanonicalEvents = [baseline];
  await renderScheduleView();
  await flushScheduleMountEffects();

  const clock = installScheduleFakeClock();
  try {
    scheduleCanonicalEvents = [baseline, calendarListEvent({
      id: 'ics:sub-1:ext-1:2026-08-27',
      title: '외부 세미나',
      source: 'ics',
      sourceCalendarId: 'ics:sub-1',
      calendarId: undefined,
      canEdit: false,
    })];
    await dispatchScheduleWindowEvent('bflow:calendar-changed', { action: 'ics' });
    await renderScheduleView();
    assert.deepEqual(
      [...(scheduleGridProps.at(-1)?.highlightedEventIdentities ?? [])],
      [],
      '외부 구독 갱신은 팀원 변경 안내가 아니다',
    );
  } finally {
    clock.restore();
  }
});

test('ScheduleView does not highlight deletions and passes an external add target to the weekly time grid', async () => {
  resetHarness();
  const removed = calendarListEvent({
    id: 'removed-external',
    source: 'google',
    sourceCalendarId: 'primary',
    calendarId: undefined,
  });
  scheduleCanonicalEvents = [removed];
  await renderScheduleView();
  await flushScheduleMountEffects();
  scheduleCanonicalEvents = [];
  await dispatchScheduleWindowEvent('bflow:calendar-changed');
  await renderScheduleView();
  assert.equal(scheduleGridProps.at(-1)?.highlightedEventIdentities?.size, 0, 'a deletion never creates a target');

  resetHarness();
  scheduleLocalStorage.set('bflow_calendar_view_v1', JSON.stringify({ viewMode: 'week', weekSubMode: 'timegrid' }));
  await renderScheduleView();
  await flushScheduleMountEffects();
  const timed = calendarListEvent({
    id: 'external-timed',
    title: '외부 시간 일정',
    source: 'google',
    sourceCalendarId: 'primary',
    calendarId: undefined,
    allDay: false,
    startTime: '10:00',
    endTime: '11:00',
  });
  scheduleCanonicalEvents = [timed];
  await dispatchScheduleWindowEvent('bflow:calendar-changed');
  await renderScheduleView();
  assert.deepEqual(
    [...(scheduleTimeGridProps.at(-1)?.highlightedEventIdentities ?? [])],
    ['google\u0000primary\u0000external-timed'],
    'the weekly time-grid receives the exact externally added identity',
  );
});

test('ScheduleView passes realtime targets to weekly card and today card views', async (t) => {
  const baseline = calendarListEvent({
    id: 'card-view-external',
    title: '변경 전 카드 일정',
    source: 'bflow',
    sourceCalendarId: 'bflow:mine',
    calendarId: 'mine',
  });
  const target = 'bflow\u0000card-view-external';

  await t.test('weekly card view', async () => {
    resetHarness();
    scheduleLocalStorage.set('bflow_calendar_view_v1', JSON.stringify({ viewMode: 'week', weekSubMode: 'card' }));
    scheduleCanonicalEvents = [baseline];
    await renderScheduleView();
    await flushScheduleMountEffects();
    scheduleCanonicalEvents = [{ ...baseline, title: '다른 팀원이 수정한 카드 일정' }];
    await dispatchScheduleWindowEvent('bflow:calendar-changed');
    await renderScheduleView();
    assert.deepEqual(
      [...(scheduleWeekScrollProps.at(-1)?.highlightedEventIdentities ?? [])],
      [target],
      'weekly card mode receives the same source-aware target as the grid',
    );
  });

  await t.test('today card view', async () => {
    resetHarness();
    scheduleLocalStorage.set('bflow_calendar_view_v1', JSON.stringify({ viewMode: 'today', weekSubMode: 'card' }));
    scheduleCanonicalEvents = [baseline];
    await renderScheduleView();
    await flushScheduleMountEffects();
    scheduleCanonicalEvents = [{ ...baseline, title: '다른 팀원이 수정한 오늘 일정' }];
    await dispatchScheduleWindowEvent('bflow:calendar-changed');
    await renderScheduleView();
    assert.deepEqual(
      [...(scheduleDayScrollProps.at(-1)?.highlightedEventIdentities ?? [])],
      [target],
      'today card mode receives the same source-aware target as the grid',
    );
  });
});

test('ScheduleView guards multiple exact local create identities without hiding a reversed identical external add', async () => {
  resetHarness();
  scheduleLocalStorage.set('bflow_calendar_view_v1', JSON.stringify({ viewMode: 'week', weekSubMode: 'timegrid' }));
  const existing = calendarListEvent({
    id: 'local-update',
    title: '로컬 수정 전',
    source: 'bflow',
    sourceCalendarId: 'bflow:mine',
    calendarId: 'mine',
    allDay: false,
    startTime: '09:00',
    endTime: '10:00',
  });
  scheduleCanonicalEvents = [existing];
  await renderScheduleView();
  await flushScheduleMountEffects();
  await renderScheduleView();

  const clock = installScheduleFakeClock();
  try {
    const moved = { ...existing, startTime: '10:00', endTime: '11:00' };
    scheduleCanonicalEvents = [moved];
    await scheduleTimeGridProps.at(-1)?.onTimeGridEventChange?.(
      existing.id,
      { id: existing.id, source: existing.source, sourceCalendarId: existing.sourceCalendarId },
      { startDate: moved.startDate, endDate: moved.endDate, startTime: '10:00', endTime: '11:00' },
    );
    await dispatchScheduleWindowEvent('bflow:calendar-changed');
    await renderScheduleView();
    assert.equal(scheduleTimeGridProps.at(-1)?.highlightedEventIdentities?.size, 0, 'a local time-grid update stays excluded');

    scheduleCreateUuidValues = ['local-preserved-id', 'local-replaced-id'];
    schedulePersistedAddIdentities = [
      { id: 'local-preserved-id', source: 'bflow', sourceCalendarId: 'bflow:mine' },
      { id: 'persisted-new-id', source: 'bflow', sourceCalendarId: 'bflow:mine' },
    ];
    scheduleTimeGridProps.at(-1)?.onTimeGridCreate?.('2026-08-27', '13:00', '14:00');
    await renderScheduleView();
    const createdPreserved = calendarListEvent({
      id: 'local-preserved-id',
      title: '로컬 추가',
      source: 'bflow',
      sourceCalendarId: 'bflow:mine',
      calendarId: 'mine',
      allDay: false,
      startDate: '2026-08-27',
      endDate: '2026-08-27',
      startTime: '13:00',
      endTime: '14:00',
    });
    const createdReplaced = calendarListEvent({
      id: 'persisted-new-id',
      title: '로컬 추가',
      source: 'bflow',
      sourceCalendarId: 'bflow:mine',
      calendarId: 'mine',
      allDay: false,
      startDate: '2026-08-27',
      endDate: '2026-08-27',
      startTime: '13:00',
      endTime: '14:00',
    });
    const createData = { ...createdPreserved, id: undefined, createdAt: undefined };
    await scheduleCreateModalProps.at(-1)?.onSave(createData);
    await scheduleCreateModalProps.at(-1)?.onSave(createData);
    assert.deepEqual(
      scheduleAddedEvents.map(({ id }) => id),
      ['local-preserved-id', 'local-replaced-id'],
      'two identical local creates retain separate optimistic identities',
    );
    const unrelatedExternalTwin = {
      ...createdReplaced,
      id: 'unrelated-external-twin',
      createdAt: '2026-08-27T01:00:00.000Z',
    };
    scheduleCanonicalEvents = [moved, unrelatedExternalTwin, createdReplaced, createdPreserved];
    await dispatchScheduleWindowEvent('bflow:calendar-changed');
    await renderScheduleView();
    assert.deepEqual(
      [...(scheduleTimeGridProps.at(-1)?.highlightedEventIdentities ?? [])],
      ['bflow\u0000unrelated-external-twin'],
      'exact local guards ignore canonical ordering and leave the unrelated external twin highlighted',
    );

    clock.advance(3_001);
    scheduleCanonicalEvents = [
      moved,
      unrelatedExternalTwin,
      { ...createdReplaced, title: '다른 창에서 수정됨' },
      createdPreserved,
    ];
    await dispatchScheduleWindowEvent('bflow:calendar-changed');
    await renderScheduleView();
    assert.deepEqual(
      [...(scheduleTimeGridProps.at(-1)?.highlightedEventIdentities ?? [])],
      ['bflow\u0000persisted-new-id'],
      'after the guard expires, a later canonical change is treated as external',
    );
  } finally {
    clock.restore();
  }
});

test('ScheduleView consumes a matched local update guard before a collaborator changes the same identity', async () => {
  resetHarness();
  scheduleLocalStorage.set('bflow_calendar_view_v1', JSON.stringify({ viewMode: 'week', weekSubMode: 'timegrid' }));
  const before = calendarListEvent({
    id: 'same-event-fast-follow',
    title: '내 수정 전 회의',
    source: 'bflow',
    sourceCalendarId: 'bflow:mine',
    calendarId: 'mine',
    allDay: false,
    startTime: '09:00',
    endTime: '10:00',
  });
  scheduleCanonicalEvents = [before];
  await renderScheduleView();
  await flushScheduleMountEffects();
  await renderScheduleView();

  const clock = installScheduleFakeClock();
  try {
    const localEcho = { ...before, startTime: '10:00', endTime: '11:00' };
    scheduleCanonicalEvents = [localEcho];
    await scheduleTimeGridProps.at(-1)?.onTimeGridEventChange?.(
      before.id,
      { id: before.id, source: before.source, sourceCalendarId: before.sourceCalendarId },
      { startDate: localEcho.startDate, endDate: localEcho.endDate, startTime: '10:00', endTime: '11:00' },
    );
    await renderScheduleView();
    assert.equal(
      scheduleTimeGridProps.at(-1)?.highlightedEventIdentities?.size,
      0,
      'the matching canonical echo of this window\'s save stays quiet',
    );

    scheduleCanonicalEvents = [{ ...localEcho, title: '동료가 바로 이어서 수정한 회의' }];
    await dispatchScheduleWindowEvent('bflow:calendar-changed');
    await renderScheduleView();
    assert.deepEqual(
      [...(scheduleTimeGridProps.at(-1)?.highlightedEventIdentities ?? [])],
      ['bflow\u0000same-event-fast-follow'],
      'a collaborator update within the former three-second guard window is still announced',
    );
  } finally {
    clock.restore();
  }
});

test('ScheduleView does not use a local guard to hide a nonmatching collaborator refresh', async () => {
  resetHarness();
  scheduleLocalStorage.set('bflow_calendar_view_v1', JSON.stringify({ viewMode: 'week', weekSubMode: 'timegrid' }));
  const before = calendarListEvent({
    id: 'same-event-conflict',
    title: '내 수정 전 회의',
    source: 'bflow',
    sourceCalendarId: 'bflow:mine',
    calendarId: 'mine',
    allDay: false,
    startTime: '09:00',
    endTime: '10:00',
  });
  scheduleCanonicalEvents = [before];
  await renderScheduleView();
  await flushScheduleMountEffects();
  await renderScheduleView();

  const clock = installScheduleFakeClock();
  try {
    scheduleCanonicalEvents = [{
      ...before,
      title: '동료의 최신 수정',
      startTime: '10:00',
      endTime: '11:00',
    }];
    await scheduleTimeGridProps.at(-1)?.onTimeGridEventChange?.(
      before.id,
      { id: before.id, source: before.source, sourceCalendarId: before.sourceCalendarId },
      { startDate: before.startDate, endDate: before.endDate, startTime: '10:00', endTime: '11:00' },
    );
    await renderScheduleView();
    assert.deepEqual(
      [...(scheduleTimeGridProps.at(-1)?.highlightedEventIdentities ?? [])],
      ['bflow\u0000same-event-conflict'],
      'the local save guard is only valid for its own expected canonical version, not a collaborator version',
    );
  } finally {
    clock.restore();
  }
});

test('ScheduleView keeps a local update guard through its failed-save rollback', async () => {
  resetHarness();
  scheduleLocalStorage.set('bflow_calendar_view_v1', JSON.stringify({ viewMode: 'week', weekSubMode: 'timegrid' }));
  const before = calendarListEvent({
    id: 'failed-local-rollback',
    title: '되돌릴 회의',
    source: 'bflow',
    sourceCalendarId: 'bflow:mine',
    calendarId: 'mine',
    allDay: false,
    startTime: '09:00',
    endTime: '10:00',
  });
  const optimistic = { ...before, startTime: '10:00', endTime: '11:00' };
  const persistenceError = new Error('저장 실패');
  scheduleCanonicalEvents = [before];
  await renderScheduleView();
  await flushScheduleMountEffects();
  await renderScheduleView();

  const clock = installScheduleFakeClock();
  try {
    scheduleUpdateHandler = async () => {
      scheduleCanonicalEvents = [optimistic];
      await dispatchScheduleWindowEvent('bflow:calendar-changed');
      scheduleCanonicalEvents = [before];
      await dispatchScheduleWindowEvent('bflow:calendar-changed');
      throw persistenceError;
    };
    const result = scheduleTimeGridProps.at(-1)?.onTimeGridEventChange?.(
      before.id,
      { id: before.id, source: before.source, sourceCalendarId: before.sourceCalendarId },
      { startDate: optimistic.startDate, endDate: optimistic.endDate, startTime: '10:00', endTime: '11:00' },
    );
    await assert.rejects(result, (error) => error === persistenceError);
    await renderScheduleView();
    assert.deepEqual(
      [...(scheduleTimeGridProps.at(-1)?.highlightedEventIdentities ?? [])],
      [],
      'the local rollback is not presented as a teammate change after the optimistic echo',
    );
  } finally {
    clock.restore();
  }
});

test('ScheduleView keeps a pending local update guard through a delayed failed-save rollback', async () => {
  resetHarness();
  scheduleLocalStorage.set('bflow_calendar_view_v1', JSON.stringify({ viewMode: 'week', weekSubMode: 'timegrid' }));
  const before = calendarListEvent({
    id: 'delayed-failed-local-rollback',
    title: '늦게 되돌릴 회의',
    source: 'bflow',
    sourceCalendarId: 'bflow:mine',
    calendarId: 'mine',
    allDay: false,
    startTime: '09:00',
    endTime: '10:00',
  });
  const optimistic = { ...before, startTime: '10:00', endTime: '11:00' };
  const persistenceError = new Error('늦은 저장 실패');
  scheduleCanonicalEvents = [before];
  await renderScheduleView();
  await flushScheduleMountEffects();
  await renderScheduleView();

  const clock = installScheduleFakeClock();
  try {
    scheduleUpdateHandler = async () => {
      scheduleCanonicalEvents = [optimistic];
      await dispatchScheduleWindowEvent('bflow:calendar-changed');
      clock.advance(3_001);
      scheduleCanonicalEvents = [before];
      await dispatchScheduleWindowEvent('bflow:calendar-changed');
      throw persistenceError;
    };
    const result = scheduleTimeGridProps.at(-1)?.onTimeGridEventChange?.(
      before.id,
      { id: before.id, source: before.source, sourceCalendarId: before.sourceCalendarId },
      { startDate: optimistic.startDate, endDate: optimistic.endDate, startTime: '10:00', endTime: '11:00' },
    );
    await assert.rejects(result, (error) => error === persistenceError);
    await renderScheduleView();
    assert.deepEqual(
      [...(scheduleTimeGridProps.at(-1)?.highlightedEventIdentities ?? [])],
      [],
      'a still-pending local mutation keeps its rollback out of teammate highlights even after the normal TTL',
    );
  } finally {
    clock.restore();
  }
});

test('ScheduleView keeps a local delete rollback from pulsing as a teammate add', async () => {
  resetHarness();
  const before = calendarListEvent({
    id: 'failed-local-delete',
    title: '되돌릴 삭제 일정',
    source: 'bflow',
    sourceCalendarId: 'bflow:mine',
    calendarId: 'mine',
  });
  const persistenceError = new Error('삭제 저장 실패');
  scheduleCanonicalEvents = [before];
  await renderScheduleView();
  await flushScheduleMountEffects();
  await renderScheduleView();
  scheduleGridProps.at(-1)?.onEventClick(before);
  await renderScheduleView();

  const clock = installScheduleFakeClock();
  try {
    scheduleDeleteHandler = async () => {
      scheduleCanonicalEvents = [];
      await dispatchScheduleWindowEvent('bflow:calendar-changed');
      scheduleCanonicalEvents = [before];
      await dispatchScheduleWindowEvent('bflow:calendar-changed');
      throw persistenceError;
    };
    const panel = schedulePanelProps.at(-1);
    assert.ok(panel, 'the selected local event exposes the detail delete callback');
    await assert.rejects(panel.onDelete(before.id), (error) => error === persistenceError);
    await renderScheduleView();
    assert.deepEqual(
      [...(scheduleGridProps.at(-1)?.highlightedEventIdentities ?? [])],
      [],
      'the local failed-delete restoration is not presented as a teammate add',
    );
  } finally {
    clock.restore();
  }
});

test('ScheduleView keeps an open delete editor mounted until a failed optimistic delete rolls back', async () => {
  resetHarness();
  const before = calendarListEvent({
    id: 'failed-delete-editor-stays-open',
    title: '삭제 실패 안내를 보여줄 일정',
    source: 'bflow',
    sourceCalendarId: 'bflow:mine',
    calendarId: 'mine',
  });
  const persistenceError = new Error('삭제 저장 실패');
  let signalOptimisticRemoval!: () => void;
  const optimisticRemoval = new Promise<void>((resolve) => { signalOptimisticRemoval = resolve; });
  let releaseRollback!: () => void;
  const rollbackRelease = new Promise<void>((resolve) => { releaseRollback = resolve; });
  scheduleCanonicalEvents = [before];
  await renderScheduleView();
  await flushScheduleMountEffects();
  await renderScheduleView();
  scheduleGridProps.at(-1)?.onEventClick(before);
  await renderScheduleView();

  scheduleDeleteHandler = async () => {
    scheduleCanonicalEvents = [];
    await dispatchScheduleWindowEvent('bflow:calendar-changed');
    signalOptimisticRemoval();
    await rollbackRelease;
    scheduleCanonicalEvents = [before];
    await dispatchScheduleWindowEvent('bflow:calendar-changed');
    throw persistenceError;
  };
  const panel = schedulePanelProps.at(-1);
  assert.ok(panel, 'the selected row exposes the detail delete callback');
  const deletion = panel.onDelete(before.id);
  await optimisticRemoval;
  schedulePanelProps = [];
  await renderScheduleView();
  assert.deepEqual(
    schedulePanelProps.at(-1)?.event,
    before,
    'the side panel stays mounted while the optimistic deletion is pending',
  );

  releaseRollback();
  await assert.rejects(deletion, (error) => error === persistenceError);
  schedulePanelProps = [];
  await renderScheduleView();
  assert.deepEqual(
    schedulePanelProps.at(-1)?.event,
    before,
    'the restored row remains in the editor so its rejection handler can show the error',
  );
});

test('ScheduleView keeps overlapping local update and failed-delete guards separate for one event', async () => {
  resetHarness();
  scheduleLocalStorage.set('bflow_calendar_view_v1', JSON.stringify({ viewMode: 'week', weekSubMode: 'timegrid' }));
  const before = calendarListEvent({
    id: 'overlapping-local-guards',
    title: '같은 일정의 겹친 저장',
    source: 'bflow',
    sourceCalendarId: 'bflow:mine',
    calendarId: 'mine',
    allDay: false,
    startTime: '09:00',
    endTime: '10:00',
  });
  const moved = { ...before, startTime: '10:00', endTime: '11:00' };
  const deleteError = new Error('겹친 삭제 저장 실패');
  let releaseUpdate!: () => void;
  const updateFinished = new Promise<void>((resolve) => { releaseUpdate = resolve; });
  let signalDeleteStarted!: () => void;
  const deleteStarted = new Promise<void>((resolve) => { signalDeleteStarted = resolve; });
  let releaseDeleteRollback!: () => void;
  const deleteRollback = new Promise<void>((resolve) => { releaseDeleteRollback = resolve; });
  scheduleCanonicalEvents = [before];
  await renderScheduleView();
  await flushScheduleMountEffects();
  await renderScheduleView();
  scheduleTimeGridProps.at(-1)?.onEventClick(before);
  await renderScheduleView();

  scheduleUpdateHandler = async () => updateFinished;
  scheduleDeleteHandler = async () => {
    signalDeleteStarted();
    await deleteRollback;
    scheduleCanonicalEvents = [];
    await dispatchScheduleWindowEvent('bflow:calendar-changed');
    scheduleCanonicalEvents = [before];
    await dispatchScheduleWindowEvent('bflow:calendar-changed');
    throw deleteError;
  };
  const updateResult = scheduleTimeGridProps.at(-1)?.onTimeGridEventChange?.(
    before.id,
    { id: before.id, source: before.source, sourceCalendarId: before.sourceCalendarId },
    { startDate: moved.startDate, endDate: moved.endDate, startTime: '10:00', endTime: '11:00' },
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  const panel = schedulePanelProps.at(-1);
  assert.ok(panel, 'the initial panel keeps its delete action while the update is pending');
  const deleteResult = panel.onDelete(before.id);
  await deleteStarted;

  releaseUpdate();
  await updateResult;
  releaseDeleteRollback();
  await assert.rejects(deleteResult, (error) => error === deleteError);
  await renderScheduleView();
  assert.deepEqual(
    [...(scheduleTimeGridProps.at(-1)?.highlightedEventIdentities ?? [])],
    [],
    'one operation settling cannot remove the other operation\'s rollback guard',
  );
});

test('ScheduleView does not present its own B flow calendar move as a teammate update', async () => {
  resetHarness();
  const before = calendarListEvent({
    id: 'local-calendar-move',
    title: '내가 옮긴 일정',
    source: 'bflow',
    sourceCalendarId: 'bflow:mine',
    calendarId: 'mine',
    color: '#6C5CE7',
    canEdit: true,
    isReadOnly: false,
    isPrivate: true,
  });
  const moved = {
    ...before,
    source: 'bflow' as const,
    sourceCalendarId: 'bflow:editable-share',
    calendarId: 'editable-share',
    color: '#6C5CE7',
    canEdit: true,
    isReadOnly: false,
    isPrivate: false,
  };
  scheduleCanonicalEvents = [before];
  await renderScheduleView();
  await flushScheduleMountEffects();
  await renderScheduleView();
  scheduleGridProps.at(-1)?.onEventClick(before);
  await renderScheduleView();
  scheduleUpdateHandler = async () => {
    scheduleCanonicalEvents = [moved];
    await dispatchScheduleWindowEvent('bflow:calendar-changed');
  };

  const panel = schedulePanelProps.at(-1);
  assert.ok(panel, 'the editable B flow row exposes its direct update callback');
  await panel.onUpdate(before.id, { calendarId: moved.calendarId });
  await renderScheduleView();
  assert.deepEqual(
    [...(scheduleGridProps.at(-1)?.highlightedEventIdentities ?? [])],
    [],
    'the local destination presentation is consumed as this window\'s own echo',
  );
});

test('ScheduleView only preserves external vacation selections outside the canonical event cache', async (t) => {
  const vacation = calendarListEvent({
    id: 'vacation-selection',
    title: '정본 휴가 일정',
    type: 'vacation',
    source: 'google',
    sourceCalendarId: 'primary',
    calendarId: undefined,
    isReadOnly: true,
  });

  await t.test('revoked Google vacation closes panel and quick edit', async () => {
    resetHarness();
    scheduleCanonicalEvents = [vacation];
    await renderScheduleView();
    await flushScheduleMountEffects();
    await renderScheduleView();
    scheduleGridProps.at(-1)?.onEventClick(vacation);
    scheduleGridProps.at(-1)?.onEventContextMenu(vacation, {
      preventDefault() {},
      stopPropagation() {},
      clientX: 80,
      clientY: 120,
    });
    await renderScheduleView();
    assert.equal(schedulePanelProps.at(-1)?.event, vacation);
    assert.equal(scheduleQuickEditProps.at(-1)?.event, vacation);

    scheduleCanonicalEvents = [];
    await dispatchScheduleWindowEvent('bflow:calendar-changed');
    schedulePanelProps = [];
    scheduleQuickEditProps = [];
    await renderScheduleView();
    assert.equal(schedulePanelProps.length, 0, 'canonical vacation revocation closes the panel');
    assert.equal(scheduleQuickEditProps.length, 0, 'canonical vacation revocation closes quick edit');
  });

  await t.test('external vacation selection survives a canonical calendar refresh', async () => {
    resetHarness();
    const externalVacation = {
      ...vacation,
      id: 'vac-external-selection',
      title: '외부 휴가 일정',
      source: 'vacation' as const,
      sourceCalendarId: undefined,
    };
    await renderScheduleView();
    stateSlots[0] = [externalVacation];
    await renderScheduleView();
    scheduleGridProps.at(-1)?.onEventClick(externalVacation);
    scheduleGridProps.at(-1)?.onEventContextMenu(externalVacation, {
      preventDefault() {},
      stopPropagation() {},
      clientX: 80,
      clientY: 120,
    });
    await renderScheduleView();

    scheduleCanonicalEvents = [];
    await dispatchScheduleWindowEvent('bflow:calendar-changed');
    schedulePanelProps = [];
    scheduleQuickEditProps = [];
    await renderScheduleView();
    assert.equal(schedulePanelProps.at(-1)?.event, externalVacation);
    assert.equal(scheduleQuickEditProps.at(-1)?.event, externalVacation);
  });
});

test('ScheduleView follows canonical B flow moves but rejects same-id rows from another storage source', async () => {
  resetHarness();
  const selected: ScheduleCalendarEvent = {
    id: 'shared-id',
    title: '회수 대상 일정',
    memo: '회수 대상 메모',
    color: '#6C5CE7',
    type: 'custom',
    startDate: '2026-08-25',
    endDate: '2026-08-25',
    createdBy: 'owner',
    createdAt: '2026-08-24T00:00:00.000Z',
    source: 'bflow',
    sourceCalendarId: 'bflow:revoked-calendar',
    calendarId: 'revoked-calendar',
    canEdit: true,
    isReadOnly: false,
  };
  scheduleCanonicalEvents = [selected];
  await renderScheduleView();
  await flushScheduleMountEffects();
  await renderScheduleView();
  scheduleGridProps.at(-1)?.onEventClick(selected);
  scheduleGridProps.at(-1)?.onEventContextMenu(selected, {
    preventDefault() {},
    stopPropagation() {},
    clientX: 100,
    clientY: 140,
  });
  await renderScheduleView();

  const moved = {
    ...selected,
    title: '다른 캘린더로 이동한 일정',
    memo: '이동 뒤에도 열린 상태가 따라가야 하는 메모',
    sourceCalendarId: 'bflow:other-calendar',
    calendarId: 'other-calendar',
  };
  scheduleCanonicalEvents = [moved];
  await dispatchScheduleWindowEvent('bflow:calendar-changed');
  schedulePanelProps = [];
  scheduleQuickEditProps = [];
  await renderScheduleView();

  assert.deepEqual(scheduleGridProps.at(-1)?.events, [moved], 'the moved row remains visible in its new calendar');
  assert.deepEqual(schedulePanelProps.at(-1)?.event, moved, 'the open panel follows the globally unique B flow row');
  assert.deepEqual(scheduleQuickEditProps.at(-1)?.event, moved, 'quick edit follows the same moved B flow row');

  const crossStorage: ScheduleCalendarEvent = {
    ...moved,
    title: '구글 저장소의 동일 ID 일정',
    memo: '노출되면 안 되는 다른 저장소 메모',
    source: 'google',
    sourceCalendarId: 'primary',
    calendarId: undefined,
  };
  scheduleCanonicalEvents = [crossStorage];
  await dispatchScheduleWindowEvent('bflow:calendar-changed');
  schedulePanelProps = [];
  scheduleQuickEditProps = [];
  await renderScheduleView();

  assert.deepEqual(scheduleGridProps.at(-1)?.events, [crossStorage], 'the other storage row remains independently visible');
  assert.equal(schedulePanelProps.length, 0, 'same id from Google cannot replace the old B flow panel');
  assert.equal(scheduleQuickEditProps.length, 0, 'same id from Google cannot replace B flow quick edit');
});

test('ScheduleView consumes a stored date request after it mounts exactly once', async () => {
  resetHarness();
  // 알림/위젯이 먼저 store에 남긴 요청: ScheduleView 리스너가 아직 없는 콜드 마운트다.
  schedulePendingDateNavigation = {
    id: 47,
    date: '2026-09-17',
    todoId: 'todo-cold-mount',
  };
  schedulePendingTodoPanelNavigation = schedulePendingDateNavigation;

  await renderScheduleView();
  await flushScheduleMountEffects();
  assert.deepEqual(scheduleDateNavigationConsumeIds, [47]);
  assert.equal(schedulePendingDateNavigation, null);

  scheduleGridProps = [];
  await renderScheduleView();
  const grid = scheduleGridProps.at(-1);
  assert.equal(grid?.currentMonth, 8, 'the mounted view moves to the requested September month');
  assert.equal(grid?.pulseDate, '2026-09-17', 'the requested date receives the existing visual pulse');

  await flushScheduleMountEffects();
  await renderScheduleView();
  assert.deepEqual(
    scheduleDateNavigationConsumeIds,
    [47],
    'StrictMode-like repeat effects cannot consume and pulse the same request twice',
  );
  resetHarness();
});

async function assertSpringDstDateNavigation(): Promise<void> {
  resetHarness();
  scheduleLocalStorage.set('bflow_calendar_view_v1', JSON.stringify({
    viewMode: 'today',
    weekSubMode: 'card',
  }));
  schedulePendingDateNavigation = {
    id: 54,
    date: '2026-03-08',
  };

  await renderScheduleView();
  await flushScheduleMountEffects();
  await renderScheduleView();

  const day = scheduleDayScrollProps.at(-1);
  assert.ok(day);
  assert.equal(day.year, 2026);
  assert.equal(
    day.activeDayIndex,
    66,
    'March 8 is the zero-based 66th day of 2026 even where the DST jump removes one elapsed hour',
  );
  resetHarness();
}

test('ScheduleView keeps the March 8 day index when spring DST shortens the elapsed day', async () => {
  if (process.env.BFLOW_CALENDAR_DST_CHILD === '1') {
    await assertSpringDstDateNavigation();
    return;
  }

  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  const child = spawnSync(process.execPath, [
    '--test',
    '--test-name-pattern',
    '^ScheduleView keeps the March 8 day index when spring DST shortens the elapsed day$',
    fileURLToPath(import.meta.url),
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...childEnv,
      TZ: 'America/New_York',
      BFLOW_CALENDAR_DST_CHILD: '1',
    },
  });
  const childOutput = `${child.stdout ?? ''}\n${child.stderr ?? ''}`;
  assert.equal(child.error, undefined, childOutput);
  assert.equal(child.status, 0, childOutput);
});

test('ScheduleView resolves a stored todo panel after canonical events finish loading', async () => {
  resetHarness();
  const linkedEvent: ScheduleCalendarEvent = {
    id: 'delayed-todo-event',
    title: '늦게 도착한 연결 일정',
    memo: '목록 로드가 끝난 뒤 패널에 열려야 한다',
    color: '#74B9FF',
    type: 'custom',
    startDate: '2026-09-17',
    endDate: '2026-09-17',
    createdBy: 'owner',
    createdAt: '2026-08-24T00:00:00.000Z',
    source: 'bflow',
    sourceCalendarId: 'bflow:mine',
    calendarId: 'mine',
    linkedTodoId: 'todo-delayed-load',
    canEdit: true,
    isReadOnly: false,
  };
  scheduleCanonicalEvents = [linkedEvent];
  scheduleGetEventsGate = new Promise<void>((resolve) => {
    resolveScheduleGetEventsGate = resolve;
  });
  schedulePendingDateNavigation = {
    id: 48,
    date: '2026-09-17',
    todoId: 'todo-delayed-load',
  };
  schedulePendingTodoPanelNavigation = schedulePendingDateNavigation;

  await renderScheduleView();
  await flushScheduleMountEffects();
  await new Promise<void>((resolve) => setTimeout(resolve, 120));
  assert.equal(schedulePanelProps.length, 0, 'the historical 100ms lookup has no events before the delayed canonical load');

  resolveScheduleGetEventsGate?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  schedulePanelProps = [];
  await renderScheduleView();
  await flushScheduleMountEffects();
  await renderScheduleView();

  assert.deepEqual(
    schedulePanelProps.at(-1)?.event,
    linkedEvent,
    'the request must still open its linked event after the canonical list arrives',
  );
  assert.deepEqual(scheduleTodoPanelNavigationConsumeIds, [48]);
  await flushScheduleMountEffects();
  await renderScheduleView();
  assert.deepEqual(
    scheduleTodoPanelNavigationConsumeIds,
    [48],
    'repeat effects cannot open the same delayed todo panel twice',
  );
  resetHarness();
});

test('ScheduleView resolves only the latest stored todo panel when delayed events arrive', async () => {
  resetHarness();
  const oldLinkedEvent: ScheduleCalendarEvent = {
    id: 'old-delayed-todo-event',
    title: '이전 할일 일정',
    memo: '',
    color: '#74B9FF',
    type: 'custom',
    startDate: '2026-09-17',
    endDate: '2026-09-17',
    createdBy: 'owner',
    createdAt: '2026-08-24T00:00:00.000Z',
    source: 'bflow',
    sourceCalendarId: 'bflow:mine',
    calendarId: 'mine',
    linkedTodoId: 'todo-old-delayed',
    canEdit: true,
    isReadOnly: false,
  };
  const latestLinkedEvent: ScheduleCalendarEvent = {
    ...oldLinkedEvent,
    id: 'latest-delayed-todo-event',
    title: '최신 할일 일정',
    linkedTodoId: 'todo-latest-delayed',
  };
  scheduleCanonicalEvents = [oldLinkedEvent, latestLinkedEvent];
  scheduleGetEventsGate = new Promise<void>((resolve) => {
    resolveScheduleGetEventsGate = resolve;
  });
  schedulePendingDateNavigation = {
    id: 51,
    date: '2026-09-17',
    todoId: oldLinkedEvent.linkedTodoId,
  };
  schedulePendingTodoPanelNavigation = schedulePendingDateNavigation;

  await renderScheduleView();
  await flushScheduleMountEffects();

  schedulePendingDateNavigation = {
    id: 52,
    date: '2026-09-18',
    todoId: latestLinkedEvent.linkedTodoId,
  };
  schedulePendingTodoPanelNavigation = schedulePendingDateNavigation;
  await renderScheduleView();
  await flushScheduleMountEffects();

  resolveScheduleGetEventsGate?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  schedulePanelProps = [];
  await renderScheduleView();
  await flushScheduleMountEffects();
  await renderScheduleView();

  assert.deepEqual(scheduleDateNavigationConsumeIds, [51, 52]);
  assert.deepEqual(
    scheduleTodoPanelNavigationConsumeIds,
    [52],
    'the stale todo request must not consume the newer panel intent',
  );
  assert.deepEqual(schedulePanelProps.at(-1)?.event, latestLinkedEvent);
  resetHarness();
});

test('ScheduleView does not resolve a delayed todo panel after leaving the schedule', async () => {
  resetHarness();
  const linkedEvent: ScheduleCalendarEvent = {
    id: 'left-schedule-todo-event',
    title: '떠난 화면에서 열리면 안 되는 일정',
    memo: '',
    color: '#74B9FF',
    type: 'custom',
    startDate: '2026-09-17',
    endDate: '2026-09-17',
    createdBy: 'owner',
    createdAt: '2026-08-24T00:00:00.000Z',
    source: 'bflow',
    sourceCalendarId: 'bflow:mine',
    calendarId: 'mine',
    linkedTodoId: 'todo-left-schedule',
    canEdit: true,
    isReadOnly: false,
  };
  scheduleCanonicalEvents = [linkedEvent];
  scheduleGetEventsGate = new Promise<void>((resolve) => {
    resolveScheduleGetEventsGate = resolve;
  });
  schedulePendingDateNavigation = {
    id: 53,
    date: '2026-09-17',
    todoId: linkedEvent.linkedTodoId,
  };
  schedulePendingTodoPanelNavigation = schedulePendingDateNavigation;

  await renderScheduleView();
  await flushScheduleMountEffects();
  scheduleCurrentView = 'dashboard';
  resolveScheduleGetEventsGate?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  schedulePanelProps = [];
  await renderScheduleView();
  await flushScheduleMountEffects();
  await renderScheduleView();

  assert.deepEqual(scheduleTodoPanelNavigationConsumeIds, []);
  assert.equal(schedulePanelProps.length, 0, 'a delayed event list cannot open a panel after navigation leaves schedule');
  resetHarness();
});

test('ScheduleView todo navigation does not adopt an unrelated same-id storage row', async () => {
  resetHarness();
  const unrelatedGoogle: ScheduleCalendarEvent = {
    id: 'cal_todo-identity',
    title: '무관한 Google 일정',
    memo: '할일 패널에 열리면 안 됨',
    color: '#74B9FF',
    type: 'custom',
    startDate: '2026-08-25',
    endDate: '2026-08-25',
    createdBy: 'owner',
    createdAt: '2026-08-24T00:00:00.000Z',
    source: 'google',
    sourceCalendarId: 'primary',
    canEdit: true,
    isReadOnly: false,
  };
  scheduleCanonicalEvents = [unrelatedGoogle];

  await renderScheduleView();
  await flushScheduleMountEffects();
  await renderScheduleView();
  await flushScheduleMountEffects();
  schedulePendingDateNavigation = {
    id: 101,
    date: '2026-08-25',
    todoId: 'todo-identity',
  };
  schedulePendingTodoPanelNavigation = schedulePendingDateNavigation;
  await renderScheduleView();
  await flushScheduleMountEffects();
  await new Promise<void>((resolve) => setTimeout(resolve, 120));
  schedulePanelProps = [];
  await renderScheduleView();
  assert.equal(
    schedulePanelProps.length,
    0,
    'a raw cal_* collision cannot substitute for the missing linked B flow event',
  );
  resetHarness();
});

test('ScheduleView todo navigation prefers the unique linked identity over a raw-ID sibling', async () => {
  resetHarness();
  const unrelatedGoogle: ScheduleCalendarEvent = {
    id: 'cal_todo-identity',
    title: '무관한 Google 일정',
    memo: '',
    color: '#74B9FF',
    type: 'custom',
    startDate: '2026-08-25',
    endDate: '2026-08-25',
    createdBy: 'owner',
    createdAt: '2026-08-24T00:00:00.000Z',
    source: 'google',
    sourceCalendarId: 'primary',
    linkedTodoId: 'another-google-todo',
    canEdit: true,
    isReadOnly: false,
  };
  const linkedBflow: ScheduleCalendarEvent = {
    ...unrelatedGoogle,
    title: '열어야 할 B flow 할일 일정',
    source: 'bflow',
    sourceCalendarId: 'bflow:mine',
    calendarId: 'mine',
    linkedTodoId: 'todo-identity',
  };
  scheduleCanonicalEvents = [unrelatedGoogle, linkedBflow];

  await renderScheduleView();
  await flushScheduleMountEffects();
  await renderScheduleView();
  await flushScheduleMountEffects();
  schedulePendingDateNavigation = {
    id: 102,
    date: '2026-08-25',
    todoId: 'todo-identity',
  };
  schedulePendingTodoPanelNavigation = schedulePendingDateNavigation;
  await renderScheduleView();
  await flushScheduleMountEffects();
  await new Promise<void>((resolve) => setTimeout(resolve, 120));
  schedulePanelProps = [];
  await renderScheduleView();

  assert.deepEqual(
    schedulePanelProps.at(-1)?.event,
    linkedBflow,
    'the explicit linkedTodo row wins even when an earlier sibling shares its raw ID',
  );
  resetHarness();
});

test('ScheduleView reconciles an open calendar settings modal without closing create mode', async (t) => {
  await t.test('same-id metadata replaces the stale object and missing or unmanaged rows close the modal', async () => {
    resetHarness();
    let tree = await renderScheduleView();
    buttonByTitle(tree, '사이드바 펼치기').props.onClick?.();
    tree = await renderScheduleView();
    buttonByLabel(tree, '레일 캘린더 설정').props.onClick?.();
    tree = await renderScheduleView();
    assert.match(textContent(tree), /설정 EP 마일스톤/);

    calendarState.calendars = calendarState.calendars.map((calendar) => (
      calendar.id === 'mine' ? { ...calendar, name: '정본 개인 캘린더' } : calendar
    ));
    await renderScheduleView();
    await flushScheduleMountEffects();
    tree = await renderScheduleView();
    assert.match(textContent(tree), /설정 정본 개인 캘린더/, 'same-id canonical metadata replaces the stale modal object');

    calendarState.calendars = calendarState.calendars.map((calendar) => (
      calendar.id === 'mine' ? { ...calendar, canManage: false } : calendar
    ));
    await renderScheduleView();
    await flushScheduleMountEffects();
    tree = await renderScheduleView();
    assert.equal(
      findElements(tree, (element) => element.props['aria-label'] === '캘린더 설정 모달').length,
      0,
      'loss of manage permission closes the modal',
    );

    calendarState.calendars = calendarState.calendars.map((calendar) => (
      calendar.id === 'mine' ? { ...calendar, canManage: true } : calendar
    ));
    buttonByLabel(tree, '레일 캘린더 설정').props.onClick?.();
    await renderScheduleView();
    calendarState.calendars = calendarState.calendars.filter((calendar) => calendar.id !== 'mine');
    await renderScheduleView();
    await flushScheduleMountEffects();
    tree = await renderScheduleView();
    assert.equal(
      findElements(tree, (element) => element.props['aria-label'] === '캘린더 설정 모달').length,
      0,
      'a missing canonical row also closes the modal',
    );
  });

  await t.test('the null create-mode sentinel survives unrelated calendar list refreshes', async () => {
    resetHarness();
    let tree = await renderScheduleView();
    buttonByTitle(tree, '사이드바 펼치기').props.onClick?.();
    tree = await renderScheduleView();
    buttonByLabel(tree, '레일 새 캘린더').props.onClick?.();
    tree = await renderScheduleView();
    assert.match(textContent(tree), /새 캘린더 연결됨/);

    calendarState.calendars = [];
    await renderScheduleView();
    await flushScheduleMountEffects();
    tree = await renderScheduleView();
    assert.match(textContent(tree), /새 캘린더 연결됨/, 'create mode is not mistaken for a revoked existing calendar');
  });

  await t.test('a pending optimistic delete keeps its matching retry modal until canonical settlement', async () => {
    resetHarness();
    let tree = await renderScheduleView();
    buttonByTitle(tree, '사이드바 펼치기').props.onClick?.();
    tree = await renderScheduleView();
    buttonByLabel(tree, '레일 캘린더 설정').props.onClick?.();
    tree = await renderScheduleView();
    assert.match(textContent(tree), /설정 EP 마일스톤/);

    calendarState.optimisticDeletedCalendarIds = ['mine'];
    calendarState.calendars = calendarState.calendars.filter((calendar) => calendar.id !== 'mine');
    await renderScheduleView();
    await flushScheduleMountEffects();
    tree = await renderScheduleView();
    assert.match(
      textContent(tree),
      /설정 EP 마일스톤/,
      'local removal hides the rail row without hiding the ambiguous-response retry surface',
    );

    calendarState.optimisticDeletedCalendarIds = [];
    await renderScheduleView();
    await flushScheduleMountEffects();
    tree = await renderScheduleView();
    assert.equal(
      findElements(tree, (element) => element.props['aria-label'] === '캘린더 설정 모달').length,
      0,
      'authoritative absence closes the modal once the tombstone is settled',
    );
  });
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

test('ScheduleView applies one reduced-motion policy above every calendar branch, sidebar, and modal', async () => {
  const boundaryFor = (tree: ReactNode, expectedPolicy: 'always' | 'never'): ReactElement<Record<string, unknown>> => {
    const boundaries = findElements(tree, (element) => element.props['data-testid'] === 'schedule-motion-config');
    assert.equal(boundaries.length, 1, 'one root boundary must cover the complete ScheduleView subtree');
    const boundary = boundaries[0];
    assert.equal(boundary.type, 'motion-config', 'the policy boundary stays above the sidebar and every calendar surface');
    assert.equal(boundary.props['data-reduced-motion'], expectedPolicy);
    return boundary;
  };

  for (const scenario of [
    {
      name: 'month grid',
      reduce: true,
      preference: { viewMode: 'month', weekSubMode: 'card' },
      marker: 'calendar-grid',
    },
    {
      name: 'weekly time grid',
      reduce: false,
      preference: { viewMode: 'week', weekSubMode: 'timegrid' },
      marker: 'week-time-grid-view',
    },
    {
      name: 'weekly card view',
      reduce: true,
      preference: { viewMode: 'week', weekSubMode: 'card' },
      marker: 'week-scroll-view',
    },
    {
      name: 'daily view',
      reduce: false,
      preference: { viewMode: 'today', weekSubMode: 'card' },
      marker: 'day-scroll-view',
    },
  ] as const) {
    resetHarness();
    scheduleReducedMotion = scenario.reduce;
    scheduleLocalStorage.set('bflow_calendar_view_v1', JSON.stringify(scenario.preference));

    const boundary = boundaryFor(
      await renderScheduleView(),
      scenario.reduce ? 'always' : 'never',
    );
    assert.ok(
      findElements(boundary.props.children as ReactNode, (element) => element.props['data-testid'] === scenario.marker).length > 0,
      `${scenario.name} renders inside the shared motion boundary`,
    );
  }

  resetHarness();
  scheduleReducedMotion = true;
  let tree = await renderScheduleView();
  buttonByTitle(tree, '사이드바 펼치기').props.onClick?.({ stopPropagation() {} });
  tree = await renderScheduleView();
  let boundary = boundaryFor(tree, 'always');
  assert.ok(
    findElements(boundary.props.children as ReactNode, (element) => element.props['data-testid'] === 'mini-calendar').length > 0,
    'the animated mini calendar stays below the same root policy',
  );

  buttonByText(tree, '일정').props.onClick?.({ stopPropagation() {} });
  tree = await renderScheduleView();
  boundary = boundaryFor(tree, 'always');
  assert.ok(
    findElements(boundary.props.children as ReactNode, (element) => element.props['aria-label'] === '일정 생성 모달 연결됨').length > 0,
    'modal animation stays below the same root policy',
  );
});

test('ScheduleView restores and remembers the weekly time-grid choice while opening timed slot and drag ranges', async () => {
  resetHarness();
  scheduleLocalStorage.set('bflow_calendar_view_v1', JSON.stringify({
    viewMode: 'week',
    weekSubMode: 'timegrid',
  }));

  let tree = await renderScheduleView();
  const cardToggle = buttonByLabel(tree, '주간 카드 보기');
  const timeGridToggle = buttonByLabel(tree, '주간 시간표 보기');
  assert.equal(cardToggle.props['aria-pressed'], false);
  assert.equal(timeGridToggle.props['aria-pressed'], true);
  assert.equal(scheduleTimeGridProps.at(-1)?.weekDays.length, 7, 'the active Sunday-start week reaches the time grid');
  assert.ok((scheduleTimeGridProps.at(-1)?.weekCount ?? 0) >= 52, 'ScheduleView retains ownership of the full calendar-year navigation range');

  scheduleTimeGridProps.at(-1)?.onSlotClick('2026-08-26', '10:00', '10:30');
  tree = await renderScheduleView();
  assert.equal(scheduleCreateModalProps.at(-1)?.initialDate, '2026-08-26');
  assert.equal(scheduleCreateModalProps.at(-1)?.initialEndDate, '2026-08-26');
  assert.equal(scheduleCreateModalProps.at(-1)?.initialStartTime, '10:00', 'a slot click starts a timed 30-minute create');
  assert.equal(scheduleCreateModalProps.at(-1)?.initialEndTime, '10:30');

  scheduleTimeGridProps.at(-1)?.onTimeGridCreate?.('2026-08-27', '13:15', '14:45');
  tree = await renderScheduleView();
  assert.equal(scheduleCreateModalProps.at(-1)?.initialDate, '2026-08-27');
  assert.equal(scheduleCreateModalProps.at(-1)?.initialEndDate, '2026-08-27');
  assert.equal(scheduleCreateModalProps.at(-1)?.initialStartTime, '13:15', 'a time-grid drag preserves its exact start');
  assert.equal(scheduleCreateModalProps.at(-1)?.initialEndTime, '14:45', 'a time-grid drag preserves its exact end');

  await scheduleCreateModalProps.at(-1)?.onSave({
    title: '저장 뒤 일반 일정',
    memo: '',
    color: '#6C5CE7',
    type: 'custom',
    startDate: '2026-08-27',
    endDate: '2026-08-27',
    createdBy: '배한솔',
    allDay: false,
    startTime: '13:15',
    endTime: '14:45',
  });
  assert.deepEqual(
    scheduleAddedEvents.map((event) => ({
      startDate: event.startDate,
      endDate: event.endDate,
      startTime: event.startTime,
      endTime: event.endTime,
    })),
    [{
      startDate: '2026-08-27',
      endDate: '2026-08-27',
      startTime: '13:15',
      endTime: '14:45',
    }],
    'the still-prefilled timed modal saves its exact drag range',
  );
  // The ordinary-create button also resets these fields, so assert the successful-save
  // reset before opening it to keep this path independently covered.
  assert.deepEqual(
    stateSlots.slice(5, 9),
    [undefined, undefined, undefined, undefined],
    'a successful timed save clears its date and time prefill before the next opener',
  );

  tree = await renderScheduleView();
  buttonByText(tree, '일정').props.onClick?.({ stopPropagation() {} });
  tree = await renderScheduleView();
  assert.deepEqual(
    {
      initialDate: scheduleCreateModalProps.at(-1)?.initialDate,
      initialEndDate: scheduleCreateModalProps.at(-1)?.initialEndDate,
      initialStartTime: scheduleCreateModalProps.at(-1)?.initialStartTime,
      initialEndTime: scheduleCreateModalProps.at(-1)?.initialEndTime,
    },
    {
      initialDate: undefined,
      initialEndDate: undefined,
      initialStartTime: undefined,
      initialEndTime: undefined,
    },
    'a successful save clears every date and time prefill before the next ordinary creation',
  );

  scheduleCreateModalProps.at(-1)?.onClose();
  tree = await renderScheduleView();
  scheduleTimeGridProps.at(-1)?.onTimeGridCreate?.('2026-08-28', '09:00', '09:30');
  tree = await renderScheduleView();
  assert.equal(scheduleCreateModalProps.at(-1)?.initialStartTime, '09:00', 'the close check begins from a timed time-grid creation');
  assert.equal(scheduleCreateModalProps.at(-1)?.initialEndTime, '09:30');
  scheduleCreateModalProps.at(-1)?.onClose();
  tree = await renderScheduleView();
  buttonByText(tree, '일정').props.onClick?.({ stopPropagation() {} });
  tree = await renderScheduleView();
  assert.deepEqual(
    {
      initialDate: scheduleCreateModalProps.at(-1)?.initialDate,
      initialEndDate: scheduleCreateModalProps.at(-1)?.initialEndDate,
      initialStartTime: scheduleCreateModalProps.at(-1)?.initialStartTime,
      initialEndTime: scheduleCreateModalProps.at(-1)?.initialEndTime,
    },
    {
      initialDate: undefined,
      initialEndDate: undefined,
      initialStartTime: undefined,
      initialEndTime: undefined,
    },
    'closing a timed creation also clears every date and time prefill before the next ordinary creation',
  );

  cardToggle.props.onClick?.({ stopPropagation() {} });
  tree = await renderScheduleView();
  assert.equal(buttonByLabel(tree, '주간 카드 보기').props['aria-pressed'], true);
  assert.equal(scheduleWeekScrollProps.at(-1)?.mode, 'week', 'the existing card mode remains the weekly fallback');
  await flushScheduleMountEffects();
  assert.equal(
    scheduleLocalStorage.get('bflow_calendar_view_v1'),
    JSON.stringify({ viewMode: 'week', weekSubMode: 'card' }),
    'the latest weekly sub-mode is saved with the main view mode',
  );

  buttonByText(tree, '월').props.onClick?.({ stopPropagation() {} });
  tree = await renderScheduleView();
  assert.equal(findButtons(tree).some((button) => button.props['aria-label'] === '주간 카드 보기'), false, 'the sub-toggle stays exclusive to the weekly view');
});

test('EventCreateModal makes a supplied timed range editable without inheriting it into normal creation', async () => {
  resetHarness();
  const saved: Record<string, unknown>[] = [];
  const renderTimed = () => renderEventCreateModal(
    false,
    (event) => saved.push(event),
    '2026-08-26',
    [],
    { initialEndDate: '2026-08-26', initialStartTime: '10:00', initialEndTime: '10:30' },
  );

  let tree = await renderTimed();
  assert.equal(formElementByLabel(tree, '종일 일정').props.checked, false, 'a supplied time range disables all-day by default');
  assert.equal(formElementByLabel(tree, '시작 시각').props.value, '10:00');
  assert.equal(formElementByLabel(tree, '종료 시각').props.value, '10:30');

  formElementByLabel(tree, '제목').props.onChange?.({ target: { value: '시간표 일정', checked: false } });
  tree = await renderTimed();
  buttonByText(tree, '만들기').props.onClick?.();
  assert.deepEqual(
    { allDay: saved[0]?.allDay, startTime: saved[0]?.startTime, endTime: saved[0]?.endTime },
    { allDay: false, startTime: '10:00', endTime: '10:30' },
  );

});

test('EventCreateModal stays open and explains a failed save', async () => {
  resetHarness();
  let attempts = 0;
  const renderModal = () => renderEventCreateModal(
    false,
    () => {
      attempts += 1;
      return Promise.reject(new Error('save failed'));
    },
    '2026-08-26',
  );

  let tree = await renderModal();
  formElementByLabel(tree, '제목').props.onChange?.({ target: { value: '실패할 일정', checked: false } });
  tree = await renderModal();

  const submit = buttonByText(tree, '만들기');
  await submit.props.onClick?.();
  await Promise.resolve();
  await Promise.resolve();
  tree = await renderModal();

  assert.match(textContent(tree), /저장하지 못했어요/, '실패하면 모달에 사유가 뜬다');
  assert.equal(
    findButtons(tree).some((button) => textContent(button).includes('만들기')),
    true,
    '실패해도 모달은 그대로 열려 있다',
  );
  assert.equal(attempts, 1, '한 번의 클릭은 한 번만 저장을 시도한다');
});

test('EventCreateModal locks its submit button while a save is in flight', async () => {
  resetHarness();
  let attempts = 0;
  let releaseSave: (() => void) | undefined;
  const renderModal = () => renderEventCreateModal(
    false,
    () => {
      attempts += 1;
      return new Promise<void>((resolve) => { releaseSave = resolve; });
    },
    '2026-08-26',
  );

  let tree = await renderModal();
  formElementByLabel(tree, '제목').props.onChange?.({ target: { value: '느린 저장', checked: false } });
  tree = await renderModal();

  void buttonByText(tree, '만들기').props.onClick?.();
  await Promise.resolve();
  tree = await renderModal();

  const pendingSubmit = findButtons(tree).find((button) => textContent(button).includes('저장 중'));
  assert.ok(pendingSubmit, '저장 중에는 버튼 라벨이 바뀐다');
  assert.equal(pendingSubmit.props.disabled, true, '저장 중에는 버튼이 잠긴다');

  pendingSubmit.props.onClick?.();
  assert.equal(attempts, 1, '저장 중 다시 눌러도 두 번 저장하지 않는다');
  releaseSave?.();
});

test('ScheduleView rolls end-of-day time-grid slot and drag creation into a savable next-day timed modal', async () => {
  resetHarness();
  scheduleLocalStorage.set('bflow_calendar_view_v1', JSON.stringify({
    viewMode: 'week',
    weekSubMode: 'timegrid',
  }));

  await renderScheduleView();
  scheduleTimeGridProps.at(-1)?.onSlotClick('2026-08-31', '23:30', '00:00');
  await renderScheduleView();
  const lastSlotPrefill = scheduleCreateModalProps.at(-1);
  assert.deepEqual(
    {
      initialDate: lastSlotPrefill?.initialDate,
      initialEndDate: lastSlotPrefill?.initialEndDate,
      initialStartTime: lastSlotPrefill?.initialStartTime,
      initialEndTime: lastSlotPrefill?.initialEndTime,
    },
    {
      initialDate: '2026-08-31',
      initialEndDate: '2026-09-01',
      initialStartTime: '23:30',
      initialEndTime: '00:00',
    },
    '23:30–24:00 slot click opens the next-day timed interval rather than a reversed same-day range',
  );

  scheduleTimeGridProps.at(-1)?.onTimeGridCreate?.('2026-08-31', '23:45', '00:00');
  await renderScheduleView();
  assert.deepEqual(
    {
      initialDate: scheduleCreateModalProps.at(-1)?.initialDate,
      initialEndDate: scheduleCreateModalProps.at(-1)?.initialEndDate,
      initialStartTime: scheduleCreateModalProps.at(-1)?.initialStartTime,
      initialEndTime: scheduleCreateModalProps.at(-1)?.initialEndTime,
    },
    {
      initialDate: '2026-08-31',
      initialEndDate: '2026-09-01',
      initialStartTime: '23:45',
      initialEndTime: '00:00',
    },
    'late create drag keeps its 15-minute midnight boundary intact',
  );

  resetHarness();
  const saved: Record<string, unknown>[] = [];
  const renderModal = () => renderEventCreateModal(
    false,
    (created) => saved.push(created),
    '2026-08-31',
    [],
    { initialEndDate: '2026-09-01', initialStartTime: '23:45', initialEndTime: '00:00' },
  );
  let modal = await renderModal();
  assert.equal(formElementByLabel(modal, '종일 일정').props.checked, false);
  assert.equal(formElementByLabel(modal, '종료일').props.value, '2026-09-01');
  assert.doesNotMatch(textContent(modal), /종료 시각은 시작 시각보다 뒤여야 해요/);
  formElementByLabel(modal, '제목').props.onChange?.({ target: { value: '자정 경계 일정', checked: false } });
  modal = await renderModal();
  buttonByText(modal, '만들기').props.onClick?.();
  assert.deepEqual(
    {
      allDay: saved[0]?.allDay,
      startDate: saved[0]?.startDate,
      endDate: saved[0]?.endDate,
      startTime: saved[0]?.startTime,
      endTime: saved[0]?.endTime,
    },
    {
      allDay: false,
      startDate: '2026-08-31',
      endDate: '2026-09-01',
      startTime: '23:45',
      endTime: '00:00',
    },
    'the actual modal accepts and saves the wrapped time range',
  );
});

test('ScheduleView persists a time-grid move with its complete patch and source-aware identity', async () => {
  resetHarness();
  scheduleLocalStorage.set('bflow_calendar_view_v1', JSON.stringify({
    viewMode: 'week',
    weekSubMode: 'timegrid',
  }));
  const before = calendarListEvent({
    id: 'time-grid-shared-id',
    source: 'bflow',
    sourceCalendarId: 'bflow:mine',
    allDay: false,
    startTime: '09:00',
    endTime: '09:30',
  });
  const moved = {
    ...before,
    startDate: '2026-08-27',
    endDate: '2026-08-27',
    startTime: '13:15',
    endTime: '14:45',
  };
  scheduleCanonicalEvents = [moved];

  await renderScheduleView();
  stateSlots[0] = [before];
  await renderScheduleView();
  const grid = scheduleTimeGridProps.at(-1);
  assert.ok(grid?.onTimeGridEventChange, 'the existing C.2 time-grid mutation contract reaches ScheduleView');
  await grid.onTimeGridEventChange?.(before.id, {
    id: before.id,
    source: before.source,
    sourceCalendarId: before.sourceCalendarId,
  }, {
    startDate: moved.startDate,
    endDate: moved.endDate,
    startTime: moved.startTime!,
    endTime: moved.endTime!,
  });

  assert.deepEqual(scheduleUpdateCalls.at(-1), {
    id: before.id,
    updates: {
      startDate: '2026-08-27',
      endDate: '2026-08-27',
      startTime: '13:15',
      endTime: '14:45',
    },
    targetIdentity: {
      id: before.id,
      source: 'bflow',
      sourceCalendarId: 'bflow:mine',
    },
  });
});

test('ScheduleView calendar shortcuts switch views, return to today, and preserve arrow navigation', async (t) => {
  await t.test('W and M switch directly between the weekly and monthly views', async () => {
    resetHarness();
    await renderScheduleView();
    await flushScheduleMountEffects();

    dispatchScheduleKeydown('w');
    await renderScheduleView();
    assert.ok(scheduleWeekScrollProps.at(-1), 'W renders the weekly calendar');

    for (const cleanup of scheduleMountedEffectCleanups.splice(0).reverse()) cleanup();
    await flushScheduleMountEffects();
    const monthRenderCountBeforeM = scheduleGridProps.length;
    dispatchScheduleKeydown('m');
    await renderScheduleView();
    assert.equal(scheduleGridProps.length, monthRenderCountBeforeM + 1, 'M renders a new monthly calendar');
  });

  await t.test('T returns the daily calendar to the real current date', async () => {
    resetHarness();
    scheduleLocalStorage.set('bflow_calendar_view_v1', JSON.stringify({
      viewMode: 'today',
      weekSubMode: 'card',
    }));
    await renderScheduleView();
    scheduleDayScrollProps.at(-1)!.onActiveDayChange(0);
    await renderScheduleView();
    for (const cleanup of scheduleMountedEffectCleanups.splice(0).reverse()) cleanup();
    await flushScheduleMountEffects();

    dispatchScheduleKeydown('t');
    await renderScheduleView();

    const now = new Date();
    const expectedIndex = Math.round((
      new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).getTime()
      - new Date(now.getFullYear(), 0, 1, 12).getTime()
    ) / 86_400_000);
    assert.equal(scheduleDayScrollProps.at(-1)?.year, now.getFullYear());
    assert.equal(scheduleDayScrollProps.at(-1)?.activeDayIndex, expectedIndex);
  });

  await t.test('the detail panel keeps calendar keyboard navigation alive, only yielding Escape', async () => {
    resetHarness();
    const target = calendarListEvent({
      id: 'panel-open',
      title: '열어 둔 일정',
      source: 'bflow',
      sourceCalendarId: 'bflow:mine',
      calendarId: 'mine',
      canEdit: true,
    });
    scheduleCanonicalEvents = [target];
    await renderScheduleView();
    await flushScheduleMountEffects();
    await renderScheduleView();
    scheduleGridProps.at(-1)?.onEventClick(target);
    await renderScheduleView();
    assert.ok(schedulePanelProps.at(-1), '상세 패널이 열려 있다');

    for (const cleanup of scheduleMountedEffectCleanups.splice(0).reverse()) cleanup();
    await flushScheduleMountEffects();

    dispatchScheduleKeydown('ArrowRight');
    await renderScheduleView();
    assert.ok(
      scheduleGridProps.at(-1)?.focusedDate,
      '패널이 열려 있어도 방향키 이동은 살아 있다',
    );

    for (const cleanup of scheduleMountedEffectCleanups.splice(0).reverse()) cleanup();
    await flushScheduleMountEffects();
    const createCountBefore = scheduleCreateModalProps.length;
    dispatchScheduleKeydown('Escape');
    await renderScheduleView();
    assert.equal(
      scheduleCreateModalProps.length,
      createCountBefore,
      'Escape는 패널 자신이 처리하도록 캘린더가 손대지 않는다',
    );
  });

  await t.test('ArrowRight still moves the focused month date before C uses it', async () => {
    resetHarness();
    await renderScheduleView();
    await flushScheduleMountEffects();

    dispatchScheduleKeydown('ArrowRight');
    await renderScheduleView();
    const focusedDate = scheduleGridProps.at(-1)?.focusedDate;
    assert.ok(focusedDate, 'the existing arrow navigation still focuses a calendar date');

    for (const cleanup of scheduleMountedEffectCleanups.splice(0).reverse()) cleanup();
    await flushScheduleMountEffects();
    dispatchScheduleKeydown('c');
    await renderScheduleView();
    assert.equal(scheduleCreateModalProps.at(-1)?.initialDate, focusedDate);
    assert.equal(scheduleCreateModalProps.at(-1)?.initialEndDate, focusedDate);
  });

  await t.test('period navigation discards a hidden month focus before C creates a new event', async () => {
    resetHarness();
    let tree = await renderScheduleView();
    await flushScheduleMountEffects();

    dispatchScheduleKeydown('t');
    await rerenderScheduleViewWithFreshEffects();
    dispatchScheduleKeydown('ArrowRight');
    tree = await rerenderScheduleViewWithFreshEffects();
    const focusedDate = scheduleGridProps.at(-1)?.focusedDate;
    const today = scheduleFmtDate(new Date());
    assert.ok(focusedDate, 'a month arrow creates a focused date before the period changes');
    assert.notEqual(focusedDate, today, 'the focused date differs from C\'s normal today fallback');

    buttonByLabel(tree, '다음 기간').props.onClick?.();
    await rerenderScheduleViewWithFreshEffects();

    dispatchScheduleKeydown('c');
    await renderScheduleView();
    assert.equal(scheduleCreateModalProps.at(-1)?.initialDate, today);
    assert.equal(scheduleCreateModalProps.at(-1)?.initialEndDate, today);
  });

  await t.test('C falls back to today when no month date is focused', async () => {
    resetHarness();
    await renderScheduleView();
    await flushScheduleMountEffects();

    dispatchScheduleKeydown('c');
    await renderScheduleView();

    const today = scheduleFmtDate(new Date());
    assert.equal(scheduleCreateModalProps.at(-1)?.initialDate, today);
    assert.equal(scheduleCreateModalProps.at(-1)?.initialEndDate, today);
  });
});

test('ScheduleView shortcut help toggles with ? and closes with Escape without motion when reduced', async () => {
  resetHarness();
  await renderScheduleView();
  await flushScheduleMountEffects();

  dispatchScheduleKeydown('?', { tagName: 'DIV' }, { shiftKey: true });
  let tree = await renderScheduleView();
  const animatedDialog = nodeByAriaLabel(tree, '캘린더 단축키');
  assert.match(String((animatedDialog.props as { className?: string }).className), /char-modal-in_200ms_ease-out/);
  assert.match(textContent(animatedDialog), /오늘/);
  assert.match(textContent(animatedDialog), /새 일정/);

  dispatchScheduleKeydown('?', { tagName: 'DIV' }, { shiftKey: true });
  tree = await renderScheduleView();
  assert.throws(() => nodeByAriaLabel(tree, '캘린더 단축키'), /must be rendered/);

  dispatchScheduleKeydown('?', { tagName: 'DIV' }, { shiftKey: true });
  await rerenderScheduleViewWithFreshEffects();
  dispatchScheduleKeydown('Escape');
  tree = await renderScheduleView();
  assert.throws(() => nodeByAriaLabel(tree, '캘린더 단축키'), /must be rendered/);

  resetHarness();
  scheduleReducedMotion = true;
  await renderScheduleView();
  await flushScheduleMountEffects();
  dispatchScheduleKeydown('?', { tagName: 'DIV' }, { shiftKey: true });
  tree = await renderScheduleView();
  const reducedDialog = nodeByAriaLabel(tree, '캘린더 단축키');
  assert.doesNotMatch(String((reducedDialog.props as { className?: string }).className), /char-modal-in/);
});

test('ShortcutHelpOverlay moves and contains focus, blocks background keys, then restores the opener', async () => {
  const ShortcutHelpOverlay = await loadShortcutHelpOverlay();
  const previousDocument = globalThis.document;
  shortcutOverlayRefs = [];
  shortcutOverlayEffects = [];

  type FocusTarget = {
    name: string;
    isConnected: boolean;
    focus(): void;
    querySelectorAll?(): FocusTarget[];
  };
  let activeElement: FocusTarget | null = null;
  const focusLog: string[] = [];
  const makeTarget = (name: string): FocusTarget => ({
    name,
    isConnected: true,
    focus() {
      activeElement = this;
      focusLog.push(name);
    },
  });
  const opener = makeTarget('opener');
  const closeButton = makeTarget('close');
  const dialog = {
    ...makeTarget('dialog'),
    querySelectorAll: () => [closeButton],
  };
  activeElement = opener;
  globalThis.document = { get activeElement() { return activeElement; } } as unknown as Document;

  let closeRequests = 0;
  const tree = resolveComponents(ShortcutHelpOverlay({ onClose() { closeRequests += 1; } }));
  const dialogNode = nodeByAriaLabel(tree, '캘린더 단축키') as ReactElement<Record<string, unknown>>;
  const closeNode = buttonByLabel(tree, '단축키 도움말 닫기') as unknown as ReactElement<Record<string, unknown>>;
  const dialogRef = (dialogNode as unknown as { ref?: { current: unknown } }).ref;
  const closeRef = (closeNode as unknown as { ref?: { current: unknown } }).ref;
  if (dialogRef) dialogRef.current = dialog;
  if (closeRef) closeRef.current = closeButton;

  const cleanups = shortcutOverlayEffects
    .map((effect) => effect())
    .filter((cleanup): cleanup is () => void => typeof cleanup === 'function');
  assert.equal(activeElement, closeButton, '열리면 배경의 기존 포커스 대신 닫기 버튼에 포커스한다');

  const onKeyDown = dialogNode.props.onKeyDown as ((event: Record<string, unknown>) => void) | undefined;
  let helpTogglePrevented = false;
  onKeyDown?.({
    key: '?',
    shiftKey: true,
    preventDefault() { helpTogglePrevented = true; },
    stopPropagation() {},
  });
  assert.equal(closeRequests, 1, '포커스가 도움말 안에 있어도 Shift+/를 다시 누르면 도움말을 닫는다');
  assert.equal(helpTogglePrevented, true);

  let tabPrevented = false;
  onKeyDown?.({
    key: 'Tab',
    shiftKey: false,
    preventDefault() { tabPrevented = true; },
    stopPropagation() {},
  });
  assert.equal(tabPrevented, true, '마지막 포커스 요소에서 Tab을 누르면 다이얼로그 안에 머문다');
  assert.equal(activeElement, closeButton);

  let shiftTabPrevented = false;
  onKeyDown?.({
    key: 'Tab',
    shiftKey: true,
    preventDefault() { shiftTabPrevented = true; },
    stopPropagation() {},
  });
  assert.equal(shiftTabPrevented, true, '첫 포커스 요소에서 Shift+Tab을 눌러도 다이얼로그 안에 머문다');

  let backgroundEnterActivations = 0;
  let propagationStopped = false;
  onKeyDown?.({
    key: 'Enter',
    shiftKey: false,
    preventDefault() {},
    stopPropagation() { propagationStopped = true; },
  });
  if (!propagationStopped) backgroundEnterActivations += 1;
  assert.equal(backgroundEnterActivations, 0, '모달 안 Enter가 배경 단축키까지 전달되지 않는다');

  for (const cleanup of cleanups.reverse()) cleanup();
  assert.equal(activeElement, opener, '닫힐 때 연결된 기존 포커스 요소로 돌아간다');
  assert.deepEqual(focusLog, ['close', 'close', 'close', 'opener']);
  globalThis.document = previousDocument;
});

test('ScheduleView calendar shortcuts ignore editing targets, modifiers, and open modal UI', async () => {
  resetHarness();
  await renderScheduleView();
  await flushScheduleMountEffects();

  dispatchScheduleKeydown('w', { tagName: 'INPUT' });
  dispatchScheduleKeydown('c', { tagName: 'DIV', isContentEditable: true });
  dispatchScheduleKeydown('w', { tagName: 'DIV' }, { ctrlKey: true });
  let tree = await renderScheduleView();
  assert.equal(scheduleWeekScrollProps.length, 0, 'text editing and modified keys do not switch views');
  assert.equal(scheduleCreateModalProps.length, 0, 'contenteditable does not open the create modal');
  assert.ok(scheduleGridProps.at(-1), 'the monthly view remains active');

  dispatchScheduleKeydown('c');
  tree = await rerenderScheduleViewWithFreshEffects();
  assert.ok(scheduleCreateModalProps.at(-1), 'the unmodified shortcut opens create mode');
  dispatchScheduleKeydown('w');
  await renderScheduleView();
  assert.equal(scheduleWeekScrollProps.length, 0, 'open create UI blocks calendar shortcuts');
});

test('ScheduleView allows Shift only for shortcut help and ignores Shift+T/W/M/C', async () => {
  resetHarness();
  scheduleLocalStorage.set('bflow_calendar_view_v1', JSON.stringify({
    viewMode: 'today',
    weekSubMode: 'card',
  }));
  await renderScheduleView();
  scheduleDayScrollProps.at(-1)!.onActiveDayChange(0);
  await rerenderScheduleViewWithFreshEffects();

  dispatchScheduleKeydown('T', { tagName: 'DIV' }, { shiftKey: true });
  dispatchScheduleKeydown('W', { tagName: 'DIV' }, { shiftKey: true });
  dispatchScheduleKeydown('M', { tagName: 'DIV' }, { shiftKey: true });
  dispatchScheduleKeydown('C', { tagName: 'DIV' }, { shiftKey: true });
  let tree = await renderScheduleView();

  assert.equal(scheduleDayScrollProps.at(-1)?.activeDayIndex, 0, 'Shift+T does not return to today');
  assert.equal(scheduleWeekScrollProps.length, 0, 'Shift+W does not switch to week');
  assert.equal(scheduleGridProps.length, 0, 'Shift+M does not switch to month');
  assert.equal(scheduleCreateModalProps.length, 0, 'Shift+C does not open create mode');

  dispatchScheduleKeydown('?', { tagName: 'DIV' }, { shiftKey: true });
  tree = await renderScheduleView();
  assert.ok(nodeByAriaLabel(tree, '캘린더 단축키'), 'Shift+/ remains the one allowed Shift shortcut');
});

test('ScheduleView suppresses calendar shortcuts while calendar settings is open', async () => {
  resetHarness();
  let tree = await renderScheduleView();
  await flushScheduleMountEffects();

  buttonByTitle(tree, '사이드바 펼치기').props.onClick?.();
  tree = await renderScheduleView();
  buttonByLabel(tree, '레일 새 캘린더').props.onClick?.();
  tree = await rerenderScheduleViewWithFreshEffects();
  assert.ok(nodeByAriaLabel(tree, '캘린더 설정 모달'));

  dispatchScheduleKeydown('w');
  dispatchScheduleKeydown('c');
  await renderScheduleView();
  assert.equal(scheduleWeekScrollProps.length, 0, 'settings modal blocks view shortcuts');
  assert.equal(scheduleCreateModalProps.length, 0, 'settings modal blocks create shortcuts');
});

test('ScheduleView suppresses calendar shortcuts while the tag manager popover is open', async () => {
  resetHarness();
  await renderScheduleView();
  await flushScheduleMountEffects();

  scheduleTagBarProps.at(-1)?.onOpenTagManager({
    left: 111, right: 207, top: 52, bottom: 80, width: 96, height: 28,
  } as DOMRect);
  let tree = await rerenderScheduleViewWithFreshEffects();
  assert.ok(nodeByAriaLabel(tree, '태그 관리 팝오버 연결됨'));

  dispatchScheduleKeydown('c');
  dispatchScheduleKeydown('?', { tagName: 'DIV' }, { shiftKey: true });
  tree = await renderScheduleView();

  assert.equal(scheduleCreateModalProps.length, 0, 'tag management blocks a create modal behind the popover');
  assert.throws(() => nodeByAriaLabel(tree, '캘린더 단축키'), /must be rendered/, 'tag management blocks shortcut help behind the popover');
});

test('ScheduleView suppresses calendar shortcuts while a global modal is open', async () => {
  resetHarness();
  await renderScheduleView();
  await flushScheduleMountEffects();
  scheduleGlobalModalOpen = true;

  dispatchScheduleKeydown('w', { tagName: 'BUTTON' });
  dispatchScheduleKeydown('m', { tagName: 'BUTTON' });
  dispatchScheduleKeydown('c', { tagName: 'BUTTON' });
  dispatchScheduleKeydown('?', { tagName: 'BUTTON' }, { shiftKey: true });
  const tree = await renderScheduleView();

  assert.equal(scheduleWeekScrollProps.length, 0, 'a global dialog blocks view changes behind it');
  assert.equal(scheduleCreateModalProps.length, 0, 'a global dialog blocks create mode behind it');
  assert.throws(() => nodeByAriaLabel(tree, '캘린더 단축키'), /must be rendered/, 'a global dialog blocks shortcut help behind it');
});

test('ScheduleView carries weekly and daily navigation across a calendar-year boundary', async (t) => {
  await t.test('weekly header navigation moves past the last generated week and returns without an empty week', async () => {
    resetHarness();
    scheduleLocalStorage.set('bflow_calendar_view_v1', JSON.stringify({
      viewMode: 'week',
      weekSubMode: 'timegrid',
    }));

    let tree = await renderScheduleView();
    const initialGrid = scheduleTimeGridProps.at(-1);
    assert.ok(initialGrid);
    initialGrid.onWeekChange(initialGrid.weekCount - 1);
    tree = await renderScheduleView();
    const lastWeek = scheduleTimeGridProps.at(-1);
    assert.ok(lastWeek);
    const lastWeekStart = scheduleFmtDate(lastWeek.weekDays[0]);

    buttonByLabel(tree, '다음 기간').props.onClick?.({ stopPropagation() {} });
    tree = await renderScheduleView();
    const followingWeek = scheduleTimeGridProps.at(-1);
    assert.ok(followingWeek);
    assert.equal(followingWeek.weekDays.length, 7, 'next year still provides a complete Sunday-start week');
    assert.ok(scheduleFmtDate(followingWeek.weekDays[0]) > lastWeekStart, 'the header arrow moves to the next actual week instead of clamping');

    buttonByLabel(tree, '이전 기간').props.onClick?.({ stopPropagation() {} });
    await renderScheduleView();
    assert.equal(scheduleFmtDate(scheduleTimeGridProps.at(-1)!.weekDays[0]), lastWeekStart, 'moving back restores the prior week across the year edge');
  });

  await t.test('today keyboard arrow advances 12/31 to 1/1 with the new year index', async () => {
    resetHarness();
    scheduleLocalStorage.set('bflow_calendar_view_v1', JSON.stringify({
      viewMode: 'today',
      weekSubMode: 'card',
    }));

    await renderScheduleView();
    const initialDay = scheduleDayScrollProps.at(-1);
    assert.ok(initialDay);
    const lastDayIndex = new Date(initialDay.year, 1, 29).getDate() === 29 ? 365 : 364;
    initialDay.onActiveDayChange(lastDayIndex);
    schedulePendingEffects.splice(0);
    await renderScheduleView();
    await flushScheduleMountEffects();

    dispatchScheduleKeydown('ArrowRight');
    await renderScheduleView();
    const nextDay = scheduleDayScrollProps.at(-1);
    assert.ok(nextDay);
    assert.equal(nextDay.year, initialDay.year + 1);
    assert.equal(nextDay.activeDayIndex, 0, 'January 1 is the first valid index of the new year');
  });
});

test('ScheduleView keeps valid weekly indices owned by the displayed year', async (t) => {
  const renderCardAtIndexOne = async (): Promise<ReactNode> => {
    resetHarness();
    scheduleLocalStorage.set('bflow_calendar_view_v1', JSON.stringify({
      viewMode: 'week',
      weekSubMode: 'card',
    }));

    await renderScheduleView();
    const card = scheduleWeekScrollProps.at(-1);
    assert.ok(card);
    card.onWeekChange(1);
    const tree = await renderScheduleView();
    const indexOne = scheduleWeekScrollProps.at(-1);
    assert.ok(indexOne);
    assert.equal(indexOne.currentYear, 2026);
    assert.equal(indexOne.currentMonth, 0);
    assert.equal(indexOne.activeWeekIndex, 1);
    return tree;
  };

  await t.test('a valid timegrid index for the first 2026 week keeps January 2026 selected', async () => {
    resetHarness();
    scheduleLocalStorage.set('bflow_calendar_view_v1', JSON.stringify({
      viewMode: 'week',
      weekSubMode: 'timegrid',
    }));

    let tree = await renderScheduleView();
    const timeGrid = scheduleTimeGridProps.at(-1);
    assert.ok(timeGrid);
    assert.equal(
      scheduleFmtDate(scheduleGenerateYearWeeks(2026)[0][0]),
      '2025-12-28',
      'the first generated 2026 week intentionally includes December dates',
    );
    timeGrid.onWeekChange(0);
    tree = await renderScheduleView();

    buttonByLabel(tree, '주간 카드 보기').props.onClick?.({ stopPropagation() {} });
    await renderScheduleView();
    const card = scheduleWeekScrollProps.at(-1);
    assert.ok(card);
    assert.equal(card.currentYear, 2026);
    assert.equal(card.currentMonth, 0, 'the first valid week is owned by January in the displayed year');
    assert.equal(card.activeWeekIndex, 0);
  });

  await t.test('a valid card index stays in 2026 while an out-of-range sentinel still crosses years', async () => {
    resetHarness();
    scheduleLocalStorage.set('bflow_calendar_view_v1', JSON.stringify({
      viewMode: 'week',
      weekSubMode: 'card',
    }));

    await renderScheduleView();
    const card = scheduleWeekScrollProps.at(-1);
    assert.ok(card);
    card.onWeekChange(0);
    await renderScheduleView();
    const firstWeek = scheduleWeekScrollProps.at(-1);
    assert.ok(firstWeek);
    assert.equal(firstWeek.currentYear, 2026);
    assert.equal(firstWeek.currentMonth, 0);
    assert.equal(firstWeek.activeWeekIndex, 0);

    firstWeek.onWeekChange(-1);
    await renderScheduleView();
    const priorYear = scheduleWeekScrollProps.at(-1);
    assert.ok(priorYear);
    assert.equal(priorYear.currentYear, 2025, 'only the boundary sentinel changes the displayed year');
  });

  await t.test('the header previous control keeps index one and index zero inside January 2026', async () => {
    const tree = await renderCardAtIndexOne();
    buttonByLabel(tree, '이전 기간').props.onClick?.({ stopPropagation() {} });
    await renderScheduleView();

    const firstWeek = scheduleWeekScrollProps.at(-1);
    assert.ok(firstWeek);
    assert.equal(firstWeek.currentYear, 2026);
    assert.equal(firstWeek.currentMonth, 0);
    assert.equal(firstWeek.activeWeekIndex, 0);
  });

  await t.test('ArrowLeft keeps index one and index zero inside January 2026', async () => {
    await renderCardAtIndexOne();
    await rerenderScheduleViewWithFreshEffects();

    dispatchScheduleKeydown('ArrowLeft');
    await renderScheduleView();
    const firstWeek = scheduleWeekScrollProps.at(-1);
    assert.ok(firstWeek);
    assert.equal(firstWeek.currentYear, 2026);
    assert.equal(firstWeek.currentMonth, 0);
    assert.equal(firstWeek.activeWeekIndex, 0);
  });
});

test('ScheduleView counts every event overlapping the displayed month', async () => {
  resetHarness();
  scheduleCanonicalEvents = [
    calendarListEvent({ id: 'from-prior-month', title: '전달에서 이어짐', startDate: '2026-07-30', endDate: '2026-08-02' }),
    calendarListEvent({ id: 'inside-month', title: '이번 달 일정', startDate: '2026-08-12', endDate: '2026-08-12' }),
    calendarListEvent({ id: 'into-next-month', title: '다음 달까지', startDate: '2026-08-30', endDate: '2026-09-03' }),
    calendarListEvent({ id: 'outside-month', title: '다음 달만', startDate: '2026-09-01', endDate: '2026-09-02' }),
  ];

  await renderScheduleView();
  await flushScheduleMountEffects();
  const tree = await renderScheduleView();
  assert.match(textContent(tree), /이번 달 3개/, 'events that started before or end after this month still count while they overlap it');
});

test('ScheduleView ignores malformed remembered calendar view data', async () => {
  resetHarness();
  scheduleLocalStorage.set('bflow_calendar_view_v1', '{not-json');

  const tree = await renderScheduleView();
  assert.equal(findButtons(tree).some((button) => button.props['aria-label'] === '주간 시간표 보기'), false, 'malformed storage falls back to the existing monthly view');
  assert.equal(scheduleTimeGridProps.length, 0);
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

test('the weekly header names the month and week, and today pulses in every view', async () => {
  // 주간 헤더는 범위만으로는 몇 월 몇째 주인지 알기 어려워 연·월·주차를 함께 보여 준다.
  resetHarness();
  scheduleLocalStorage.set('bflow_calendar_view_v1', JSON.stringify({ viewMode: 'week', weekSubMode: 'card' }));
  let tree = await renderScheduleView();
  await flushScheduleMountEffects();
  tree = await renderScheduleView();

  assert.match(
    textContent(tree),
    /\d{4}년 \d{1,2}월 · \d{1,2}주차 · \d{1,2}\.\d{1,2} – \d{1,2}\.\d{1,2}/,
    '주간 헤더가 연·월·주차·범위를 모두 담는다',
  );

  // '오늘' 버튼은 헤더 네비게이션에 있어 월·주·2주 보기에서 누를 수 있다.
  // 오늘 보기에는 헤더 네비게이션 자체가 없으므로, 같은 펄스를 미니 달력 이동으로 확인한다.
  const todayButtonCases = [
    { label: '월 보기', stored: { viewMode: 'month', weekSubMode: 'card' }, read: () => scheduleGridProps.at(-1)?.pulseDate },
    { label: '주간 카드', stored: { viewMode: 'week', weekSubMode: 'card' }, read: () => scheduleWeekScrollProps.at(-1)?.pulseDate },
    { label: '주간 시간표', stored: { viewMode: 'week', weekSubMode: 'timegrid' }, read: () => scheduleGridProps.at(-1)?.pulseDate ?? null },
  ] as const;

  for (const { label, stored, read } of todayButtonCases.slice(0, 2)) {
    resetHarness();
    scheduleLocalStorage.set('bflow_calendar_view_v1', JSON.stringify(stored));
    const clock = installScheduleFakeClock();
    try {
      tree = await renderScheduleView();
      await flushScheduleMountEffects();
      tree = await renderScheduleView();
      assert.equal(read(), null, `${label}: 처음에는 펄스가 없다`);

      buttonByText(tree, '오늘').props.onClick?.();
      tree = await renderScheduleView();
      assert.equal(read(), scheduleFmtDate(new Date()), `${label}: '오늘'을 누르면 그 날짜가 펄스한다`);
      assert.equal(scheduleCreateModalProps.length, 0, `${label}: '오늘'은 새 일정 창을 열지 않는다`);

      clock.advance(2_500);
      tree = await renderScheduleView();
      assert.equal(read(), null, `${label}: 펄스는 잠시 뒤 사라진다`);
    } finally {
      clock.restore();
    }
  }

  // 오늘 보기: 미니 달력으로 날짜를 옮기면 그 날짜 카드가 펄스한다.
  resetHarness();
  scheduleLocalStorage.set('bflow_calendar_view_v1', JSON.stringify({ viewMode: 'today', weekSubMode: 'card' }));
  tree = await renderScheduleView();
  await flushScheduleMountEffects();
  buttonByTitle(tree, '사이드바 펼치기').props.onClick?.();
  tree = await renderScheduleView();
  assert.equal(scheduleDayScrollProps.at(-1)?.pulseDate, null, '오늘 카드: 처음에는 펄스가 없다');

  const miniCalendar = scheduleMiniCalendarProps.at(-1);
  assert.ok(miniCalendar, '오늘 보기 사이드바에도 미니 달력이 있다');
  miniCalendar.onDateSelect('2026-08-11');
  await renderScheduleView();
  assert.equal(
    scheduleDayScrollProps.at(-1)?.pulseDate,
    '2026-08-11',
    '오늘 카드도 이동한 날짜를 펄스로 알려 준다',
  );
});

test('the month grid explains an empty month without blocking the create path', async () => {
  resetHarness();
  const emptyTree = await renderCalendarGrid([]);
  assert.match(textContent(emptyTree), /이번 달 일정이 없습니다/);
  assert.match(textContent(emptyTree), /날짜를 눌러 새 일정을 만들어 보세요/);

  const notice = findElements(emptyTree, (node) => (
    typeof node.props.className === 'string'
    && node.props.className.includes('pointer-events-none')
    && node.props.className.includes('absolute inset-0')
  ))[0];
  assert.ok(notice, '안내는 격자 위에 얹기만 한다');
  assert.match(
    String(notice.props.className),
    /pointer-events-none/,
    '날짜 셀 클릭이 곧 생성 경로이므로 안내가 클릭을 가리면 안 된다',
  );

  // 이번 달에 걸치는 일정이 하나라도 있으면 안내를 숨긴다.
  const filledTree = await renderCalendarGrid([calendarListEvent({ id: 'filled', title: '이번 달 일정' })]);
  assert.doesNotMatch(textContent(filledTree), /이번 달 일정이 없습니다/);

  // 옆 달에만 걸친 일정은 이번 달을 채우지 않는다.
  const neighbourTree = await renderCalendarGrid([calendarListEvent({
    id: 'neighbour',
    title: '다음 달 일정',
    startDate: '2026-09-10',
    endDate: '2026-09-10',
  })]);
  assert.match(textContent(neighbourTree), /이번 달 일정이 없습니다/);
});

test('a later move pulse is not cut short by the earlier one', async () => {
  resetHarness();
  let tree = await renderScheduleView();
  await flushScheduleMountEffects();
  tree = await renderScheduleView();
  buttonByTitle(tree, '사이드바 펼치기').props.onClick?.();
  tree = await renderScheduleView();

  const clock = installScheduleFakeClock();
  try {
    // '오늘'로 이동(2.5초 펄스).
    buttonByText(tree, '오늘').props.onClick?.();
    tree = await renderScheduleView();
    const todayStr = scheduleFmtDate(new Date());
    assert.equal(scheduleGridProps.at(-1)?.pulseDate, todayStr);

    // 2초 뒤 미니 달력으로 다른 날짜로 이동(3초 펄스).
    clock.advance(2_000);
    scheduleMiniCalendarProps.at(-1)?.onDateSelect('2026-08-11');
    tree = await renderScheduleView();
    assert.equal(scheduleGridProps.at(-1)?.pulseDate, '2026-08-11');

    // 앞선 '오늘' 타이머가 만료되는 시점(+0.5초)에도 새 펄스는 살아 있어야 한다.
    clock.advance(600);
    tree = await renderScheduleView();
    assert.equal(
      scheduleGridProps.at(-1)?.pulseDate,
      '2026-08-11',
      '앞선 타이머가 새 펄스를 조기에 끄지 않는다',
    );

    // 새 펄스는 자기 수명(3초)만큼만 남는다.
    clock.advance(2_500);
    await renderScheduleView();
    assert.equal(scheduleGridProps.at(-1)?.pulseDate, null, '자기 수명이 끝나면 꺼진다');
  } finally {
    clock.restore();
  }
});

test('rapid navigation also skips the weekly scroll animation and month-crossing arrows', async () => {
  // ① 주간 카드: 연타 중에는 주 이동 스크롤도 즉시 그린다.
  resetHarness();
  scheduleLocalStorage.set('bflow_calendar_view_v1', JSON.stringify({ viewMode: 'week', weekSubMode: 'card' }));
  const clock = installScheduleFakeClock();
  try {
    let tree = await renderScheduleView();
    await flushScheduleMountEffects();
    tree = await renderScheduleView();
    assert.equal(scheduleWeekScrollProps.at(-1)?.instantScroll, false, '처음에는 부드럽게 스크롤한다');

    buttonByLabel(tree, '다음 기간').props.onClick?.();
    tree = await renderScheduleView();
    clock.advance(120);
    buttonByLabel(tree, '다음 기간').props.onClick?.();
    tree = await renderScheduleView();
    assert.equal(scheduleWeekScrollProps.at(-1)?.instantScroll, true, '연타 중에는 즉시 스크롤한다');
  } finally {
    clock.restore();
  }

  // ② 월간 방향키가 달을 넘길 때도 연타 스킵이 걸린다.
  resetHarness();
  const monthClock = installScheduleFakeClock();
  try {
    await renderScheduleView();
    await flushScheduleMountEffects();

    // 달 안에서만 움직이는 첫 이동은 기간 이동이 아니다.
    dispatchScheduleKeydown('ArrowRight');
    await renderScheduleView();
    assert.equal(scheduleGridProps.at(-1)?.instantTransition, false);

    // 달 경계를 넘는 이동을 연달아 두 번 하면 두 번째는 즉시 그린다.
    for (let step = 0; step < 40; step += 1) dispatchScheduleKeydown('ArrowDown');
    await renderScheduleView();
    monthClock.advance(120);
    for (let step = 0; step < 40; step += 1) dispatchScheduleKeydown('ArrowDown');
    await renderScheduleView();
    assert.equal(
      scheduleGridProps.at(-1)?.instantTransition,
      true,
      '방향키를 꾹 눌러 달을 넘길 때도 스킵이 걸린다',
    );
  } finally {
    monthClock.restore();
  }
});

test('rapid period navigation draws the next period instantly instead of queueing slides', async () => {
  resetHarness();
  const clock = installScheduleFakeClock();
  const monthGrid = () => scheduleGridProps.at(-1);
  try {
    let tree = await renderScheduleView();
    await flushScheduleMountEffects();
    tree = await renderScheduleView();

    assert.equal(monthGrid()?.instantTransition, false, '처음에는 평소 전환을 쓴다');

    // 첫 이동은 평소대로 애니메이션한다.
    buttonByLabel(tree, '다음 기간').props.onClick?.();
    tree = await renderScheduleView();
    assert.equal(monthGrid()?.instantTransition, false, '한 번만 눌렀을 때는 전환을 유지한다');

    // 300ms 안에 다시 누르면 그 전환은 즉시 그린다.
    clock.advance(120);
    buttonByLabel(tree, '다음 기간').props.onClick?.();
    tree = await renderScheduleView();
    assert.equal(monthGrid()?.instantTransition, true, '연타 중에는 슬라이드를 건너뛴다');

    // 손을 떼고 300ms가 지나면 평소 전환으로 돌아온다.
    clock.advance(300);
    tree = await renderScheduleView();
    assert.equal(monthGrid()?.instantTransition, false, '연타가 끝나면 전환이 돌아온다');

    // 충분히 뜸을 들인 다음 이동은 다시 애니메이션한다.
    clock.advance(1_000);
    buttonByLabel(tree, '이전 기간').props.onClick?.();
    await renderScheduleView();
    assert.equal(monthGrid()?.instantTransition, false, '천천히 누르면 전환을 유지한다');
  } finally {
    clock.restore();
  }
});

test('the rail lists ICS subscriptions with their own toggle, refresh, rename and unsubscribe', async () => {
  resetHarness();
  railSubscribeFormProps = [];
  railConfirmResult = true;

  const subscriptions = [{
    id: 'sub-1',
    name: '외부 팀 캘린더',
    url: 'https://example.com/team.ics',
    color: '#00B894',
    enabled: true,
    lastFetchedAt: '2026-09-01T00:00:00.000Z',
    lastError: null as string | null,
    lastFetchTruncated: false,
  }];
  const calls: string[] = [];
  const previousApi = (globalThis as { window?: { electronAPI?: unknown } }).window;
  (globalThis as unknown as { window: Record<string, unknown> }).window = {
    electronAPI: {
      icsList: async () => subscriptions.map((row) => ({ ...row })),
      icsRefresh: async (id: string) => { calls.push(`refresh:${id}`); },
      icsRemove: async (id: string) => { calls.push(`remove:${id}`); },
      icsUpdate: async (id: string, patch: Record<string, unknown>) => {
        calls.push(`update:${id}:${JSON.stringify(patch)}`);
        return null;
      },
      onIcsChanged: () => () => {},
    },
    dispatchEvent: () => true,
    CustomEvent: class {},
  };

  try {
    // 훅 mock의 useEffect가 비어 있어 목록은 직접 채워 준 상태로 렌더한다.
    stateSlots = [];
    stateCursor = 0;
    let tree = await renderRail(false, { resetState: true });
    stateSlots[1] = subscriptions.map((row) => ({ ...row }));
    tree = await renderRail(false);

    assert.match(textContent(tree), /구독/, '레일에 구독 섹션이 있다');
    const toggle = buttonByLabel(tree, '외부 팀 캘린더 표시');
    assert.equal(toggle.props['aria-pressed'], true, '기본값은 켜짐이다');
    toggle.props.onClick?.();
    assert.equal(
      calendarState.visibleCalendarIds['ics:sub-1'],
      false,
      '구독 토글은 구독 전용 키만 쓴다',
    );

    // ⋯ 메뉴: 지금 새로고침 / 이름·색 바꾸기 / 구독 해제
    buttonByLabel(tree, '외부 팀 캘린더 메뉴 열기').props.onClick?.({ stopPropagation() {} });
    tree = await renderRail(false);
    const menuItems = findButtons(tree).filter((button) => button.props.role === 'menuitem');
    assert.deepEqual(
      menuItems.map((button) => textContent(button).trim()),
      ['이름·색 바꾸기', '지금 새로고침', '구독 해제'],
    );

    await menuItems[1].props.onClick?.();
    await Promise.resolve();
    assert.ok(calls.includes('refresh:sub-1'), '지금 새로고침이 그 구독만 갱신한다');

    // 실패한 구독은 경고 아이콘과 마지막 확인 시각을 함께 보여 준다.
    subscriptions[0].lastError = '네트워크가 불안정합니다';
    stateSlots[1] = subscriptions.map((row) => ({ ...row }));
    tree = await renderRail(false);
    const warning = findElements(tree, (node) => node.props['aria-label'] === '외부 팀 캘린더 불러오기 실패')[0];
    assert.ok(warning, '실패하면 경고 아이콘이 뜬다');
    assert.match(String(warning.props.title), /네트워크가 불안정합니다/);
    assert.match(String(warning.props.title), /마지막 확인/, '마지막 성공 시각도 함께 알려 준다');

    // 일정이 잘려 보일 때는 경고와 구분되는 안내 아이콘을 따로 붙인다.
    assert.equal(
      findElements(tree, (node) => node.props['aria-label'] === '외부 팀 캘린더 일부만 표시').length,
      0,
      '잘리지 않았으면 안내 아이콘도 없다',
    );
    subscriptions[0].lastFetchTruncated = true;
    stateSlots[1] = subscriptions.map((row) => ({ ...row }));
    tree = await renderRail(false);
    const truncatedHint = findElements(tree, (node) => node.props['aria-label'] === '외부 팀 캘린더 일부만 표시')[0];
    assert.ok(truncatedHint, '잘렸으면 안내 아이콘이 뜬다');
    assert.match(String(truncatedHint.props.title), /500개까지만/);
  } finally {
    if (previousApi === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as unknown as { window: unknown }).window = previousApi;
  }
});

test('the rename form appears once, right under its subscription row', async () => {
  resetHarness();
  railSubscribeFormProps = [];
  railConfirmResult = true;

  const subscriptions = [{
    id: 'sub-1',
    name: '외부 팀 캘린더',
    url: 'https://example.com/team.ics',
    color: '#00B894',
    enabled: true,
    lastFetchedAt: '2026-09-01T00:00:00.000Z',
    lastError: null as string | null,
  }];
  const previousApi = (globalThis as { window?: { electronAPI?: unknown } }).window;
  (globalThis as unknown as { window: Record<string, unknown> }).window = {
    electronAPI: {
      icsList: async () => subscriptions.map((row) => ({ ...row })),
      icsUpdate: async () => null,
      onIcsChanged: () => () => {},
    },
    dispatchEvent: () => true,
    CustomEvent: class {},
  };

  try {
    stateSlots = [];
    stateCursor = 0;
    let tree = await renderRail(false, { resetState: true });
    stateSlots[1] = subscriptions.map((row) => ({ ...row }));
    tree = await renderRail(false);

    buttonByLabel(tree, '외부 팀 캘린더 메뉴 열기').props.onClick?.({ stopPropagation() {} });
    tree = await renderRail(false);
    const renameItem = findButtons(tree)
      .filter((button) => button.props.role === 'menuitem')
      .find((button) => textContent(button).trim() === '이름·색 바꾸기');
    assert.ok(renameItem, '이름·색 바꾸기 메뉴가 있다');
    renameItem.props.onClick?.();
    tree = await renderRail(false);

    const isEditForm = (element: { props: Record<string, unknown> }): boolean => (
      element.props['aria-label'] === '구독 이름·색 바꾸기'
    );
    assert.equal(findElements(tree, isEditForm).length, 1, '편집 폼은 정확히 하나만 뜬다');

    const sectionOf = (title: string) => findElements(
      tree,
      (element) => element.type === 'section' && textContent(element).includes(title),
    )[0];

    const subscriptionSection = sectionOf('구독');
    assert.ok(subscriptionSection, '구독 섹션이 있다');
    assert.equal(
      findElements(subscriptionSection, isEditForm).length,
      1,
      '편집 폼은 구독 섹션 안에 있다',
    );

    for (const bflowSection of ['내 캘린더', '팀 전체', '나에게 공유됨']) {
      const section = sectionOf(bflowSection);
      if (!section) continue;
      assert.equal(
        findElements(section, isEditForm).length,
        0,
        `${bflowSection} 섹션에는 편집 폼이 없다`,
      );
    }
  } finally {
    if (previousApi === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as unknown as { window: unknown }).window = previousApi;
  }
});

test('tag chips pop on toggle and the filtered result fades instead of jumping', async () => {
  resetHarness();
  tagBarReducedMotion = false;
  const noopAnchor = () => {};
  try {
    calendarState.enabledTagIds = { 'tag-review': false };
    const tree = await renderTagBar(false, noopAnchor);
    const enabledChip = findButtons(tree).find((button) => button.props['aria-label'] === '회의 태그');
    const disabledChip = findButtons(tree).find((button) => button.props['aria-label'] === '검수 태그');
    assert.ok(enabledChip && disabledChip, '켜진 칩과 꺼진 칩이 모두 렌더된다');
    assert.equal(enabledChip.props['aria-pressed'], true);
    assert.equal(disabledChip.props['aria-pressed'], false);

    assert.deepEqual(
      (enabledChip.props as { animate?: { scale?: number[] } }).animate,
      { scale: [1, 1.12, 1] },
      '켤 때는 살짝 커졌다 돌아온다',
    );
    assert.deepEqual(
      (disabledChip.props as { animate?: { scale?: number[] } }).animate,
      { scale: [1, 0.92, 1] },
      '끌 때는 살짝 작아졌다 돌아온다',
    );
    assert.deepEqual(
      (enabledChip.props as { transition?: unknown }).transition,
      { duration: 0.35, ease: [0.16, 1, 0.3, 1] },
    );

    tagBarReducedMotion = true;
    const reducedTree = await renderTagBar(false, noopAnchor);
    const reducedChip = findButtons(reducedTree).find((button) => button.props['aria-label'] === '회의 태그');
    assert.equal(
      (reducedChip?.props as { animate?: unknown }).animate,
      undefined,
      '동작 줄이기에서는 칩이 튀지 않는다',
    );
    assert.deepEqual((reducedChip?.props as { transition?: unknown }).transition, { duration: 0 });
  } finally {
    tagBarReducedMotion = false;
  }

  // 필터가 바뀌면 결과 컨테이너는 다시 마운트되지 않고 짧게 페이드로 이어진다.
  resetHarness();
  const clock = installScheduleFakeClock();
  const calendarBody = (tree: ReactNode) => findElements(tree, (node) => (
    typeof node.props.className === 'string'
    && node.props.className === 'flex-1 flex flex-col overflow-hidden'
  ))[0];
  try {
    let tree = await renderScheduleView();
    await flushScheduleMountEffects();
    tree = await renderScheduleView();

    const body = calendarBody(tree);
    assert.ok(body, '캘린더 본체 컨테이너가 있다');
    assert.deepEqual((body.props as { animate?: unknown }).animate, { opacity: 1, y: 0 });
    assert.deepEqual(
      (body.props as { transition?: unknown }).transition,
      { duration: 0.2, ease: [0.16, 1, 0.3, 1], opacity: { duration: 0.12 } },
      '보기 전환은 200ms를 유지하고 필터 페이드만 120ms를 쓴다',
    );

    calendarState.toggleTag('tag-meeting');
    tree = await renderScheduleView();
    await flushScheduleMountEffects();
    tree = await renderScheduleView();
    assert.equal(
      (calendarBody(tree)?.props as { animate?: { opacity?: number } }).animate?.opacity,
      0.55,
      '필터가 바뀌면 결과가 잠깐 옅어진다',
    );
    assert.equal(
      calendarBody(tree)?.props.key,
      body.props.key,
      '필터 변화는 컨테이너를 다시 마운트하지 않는다',
    );

    clock.advance(120);
    tree = await renderScheduleView();
    assert.equal(
      (calendarBody(tree)?.props as { animate?: { opacity?: number } }).animate?.opacity,
      1,
      '120ms 뒤에는 원래 농도로 돌아온다',
    );

    // 페이드 도중 OS '동작 줄이기'가 켜져도 반투명으로 굳지 않는다.
    calendarState.toggleTag('tag-review');
    tree = await renderScheduleView();
    await flushScheduleMountEffects();
    tree = await renderScheduleView();
    assert.equal(
      (calendarBody(tree)?.props as { animate?: { opacity?: number } }).animate?.opacity,
      0.55,
      '다시 페이드가 시작된다',
    );

    scheduleReducedMotion = true;
    calendarState.toggleTag('tag-meeting');
    tree = await renderScheduleView();
    await flushScheduleMountEffects();
    tree = await renderScheduleView();
    assert.equal(
      (calendarBody(tree)?.props as { animate?: { opacity?: number } }).animate?.opacity,
      1,
      "페이드 중 '동작 줄이기'가 켜져도 화면이 반투명으로 굳지 않는다",
    );
  } finally {
    scheduleReducedMotion = false;
    clock.restore();
  }
});

test('the event create backdrop dims the background like the calendar settings modal', async () => {
  resetHarness();
  const tree = await renderEventCreateModal(false, () => {});
  const backdrop = findElements(tree, (node) => (
    typeof node.props.className === 'string'
    && node.props.className.includes('fixed inset-0')
    && node.props.className.includes('z-40')
  ))[0];

  assert.ok(backdrop, '생성 모달에도 배경막이 있다');
  assert.match(
    String(backdrop.props.className),
    /bg-black/,
    '배경색 없이 농도만 주면 배경막이 보이지 않는다',
  );
  assert.deepEqual(
    backdrop.props.animate,
    { opacity: 0.16 },
    '캘린더 설정 모달과 같은 농도로 통일한다',
  );
});

test('CalendarGrid fades in the chip tooltip and limits chip hover to transform and filter', async () => {
  resetHarness();
  const clock = installScheduleFakeClock();
  const previousDocument = globalThis.document;
  globalThis.document = { body: {}, addEventListener() {}, removeEventListener() {} } as unknown as Document;

  try {
    const events = [calendarListEvent({ id: 'tooltip-chip', title: '툴팁 대상' })];
    let tree = await renderCalendarGrid(events);
    const chip = findElements(tree, (node) => node.props['data-event-id'] === 'tooltip-chip')[0];
    assert.ok(chip, '월 그리드 칩이 있다');

    const chipClass = String(chip.props.className ?? '');
    assert.match(
      chipClass,
      /transition-\[transform,filter\]/,
      'hover 트랜지션은 transform과 filter로만 제한한다',
    );
    assert.doesNotMatch(chipClass, /transition-all/, 'transition-all은 레이아웃 속성까지 애니메이션한다');

    // 툴팁은 400ms 지연 뒤 나타난다.
    (chip.props.onMouseEnter as ((event: unknown) => void) | undefined)?.({ clientX: 120, clientY: 200 });
    clock.advance(400);
    tree = await renderCalendarGrid(events, {}, true);

    const tooltip = findElements(tree, (node) => (
      typeof node.props.className === 'string' && node.props.className.includes('max-w-[260px]')
    ))[0];
    assert.ok(tooltip, '400ms 뒤 툴팁이 나타난다');
    assert.deepEqual(
      tooltip.props.initial,
      { opacity: 0, scale: 0.96, x: '-50%', y: '-100%' },
      '툴팁은 사라진 상태에서 등장하고 커서 위 중앙 앵커를 유지한다',
    );
    assert.deepEqual(
      tooltip.props.animate,
      { opacity: 1, scale: 1, x: '-50%', y: '-100%' },
      'framer가 transform을 직접 관리하므로 앵커도 motion value로 넘긴다',
    );
    assert.equal(
      (tooltip.props.style as { transform?: unknown }).transform,
      undefined,
      'style의 정적 transform은 덮어써지므로 남겨 두지 않는다',
    );
    assert.deepEqual(
      tooltip.props.transition,
      { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
      '툴팁 등장은 200ms 공용 이징을 쓴다',
    );

    // 동작 줄이기에서는 등장 애니메이션을 쓰지 않는다.
    resetHarness();
    let reducedTree = await renderCalendarGrid(events, { reduceMotion: true });
    const reducedChip = findElements(reducedTree, (node) => node.props['data-event-id'] === 'tooltip-chip')[0];
    (reducedChip.props.onMouseEnter as ((event: unknown) => void) | undefined)?.({ clientX: 120, clientY: 200 });
    clock.advance(400);
    reducedTree = await renderCalendarGrid(events, { reduceMotion: true }, true);
    const reducedTooltip = findElements(reducedTree, (node) => (
      typeof node.props.className === 'string' && node.props.className.includes('max-w-[260px]')
    ))[0];
    assert.ok(reducedTooltip);
    assert.equal(reducedTooltip.props.initial, false, '동작 줄이기에서는 등장 애니메이션을 건너뛴다');
    assert.deepEqual(
      reducedTooltip.props.animate,
      { opacity: 1, scale: 1, x: '-50%', y: '-100%' },
      '동작 줄이기에서도 앵커는 그대로다',
    );
    assert.deepEqual(reducedTooltip.props.transition, { duration: 0 });
  } finally {
    calendarGridEffectCleanups.splice(0).forEach((cleanup) => cleanup());
    globalThis.document = previousDocument;
    clock.restore();
  }
});

test('CalendarGrid gives the month overflow popup modal semantics and closes it with Escape', async () => {
  resetHarness();
  const previousDocument = globalThis.document;
  const documentListeners = new Map<string, Set<(event: Event) => void>>();
  const backgroundTrigger = { isConnected: true, focus: () => { restoredFocus += 1; } };
  let restoredFocus = 0;
  globalThis.document = {
    activeElement: backgroundTrigger,
    addEventListener(type: string, listener: (event: Event) => void) {
      const listeners = documentListeners.get(type) ?? new Set();
      listeners.add(listener);
      documentListeners.set(type, listeners);
    },
    removeEventListener(type: string, listener: (event: Event) => void) {
      documentListeners.get(type)?.delete(listener);
    },
  } as unknown as Document;

  try {
    const events = Array.from({ length: 5 }, (_, index) => calendarListEvent({
      id: `overflow-${index}`,
      title: `겹친 일정 ${index}`,
    }));

    let tree = await renderCalendarGrid(events, { maxVisibleBars: 2 });
    const moreButton = buttonByText(tree, '더보기');
    moreButton.props.onClick?.({
      stopPropagation() {},
      target: { getBoundingClientRect: () => ({ left: 40, bottom: 120 }) },
    } as never);

    tree = await renderCalendarGrid(events, { maxVisibleBars: 2 }, true);
    const popup = findElements(tree, (candidate) => candidate.props.role === 'dialog')[0];
    assert.ok(popup, '월 보기 "+N 더보기" 팝업이 열린다');
    assert.equal(
      popup.props['aria-modal'],
      'true',
      '팝업이 aria-modal 대화상자여야 배경 캘린더 단축키(C/W/M/?)가 뒤에서 열리지 않는다',
    );
    assert.match(String(popup.props['aria-label'] ?? ''), /일정 목록$/);

    assert.equal(popup.props.tabIndex, -1, '팝업 자체가 포커스를 받을 수 있어야 한다');
    assert.ok(
      buttonByLabel(tree, `${String(popup.props['aria-label'])} 닫기`),
      '키보드로 닿을 수 있는 닫기 버튼이 팝업 안에 있다',
    );

    let tabPrevented = false;
    (popup.props.onKeyDown as ((event: unknown) => void) | undefined)?.({
      key: 'Tab',
      shiftKey: false,
      preventDefault() { tabPrevented = true; },
    });
    assert.equal(tabPrevented, true, 'Tab이 팝업 안에 머물고 뒤쪽 캘린더로 빠져나가지 않는다');

    flushCalendarGridEffects();
    const escapeListeners = documentListeners.get('keydown');
    assert.equal(escapeListeners?.size, 1, '팝업이 자기 Escape 닫기를 직접 소유한다');
    let defaultPrevented = false;
    for (const listener of escapeListeners ?? []) {
      listener({ key: 'Escape', preventDefault() { defaultPrevented = true; }, stopPropagation() {} } as unknown as Event);
    }
    assert.equal(defaultPrevented, true);

    tree = await renderCalendarGrid(events, { maxVisibleBars: 2 }, true);
    assert.equal(
      findElements(tree, (candidate) => candidate.props.role === 'dialog').length,
      0,
      'Escape로 팝업이 닫힌다',
    );
    calendarGridEffectCleanups.splice(0).forEach((cleanup) => cleanup());
    assert.equal(restoredFocus, 1, '팝업이 닫히면 포커스를 원래 트리거로 돌려준다');
  } finally {
    calendarGridEffectCleanups.splice(0).forEach((cleanup) => cleanup());
    globalThis.document = previousDocument;
  }
});

test('CalendarGrid renders a source-aware external-change ring and keeps reduced motion static', async () => {
  const bflow = calendarListEvent({
    id: 'shared-highlight-id',
    title: 'B flow 일정',
    source: 'bflow',
    sourceCalendarId: 'bflow:mine',
    calendarId: 'mine',
  });
  const google = calendarListEvent({
    id: 'shared-highlight-id',
    title: 'Google 일정',
    source: 'google',
    sourceCalendarId: 'primary',
    calendarId: undefined,
  });
  const highlighted = new Set(['google\u0000primary\u0000shared-highlight-id']);

  const animatedTree = await renderCalendarGrid([bflow, google], {
    highlightedEventIdentities: highlighted,
    reduceMotion: false,
  });
  const animatedBars = findElements(animatedTree, (element) => element.props['data-event-identity'] !== undefined);
  const bflowBar = animatedBars.find((element) => element.props['data-event-identity'] === 'bflow\u0000shared-highlight-id');
  const googleBar = animatedBars.find((element) => element.props['data-event-identity'] === 'google\u0000primary\u0000shared-highlight-id');
  assert.ok(bflowBar);
  assert.ok(googleBar);
  assert.equal(bflowBar.props['data-realtime-highlight'], undefined, 'same raw id from B flow is not targeted');
  assert.equal(googleBar.props['data-realtime-highlight'], 'true', 'the exact Google storage identity receives the ring');
  assert.match(String(googleBar.props.className), /calendar-realtime-highlight(?!-static)/);

  const staticTree = await renderCalendarGrid([google], {
    highlightedEventIdentities: highlighted,
    reduceMotion: true,
  });
  const staticBar = findElements(staticTree, (element) => element.props['data-realtime-highlight'] === 'true')[0];
  assert.ok(staticBar);
  assert.match(String(staticBar.props.className), /calendar-realtime-highlight-static/);
  assert.doesNotMatch(String(staticBar.props.className), /calendar-realtime-highlight(?!-static)/, 'reduced motion omits the pulse animation class');
});

test('CalendarGrid keeps same-id rows keyed and ghosted by source identity and forwards the dragged event object', async () => {
  const bflow = calendarListEvent({
    id: 'grid-shared-id',
    title: 'B flow 일정',
    source: 'bflow',
    sourceCalendarId: 'bflow:mine',
    calendarId: 'mine',
    isReadOnly: false,
  });
  const google = calendarListEvent({
    id: 'grid-shared-id',
    title: 'Google 일정',
    source: 'google',
    sourceCalendarId: 'primary',
    calendarId: undefined,
    isReadOnly: false,
  });
  const targetIdentity: ScheduleEventIdentity = {
    id: bflow.id,
    source: bflow.source,
    sourceCalendarId: bflow.sourceCalendarId,
  };
  const dragged: Array<{ event: ScheduleCalendarEvent; mode: string; anchorDate: string }> = [];
  const listeners = new Map<string, (event: { clientX: number; clientY: number }) => void>();
  const globalScope = globalThis as typeof globalThis & { document?: unknown };
  const hadDocument = Object.prototype.hasOwnProperty.call(globalScope, 'document');
  const priorDocument = globalScope.document;
  globalScope.document = {
    addEventListener(type: string, listener: (event: { clientX: number; clientY: number }) => void) {
      listeners.set(type, listener);
    },
    removeEventListener(type: string) {
      listeners.delete(type);
    },
    elementFromPoint() {
      return null;
    },
  };
  try {
    const ghostTree = await renderCalendarGrid([bflow, google], {
      dragPreview: {
        eventId: bflow.id,
        newStartDate: '2026-08-26',
        newEndDate: '2026-08-26',
      },
      draggedEventIdentity: targetIdentity,
      isDragging: true,
      onDragStart(event, mode, anchorDate) {
        dragged.push({ event, mode, anchorDate });
      },
    });
    const bars = findElements(ghostTree, (candidate) => candidate.props['data-event-id'] === 'grid-shared-id');
    assert.equal(bars.length, 2, 'both provider rows render');
    assert.equal(
      new Set(bars.map((bar) => bar.props['data-event-identity'])).size,
      2,
      'the same source-aware identity used by React keys stays unique per provider row',
    );
    assert.equal(
      bars.filter((bar) => String(bar.props.className).includes('pointer-events-none')).length,
      1,
      'only the selected identity becomes the drag ghost',
    );

    const interactiveTree = await renderCalendarGrid([bflow, google], {
      onDragStart(event, mode, anchorDate) {
        dragged.push({ event, mode, anchorDate });
      },
    });
    const bflowBar = findElements(
      interactiveTree,
      (candidate) => candidate.props['data-event-id'] === bflow.id
        && textContent(candidate).includes('B flow 일정'),
    ).find((bar) => textContent(bar).includes('B flow 일정'));
    assert.ok(bflowBar);
    const target = {
      style: {} as Record<string, string>,
      getBoundingClientRect: () => ({ left: 0, width: 100 }),
    };
    const onMouseDown = bflowBar.props.onMouseDown as (event: Record<string, unknown>) => void;
    onMouseDown({
      button: 0,
      clientX: 50,
      clientY: 20,
      preventDefault() {},
      stopPropagation() {},
      currentTarget: target,
    });
    listeners.get('mousemove')?.({ clientX: 60, clientY: 20 });

    assert.deepEqual(dragged, [{ event: bflow, mode: 'move', anchorDate: bflow.startDate }]);
  } finally {
    if (hadDocument) globalScope.document = priorDocument;
    else delete globalScope.document;
  }
});

test('todo affordances only infer cal_* links for local B flow rows', async () => {
  resetHarness();
  const googleCollision = calendarListEvent({
    id: 'cal_todo-source-fence',
    title: 'Google cal ID 충돌',
    type: 'custom',
    source: 'google',
    sourceCalendarId: 'primary',
    calendarId: undefined,
    linkedTodoId: undefined,
  });
  const localLegacy = calendarListEvent({
    ...googleCollision,
    title: '로컬 B flow 할일 일정',
    source: undefined,
    sourceCalendarId: undefined,
  });
  const explicitGoogle = calendarListEvent({
    ...googleCollision,
    id: 'google-explicit-link',
    title: '명시적으로 연결된 Google 일정',
    linkedTodoId: 'todo-explicit',
  });

  const grid = await renderCalendarGrid([googleCollision, localLegacy, explicitGoogle]);
  const barFor = (title: string) => findElements(grid, (element) => (
    element.props['data-event-id'] !== undefined && textContent(element).includes(title)
  ))[0];
  const linkedIconCount = (title: string) => findElements(
    barFor(title),
    (element) => element.props['data-linked-todo-icon'] === true,
  ).length;
  assert.equal(linkedIconCount(googleCollision.title), 0, 'a Google cal_* ID alone does not render the todo icon');
  assert.equal(linkedIconCount(localLegacy.title), 1, 'legacy local cal_* rows keep the inferred todo icon');
  assert.equal(linkedIconCount(explicitGoogle.title), 1, 'an explicit linkedTodoId works for every provider');

  const googlePanel = await renderEventSidePanel(googleCollision);
  assert.equal(
    findButtons(googlePanel).some((button) => textContent(button) === '할일로 이동'),
    false,
    'a metadata-less Google cal_* row cannot expose todo navigation',
  );

  const priorWindow = globalThis.window;
  const navigations: Array<{ todoId?: string }> = [];
  Object.assign(globalThis, {
    window: {
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent(event: CustomEvent<{ todoId?: string }>) {
        navigations.push(event.detail);
        return true;
      },
    },
  });
  try {
    const explicitPanel = await renderEventSidePanel(explicitGoogle);
    const todoButton = findButtons(explicitPanel).find((button) => textContent(button) === '할일로 이동');
    assert.ok(todoButton, 'explicit Google todo links keep the navigation button');
    todoButton.props.onClick?.({ stopPropagation() {} });
    await new Promise<void>((resolve) => setTimeout(resolve, 320));
    assert.deepEqual(navigations, [{ todoId: 'todo-explicit' }], 'panel navigation dispatches the explicit todo identity');
  } finally {
    globalThis.window = priorWindow;
  }
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

test('ScheduleView shows the mini calendar in every view and navigates instead of creating', async () => {
  resetHarness();
  let tree = await renderScheduleView();
  await flushScheduleMountEffects();
  buttonByTitle(tree, '사이드바 펼치기').props.onClick?.();
  tree = await renderScheduleView();

  assert.equal(
    findElements(tree, (node) => node.props['data-testid'] === 'mini-calendar').length,
    1,
    '월 보기에도 미니 달력이 있다',
  );

  scheduleMiniCalendarProps.at(-1)?.onDateSelect('2026-08-11');
  tree = await renderScheduleView();
  assert.equal(scheduleCreateModalProps.length, 0, '미니 달력 클릭은 새 일정 창을 열지 않는다');
  assert.equal(scheduleGridProps.at(-1)?.pulseDate, '2026-08-11', '고른 날짜로 이동해 펄스로 알린다');
  assert.equal(scheduleGridProps.at(-1)?.focusedDate, '2026-08-11', '월 보기는 그 날짜를 포커스로 잡는다');

  // 주간 보기: 미니 달력과 주간 사이드바가 함께 보이고 현재 주를 하이라이트한다.
  resetHarness();
  scheduleLocalStorage.set('bflow_calendar_view_v1', JSON.stringify({ viewMode: 'week', weekSubMode: 'card' }));
  tree = await renderScheduleView();
  await flushScheduleMountEffects();
  buttonByTitle(tree, '사이드바 펼치기').props.onClick?.();
  tree = await renderScheduleView();

  assert.equal(
    findElements(tree, (node) => node.props['data-testid'] === 'mini-calendar').length,
    1,
    '주간 보기에도 미니 달력이 있다',
  );
  assert.equal(
    findElements(tree, (node) => node.props['data-testid'] === 'week-sidebar').length,
    1,
    '기존 주간 사이드바는 미니 달력 아래에 그대로 남는다',
  );
  const weekStart = scheduleMiniCalendarProps.at(-1)?.activeWeekStart;
  assert.ok(weekStart, '주간 보기는 보고 있는 주를 미니 달력에 표시한다');
  assert.equal(new Date(`${weekStart}T12:00:00`).getDay(), 0, '주 하이라이트는 일요일에서 시작한다');

  // 오늘 보기: 미니 달력과 일간 사이드바가 함께 보이고 그 날짜를 표시한다.
  resetHarness();
  scheduleLocalStorage.set('bflow_calendar_view_v1', JSON.stringify({ viewMode: 'today', weekSubMode: 'card' }));
  tree = await renderScheduleView();
  await flushScheduleMountEffects();
  buttonByTitle(tree, '사이드바 펼치기').props.onClick?.();
  tree = await renderScheduleView();

  assert.equal(
    findElements(tree, (node) => node.props['data-testid'] === 'mini-calendar').length,
    1,
    '오늘 보기에도 미니 달력이 있다',
  );
  assert.equal(
    findElements(tree, (node) => node.props['data-testid'] === 'day-sidebar').length,
    1,
    '기존 일간 사이드바는 미니 달력 아래에 그대로 남는다',
  );
  assert.match(
    String(scheduleMiniCalendarProps.at(-1)?.selectedDate ?? ''),
    /^\d{4}-\d{2}-\d{2}$/,
    '오늘 보기는 보고 있는 날짜를 미니 달력에 표시한다',
  );
  assert.equal(scheduleMiniCalendarProps.at(-1)?.activeWeekStart, undefined);
});

test('browsing months in the mini calendar does not drag the weekly view along', async () => {
  resetHarness();
  scheduleLocalStorage.set('bflow_calendar_view_v1', JSON.stringify({ viewMode: 'week', weekSubMode: 'card' }));
  let tree = await renderScheduleView();
  await flushScheduleMountEffects();
  buttonByTitle(tree, '사이드바 펼치기').props.onClick?.();
  tree = await renderScheduleView();

  const headerBefore = textContent(tree);
  const weekStartBefore = scheduleMiniCalendarProps.at(-1)?.activeWeekStart;
  const weekIndexBefore = scheduleWeekScrollProps.at(-1)?.activeWeekIndex;
  assert.ok(weekStartBefore);

  // 연도 경계를 넘겨 '구경만' 한다 — 클릭은 하지 않았다.
  scheduleMiniCalendarProps.at(-1)?.onMonthChange(new Date(2027, 0, 1));
  tree = await renderScheduleView();

  assert.equal(textContent(tree), headerBefore, '본화면 헤더는 그대로다');
  assert.equal(scheduleWeekScrollProps.at(-1)?.activeWeekIndex, weekIndexBefore, '보고 있는 주도 그대로다');
  assert.equal(
    scheduleMiniCalendarProps.at(-1)?.currentMonth.getFullYear(),
    2027,
    '미니 달력만 넘겨 본 달을 따라간다',
  );
  assert.equal(scheduleMiniCalendarProps.at(-1)?.currentMonth.getMonth(), 0);

  // 날짜를 실제로 고르면 기존대로 본화면이 따라 움직인다.
  scheduleMiniCalendarProps.at(-1)?.onDateSelect('2027-01-13');
  tree = await renderScheduleView();
  assert.notEqual(
    scheduleWeekScrollProps.at(-1)?.activeWeekIndex,
    weekIndexBefore,
    '날짜 클릭 이동은 기존대로 동작한다',
  );
});

test('ScheduleView opens quick edit from a right click in the weekly, timetable and today views', async () => {
  const mouse = (clientX: number, clientY: number) => ({
    preventDefault() {},
    stopPropagation() {},
    clientX,
    clientY,
  });
  const todayStr = scheduleFmtDate(new Date());

  const cases = [
    {
      label: '주간 카드',
      stored: { viewMode: 'week', weekSubMode: 'card' },
      read: () => scheduleWeekScrollProps.at(-1)?.onEventContextMenu,
      position: { x: 120, y: 240 },
    },
    {
      label: '주간 시간표',
      stored: { viewMode: 'week', weekSubMode: 'timegrid' },
      read: () => scheduleTimeGridProps.at(-1)?.onEventContextMenu,
      position: { x: 310, y: 180 },
    },
    {
      label: '오늘 카드',
      stored: { viewMode: 'today', weekSubMode: 'card' },
      read: () => scheduleDayScrollProps.at(-1)?.onEventContextMenu,
      position: { x: 64, y: 96 },
    },
  ] as const;

  for (const { label, stored, read, position } of cases) {
    resetHarness();
    scheduleLocalStorage.set('bflow_calendar_view_v1', JSON.stringify(stored));
    const target = calendarListEvent({
      id: 'context-menu-target',
      title: '우클릭할 일정',
      startDate: todayStr,
      endDate: todayStr,
    });
    scheduleCanonicalEvents = [target];

    await renderScheduleView();
    await flushScheduleMountEffects();
    await renderScheduleView();

    const onEventContextMenu = read();
    assert.ok(onEventContextMenu, `${label} 보기도 우클릭 빠른 편집을 연결한다`);

    onEventContextMenu(target, mouse(position.x, position.y));
    await renderScheduleView();

    const quickEdit = scheduleQuickEditProps.at(-1);
    assert.ok(quickEdit, `${label} 우클릭이 빠른 편집을 연다`);
    assert.equal(quickEdit.event.id, target.id);
    assert.deepEqual(quickEdit.position, position, `${label} 빠른 편집은 눌린 좌표에서 열린다`);
  }
});

test('quick edit closing animation is owned by exactly one presence boundary', () => {
  // framer-motion 10.x는 중첩 AnimatePresence로 exit를 전파하지 않는다. 빠른 편집이
  // 자기 자신을 감싸면 닫힘 애니메이션이 죽으므로, presence는 ScheduleView가 소유한다.
  const quickEditSource = readFileSync('src/components/calendar/EventQuickEdit.tsx', 'utf8');
  const scheduleSource = readFileSync('src/views/ScheduleView.tsx', 'utf8');

  assert.doesNotMatch(
    quickEditSource,
    /<AnimatePresence/,
    '빠른 편집은 자기 presence를 소유하지 않는다',
  );
  assert.match(
    quickEditSource,
    /exit=\{\{ opacity: 0, scale: 0\.95 \}\}/,
    '빠른 편집 motion.div는 exit 상태를 유지한다',
  );
  assert.match(
    scheduleSource,
    /<AnimatePresence>\s*\{quickEdit && \(/,
    'ScheduleView의 조건부 렌더가 presence 경계를 소유한다',
  );
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

  assert.deepEqual(scheduleUpdateCalls, [{
    id: before.id,
    updates: { calendarId: 'editable-share' },
    targetIdentity: {
      id: before.id,
      source: before.source,
      sourceCalendarId: before.sourceCalendarId,
    },
  }]);
  assert.equal(scheduleGetEventsCalls, 1, 'a successful write is followed by a canonical cache read');
  assert.deepEqual(schedulePanelProps.at(-1)?.event, scheduleCanonicalEvents[0], 'panel uses re-derived color, source and permissions');

  await panel.onUpdate(before.id, { startDate: '2026-08-26', endDate: '2026-08-25' });

  assert.deepEqual(scheduleUpdateCalls.at(-1), {
    id: before.id,
    updates: { startDate: '2026-08-25', endDate: '2026-08-26' },
    targetIdentity: {
      id: before.id,
      source: before.source,
      sourceCalendarId: before.sourceCalendarId,
    },
  }, 'a complete crossing date pair reaches the existing ScheduleView swap');
  assert.equal(scheduleGetEventsCalls, 2);
});

test('ScheduleView drag reconciliation follows a moved B flow row but rejects a same-id Google row', async () => {
  resetHarness();
  const before: ScheduleCalendarEvent = {
    id: 'drag-shared-id',
    title: '드래그 전 일정',
    memo: 'B flow 원본 메모',
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
  scheduleCanonicalEvents = [before];

  await renderScheduleView();
  stateSlots[0] = [before];
  await renderScheduleView();
  scheduleGridProps.at(-1)?.onEventClick(before);
  scheduleGridProps.at(-1)?.onEventContextMenu(before, {
    preventDefault() {},
    stopPropagation() {},
    clientX: 120,
    clientY: 180,
  });
  await renderScheduleView();

  const moved: ScheduleCalendarEvent = {
    ...before,
    title: '다른 B flow 캘린더로 이동',
    memo: '이동 뒤 정본 메모',
    sourceCalendarId: 'bflow:editable-share',
    calendarId: 'editable-share',
    startDate: '2026-08-26',
    endDate: '2026-08-26',
  };
  scheduleGridProps.at(-1)?.onDragStart(before, 'move', before.startDate);
  assert.ok(scheduleDragDoneHandler, 'the real ScheduleView drag completion handler is wired into the DnD hook');
  scheduleCanonicalEvents = [moved];
  await scheduleDragDoneHandler(before.id, moved.startDate, moved.endDate);
  await renderScheduleView();

  assert.deepEqual(scheduleUpdateCalls.at(-1)?.targetIdentity, {
    id: before.id,
    source: before.source,
    sourceCalendarId: before.sourceCalendarId,
  }, 'drag persistence receives the exact row selected at drag start');
  assert.deepEqual(schedulePanelProps.at(-1)?.event, moved, 'a globally unique B flow UUID follows a calendar move');
  assert.deepEqual(scheduleQuickEditProps.at(-1)?.event, moved, 'quick edit follows the same moved B flow row');

  const crossStorage: ScheduleCalendarEvent = {
    ...moved,
    title: 'Google 저장소의 동일 ID 일정',
    memo: '노출되거나 할일에 동기화되면 안 되는 메모',
    source: 'google',
    sourceCalendarId: 'primary',
    calendarId: undefined,
    linkedTodoId: 'google-todo',
  };
  scheduleGridProps.at(-1)?.onDragStart(moved, 'move', moved.startDate);
  scheduleCanonicalEvents = [crossStorage];
  schedulePanelProps = [];
  scheduleQuickEditProps = [];
  scheduleTodoSyncCalls.length = 0;
  assert.ok(scheduleDragDoneHandler);
  await scheduleDragDoneHandler(moved.id, '2026-08-27', '2026-08-27');
  await new Promise<void>((resolve) => setImmediate(resolve));
  await renderScheduleView();

  assert.deepEqual(scheduleGridProps.at(-1)?.events, [crossStorage], 'the Google row remains independently visible');
  assert.equal(schedulePanelProps.length, 0, 'the old B flow panel closes instead of adopting Google data');
  assert.equal(scheduleQuickEditProps.length, 0, 'the old B flow quick edit closes instead of adopting Google data');
  assert.deepEqual(scheduleTodoSyncCalls, [], 'the unrelated Google row never drives B flow todo reverse-sync');
});

test('ScheduleView direct update reconciliation rejects a same-id row from another storage source', async () => {
  resetHarness();
  const before: ScheduleCalendarEvent = {
    id: 'direct-shared-id',
    title: '직접 편집 전 일정',
    memo: 'B flow 원본 메모',
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
  scheduleCanonicalEvents = [before];

  await renderScheduleView();
  stateSlots[0] = [before];
  await renderScheduleView();
  scheduleGridProps.at(-1)?.onEventClick(before);
  scheduleGridProps.at(-1)?.onEventContextMenu(before, {
    preventDefault() {},
    stopPropagation() {},
    clientX: 140,
    clientY: 200,
  });
  await renderScheduleView();
  const panel = schedulePanelProps.at(-1);
  assert.ok(panel);

  const crossStorage: ScheduleCalendarEvent = {
    ...before,
    title: 'Google 저장소의 동일 ID 일정',
    memo: '직접 편집 뒤 채택되면 안 되는 메모',
    source: 'google',
    sourceCalendarId: 'primary',
    calendarId: undefined,
    linkedTodoId: 'google-todo',
  };
  scheduleCanonicalEvents = [crossStorage];
  schedulePanelProps = [];
  scheduleQuickEditProps = [];
  scheduleTodoSyncCalls.length = 0;
  await panel.onUpdate(before.id, { title: '저장 요청 제목' });
  await new Promise<void>((resolve) => setImmediate(resolve));
  await renderScheduleView();

  assert.deepEqual(scheduleUpdateCalls.at(-1)?.targetIdentity, {
    id: before.id,
    source: before.source,
    sourceCalendarId: before.sourceCalendarId,
  }, 'direct edits keep the panel row identity through the service boundary');
  assert.deepEqual(scheduleGridProps.at(-1)?.events, [crossStorage], 'the canonical list can still contain the independent Google row');
  assert.equal(schedulePanelProps.length, 0, 'the B flow panel closes instead of adopting same-id Google data');
  assert.equal(scheduleQuickEditProps.length, 0, 'the B flow quick edit closes instead of adopting same-id Google data');
  assert.deepEqual(scheduleTodoSyncCalls, [], 'the unrelated Google row never drives B flow todo reverse-sync');
});

test('ScheduleView never infers todo side effects from a metadata-less Google cal_* ID', async (t) => {
  const googleEvent = calendarListEvent({
    id: 'cal_google-provider-id',
    title: 'Google 제공자 ID 일정',
    type: 'custom',
    source: 'google',
    sourceCalendarId: 'primary',
    calendarId: undefined,
    linkedTodoId: undefined,
    canEdit: true,
    isReadOnly: false,
  });

  await t.test('direct edit does not reverse-sync a guessed todo', async () => {
    resetHarness();
    scheduleCanonicalEvents = [{ ...googleEvent, title: '수정된 Google 일정' }];
    await renderScheduleView();
    stateSlots[0] = [googleEvent];
    await renderScheduleView();
    scheduleGridProps.at(-1)?.onEventClick(googleEvent);
    await renderScheduleView();
    const panel = schedulePanelProps.at(-1);
    assert.ok(panel);
    await panel.onUpdate(googleEvent.id, { title: '수정된 Google 일정' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(scheduleTodoSyncCalls, []);
  });

  await t.test('drag does not reverse-sync a guessed todo', async () => {
    resetHarness();
    scheduleCanonicalEvents = [{
      ...googleEvent,
      startDate: '2026-08-26',
      endDate: '2026-08-26',
    }];
    await renderScheduleView();
    stateSlots[0] = [googleEvent];
    await renderScheduleView();
    scheduleGridProps.at(-1)?.onDragStart(googleEvent, 'move', googleEvent.startDate);
    assert.ok(scheduleDragDoneHandler);
    await scheduleDragDoneHandler(googleEvent.id, '2026-08-26', '2026-08-26');
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(scheduleTodoSyncCalls, []);
  });

  await t.test('delete does not unlink a guessed todo', async () => {
    resetHarness();
    await renderScheduleView();
    stateSlots[0] = [googleEvent];
    await renderScheduleView();
    scheduleGridProps.at(-1)?.onEventClick(googleEvent);
    await renderScheduleView();
    const panel = schedulePanelProps.at(-1);
    assert.ok(panel);
    await panel.onDelete(googleEvent.id);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(scheduleTodoSyncCalls, []);
  });

  await t.test('explicit Google todo metadata still reverse-syncs', async () => {
    resetHarness();
    const explicitlyLinked = { ...googleEvent, id: 'google-explicit', linkedTodoId: 'todo-explicit' };
    scheduleCanonicalEvents = [{ ...explicitlyLinked, title: '명시 연결 수정' }];
    await renderScheduleView();
    stateSlots[0] = [explicitlyLinked];
    await renderScheduleView();
    scheduleGridProps.at(-1)?.onEventClick(explicitlyLinked);
    await renderScheduleView();
    const panel = schedulePanelProps.at(-1);
    assert.ok(panel);
    await panel.onUpdate(explicitlyLinked.id, { title: '명시 연결 수정' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(scheduleTodoSyncCalls.at(-1)?.todoId, 'todo-explicit');
  });
});

test('ScheduleView delete keeps the selected row identity and preserves same-id siblings', async () => {
  resetHarness();
  const bflow: ScheduleCalendarEvent = {
    id: 'delete-shared-id',
    title: '삭제할 B flow 일정',
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
  const google: ScheduleCalendarEvent = {
    ...bflow,
    title: '보존할 Google 일정',
    source: 'google',
    sourceCalendarId: 'primary',
    calendarId: undefined,
    linkedTodoId: 'unrelated-google-todo',
  };

  await renderScheduleView();
  stateSlots[0] = [google, bflow];
  await renderScheduleView();
  scheduleGridProps.at(-1)?.onEventClick(bflow);
  await renderScheduleView();
  const panel = schedulePanelProps.at(-1);
  assert.ok(panel);

  await panel.onDelete(bflow.id);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await renderScheduleView();

  assert.deepEqual(scheduleDeleteCalls, [{
    id: bflow.id,
    targetIdentity: {
      id: bflow.id,
      source: bflow.source,
      sourceCalendarId: bflow.sourceCalendarId,
    },
  }]);
  assert.deepEqual(scheduleGridProps.at(-1)?.events, [google], 'only the selected storage row leaves local state');
  assert.deepEqual(scheduleTodoSyncCalls, [], 'a same-id sibling cannot drive todo unlinking');
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

test('ScheduleView duplicates a subscribed (ICS) event into the editable personal calendar', async () => {
  resetHarness();
  const subscribed: ScheduleCalendarEvent = {
    id: 'ics:sub-1:ext-1:2026-08-25',
    title: '외부 세미나',
    memo: '',
    color: '#00B894',
    type: 'custom',
    startDate: '2026-08-25',
    endDate: '2026-08-25',
    createdBy: '외부 팀 캘린더',
    createdAt: '2026-08-24T00:00:00.000Z',
    source: 'ics',
    sourceCalendarId: 'ics:sub-1',
    canEdit: false,
    isReadOnly: true,
  };

  await renderScheduleView();
  stateSlots[0] = [subscribed];
  await renderScheduleView();
  scheduleGridProps.at(-1)?.onEventContextMenu(subscribed, {
    preventDefault() {},
    stopPropagation() {},
    clientX: 100,
    clientY: 120,
  });
  await renderScheduleView();
  const quickEdit = scheduleQuickEditProps.at(-1);
  assert.ok(quickEdit);
  await quickEdit.onDuplicate(subscribed);

  assert.equal(scheduleAddedEvents.length, 1);
  assert.equal(
    scheduleAddedEvents[0].calendarId,
    'mine',
    '구독 일정 복사는 편집 가능한 개인 캘린더로 간다',
  );
  assert.equal(scheduleAddedEvents[0].source, undefined);
  assert.equal(scheduleAddedEvents[0].sourceCalendarId, undefined);
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

test('CalendarSettingsModal updates calendar metadata and event presentation before deferred IPC settles', async (t) => {
  await t.test('create adds a non-persistable local placeholder to the rail immediately', async () => {
    resetHarness();
    settingsApiGate = new Promise<void>((resolve) => { resolveSettingsApiGate = resolve; });
    let tree = await renderCalendarSettingsModal();
    formElementByLabel(tree, '캘린더 이름').props.onChange?.({
      target: { value: '즉시 보이는 캘린더', checked: false },
    });
    tree = await renderCalendarSettingsModal();

    const pendingSave = buttonByText(tree, '저장').props.onClick?.();

    const optimistic = calendarState.calendars.find((item) => item.name === '즉시 보이는 캘린더');
    assert.ok(optimistic, 'the rail store changes in the same turn instead of waiting for IPC');
    assert.match(optimistic.id, /^optimistic-calendar:/, 'the placeholder is visibly local, not a fake server UUID');
    assert.equal(optimistic.canEdit, false, 'events cannot be persisted against the local-only placeholder');
    assert.match(textContent(await renderRail(false, { resetState: true })), /즉시 보이는 캘린더/);
    assert.deepEqual(settingsApiCalls[0].args, [{
      name: '즉시 보이는 캘린더',
      color: '#6C5CE7',
      visibility: 'members',
      members: [],
    }], 'the local placeholder id never crosses the persistence boundary');

    resolveSettingsApiGate?.();
    await pendingSave;
    assert.ok(calendarState.calendars.some((item) => item.id === 'created-calendar'));
    assert.equal(calendarState.calendars.some((item) => item.id === optimistic.id), false);
  });

  await t.test('name, color, and visibility update the rail and cached event tint immediately', async () => {
    resetHarness();
    const editable = calendar({
      id: 'deferred-update',
      name: '수정 전',
      ownerId: myUserId,
      visibility: 'members',
      color: '#6C5CE7',
      canManage: true,
    });
    let tree = await renderCalendarSettingsModal(editable, 1);
    settingsCachedEvents = [calendarListEvent({
      id: 'deferred-event',
      calendarId: editable.id,
      sourceCalendarId: `bflow:${editable.id}`,
      color: '#6C5CE7',
    })];
    settingsApiGate = new Promise<void>((resolve) => { resolveSettingsApiGate = resolve; });
    formElementByLabel(tree, '캘린더 이름').props.onChange?.({
      target: { value: '수정 즉시', checked: false },
    });
    buttonByLabel(tree, '색상 #74B9FF').props.onClick?.();
    formElementByLabel(tree, '팀 전체').props.onChange?.({
      target: { value: 'team', checked: true },
    });
    tree = await renderCalendarSettingsModal(editable, 1);

    const pendingSave = buttonByText(tree, '저장').props.onClick?.();

    const optimistic = calendarState.calendars.find((item) => item.id === editable.id);
    assert.deepEqual(
      optimistic && { name: optimistic.name, color: optimistic.color, visibility: optimistic.visibility },
      { name: '수정 즉시', color: '#74B9FF', visibility: 'team' },
    );
    const rail = await renderRail(false, { resetState: true });
    assert.match(textContent(rail), /팀 전체.*수정 즉시/);
    assert.equal(buttonByLabel(rail, '수정 즉시 표시').props.style?.backgroundColor, '#74B9FF');
    assert.equal(settingsCachedEvents[0]?.color, '#74B9FF', 'existing event chips derive the new calendar tint without an event reload');
    assert.equal(settingsPresentationRefreshCount, 1);
    assert.deepEqual(settingsApiCalls.map((call) => call.name), ['calendarUpdate']);

    resolveSettingsApiGate?.();
    await pendingSave;
  });

  await t.test('delete removes the rail row and its cached events while IPC is pending', async () => {
    resetHarness();
    const editable = calendar({ id: 'deferred-delete', name: '즉시 삭제', canManage: true });
    const tree = await renderCalendarSettingsModal(editable, 1);
    settingsCachedEvents = [calendarListEvent({
      id: 'deleted-calendar-event',
      calendarId: editable.id,
      sourceCalendarId: `bflow:${editable.id}`,
    })];
    settingsConfirmResponses = [true];
    settingsApiGate = new Promise<void>((resolve) => { resolveSettingsApiGate = resolve; });

    const pendingDelete = buttonByText(tree, '캘린더 삭제').props.onClick?.();
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(calendarState.calendars.some((item) => item.id === editable.id), false);
    assert.doesNotMatch(textContent(await renderRail(false, { resetState: true })), /즉시 삭제/);
    assert.deepEqual(settingsCachedEvents, [], 'known-calendar filtering hides deleted calendar events immediately');
    assert.deepEqual(settingsApiCalls.map((call) => call.name), ['calendarDelete']);

    resolveSettingsApiGate?.();
    await pendingDelete;
  });
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
    settingsBflowMetadataFresh = false;
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

  await t.test('fresh canonical metadata settles the mutation even when event-row refresh fails', async () => {
    resetHarness();
    settingsBflowReloadResult = false;
    settingsBflowMetadataFresh = true;
    let tree = await renderCalendarSettingsModal(shared, 14);
    buttonByLabel(tree, '색상 #74B9FF').props.onClick?.();
    tree = await renderCalendarSettingsModal(shared, 14);
    await buttonByText(tree, '저장').props.onClick?.();

    assert.deepEqual(settingsApiCalls.map((call) => call.name), [
      'calendarUpdate', 'loadBflowEvents',
    ]);
    assert.equal(settingsCloseCount, 1, 'fresh calendar metadata is sufficient to adopt the committed update');
    assert.equal(settingsToastErrors.length, 0);
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

test('CalendarSettingsModal rejects handlers captured by a previous calendar actor', async (t) => {
  await t.test('a deferred delete confirmation cannot cross an A to B session switch', async () => {
    resetHarness();
    const actorA = settingsCurrentUser;
    const actorB = settingsUsers.find((user) => user.id === 'user-jang');
    assert.ok(actorB);
    const calendarA = calendar({
      id: 'confirm-actor-a',
      name: 'A 비공개 일정',
      ownerId: actorA.id,
      canManage: true,
    });
    const calendarB = calendar({
      id: 'confirm-actor-b',
      name: 'B 캘린더',
      ownerId: actorB.id,
      canManage: true,
    });
    settingsConfirmResponses = [true];
    settingsConfirmGate = new Promise<void>((resolve) => {
      resolveSettingsConfirmGate = resolve;
    });
    const treeA = await renderCalendarSettingsModal(calendarA, 3);

    const pendingDelete = buttonByText(treeA, '캘린더 삭제').props.onClick?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(settingsConfirmMessages.length, 1, 'the destructive prompt is actually pending');

    settingsCurrentUser = actorB;
    calendarState.calendars = [calendarB];
    settingsCanonicalCalendars = [calendarB];
    settingsCanonicalByActor.set(actorB.id, {
      revision: ++settingsCanonicalRevision,
      calendars: cloneSettingsCalendars([calendarB]),
    });
    stateSlots = [];
    modalRefSlots = [];
    await renderCalendarSettingsModal(calendarB, 0);

    resolveSettingsConfirmGate?.();
    await pendingDelete;

    assert.deepEqual(settingsApiCalls, [], 'the stale A handler never invokes B-session persistence');
    assert.equal(settingsOptimisticByActor.size, 0, 'neither actor receives a stale optimistic mutation');
    assert.deepEqual(calendarState.calendars.map((item) => item.id), [calendarB.id]);
    assert.deepEqual(calendarState.optimisticDeletedCalendarIds, []);
    assert.equal(settingsPresentationRefreshCount, 0);
    assert.equal(settingsCloseCount, 0);
    assert.deepEqual(settingsToastErrors, []);
    assert.deepEqual(settingsToastSuccesses, []);
  });

  await t.test('a directly invoked stale save handler is stopped at the mutation boundary', async () => {
    resetHarness();
    const actorB = settingsUsers.find((user) => user.id === 'user-jang');
    assert.ok(actorB);
    const calendarA = calendar({ id: 'stale-save-a', ownerId: settingsCurrentUser.id, canManage: true });
    let tree = await renderCalendarSettingsModal(calendarA, 1);
    formElementByLabel(tree, '캘린더 이름').props.onChange?.({
      target: { value: 'A에서 준비한 수정', checked: false },
    });
    tree = await renderCalendarSettingsModal(calendarA, 1);
    const staleSave = buttonByText(tree, '저장').props.onClick;

    settingsCurrentUser = actorB;
    await staleSave?.();

    assert.deepEqual(settingsApiCalls, [], 'runMutation rejects the captured A actor before IPC');
    assert.equal(settingsOptimisticByActor.size, 0);
    assert.equal(settingsPresentationRefreshCount, 0);
    assert.equal(settingsCloseCount, 0);
    assert.deepEqual(settingsToastErrors, []);
    assert.deepEqual(settingsToastSuccesses, []);
  });
});

test('CalendarSettingsModal hides metadata immediately when an update removes the actor view permission', async (t) => {
  await t.test('a non-owner admin switching a team calendar to private keeps only the retry modal after refresh failure', async () => {
    resetHarness();
    const teamCalendar = calendar({
      id: 'admin-team-to-private',
      name: '관리 중인 팀 캘린더',
      ownerId: 'owner-lead',
      visibility: 'team',
      members: [],
      canManage: true,
    });
    let tree = await renderCalendarSettingsModal(teamCalendar, 2);
    settingsCachedEvents = [calendarListEvent({
      id: 'private-after-update-event',
      title: '비공개 전환 일정 제목',
      memo: '비공개 전환 일정 메모',
      calendarId: teamCalendar.id,
      sourceCalendarId: `bflow:${teamCalendar.id}`,
    })];
    settingsApiGate = new Promise<void>((resolve) => { resolveSettingsApiGate = resolve; });
    settingsBflowReloadResult = false;
    settingsBflowMetadataFresh = false;
    formElementByLabel(tree, '나만').props.onChange?.({ target: { value: 'private', checked: true } });
    tree = await renderCalendarSettingsModal(teamCalendar, 2);

    const pendingSave = buttonByText(tree, '저장').props.onClick?.();

    assert.equal(calendarState.calendars.some((item) => item.id === teamCalendar.id), false);
    assert.deepEqual(settingsCachedEvents, [], 'cached title and memo disappear before persistence settles');
    assert.deepEqual(calendarState.optimisticDeletedCalendarIds, [teamCalendar.id]);
    assert.equal(settingsCloseCount, 0, 'the matching settings modal remains as the retry surface');

    resolveSettingsApiGate?.();
    await pendingSave;

    assert.deepEqual(settingsApiCalls.map((call) => call.name), ['calendarUpdate', 'loadBflowEvents']);
    assert.equal(calendarState.calendars.some((item) => item.id === teamCalendar.id), false);
    assert.deepEqual(calendarState.optimisticDeletedCalendarIds, [teamCalendar.id]);
    assert.equal(settingsCloseCount, 0);
    assert.equal(settingsToastErrors.length, 1);
  });

  await t.test('a non-owner admin removing their own member row stays hidden through ambiguous response loss', async () => {
    resetHarness();
    const membersCalendar = calendar({
      id: 'admin-member-self-removal',
      name: '멤버 전용 캘린더',
      ownerId: 'owner-lead',
      visibility: 'members',
      members: [
        { userId: myUserId, canEdit: true },
        { userId: 'user-jang', canEdit: false },
      ],
      canManage: true,
    });
    let tree = await renderCalendarSettingsModal(membersCalendar, 2);
    settingsCachedEvents = [calendarListEvent({
      id: 'member-removal-event',
      title: '제거 뒤 숨길 제목',
      memo: '제거 뒤 숨길 메모',
      calendarId: membersCalendar.id,
      sourceCalendarId: `bflow:${membersCalendar.id}`,
    })];
    settingsApiFailures.add('calendarUpdate');
    settingsCanonicalCalendarsAfterReload = calendarState.calendars.map((item) => (
      item.id === membersCalendar.id
        ? {
            ...item,
            members: [
              { userId: myUserId, canEdit: false },
              { userId: 'user-jang', canEdit: false },
            ],
          }
        : { ...item, members: item.members.map((member) => ({ ...member })) }
    ));
    buttonByLabel(tree, '배한솔 제거').props.onClick?.();
    tree = await renderCalendarSettingsModal(membersCalendar, 2);

    await buttonByText(tree, '저장').props.onClick?.();

    assert.deepEqual(settingsApiCalls.map((call) => call.name), ['calendarUpdate', 'loadBflowEvents']);
    assert.equal(calendarState.calendars.some((item) => item.id === membersCalendar.id), false);
    assert.deepEqual(settingsCachedEvents, []);
    assert.deepEqual(calendarState.optimisticDeletedCalendarIds, [membersCalendar.id]);
    assert.equal(settingsCloseCount, 0, 'ambiguous canonical metadata keeps the safe hidden retry surface');
    assert.equal(settingsToastErrors.length, 1);
  });

  await t.test('independent canonical revocation cannot confirm a response-lost metadata update', async () => {
    resetHarness();
    const membersCalendar = calendar({
      id: 'admin-member-confirmed-removal',
      name: '제3자 회수 전 이름',
      ownerId: 'owner-lead',
      visibility: 'members',
      members: [{ userId: myUserId, canEdit: true }],
      canManage: true,
    });
    let tree = await renderCalendarSettingsModal(membersCalendar, 1);
    settingsApiFailures.add('calendarUpdate');
    settingsCanonicalCalendarsAfterReload = calendarState.calendars
      .filter((item) => item.id !== membersCalendar.id)
      .map((item) => ({ ...item, members: item.members.map((member) => ({ ...member })) }));
    formElementByLabel(tree, '캘린더 이름').props.onChange?.({
      target: { value: '응답 유실 중 보낸 이름', checked: false },
    });
    buttonByLabel(tree, '배한솔 제거').props.onClick?.();
    tree = await renderCalendarSettingsModal(membersCalendar, 1);

    await buttonByText(tree, '저장').props.onClick?.();

    assert.deepEqual(settingsApiCalls[0], {
      name: 'calendarUpdate',
      args: [membersCalendar.id, { name: '응답 유실 중 보낸 이름', members: [] }],
    });
    assert.equal(
      settingsCloseCount,
      0,
      'target absence proves revocation, not that the independently failed name and member write committed',
    );
    assert.deepEqual(calendarState.optimisticDeletedCalendarIds, [membersCalendar.id]);
    assert.equal(settingsToastErrors.length, 1);
    assert.deepEqual(settingsToastSuccesses, []);
  });

  await t.test('team visibility and calendar ownership keep presentation visible', async () => {
    resetHarness();
    const nonOwnerTeam = calendar({
      id: 'admin-stays-team',
      name: '팀 유지 전',
      ownerId: 'owner-lead',
      visibility: 'team',
      members: [],
      canManage: true,
    });
    let tree = await renderCalendarSettingsModal(nonOwnerTeam, 1);
    settingsCachedEvents = [calendarListEvent({
      id: 'team-stays-visible-event',
      calendarId: nonOwnerTeam.id,
      sourceCalendarId: `bflow:${nonOwnerTeam.id}`,
    })];
    settingsApiGate = new Promise<void>((resolve) => { resolveSettingsApiGate = resolve; });
    formElementByLabel(tree, '캘린더 이름').props.onChange?.({ target: { value: '팀 유지 후', checked: false } });
    tree = await renderCalendarSettingsModal(nonOwnerTeam, 1);
    const pendingTeamSave = buttonByText(tree, '저장').props.onClick?.();

    assert.ok(calendarState.calendars.some((item) => item.id === nonOwnerTeam.id));
    assert.equal(settingsCachedEvents.length, 1);
    assert.deepEqual(calendarState.optimisticDeletedCalendarIds, []);
    resolveSettingsApiGate?.();
    await pendingTeamSave;

    resetHarness();
    const ownerCalendar = calendar({
      id: 'owner-stays-visible',
      ownerId: myUserId,
      visibility: 'team',
      members: [],
      canManage: true,
    });
    tree = await renderCalendarSettingsModal(ownerCalendar, 1);
    settingsCachedEvents = [calendarListEvent({
      id: 'owner-private-visible-event',
      calendarId: ownerCalendar.id,
      sourceCalendarId: `bflow:${ownerCalendar.id}`,
    })];
    settingsApiGate = new Promise<void>((resolve) => { resolveSettingsApiGate = resolve; });
    formElementByLabel(tree, '나만').props.onChange?.({ target: { value: 'private', checked: true } });
    tree = await renderCalendarSettingsModal(ownerCalendar, 1);
    const pendingOwnerSave = buttonByText(tree, '저장').props.onClick?.();

    assert.ok(calendarState.calendars.some((item) => item.id === ownerCalendar.id));
    assert.equal(settingsCachedEvents.length, 1);
    assert.deepEqual(calendarState.optimisticDeletedCalendarIds, []);
    resolveSettingsApiGate?.();
    await pendingOwnerSave;
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
    assert.ok(
      calendarState.calendars.some((item) => item.name === '재시도 캘린더'),
      'an unavailable refresh keeps the safe optimistic placeholder while the duplicate-write latch is active',
    );

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
    settingsBflowMetadataFresh = false;
    let tree = await renderCalendarSettingsModal(calendarA, 1, () => { closeCalls.push('A'); });
    buttonByLabel(tree, '색상 #74B9FF').props.onClick?.();
    tree = await renderCalendarSettingsModal(calendarA, 1, () => { closeCalls.push('A'); });
    await buttonByText(tree, '저장').props.onClick?.();
    assert.ok(buttonByLabel(await renderCalendarSettingsModal(calendarA), '최신 캘린더 목록 다시 불러오기'));

    settingsCurrentUser = actorB;
    settingsBflowReloadResult = true;
    settingsBflowMetadataFresh = true;
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
    assert.ok(
      calendarState.calendars.some((item) => item.name === '모호한 캘린더'),
      'an unavailable refresh keeps the safe optimistic placeholder while the duplicate-write latch is active',
    );

    stateSlots = [];
    modalRefSlots = [];
    tree = await renderCalendarSettingsModal();
    assert.ok(buttonByLabel(tree, '최신 캘린더 목록 다시 불러오기'));
    assert.equal(buttonByText(tree, '저장').props.disabled, true);
    await buttonByText(tree, '저장').props.onClick?.();
    assert.equal(settingsApiCalls.filter((call) => call.name === 'calendarCreate').length, 1);

    settingsMetadataFreshness = { calendarsFresh: true, tagsFresh: true };
    settingsCanonicalCalendarsAfterReload = settingsCanonicalCalendars.map((item) => ({
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
    assert.equal(
      calendarState.calendars.some((item) => item.name === '모호한 캘린더'),
      false,
      'a fresh no-commit proof restores canonical metadata and removes the placeholder',
    );
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

test('CalendarSettingsModal unlocks an update after a fresh before-state proves it was not committed', async () => {
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
  assert.equal(
    findButtons(tree).some((button) => button.props['aria-label'] === '최신 캘린더 목록 다시 불러오기'),
    false,
    'a fresh no-commit proof leaves no reconciliation banner',
  );
  assert.equal(buttonByText(tree, '저장').props.disabled, false, 'the attempted draft is immediately retryable');
  assert.equal(buttonByLabel(tree, '색상 #74B9FF').props['aria-pressed'], true, 'the user draft survives the failed write');

  settingsApiFailures.delete('calendarUpdate');
  await buttonByText(tree, '저장').props.onClick?.();

  assert.deepEqual(settingsApiCalls.map((call) => call.name), [
    'calendarUpdate', 'loadBflowEvents', 'calendarUpdate', 'loadBflowEvents',
  ]);
  assert.equal(settingsCloseCount, 1, 'a deliberate retry can complete without an extra reconciliation click');
  assert.equal(settingsToastSuccesses.length, 1);
});

test('CalendarSettingsModal unlocks a create after a fresh list proves no new calendar was committed', async () => {
  resetHarness();
  settingsApiFailures.add('calendarCreate');
  let tree = await renderCalendarSettingsModal();
  formElementByLabel(tree, '캘린더 이름').props.onChange?.({ target: { value: '재시도 생성', checked: false } });
  tree = await renderCalendarSettingsModal();
  await buttonByText(tree, '저장').props.onClick?.();

  assert.deepEqual(settingsApiCalls.map((call) => call.name), ['calendarCreate', 'loadAll']);
  assert.equal(settingsCloseCount, 0);
  tree = await renderCalendarSettingsModal();
  assert.equal(
    findButtons(tree).some((button) => button.props['aria-label'] === '최신 캘린더 목록 다시 불러오기'),
    false,
    'no new canonical ID proves the create did not commit without another reload',
  );
  assert.equal(buttonByText(tree, '저장').props.disabled, false);
  assert.equal(formElementByLabel(tree, '캘린더 이름').props.value, '재시도 생성', 'the create draft remains available');

  settingsApiFailures.delete('calendarCreate');
  await buttonByText(tree, '저장').props.onClick?.();

  assert.deepEqual(settingsApiCalls.map((call) => call.name), [
    'calendarCreate', 'loadAll', 'calendarCreate', 'loadAll',
  ]);
  assert.equal(settingsCloseCount, 1);
});

test('CalendarSettingsModal unlocks a delete after a fresh list proves the target remains', async () => {
  resetHarness();
  settingsApiFailures.add('calendarDelete');
  settingsConfirmResponses = [true, true];
  const editable = calendar({ id: 'retry-delete', name: '재시도 삭제', canManage: true });
  let tree = await renderCalendarSettingsModal(editable, 3);
  await buttonByText(tree, '캘린더 삭제').props.onClick?.();

  assert.deepEqual(settingsApiCalls.map((call) => call.name), ['calendarDelete', 'loadBflowEvents']);
  assert.equal(settingsCloseCount, 0);
  tree = await renderCalendarSettingsModal(editable, 3);
  assert.equal(
    findButtons(tree).some((button) => button.props['aria-label'] === '최신 캘린더 목록 다시 불러오기'),
    false,
    'the canonical target proves deletion did not commit without another reload',
  );
  assert.equal(buttonByText(tree, '캘린더 삭제').props.disabled, false);

  settingsApiFailures.delete('calendarDelete');
  await buttonByText(tree, '캘린더 삭제').props.onClick?.();

  assert.deepEqual(settingsApiCalls.map((call) => call.name), [
    'calendarDelete', 'loadBflowEvents', 'calendarDelete', 'loadBflowEvents',
  ]);
  assert.equal(settingsCloseCount, 1);
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
  assert.doesNotMatch(renderedText, /팀 캘린더에 공유돼요|이 캘린더 멤버와 공유돼요|알림/, 'personal calendars do not show shared-calendar copy');
});

test('EventCreateModal blocks incomplete linked types and saves them after every required target is selected', async (t) => {
  const episodes: EventCreateModalProps['episodes'] = [{
    episodeNumber: 101,
    title: '101화',
    parts: [{
      partId: 'A',
      sheetName: 'EP101_BG',
      department: 'bg',
      scenes: [{ sceneId: 'scene-101-1', no: 1 }],
    }],
  }];
  const cases = [
    {
      type: 'episode',
      typeButton: '에피소드',
      selections: [['에피소드 선택', '101']],
      expectedLink: { linkedEpisode: 101 },
    },
    {
      type: 'part',
      typeButton: '파트',
      selections: [['에피소드 선택', '101'], ['파트 선택', 'EP101_BG']],
      expectedLink: { linkedEpisode: 101, linkedPart: 'A' },
    },
    {
      type: 'scene',
      typeButton: '씬',
      selections: [['에피소드 선택', '101'], ['파트 선택', 'EP101_BG'], ['씬 선택', 'scene-101-1']],
      expectedLink: { linkedEpisode: 101, linkedPart: 'A', linkedSceneId: 'scene-101-1' },
    },
  ] as const;

  for (const entry of cases) {
    await t.test(entry.type, async () => {
      resetHarness();
      const saved: Record<string, unknown>[] = [];
      const render = () => renderEventCreateModal(false, (event) => saved.push(event), '2026-08-25', episodes);
      let tree = await render();

      buttonByText(tree, entry.typeButton).props.onClick?.();
      tree = await render();
      flushEventCreateEffects();
      tree = await render();

      const incompleteCreateButton = buttonByText(tree, '만들기');
      incompleteCreateButton.props.onClick?.();
      assert.deepEqual(
        { disabled: incompleteCreateButton.props.disabled, saveCount: saved.length },
        { disabled: true, saveCount: 0 },
        `${entry.type} cannot submit its generated placeholder without a linked target`,
      );

      for (const [placeholder, value] of entry.selections) {
        formElementByOptionText(tree, placeholder).props.onChange?.({ target: { value, checked: false } });
        tree = await render();
        flushEventCreateEffects();
        tree = await render();
      }

      const completeCreateButton = buttonByText(tree, '만들기');
      assert.equal(completeCreateButton.props.disabled, false, `${entry.type} becomes submittable after selecting its target`);
      completeCreateButton.props.onClick?.();

      assert.equal(saved.length, 1);
      assert.equal(saved[0].type, entry.type);
      assert.deepEqual(
        Object.fromEntries(Object.keys(entry.expectedLink).map((key) => [key, saved[0][key]])),
        entry.expectedLink,
      );
    });
  }
});

test('EventCreateModal never offers an optimistic tag placeholder as a persisted event tag', async () => {
  resetHarness();
  calendarState.tags.push({
    id: 'optimistic-tag:user-me:91:2',
    name: '저장 중 태그',
    color: '#74B9FF',
    sortOrder: 2,
  });
  const tree = await renderEventCreateModal(false, () => {});
  assert.equal(
    findButtons(tree).some((button) => button.props['aria-label'] === '저장 중 태그 태그'),
    false,
    'a temporary renderer-only id cannot become an event foreign key',
  );
});

test('EventCreateModal clears a selected tag that disappears before submit', async () => {
  resetHarness();
  const saved: Record<string, unknown>[] = [];
  let tree = await renderEventCreateModal(false, (event) => saved.push(event));
  formElementByLabel(tree, '제목').props.onChange?.({ target: { value: '삭제 중 태그 일정', checked: false } });
  buttonByLabel(tree, '회의 태그').props.onClick?.();
  tree = await renderEventCreateModal(false, (event) => saved.push(event));
  calendarState.tags = calendarState.tags.filter(({ id }) => id !== 'tag-meeting');
  calendarState.optimisticDeletedTagIds = ['tag-meeting'];
  tree = await renderEventCreateModal(false, (event) => saved.push(event));
  flushEventCreateEffects();
  tree = await renderEventCreateModal(false, (event) => saved.push(event));
  buttonByText(tree, '만들기').props.onClick?.();

  assert.equal(saved.length, 1);
  assert.equal(saved[0].tagId, undefined, 'a stale deleted UUID cannot become an event foreign key');
});

test('EventCreateModal preserves a selected real tag while canonical tag metadata is unavailable', async () => {
  resetHarness();
  const saved: Record<string, unknown>[] = [];
  let tree = await renderEventCreateModal(false, (event) => saved.push(event));
  formElementByLabel(tree, '제목').props.onChange?.({ target: { value: '메타데이터 장애 일정', checked: false } });
  buttonByLabel(tree, '회의 태그').props.onClick?.();
  tree = await renderEventCreateModal(false, (event) => saved.push(event));

  calendarState.tags = [];
  tagManagerCanonicalByActor.delete(settingsCurrentUser.id);
  tree = await renderEventCreateModal(false, (event) => saved.push(event));
  flushEventCreateEffects();
  tree = await renderEventCreateModal(false, (event) => saved.push(event));
  buttonByText(tree, '만들기').props.onClick?.();

  assert.equal(saved.length, 1);
  assert.equal(saved[0].tagId, 'tag-meeting', 'an unknown tag list is not authoritative deletion');
});

test('EventCreateModal describes shared visibility without promising deferred notifications', async () => {
  resetHarness();
  let tree = await renderEventCreateModal(false, () => {});

  formElementByLabel(tree, '캘린더').props.onChange?.({ target: { value: 'team', checked: false } });
  tree = await renderEventCreateModal(false, () => {});
  assert.match(textContent(tree), /팀 캘린더에 공유돼요/);
  assert.doesNotMatch(textContent(tree), /알림/, 'team creation must not promise a notification that is not implemented');

  formElementByLabel(tree, '캘린더').props.onChange?.({ target: { value: 'editable-share', checked: false } });
  tree = await renderEventCreateModal(false, () => {});
  assert.match(textContent(tree), /이 캘린더 멤버와 공유돼요/);
  assert.doesNotMatch(textContent(tree), /알림/, 'member creation must not promise a notification that is not implemented');
});

test('EventCreateModal creates a tagged timed B flow event and rolls an empty end time into the next day', async () => {
  resetHarness();
  const saved: Record<string, unknown>[] = [];
  let tree = await renderEventCreateModal(false, (event) => saved.push(event), '2026-08-31');
  assert.doesNotMatch(textContent(formElementByLabel(tree, '캘린더')), /내 구글 캘린더/, 'Google is hidden while Task 3.3 reports unauthenticated');

  formElementByLabel(tree, '캘린더').props.onChange?.({ target: { value: 'editable-share', checked: false } });
  tree = await renderEventCreateModal(false, (event) => saved.push(event), '2026-08-31');

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

test('EventCreateModal clears and rejects a stale Google destination when authentication and every editable fallback disappear', async () => {
  resetHarness();
  const saved: Record<string, unknown>[] = [];
  let tree = await renderEventCreateModal(true, (event) => saved.push(event));

  formElementByLabel(tree, '캘린더').props.onChange?.({ target: { value: 'google', checked: false } });
  tree = await renderEventCreateModal(true, (event) => saved.push(event));
  formElementByLabel(tree, '제목').props.onChange?.({ target: { value: '인증 만료 일정', checked: false } });

  calendarState.calendars = [];
  tree = await renderEventCreateModal(false, (event) => saved.push(event));
  const createButton = buttonByText(tree, '만들기');
  assert.equal(createButton.props.disabled, true, 'a stale unauthenticated Google destination cannot enable submit');
  await createButton.props.onClick?.();
  assert.equal(saved.length, 0, 'the submit handler independently rejects the unavailable destination');

  flushEventCreateEffects();
  tree = await renderEventCreateModal(false, (event) => saved.push(event));
  assert.equal(formElementByLabel(tree, '캘린더').props.value, '', 'the stale selection clears when no fallback exists');
});
