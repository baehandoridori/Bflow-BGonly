import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';
import { build } from 'esbuild';

type QuickEditEventType = 'custom' | 'episode' | 'part' | 'scene' | 'vacation';

type QuickEditEvent = {
  id: string;
  title: string;
  memo: string;
  color: string;
  type: QuickEditEventType;
  startDate: string;
  endDate: string;
  createdBy: string;
  createdAt: string;
  source?: 'bflow' | 'google' | 'vacation';
  sourceCalendarId?: string;
  calendarId?: string;
  linkedSceneId?: string;
  linkedTodoId?: string;
  canEdit?: boolean;
  isReadOnly?: boolean;
  tagId?: string;
  allDay?: boolean;
  startTime?: string;
  endTime?: string;
};

type QuickEditProps = {
  event: QuickEditEvent;
  position: { x: number; y: number };
  onClose(): void;
  onUpdate(id: string, updates: Partial<QuickEditEvent>): void | Promise<void>;
  onDelete(id: string): void;
  onDuplicate(event: QuickEditEvent): void;
};

type QuickEditComponent = (props: QuickEditProps) => ReactNode;

type SidePanelProps = {
  event: QuickEditEvent & {
    vacationType?: string;
    vacationUserName?: string;
  };
  onClose(): void;
  onDelete(id: string): void;
  onUpdate(id: string, updates: Partial<QuickEditEvent>): void;
  onNavigate(event: QuickEditEvent): void;
};

type SidePanelComponent = (props: SidePanelProps) => ReactNode;

type ButtonElement = ReactElement<{
  'aria-describedby'?: string;
  'aria-label'?: string;
  'aria-pressed'?: boolean;
  className?: string;
  children?: ReactNode;
  disabled?: boolean;
  onClick?: () => unknown;
  style?: Record<string, unknown>;
}, 'button'>;

type FormElement = ReactElement<{
  'aria-label'?: string;
  checked?: boolean;
  children?: ReactNode;
  disabled?: boolean;
  type?: string;
  value?: string;
  onChange?: (event: { target: { checked: boolean; value: string } }) => unknown;
}, 'input' | 'select' | 'textarea'>;

type QuickEditCallbacks = Pick<
  QuickEditProps,
  'onClose' | 'onUpdate' | 'onDelete' | 'onDuplicate'
>;

let bundledQuickEdit: Promise<QuickEditComponent> | undefined;
let bundledSidePanel: Promise<SidePanelComponent> | undefined;
let forcedTab: 'calendar' | 'edit' = 'calendar';
let forcedEventType: QuickEditEventType | undefined;
let forcedQuickEditDraft: Partial<Pick<
  QuickEditEvent,
  'title' | 'startDate' | 'endDate' | 'memo' | 'allDay' | 'startTime' | 'endTime'
>> = {};
let quickEditStateCursor = 0;
let quickEditRefCursor = 0;
let statefulQuickEditState: unknown[] | undefined;
let statefulQuickEditRefs: Array<{ current: unknown }> | undefined;
let capturedPortalChild: ReactNode;
let forcedSidePanelEditing = false;
let forcedSidePanelDraft: Partial<Pick<
  QuickEditEvent,
  'title' | 'startDate' | 'endDate' | 'memo' | 'calendarId' | 'tagId' | 'allDay' | 'startTime' | 'endTime'
>> = {};
let sidePanelStateCursor = 0;
let sidePanelRefCursor = 0;
let sidePanelRefSlots: Array<{ current: unknown }> = [];
let calendarTagOptionsOverride: Array<{
  id: string; name: string; color: string; sortOrder: number;
}> | null = null;
let calendarOptimisticDeletedTagIdsOverride: string[] = [];
let calendarTagCanonicalSnapshotOverride: {
  revision: number;
  tags: Array<{ id: string; name: string; color: string; sortOrder: number }>;
} | null | undefined;

const defaultCanonicalTags = [
  { id: 'tag-meeting', name: '회의', color: '#FDCB6E', sortOrder: 10 },
  { id: 'tag-review', name: '검수', color: '#00B894', sortOrder: 20 },
];

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

function findButtonByText(node: ReactNode, label: string): ButtonElement {
  const button = findButtons(node).find((candidate) => textContent(candidate).includes(label));
  assert.ok(button, `button '${label}' must exist`);
  return button;
}

function findFormElements(node: ReactNode): FormElement[] {
  if (Array.isArray(node)) return node.flatMap(findFormElements);
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode };
  return [
    ...(node.type === 'input' || node.type === 'select' || node.type === 'textarea'
      ? [node as FormElement]
      : []),
    ...findFormElements(props.children),
  ];
}

function findFormElementByLabel(node: ReactNode, label: string): FormElement {
  const element = findFormElements(node).find((candidate) => candidate.props['aria-label'] === label);
  assert.ok(element, `form element '${label}' must exist`);
  return element;
}

function findElementsByRole(node: ReactNode, role: string): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap((child) => findElementsByRole(child, role));
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode; role?: string };
  return [
    ...(props.role === role ? [node] : []),
    ...findElementsByRole(props.children, role),
  ];
}

function colorButtons(node: ReactNode): ButtonElement[] {
  return findButtons(node).filter((button) => {
    const background = button.props.style?.background;
    return typeof background === 'string' && /^#[0-9A-F]{6}$/i.test(background);
  });
}

async function loadQuickEdit(): Promise<QuickEditComponent> {
  bundledQuickEdit ??= build({
    entryPoints: ['src/components/calendar/EventQuickEdit.tsx'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    write: false,
    external: [
      'react',
      'react/jsx-runtime',
      'react-dom',
      'framer-motion',
      'lucide-react',
      '@/stores/useAppStore',
      '@/stores/useAuthStore',
      '@/stores/useCalendarStore',
      '@/components/common/EntityAwareInput',
      '@/utils/glassStyles',
    ],
  }).then((result) => {
    const source = result.outputFiles[0].text;
    const module = { exports: {} as Record<string, unknown> };
    const nodeRequire = createRequire(import.meta.url);
    const react = nodeRequire('react') as Record<string, unknown>;
    const runtimeRequire = (id: string): unknown => {
      if (id === 'react') {
        return {
          ...react,
          useState(initial: unknown) {
            const slot = quickEditStateCursor++;
            const value = typeof initial === 'function'
              ? (initial as () => unknown)()
              : initial;
            const persistentState = statefulQuickEditState;
            if (persistentState) {
              if (!(slot in persistentState)) persistentState[slot] = value;
              return [persistentState[slot], (next: unknown) => {
                persistentState[slot] = typeof next === 'function'
                  ? (next as (current: unknown) => unknown)(persistentState[slot])
                  : next;
              }];
            }
            if (slot === 1) return [forcedTab, () => {}];
            if (slot === 2 && forcedQuickEditDraft.title !== undefined) return [forcedQuickEditDraft.title, () => {}];
            if (slot === 3 && forcedQuickEditDraft.startDate !== undefined) return [forcedQuickEditDraft.startDate, () => {}];
            if (slot === 4 && forcedQuickEditDraft.endDate !== undefined) return [forcedQuickEditDraft.endDate, () => {}];
            if (slot === 5) return [forcedEventType ?? value, () => {}];
            if (slot === 6 && forcedQuickEditDraft.memo !== undefined) return [forcedQuickEditDraft.memo, () => {}];
            if (slot === 11 && forcedQuickEditDraft.allDay !== undefined) return [forcedQuickEditDraft.allDay, () => {}];
            if (slot === 12 && forcedQuickEditDraft.startTime !== undefined) return [forcedQuickEditDraft.startTime, () => {}];
            if (slot === 13 && forcedQuickEditDraft.endTime !== undefined) return [forcedQuickEditDraft.endTime, () => {}];
            return [value, () => {}];
          },
          useEffect: () => {},
          useRef: (initial: unknown) => {
            const slot = quickEditRefCursor++;
            const persistentRefs = statefulQuickEditRefs;
            if (!persistentRefs) return { current: initial };
            if (!(slot in persistentRefs)) persistentRefs[slot] = { current: initial };
            return persistentRefs[slot];
          },
          useCallback: (callback: unknown) => callback,
          useMemo: (factory: () => unknown) => factory(),
        };
      }
      if (id === 'react/jsx-runtime') return nodeRequire('react/jsx-runtime');
      if (id === 'react-dom') {
        return {
          createPortal: (child: ReactNode) => {
            capturedPortalChild = child;
            return child;
          },
        };
      }
      if (id === 'framer-motion') {
        return {
          motion: { div: 'div' },
          AnimatePresence: ({ children }: { children: ReactNode }) => children,
          useIsPresent: () => true,
        };
      }
      if (id === 'lucide-react') {
        const Icon = () => null;
        return { CalendarDays: Icon, Copy: Icon, Pencil: Icon, Tags: Icon, Trash2: Icon };
      }
      if (id === '@/stores/useAppStore') {
        return { useAppStore: (selector: (state: { colorMode: string }) => unknown) => selector({ colorMode: 'dark' }) };
      }
      if (id === '@/stores/useAuthStore') {
        return {
          useAuthStore: (selector: (state: { users: unknown[]; currentUser: { id: string } }) => unknown) => selector({
            users: [],
            currentUser: { id: 'user-me' },
          }),
        };
      }
      if (id === '@/stores/useCalendarStore') {
        return {
          useCalendarStore: (selector: (value: {
            calendars: Array<{ id: string; name: string; color: string; canEdit: boolean }>;
            tags: typeof defaultCanonicalTags;
            optimisticDeletedTagIds: string[];
          }) => unknown) => selector({
            calendars: [
              { id: 'calendar-1', name: '내 일정', color: '#6C5CE7', canEdit: true },
              { id: 'calendar-2', name: 'EP 마일스톤', color: '#74B9FF', canEdit: true },
              { id: 'calendar-view', name: '보기 캘린더', color: '#8B8DA3', canEdit: false },
            ],
            tags: calendarTagOptionsOverride ?? defaultCanonicalTags,
            optimisticDeletedTagIds: calendarOptimisticDeletedTagIdsOverride,
          }),
          isOptimisticCalendarTagId: (idValue: string) => idValue.startsWith('optimistic-tag:'),
          getTagCanonicalSnapshot: (actorId: string | undefined) => actorId === 'user-me'
            ? calendarTagCanonicalSnapshotOverride === undefined
              ? { revision: 1, tags: defaultCanonicalTags }
              : calendarTagCanonicalSnapshotOverride
            : null,
        };
      }
      if (id === '@/components/common/EntityAwareInput') {
        return { EntityAwareInput: () => null };
      }
      if (id === '@/utils/glassStyles') return { floatingGlassStyle: {} };
      return nodeRequire(id);
    };

    const evaluate = new Function('require', 'module', 'exports', source);
    evaluate(runtimeRequire, module, module.exports);
    return module.exports.EventQuickEdit as QuickEditComponent;
  });
  return bundledQuickEdit;
}

async function loadSidePanel(): Promise<SidePanelComponent> {
  bundledSidePanel ??= build({
    entryPoints: ['src/components/calendar/EventSidePanel.tsx'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    write: false,
    external: [
      'react',
      'react/jsx-runtime',
      'framer-motion',
      'lucide-react',
      '@/stores/useDataStore',
      '@/stores/useAppStore',
      '@/stores/useAuthStore',
      '@/stores/useCalendarStore',
      '@/components/common/EntityAwareInput',
      '@/components/common/EntityText',
      '@/types',
      '@/utils/glassStyles',
      '@/utils/calendarDate',
    ],
  }).then((result) => {
    const source = result.outputFiles[0].text;
    const module = { exports: {} as Record<string, unknown> };
    const nodeRequire = createRequire(import.meta.url);
    const react = nodeRequire('react') as Record<string, unknown>;
    const runtimeRequire = (id: string): unknown => {
      if (id === 'react') {
        return {
          ...react,
          useState(initial: unknown) {
            const slot = sidePanelStateCursor++;
            const value = typeof initial === 'function'
              ? (initial as () => unknown)()
              : initial;
            if (slot === 0) return [forcedSidePanelEditing, () => {}];
            const draftKeys = [
              'title',
              'startDate',
              'endDate',
              'memo',
              'calendarId',
              'tagId',
              'allDay',
              'startTime',
              'endTime',
            ] as const;
            const draftKey = draftKeys[slot - 1];
            if (draftKey && Object.hasOwn(forcedSidePanelDraft, draftKey)) {
              return [forcedSidePanelDraft[draftKey], () => {}];
            }
            return [value, () => {}];
          },
          useEffect: () => {},
          useMemo: (factory: () => unknown) => factory(),
          useRef(initial: unknown) {
            const slot = sidePanelRefCursor++;
            sidePanelRefSlots[slot] ??= { current: initial };
            return sidePanelRefSlots[slot];
          },
        };
      }
      if (id === 'react/jsx-runtime') return nodeRequire('react/jsx-runtime');
      if (id === 'framer-motion') {
        return {
          motion: { div: 'div' },
          AnimatePresence: ({ children }: { children: ReactNode }) => children,
        };
      }
      if (id === 'lucide-react') {
        const Icon = () => null;
        return {
          X: Icon,
          Pencil: Icon,
          Trash2: Icon,
          ExternalLink: Icon,
          Clock: Icon,
          FileText: Icon,
          MapPin: Icon,
          Palmtree: Icon,
          Save: Icon,
          XCircle: Icon,
          CheckSquare: Icon,
        };
      }
      if (id === '@/stores/useDataStore') {
        return { useDataStore: (selector: (state: { episodeTitles: Record<number, string> }) => unknown) => selector({ episodeTitles: {} }) };
      }
      if (id === '@/stores/useAppStore') {
        return {
          useAppStore: (selector: (state: { colorMode: string; setView: () => void }) => unknown) => selector({
            colorMode: 'dark',
            setView: () => {},
          }),
        };
      }
      if (id === '@/stores/useAuthStore') {
        return {
          useAuthStore: (selector: (state: { users: unknown[]; currentUser: { id: string } }) => unknown) => selector({
            users: [],
            currentUser: { id: 'user-me' },
          }),
        };
      }
      if (id === '@/stores/useCalendarStore') {
        return {
          useCalendarStore: (selector: (value: {
            calendars: Array<{ id: string; name: string; color: string; canEdit: boolean }>;
            tags: typeof defaultCanonicalTags;
            optimisticDeletedTagIds: string[];
          }) => unknown) => selector({
            calendars: [
              { id: 'calendar-1', name: '내 일정', color: '#6C5CE7', canEdit: true },
              { id: 'calendar-2', name: 'EP 마일스톤', color: '#74B9FF', canEdit: true },
            ],
            tags: calendarTagOptionsOverride
              ?? [{ id: 'tag-meeting', name: '회의', color: '#FDCB6E', sortOrder: 10 }],
            optimisticDeletedTagIds: calendarOptimisticDeletedTagIdsOverride,
          }),
          isOptimisticCalendarTagId: (idValue: string) => idValue.startsWith('optimistic-tag:'),
          getTagCanonicalSnapshot: (actorId: string | undefined) => actorId === 'user-me'
            ? calendarTagCanonicalSnapshotOverride === undefined
              ? { revision: 1, tags: defaultCanonicalTags }
              : calendarTagCanonicalSnapshotOverride
            : null,
        };
      }
      if (id === '@/components/common/EntityAwareInput') return { EntityAwareInput: () => null };
      if (id === '@/components/common/EntityText') return { EntityText: () => null };
      if (id === '@/types') return { DEPARTMENT_CONFIGS: {} };
      if (id === '@/utils/glassStyles') return { floatingGlassStyle: {} };
      if (id === '@/utils/calendarDate') {
        return { parseDate: (value: string) => new Date(`${value}T12:00:00`) };
      }
      return nodeRequire(id);
    };

    const evaluate = new Function('require', 'module', 'exports', source);
    evaluate(runtimeRequire, module, module.exports);
    return module.exports.EventSidePanel as SidePanelComponent;
  });
  return bundledSidePanel;
}

function event(overrides: Partial<QuickEditEvent> = {}): QuickEditEvent {
  return {
    id: 'event-1',
    title: '테스트 일정',
    memo: '메모',
    color: '#6C5CE7',
    type: 'custom',
    startDate: '2026-08-24',
    endDate: '2026-08-25',
    createdBy: 'user-1',
    createdAt: '2026-08-24T00:00:00.000Z',
    ...overrides,
  };
}

async function renderQuickEdit(
  target: QuickEditEvent,
  tab: 'calendar' | 'edit',
  callbacks: Partial<QuickEditCallbacks> = {},
  draftType?: QuickEditEventType,
  draft: Partial<Pick<
    QuickEditEvent,
    'title' | 'startDate' | 'endDate' | 'memo' | 'allDay' | 'startTime' | 'endTime'
  >> = {},
): Promise<ReactNode> {
  const EventQuickEdit = await loadQuickEdit();
  const globalScope = globalThis as typeof globalThis & { document?: { body: object } };
  const previousDocument = globalScope.document;
  globalScope.document = { body: {} };
  forcedTab = tab;
  forcedEventType = draftType;
  forcedQuickEditDraft = draft;
  quickEditStateCursor = 0;
  quickEditRefCursor = 0;
  capturedPortalChild = undefined;
  try {
    EventQuickEdit({
      event: target,
      position: { x: 0, y: 0 },
      onClose: callbacks.onClose ?? (() => {}),
      onUpdate: callbacks.onUpdate ?? (() => {}),
      onDelete: callbacks.onDelete ?? (() => {}),
      onDuplicate: callbacks.onDuplicate ?? (() => {}),
    });
    assert.ok(capturedPortalChild, 'createPortal child must be captured');
    return capturedPortalChild;
  } finally {
    if (previousDocument === undefined) delete globalScope.document;
    else globalScope.document = previousDocument;
  }
}

async function createStatefulQuickEditHarness(
  initialEvent: QuickEditEvent,
  callbacks: Partial<QuickEditCallbacks>,
): Promise<{ render(nextEvent?: QuickEditEvent): ReactNode }> {
  const EventQuickEdit = await loadQuickEdit();
  const hookState: unknown[] = [];
  const hookRefs: Array<{ current: unknown }> = [];
  let currentEvent = initialEvent;

  return {
    render(nextEvent = currentEvent) {
      currentEvent = nextEvent;
      const globalScope = globalThis as typeof globalThis & { document?: { body: object } };
      const previousDocument = globalScope.document;
      globalScope.document = { body: {} };
      forcedTab = 'calendar';
      forcedEventType = undefined;
      forcedQuickEditDraft = {};
      quickEditStateCursor = 0;
      quickEditRefCursor = 0;
      capturedPortalChild = undefined;
      statefulQuickEditState = hookState;
      statefulQuickEditRefs = hookRefs;
      try {
        EventQuickEdit({
          event: currentEvent,
          position: { x: 0, y: 0 },
          onClose: callbacks.onClose ?? (() => {}),
          onUpdate: callbacks.onUpdate ?? (() => {}),
          onDelete: callbacks.onDelete ?? (() => {}),
          onDuplicate: callbacks.onDuplicate ?? (() => {}),
        });
        assert.ok(capturedPortalChild, 'createPortal child must be captured');
        return capturedPortalChild;
      } finally {
        statefulQuickEditState = undefined;
        statefulQuickEditRefs = undefined;
        if (previousDocument === undefined) delete globalScope.document;
        else globalScope.document = previousDocument;
      }
    },
  };
}

function createDeferred(): {
  promise: Promise<void>;
  resolve(): void;
  reject(reason: Error): void;
} {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function renderSidePanel(
  target: SidePanelProps['event'],
  callbacks: Partial<Omit<SidePanelProps, 'event'>> = {},
  editing = false,
  draft: typeof forcedSidePanelDraft = {},
): Promise<ReactNode> {
  const EventSidePanel = await loadSidePanel();
  forcedSidePanelEditing = editing;
  forcedSidePanelDraft = draft;
  sidePanelStateCursor = 0;
  sidePanelRefCursor = 0;
  sidePanelRefSlots = [];
  return EventSidePanel({
    event: target,
    onClose: callbacks.onClose ?? (() => {}),
    onDelete: callbacks.onDelete ?? (() => {}),
    onUpdate: callbacks.onUpdate ?? (() => {}),
    onNavigate: callbacks.onNavigate ?? (() => {}),
  });
}

const newBflowCases: Array<{ name: string; target: QuickEditEvent }> = [
  {
    name: 'bflow source-calendar prefix',
    target: event({ sourceCalendarId: 'bflow:calendar-1', calendarId: 'calendar-1', type: 'scene' }),
  },
  {
    name: 'second canonical B flow calendar',
    target: event({ source: 'bflow', sourceCalendarId: 'bflow:calendar-2', calendarId: 'calendar-2', type: 'part' }),
  },
];

test('canonical B flow quick edit replaces event colors with immediate tag and calendar controls', async () => {
  const target = event({
    source: 'bflow',
    sourceCalendarId: 'bflow:calendar-1',
    calendarId: 'calendar-1',
    tagId: 'tag-meeting',
    canEdit: true,
  });
  const updates: Array<{ id: string; patch: Partial<QuickEditEvent> }> = [];
  const tree = await renderQuickEdit(target, 'calendar', {
    onUpdate: (id, patch) => updates.push({ id, patch }),
  });

  assert.match(textContent(tree), /태그·캘린더/);
  assert.equal(colorButtons(tree).length, 0, 'individual event color swatches are removed');
  assert.match(textContent(tree), /회의/);
  assert.match(textContent(tree), /검수/);
  assert.doesNotMatch(textContent(findFormElementByLabel(tree, '캘린더')), /보기 캘린더/);

  findButtonByText(tree, '회의').props.onClick?.();
  findFormElementByLabel(tree, '캘린더').props.onChange?.({ target: { value: 'calendar-1', checked: false } });
  assert.deepEqual(updates, [], 're-selecting the current tag or calendar is a no-op');

  findButtonByText(tree, '없음').props.onClick?.();
  findFormElementByLabel(tree, '캘린더').props.onChange?.({ target: { value: 'calendar-2', checked: false } });

  assert.deepEqual(updates, [
    { id: target.id, patch: { tagId: undefined } },
    { id: target.id, patch: { calendarId: 'calendar-2' } },
  ]);
  assert.equal(Object.hasOwn(updates[0].patch, 'tagId'), true, 'tag clearing remains an own key');

  const alreadyUntaggedUpdates: typeof updates = [];
  const alreadyUntaggedTree = await renderQuickEdit({ ...target, tagId: undefined }, 'calendar', {
    onUpdate: (id, patch) => alreadyUntaggedUpdates.push({ id, patch }),
  });
  findButtonByText(alreadyUntaggedTree, '없음').props.onClick?.();
  assert.deepEqual(alreadyUntaggedUpdates, [], 'clearing an already empty tag is a no-op');
});

test('canonical B flow quick edit keeps pending calendar and tag selections visible until persistence settles', async () => {
  const target = event({
    source: 'bflow',
    sourceCalendarId: 'bflow:calendar-1',
    calendarId: 'calendar-1',
    tagId: 'tag-meeting',
    canEdit: true,
  });
  const writes: Array<{
    patch: Partial<QuickEditEvent>;
    deferred: ReturnType<typeof createDeferred>;
  }> = [];
  const harness = await createStatefulQuickEditHarness(target, {
    onUpdate: (_id, patch) => {
      const deferred = createDeferred();
      writes.push({ patch, deferred });
      return deferred.promise;
    },
  });

  let tree = harness.render();
  const calendarWrite = findFormElementByLabel(tree, '캘린더').props.onChange?.({
    target: { value: 'calendar-2', checked: false },
  });
  tree = harness.render();
  assert.equal(findFormElementByLabel(tree, '캘린더').props.value, 'calendar-2');
  assert.equal(findFormElementByLabel(tree, '캘린더').props.disabled, true);
  findFormElementByLabel(tree, '캘린더').props.onChange?.({
    target: { value: 'calendar-1', checked: false },
  });
  assert.deepEqual(
    writes.map(({ patch }) => patch),
    [{ calendarId: 'calendar-2' }],
    'a second calendar intent cannot overtake the in-flight persistence request',
  );

  const tagWrite = findButtonByText(tree, '검수').props.onClick?.();
  tree = harness.render();
  assert.equal(findButtonByText(tree, '검수').props['aria-pressed'], true);
  assert.equal(findButtonByText(tree, '검수').props.disabled, true);
  findButtonByText(tree, '회의').props.onClick?.();
  assert.equal(findFormElementByLabel(tree, '캘린더').props.value, 'calendar-2');

  findFormElementByLabel(tree, '캘린더').props.onChange?.({
    target: { value: 'calendar-2', checked: false },
  });
  findButtonByText(tree, '검수').props.onClick?.();
  assert.deepEqual(
    writes.map(({ patch }) => patch),
    [{ calendarId: 'calendar-2' }, { tagId: 'tag-review' }],
    're-selecting or replacing either pending value is a no-op',
  );

  writes.forEach(({ deferred }) => deferred.resolve());
  await Promise.all([calendarWrite, tagWrite]);
  tree = harness.render({ ...target, calendarId: 'calendar-1', tagId: undefined });
  assert.equal(findFormElementByLabel(tree, '캘린더').props.value, 'calendar-1');
  assert.equal(findButtonByText(tree, '없음').props['aria-pressed'], true);
  assert.equal(findButtonByText(tree, '검수').props['aria-pressed'], false);
});

test('canonical B flow quick edit rolls pending calendar and tag selections back when persistence rejects', async () => {
  const target = event({
    source: 'bflow',
    sourceCalendarId: 'bflow:calendar-1',
    calendarId: 'calendar-1',
    tagId: 'tag-meeting',
    canEdit: true,
  });
  const writes: Array<ReturnType<typeof createDeferred>> = [];
  const harness = await createStatefulQuickEditHarness(target, {
    onUpdate: () => {
      const deferred = createDeferred();
      writes.push(deferred);
      return deferred.promise;
    },
  });

  let tree = harness.render();
  const calendarWrite = findFormElementByLabel(tree, '캘린더').props.onChange?.({
    target: { value: 'calendar-2', checked: false },
  });
  tree = harness.render();
  assert.equal(findFormElementByLabel(tree, '캘린더').props.value, 'calendar-2');
  writes[0].reject(new Error('calendar persistence failed'));
  await calendarWrite;
  tree = harness.render();
  assert.equal(findFormElementByLabel(tree, '캘린더').props.value, 'calendar-1');

  const tagWrite = findButtonByText(tree, '검수').props.onClick?.();
  tree = harness.render();
  assert.equal(findButtonByText(tree, '검수').props['aria-pressed'], true);
  writes[1].reject(new Error('tag persistence failed'));
  await tagWrite;
  tree = harness.render();
  assert.equal(findButtonByText(tree, '회의').props['aria-pressed'], true);
  assert.equal(findButtonByText(tree, '검수').props['aria-pressed'], false);
});

test('side panel shows calendar, tag and timed range and saves only changed temporal fields without legacy privacy', async () => {
  const target = event({
    source: 'bflow',
    sourceCalendarId: 'bflow:calendar-1',
    calendarId: 'calendar-1',
    tagId: 'tag-meeting',
    allDay: false,
    startTime: '14:00',
    endTime: '15:00',
    canEdit: true,
  });
  const displayTree = await renderSidePanel(target);
  const displayText = textContent(displayTree);
  assert.match(displayText, /내 일정/);
  assert.match(displayText, /회의/);
  assert.match(displayText, /14:00\s*[–-]\s*15:00/);
  assert.doesNotMatch(displayText, /나만 보기/);

  const updates: Array<{ id: string; patch: Partial<QuickEditEvent> }> = [];
  const editTree = await renderSidePanel(target, {
    onUpdate: (id, patch) => updates.push({ id, patch }),
  }, true, { startTime: '14:10' });
  assert.ok(findFormElementByLabel(editTree, '종일 일정'));
  assert.ok(findFormElementByLabel(editTree, '시작 시각'));
  assert.ok(findFormElementByLabel(editTree, '종료 시각'));
  findButtonByText(editTree, '저장').props.onClick?.();

  assert.deepEqual(updates, [{ id: target.id, patch: { startTime: '14:10' } }]);
  assert.equal(Object.hasOwn(updates[0].patch, 'isPrivate'), false);

  const allDayUpdates: Array<{ id: string; patch: Partial<QuickEditEvent> }> = [];
  const allDayTree = await renderSidePanel(target, {
    onUpdate: (id, patch) => allDayUpdates.push({ id, patch }),
  }, true, { allDay: true });
  findButtonByText(allDayTree, '저장').props.onClick?.();

  assert.equal(allDayUpdates[0].patch.allDay, true);
  assert.equal(Object.hasOwn(allDayUpdates[0].patch, 'startTime'), true);
  assert.equal(Object.hasOwn(allDayUpdates[0].patch, 'endTime'), true);
  assert.equal(allDayUpdates[0].patch.startTime, undefined);
  assert.equal(allDayUpdates[0].patch.endTime, undefined);
});

test('side panel cannot submit a tag selection that disappeared while the editor was open', async () => {
  const target = event({
    source: 'bflow',
    sourceCalendarId: 'bflow:calendar-1',
    calendarId: 'calendar-1',
    tagId: undefined,
    canEdit: true,
  });
  const updates: Array<{ id: string; patch: Partial<QuickEditEvent> }> = [];
  calendarTagOptionsOverride = [];
  calendarOptimisticDeletedTagIdsOverride = ['tag-meeting'];
  try {
    const tree = await renderSidePanel(target, {
      onUpdate: (id, patch) => updates.push({ id, patch }),
    }, true, { title: '제목 수정', tagId: 'tag-meeting' });
    findButtonByText(tree, '저장').props.onClick?.();
    assert.deepEqual(updates, [{
      id: target.id,
      patch: { title: '제목 수정' },
    }], 'a deleted or temporary tag id is removed again at submit time');
  } finally {
    calendarTagOptionsOverride = null;
    calendarOptimisticDeletedTagIdsOverride = [];
  }
});

test('side panel preserves an existing tag while canonical tag metadata is unavailable', async () => {
  const target = event({
    source: 'bflow',
    sourceCalendarId: 'bflow:calendar-1',
    calendarId: 'calendar-1',
    tagId: 'tag-meeting',
    canEdit: true,
  });
  const updates: Array<{ id: string; patch: Partial<QuickEditEvent> }> = [];
  calendarTagOptionsOverride = [];
  calendarTagCanonicalSnapshotOverride = null;
  try {
    const tree = await renderSidePanel(target, {
      onUpdate: (id, patch) => updates.push({ id, patch }),
    }, true, { title: '메타데이터 장애 중 제목 수정' });
    findButtonByText(tree, '저장').props.onClick?.();
    assert.deepEqual(updates, [{
      id: target.id,
      patch: { title: '메타데이터 장애 중 제목 수정' },
    }], 'an unknown tag list cannot be treated as authoritative deletion');
    assert.equal(Object.hasOwn(updates[0].patch, 'tagId'), false);
  } finally {
    calendarTagOptionsOverride = null;
    calendarTagCanonicalSnapshotOverride = undefined;
  }
});

test('side panel blocks non-increasing timed ranges while allowing an overnight range', async () => {
  const target = event({
    source: 'bflow',
    sourceCalendarId: 'bflow:calendar-1',
    calendarId: 'calendar-1',
    allDay: false,
    startDate: '2026-08-24',
    endDate: '2026-08-24',
    startTime: '15:00',
    endTime: '16:00',
    canEdit: true,
  });
  const invalidDrafts = [
    { name: 'same-day reversed', draft: { startTime: '15:00', endTime: '14:00' } },
    { name: 'equal timestamp', draft: { startTime: '15:00', endTime: '15:00' } },
    {
      name: 'earlier end date',
      draft: {
        startDate: '2026-08-25',
        endDate: '2026-08-24',
        startTime: '09:00',
        endTime: '10:00',
      },
    },
  ] as const;

  for (const { name, draft } of invalidDrafts) {
    const updates: Array<{ id: string; patch: Partial<QuickEditEvent> }> = [];
    const tree = await renderSidePanel(target, {
      onUpdate: (id, patch) => updates.push({ id, patch }),
    }, true, draft);
    const saveButton = findButtonByText(tree, '저장');

    assert.equal(saveButton.props.disabled, true, `${name}: save is disabled`);
    assert.match(textContent(tree), /종료 시각은 시작 시각보다 뒤여야 해요\./, `${name}: warning is visible`);
    assert.equal(findElementsByRole(tree, 'alert').length, 1, `${name}: warning is announced`);
    saveButton.props.onClick?.();
    assert.deepEqual(updates, [], `${name}: direct handler invocation cannot persist`);
  }

  const updates: Array<{ id: string; patch: Partial<QuickEditEvent> }> = [];
  const overnightTree = await renderSidePanel(target, {
    onUpdate: (id, patch) => updates.push({ id, patch }),
  }, true, {
    startDate: '2026-08-24',
    endDate: '2026-08-25',
    startTime: '23:30',
    endTime: '00:30',
  });
  const overnightSave = findButtonByText(overnightTree, '저장');

  assert.notEqual(overnightSave.props.disabled, true);
  assert.doesNotMatch(textContent(overnightTree), /종료 시각은 시작 시각보다 뒤여야 해요\./);
  overnightSave.props.onClick?.();
  assert.deepEqual(updates, [{
    id: target.id,
    patch: {
      startDate: '2026-08-24',
      endDate: '2026-08-25',
      startTime: '23:30',
      endTime: '00:30',
    },
  }]);
});

test('quick edit edits timed ranges with the same rules as the side panel', async () => {
  const target = event({
    source: 'bflow',
    sourceCalendarId: 'bflow:calendar-1',
    calendarId: 'calendar-1',
    allDay: false,
    startDate: '2026-08-24',
    endDate: '2026-08-24',
    startTime: '15:00',
    endTime: '16:00',
    canEdit: true,
  });

  const invalidUpdates: Array<{ id: string; patch: Partial<QuickEditEvent> }> = [];
  const invalidTree = await renderQuickEdit(target, 'edit', {
    onUpdate: (id, patch) => invalidUpdates.push({ id, patch }),
  }, undefined, { startTime: '15:00', endTime: '14:00' });
  const invalidSave = findButtonByText(invalidTree, '저장');

  assert.equal(invalidSave.props.disabled, true, '뒤집힌 시각은 저장을 막는다');
  assert.match(textContent(invalidTree), /종료 시각은 시작 시각보다 뒤여야 해요\./);
  invalidSave.props.onClick?.();
  assert.deepEqual(invalidUpdates, [], '직접 호출해도 뒤집힌 시각은 저장되지 않는다');

  const updates: Array<{ id: string; patch: Partial<QuickEditEvent> }> = [];
  const validTree = await renderQuickEdit(target, 'edit', {
    onUpdate: (id, patch) => updates.push({ id, patch }),
  }, undefined, { startTime: '13:30', endTime: '14:45' });
  const validSave = findButtonByText(validTree, '저장');

  assert.notEqual(validSave.props.disabled, true);
  validSave.props.onClick?.();
  assert.deepEqual(updates, [{
    id: target.id,
    patch: { startTime: '13:30', endTime: '14:45' },
  }], '바뀐 시각만 저장한다');

  // 종일로 되돌리면 시각 키를 비운다.
  const allDayUpdates: Array<{ id: string; patch: Partial<QuickEditEvent> }> = [];
  const allDayTree = await renderQuickEdit(target, 'edit', {
    onUpdate: (id, patch) => allDayUpdates.push({ id, patch }),
  }, undefined, { allDay: true });
  findButtonByText(allDayTree, '저장').props.onClick?.();
  assert.deepEqual(allDayUpdates, [{
    id: target.id,
    patch: { allDay: true, startTime: undefined, endTime: undefined },
  }]);

  // 시각 편집을 지원하지 않는 저장소에는 시각 입력을 노출하지 않는다.
  const legacyTree = await renderQuickEdit(event({
    source: 'bflow',
    sourceCalendarId: undefined,
    calendarId: undefined,
    allDay: false,
    startTime: '15:00',
    endTime: '16:00',
    canEdit: true,
  }), 'edit');
  assert.throws(
    () => findFormElementByLabel(legacyTree, '시작 시각'),
    /must exist/,
    '구 비공개 일정에는 시각 입력을 열지 않는다',
  );
});

test('quick edit title-only save emits no unchanged Google temporal or memo fields', async () => {
  const target = event({
    source: 'google',
    sourceCalendarId: 'primary',
    allDay: false,
    startTime: '14:00',
    endTime: '15:00',
  });
  const updates: Array<{ id: string; patch: Partial<QuickEditEvent> }> = [];
  const tree = await renderQuickEdit(target, 'edit', {
    onUpdate: (id, patch) => updates.push({ id, patch }),
  }, undefined, { title: '제목만 변경' });

  findButtonByText(tree, '저장').props.onClick?.();

  assert.deepEqual(updates, [{ id: target.id, patch: { title: '제목만 변경' } }]);
});

test('quick edit sends a complete date pair when only the start crosses the current end', async () => {
  const target = event({ source: 'google', sourceCalendarId: 'primary' });
  const updates: Array<{ id: string; patch: Partial<QuickEditEvent> }> = [];
  const tree = await renderQuickEdit(target, 'edit', {
    onUpdate: (id, patch) => updates.push({ id, patch }),
  }, undefined, { startDate: '2026-08-26' });

  findButtonByText(tree, '저장').props.onClick?.();

  assert.deepEqual(updates, [{
    id: target.id,
    patch: { startDate: '2026-08-26', endDate: '2026-08-25' },
  }]);
});

test('side panel title-only save emits no unchanged Google temporal or memo fields', async () => {
  const target = event({
    source: 'google',
    sourceCalendarId: 'primary',
    allDay: false,
    startTime: '14:00',
    endTime: '15:00',
  });
  const updates: Array<{ id: string; patch: Partial<QuickEditEvent> }> = [];
  const tree = await renderSidePanel(target, {
    onUpdate: (id, patch) => updates.push({ id, patch }),
  }, true, { title: '제목만 변경' });

  findButtonByText(tree, '저장').props.onClick?.();

  assert.deepEqual(updates, [{ id: target.id, patch: { title: '제목만 변경' } }]);

  const staleAllDayUpdates: typeof updates = [];
  const staleAllDayTree = await renderSidePanel({ ...target, allDay: true }, {
    onUpdate: (id, patch) => staleAllDayUpdates.push({ id, patch }),
  }, true, { title: '종일 제목만 변경' });

  findButtonByText(staleAllDayTree, '저장').props.onClick?.();

  assert.deepEqual(staleAllDayUpdates, [{ id: target.id, patch: { title: '종일 제목만 변경' } }]);
});

test('side panel sends a complete date pair when only the start crosses the current end', async () => {
  const target = event({
    source: 'bflow',
    sourceCalendarId: 'bflow:calendar-1',
    calendarId: 'calendar-1',
  });
  const updates: Array<{ id: string; patch: Partial<QuickEditEvent> }> = [];
  const tree = await renderSidePanel(target, {
    onUpdate: (id, patch) => updates.push({ id, patch }),
  }, true, { startDate: '2026-08-26' });

  findButtonByText(tree, '저장').props.onClick?.();

  assert.deepEqual(updates, [{
    id: target.id,
    patch: { startDate: '2026-08-26', endDate: '2026-08-25' },
  }]);
});

test('legacy private side panel keeps date-only editing and emits no unsupported all-day or time keys', async () => {
  const target = event({
    source: 'bflow',
    sourceCalendarId: 'supabase-private',
    allDay: false,
    startTime: '14:00',
    endTime: '15:00',
  });
  const updates: Array<{ id: string; patch: Partial<QuickEditEvent> }> = [];
  const tree = await renderSidePanel(target, {
    onUpdate: (id, patch) => updates.push({ id, patch }),
  }, true, { startDate: '2026-08-26' });

  findButtonByText(tree, '저장').props.onClick?.();
  const temporalControlLabels = findFormElements(tree)
    .map((element) => element.props['aria-label'])
    .filter((label) => ['종일 일정', '시작 시각', '종료 시각'].includes(label ?? ''));

  assert.deepEqual({ temporalControlLabels, updates }, {
    temporalControlLabels: [],
    updates: [{
      id: target.id,
      patch: { startDate: '2026-08-26', endDate: '2026-08-25' },
    }],
  });
});

test('quick edit removes individual color swatches for every storage', async () => {
  for (const { name, target } of newBflowCases) {
    const tree = await renderQuickEdit(target, 'calendar');
    assert.equal(colorButtons(tree).length, 0, `${name}: color choices are absent`);
    assert.match(textContent(tree), /태그·캘린더/);
  }
});

test('new B flow type segments show the derived type but stay disabled', async () => {
  for (const { name, target } of newBflowCases) {
    const tree = await renderQuickEdit(target, 'edit');
    for (const label of ['커스텀', '에피소드', '파트', '씬']) {
      const button = findButtonByText(tree, label);
      assert.equal(button.props.disabled, true, `${name}: ${label} is display-only`);
      assert.equal(
        button.props['aria-describedby'],
        `calendar-derived-fields-${target.id}`,
        `${name}: ${label} explains why it is read-only`,
      );
    }
    const selectedLabel = target.type === 'scene' ? '씬' : '파트';
    assert.equal(
      findButtonByText(tree, selectedLabel).props.style?.background,
      'rgb(var(--color-accent))',
      `${name}: current derived type remains visibly selected`,
    );
  }
});

test('new B flow save omits derived type while retaining changed editable fields', async () => {
  const updates: Array<{ id: string; patch: Partial<QuickEditEvent> }> = [];
  const target = newBflowCases[0].target;
  const tree = await renderQuickEdit(target, 'edit', {
    onUpdate: (id, patch) => updates.push({ id, patch }),
  }, undefined, { title: '변경된 제목', memo: '변경된 메모' });

  findButtonByText(tree, '저장').props.onClick?.();

  assert.deepEqual(updates, [{
    id: target.id,
    patch: {
      title: '변경된 제목',
      memo: '변경된 메모',
    },
  }]);
  assert.equal(Object.hasOwn(updates[0].patch, 'type'), false);
});

test('legacy private and Google events keep enabled editing and unchanged saves emit no write', async () => {
  const cases: Array<{ name: string; target: QuickEditEvent }> = [
    {
      name: 'legacy private',
      target: event({ source: 'bflow', sourceCalendarId: 'supabase-private', type: 'episode' }),
    },
    {
      name: 'Google',
      target: event({ source: 'google', sourceCalendarId: 'primary', type: 'scene' }),
    },
  ];

  for (const { name, target } of cases) {
    const updates: Array<{ id: string; patch: Partial<QuickEditEvent> }> = [];
    const calendarTree = await renderQuickEdit(target, 'calendar');
    assert.equal(colorButtons(calendarTree).length, 0, `${name}: legacy color editing is removed too`);
    assert.match(textContent(calendarTree), /현재 저장소를 유지/);

    const editTree = await renderQuickEdit(target, 'edit', {
      onUpdate: (id, patch) => updates.push({ id, patch }),
    });
    for (const label of ['커스텀', '에피소드', '파트', '씬']) {
      assert.notEqual(findButtonByText(editTree, label).props.disabled, true, `${name}: ${label} remains editable`);
    }
    findButtonByText(editTree, '저장').props.onClick?.();
    assert.deepEqual(updates, [], `${name}: unchanged fields do not trigger a write`);
  }
});

test('legacy private and Google events include type when the user actually changes it', async () => {
  const cases: Array<{ name: string; target: QuickEditEvent }> = [
    {
      name: 'legacy private',
      target: event({ source: 'bflow', sourceCalendarId: 'supabase-private', type: 'episode' }),
    },
    {
      name: 'Google',
      target: event({ source: 'google', sourceCalendarId: 'primary', type: 'scene' }),
    },
  ];

  for (const { name, target } of cases) {
    const updates: Array<{ id: string; patch: Partial<QuickEditEvent> }> = [];
    const tree = await renderQuickEdit(target, 'edit', {
      onUpdate: (id, patch) => updates.push({ id, patch }),
    }, 'part');

    findButtonByText(tree, '저장').props.onClick?.();

    assert.equal(updates[0].patch.type, 'part', `${name}: changed type is sent`);
  }
});

test('vacation blocks edit and delete while retaining duplicate navigation', async () => {
  const target = event({ source: 'vacation', type: 'vacation' });
  const calendarTree = await renderQuickEdit(target, 'calendar');
  assert.equal(colorButtons(calendarTree).length, 0);
  const editTab = findButtonByText(calendarTree, '일정 편집');
  assert.match(String(editTab.props.className), /cursor-not-allowed/);
  assert.notEqual(findButtonByText(calendarTree, '복사').props.disabled, true);
  assert.equal(findButtonByText(calendarTree, '삭제').props.disabled, true);
});

test('new B flow duplicate and delete actions still invoke their callback and close once', async () => {
  const target = newBflowCases[0].target;
  for (const action of ['복사', '삭제'] as const) {
    const duplicated: QuickEditEvent[] = [];
    const deleted: string[] = [];
    let closeCount = 0;
    const tree = await renderQuickEdit(target, 'calendar', {
      onClose: () => { closeCount += 1; },
      onDuplicate: (value) => duplicated.push(value),
      onDelete: (id) => deleted.push(id),
    });

    findButtonByText(tree, action).props.onClick?.();

    if (action === '복사') {
      assert.deepEqual(duplicated, [target]);
      assert.deepEqual(deleted, []);
    } else {
      assert.deepEqual(duplicated, []);
      assert.deepEqual(deleted, [target.id]);
    }
    assert.equal(closeCount, 1, `${action} closes once`);
  }
});

test('read-only calendar events block update and delete but still allow duplicate', async () => {
  const cases: Array<{ name: string; target: QuickEditEvent }> = [
    {
      name: 'explicit read-only B flow event',
      target: event({
        source: 'bflow',
        sourceCalendarId: 'bflow:calendar-shared',
        calendarId: 'calendar-shared',
        isReadOnly: true,
      }),
    },
    {
      name: 'calendar event without edit permission',
      target: event({
        source: 'bflow',
        sourceCalendarId: 'bflow:calendar-shared',
        calendarId: 'calendar-shared',
        canEdit: false,
      }),
    },
  ];

  for (const { name, target } of cases) {
    const updates: Array<{ id: string; patch: Partial<QuickEditEvent> }> = [];
    const deleted: string[] = [];
    const duplicated: QuickEditEvent[] = [];
    let closeCount = 0;
    const calendarTree = await renderQuickEdit(target, 'calendar', {
      onClose: () => { closeCount += 1; },
      onUpdate: (id, patch) => updates.push({ id, patch }),
      onDelete: (id) => deleted.push(id),
      onDuplicate: (value) => duplicated.push(value),
    });

    assert.match(textContent(calendarTree), /보기 전용/);
    assert.equal(findButtonByText(calendarTree, '일정 편집').props.disabled, true, `${name}: edit tab is disabled`);
    const duplicateButton = findButtonByText(calendarTree, '복사');
    assert.notEqual(duplicateButton.props.disabled, true, `${name}: duplicate remains available`);
    duplicateButton.props.onClick?.();
    const deleteButton = findButtonByText(calendarTree, '삭제');
    assert.equal(deleteButton.props.disabled, true, `${name}: delete is disabled`);
    assert.equal(deleteButton.props.onClick, undefined, `${name}: delete has no write handler`);

    const editTree = await renderQuickEdit(target, 'edit', {
      onClose: () => { closeCount += 1; },
      onUpdate: (id, patch) => updates.push({ id, patch }),
      onDelete: (id) => deleted.push(id),
      onDuplicate: (value) => duplicated.push(value),
    });
    assert.match(textContent(editTree), /보기 전용 일정/);
    assert.equal(findButtons(editTree).some((button) => textContent(button).includes('저장')), false, `${name}: save is absent`);

    assert.deepEqual(updates, []);
    assert.deepEqual(deleted, []);
    assert.deepEqual(duplicated, [target]);
    assert.equal(closeCount, 1, `${name}: successful duplicate closes the popup once`);
  }
});

test('read-only shared event keeps its real details without vacation or write actions in the side panel', async () => {
  const target = event({
    source: 'bflow',
    calendarId: 'calendar-shared',
    type: 'scene',
    linkedSceneId: 'S001',
    isReadOnly: true,
    canEdit: false,
  });
  const deleted: string[] = [];
  const updated: Array<{ id: string; patch: Partial<QuickEditEvent> }> = [];
  const navigated: QuickEditEvent[] = [];
  let closeCount = 0;
  const tree = await renderSidePanel(target, {
    onClose: () => { closeCount += 1; },
    onDelete: (id) => deleted.push(id),
    onUpdate: (id, patch) => updated.push({ id, patch }),
    onNavigate: (value) => navigated.push(value),
  });
  const text = textContent(tree);

  assert.match(text, /테스트 일정/);
  assert.match(text, /씬/);
  assert.match(text, /보기 전용/);
  assert.doesNotMatch(text, /휴가 관리는|휴가 탭으로 이동/);
  assert.equal(
    findButtons(tree).some((button) => ['편집', '저장', '삭제'].includes(textContent(button).trim())),
    false,
    'read-only shared events expose no write button',
  );
  findButtonByText(tree, '이동').props.onClick?.();
  assert.deepEqual(deleted, []);
  assert.deepEqual(updated, []);
  assert.deepEqual(navigated, [target]);
  assert.equal(closeCount, 0);

  const linkedTodo = event({
    source: 'bflow',
    calendarId: 'calendar-shared',
    linkedTodoId: 'todo-1',
    isReadOnly: true,
    canEdit: false,
  });
  const todoTree = await renderSidePanel(linkedTodo);
  assert.ok(findButtonByText(todoTree, '할일로 이동'));
  assert.equal(
    findButtons(todoTree).some((button) => ['편집', '저장', '삭제'].includes(textContent(button).trim())),
    false,
    'read-only linked todos keep navigation without write actions',
  );
});

test('vacation and writable events keep their existing side-panel actions', async () => {
  const vacation = event({
    source: 'vacation',
    type: 'vacation',
    isReadOnly: true,
  }) as SidePanelProps['event'];
  vacation.vacationType = '연차';
  vacation.vacationUserName = '배한솔';
  const navigated: QuickEditEvent[] = [];
  let vacationCloseCount = 0;
  const vacationTree = await renderSidePanel(vacation, {
    onClose: () => { vacationCloseCount += 1; },
    onNavigate: (value) => navigated.push(value),
  });
  assert.match(textContent(vacationTree), /휴가 관리는 휴가 탭에서 관리합니다/);
  findButtonByText(vacationTree, '휴가 탭으로 이동').props.onClick?.();
  assert.deepEqual(navigated, [vacation]);
  assert.equal(vacationCloseCount, 1);

  const writable = event({ source: 'bflow', calendarId: 'calendar-owned', canEdit: true });
  const deleted: string[] = [];
  let writableCloseCount = 0;
  const writableTree = await renderSidePanel(writable, {
    onClose: () => { writableCloseCount += 1; },
    onDelete: (id) => deleted.push(id),
  });
  assert.ok(findButtonByText(writableTree, '편집'));
  findButtonByText(writableTree, '삭제').props.onClick?.();
  assert.deepEqual(deleted, [writable.id]);
  assert.equal(writableCloseCount, 1);
});
