import { glassDropdownTestModule, resolveGlassDropdown } from './helpers/glassDropdown.ts';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';
import { build } from 'esbuild';

type CalendarEventType = 'custom' | 'episode' | 'part' | 'scene' | 'vacation';

type TestCalendarEvent = {
  id: string;
  title: string;
  memo: string;
  color: string;
  type: CalendarEventType;
  startDate: string;
  endDate: string;
  createdBy: string;
  createdAt: string;
  source?: 'bflow' | 'google' | 'vacation' | 'ics';
  sourceCalendarId?: string;
  calendarId?: string;
  tagId?: string;
  canEdit?: boolean;
  isReadOnly?: boolean;
  isPrivate?: boolean;
  allDay?: boolean;
  startTime?: string;
  endTime?: string;
};

let quickEditIsPresent = true;
const quickEditDocumentListeners = new Map<string, Set<(event: unknown) => void>>();

/** 팝업이 document에 건 닫기 리스너를 직접 발화해 본다. */
function captureQuickEditDocumentListeners() {
  quickEditDocumentListeners.clear();
  return {
    fire(type: string, event: Record<string, unknown>) {
      for (const listener of [...(quickEditDocumentListeners.get(type) ?? [])]) listener(event);
    },
    restore() { quickEditDocumentListeners.clear(); },
  };
}

type ButtonElement = ReactElement<{
  children?: ReactNode;
  onClick?: () => unknown;
}, 'button'>;

type InputElement = ReactElement<{
  type?: string;
  value?: unknown;
}, 'input'>;

type HookStore = {
  state: unknown[];
  refs: Array<{ current: unknown }>;
  effects: Array<{
    dependencies: readonly unknown[] | undefined;
    cleanup?: () => void;
  } | undefined>;
  pendingEffects: Array<{
    slot: number;
    effect: () => void | (() => void);
  }>;
  stateCursor: number;
  refCursor: number;
  effectCursor: number;
};

type QuickEditComponent = (props: {
  event: TestCalendarEvent;
  position: { x: number; y: number };
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<TestCalendarEvent>) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onDuplicate: (event: TestCalendarEvent) => void | Promise<void>;
}) => ReactNode;

type SidePanelComponent = (props: {
  event: TestCalendarEvent;
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<TestCalendarEvent>) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onNavigate: (event: TestCalendarEvent) => void;
}) => ReactNode;

let activeHooks: HookStore | undefined;
let capturedPortal: ReactNode | undefined;
let quickEditModule: Promise<QuickEditComponent> | undefined;
let sidePanelModule: Promise<SidePanelComponent> | undefined;

function createHookStore(): HookStore {
  return {
    state: [],
    refs: [],
    effects: [],
    pendingEffects: [],
    stateCursor: 0,
    refCursor: 0,
    effectCursor: 0,
  };
}

function resetHookCursors(store: HookStore): void {
  store.stateCursor = 0;
  store.refCursor = 0;
  store.effectCursor = 0;
  store.pendingEffects = [];
}

function hasChangedDependencies(
  previous: readonly unknown[] | undefined,
  next: readonly unknown[] | undefined,
): boolean {
  if (previous === undefined || next === undefined) return true;
  return previous.length !== next.length || previous.some((value, index) => !Object.is(value, next[index]));
}

function flushEffects(store: HookStore): void {
  const pendingEffects = store.pendingEffects;
  store.pendingEffects = [];
  for (const { slot, effect } of pendingEffects) {
    const cleanup = effect();
    const slotState = store.effects[slot];
    if (slotState && typeof cleanup === 'function') slotState.cleanup = cleanup;
  }
}

function mockedReact(nodeRequire: NodeRequire): Record<string, unknown> {
  const react = nodeRequire('react') as Record<string, unknown>;
  return {
    ...react,
    useState(initial: unknown) {
      const store = activeHooks;
      assert.ok(store, 'a hook store must be active while rendering');
      const slot = store.stateCursor++;
      if (!(slot in store.state)) {
        store.state[slot] = typeof initial === 'function'
          ? (initial as () => unknown)()
          : initial;
      }
      return [store.state[slot], (next: unknown) => {
        store.state[slot] = typeof next === 'function'
          ? (next as (current: unknown) => unknown)(store.state[slot])
          : next;
      }];
    },
    useRef(initial: unknown) {
      const store = activeHooks;
      assert.ok(store, 'a hook store must be active while rendering');
      const slot = store.refCursor++;
      store.refs[slot] ??= { current: initial };
      return store.refs[slot];
    },
    useEffect(effect: () => void | (() => void), dependencies?: readonly unknown[]) {
      const store = activeHooks;
      assert.ok(store, 'a hook store must be active while rendering');
      const slot = store.effectCursor++;
      const previous = store.effects[slot];
      if (!previous || hasChangedDependencies(previous.dependencies, dependencies)) {
        previous?.cleanup?.();
        store.effects[slot] = { dependencies };
        store.pendingEffects.push({ slot, effect });
      }
    },
    useMemo(factory: () => unknown) {
      return factory();
    },
    useCallback(callback: unknown) {
      return callback;
    },
  };
}

function runtimeRequireFactory(nodeRequire: NodeRequire): (id: string) => unknown {
  return (id: string): unknown => {
    if (id === 'react') return mockedReact(nodeRequire);
    if (id === 'react/jsx-runtime') return nodeRequire('react/jsx-runtime');
    if (id === 'react-dom') {
      return {
        createPortal(child: ReactNode) {
          capturedPortal = child;
          return child;
        },
      };
    }
    if (id === 'framer-motion') {
      return {
        motion: { div: 'div' },
        AnimatePresence: ({ children }: { children: ReactNode }) => children,
        useIsPresent: () => quickEditIsPresent,
      };
    }
    if (id === 'lucide-react') {
      const Icon = () => null;
      return {
        CalendarDays: Icon,
        CheckSquare: Icon,
        Clock: Icon,
        Copy: Icon,
        ExternalLink: Icon,
        FileText: Icon,
        MapPin: Icon,
        Palmtree: Icon,
        Pencil: Icon,
        Save: Icon,
        Tags: Icon,
        Trash2: Icon,
        X: Icon,
        XCircle: Icon,
      };
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
          currentUser: { id: 'user-1' },
        }),
      };
    }
    if (id === '@/stores/useDataStore') {
      return {
        useDataStore: (selector: (state: { episodeTitles: Record<number, string> }) => unknown) => selector({ episodeTitles: {} }),
      };
    }
    if (id === '@/stores/useCalendarStore') {
      const tags: Array<{ id: string; name: string; color: string; sortOrder: number }> = [];
      return {
        useCalendarStore: (selector: (state: {
          calendars: Array<{ id: string; name: string; color: string; canEdit: boolean }>;
          tags: typeof tags;
          optimisticDeletedTagIds: string[];
        }) => unknown) => selector({
          calendars: [{ id: 'calendar-1', name: '내 일정', color: '#6C5CE7', canEdit: true }],
          tags,
          optimisticDeletedTagIds: [],
        }),
        getTagCanonicalSnapshot: () => ({ revision: 1, tags }),
        isOptimisticCalendarTagId: (idValue: string) => idValue.startsWith('optimistic-tag:'),
      };
    }
    if (id === '@/components/common/EntityAwareInput') return { EntityAwareInput: () => null };
    if (id === '@/components/common/EntityText') return { EntityText: () => null };
    if (id === '@/types') return { DEPARTMENT_CONFIGS: {} };
    if (id === '@/components/common/GlassDropdown') return glassDropdownTestModule;
      if (id === '@/utils/glassStyles') return { floatingGlassStyle: {} };
    if (id === '@/utils/calendarDate') return { parseDate: (value: string) => new Date(`${value}T12:00:00`) };
    if (id === '@/utils/calendarEventIdentity') {
      return {
        calendarEventIdentityKey(calendarEvent: TestCalendarEvent) {
          const isCanonicalBflow = calendarEvent.source === 'bflow'
            && calendarEvent.sourceCalendarId?.startsWith('bflow:') === true;
          if (isCanonicalBflow) return `bflow\u0000${calendarEvent.id}`;
          return `${calendarEvent.source ?? ''}\u0000${calendarEvent.sourceCalendarId ?? ''}\u0000${calendarEvent.id}`;
        },
        calendarEventLinkedTodoId: () => undefined,
      };
    }
    return nodeRequire(id);
  };
}

async function loadQuickEdit(): Promise<QuickEditComponent> {
  quickEditModule ??= build({
    entryPoints: ['src/components/calendar/EventQuickEdit.tsx'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    write: false,
    external: ['@/components/common/GlassDropdown',
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
    const module = { exports: {} as Record<string, unknown> };
    const nodeRequire = createRequire(import.meta.url);
    new Function('require', 'module', 'exports', result.outputFiles[0].text)(
      runtimeRequireFactory(nodeRequire),
      module,
      module.exports,
    );
    return module.exports.EventQuickEdit as QuickEditComponent;
  });
  return quickEditModule;
}

async function loadSidePanel(): Promise<SidePanelComponent> {
  sidePanelModule ??= build({
    entryPoints: ['src/components/calendar/EventSidePanel.tsx'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    write: false,
    external: ['@/components/common/GlassDropdown',
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
      '@/utils/calendarEventIdentity',
    ],
  }).then((result) => {
    const module = { exports: {} as Record<string, unknown> };
    const nodeRequire = createRequire(import.meta.url);
    new Function('require', 'module', 'exports', result.outputFiles[0].text)(
      runtimeRequireFactory(nodeRequire),
      module,
      module.exports,
    );
    return module.exports.EventSidePanel as SidePanelComponent;
  });
  return sidePanelModule;
}

function event(overrides: Partial<TestCalendarEvent> = {}): TestCalendarEvent {
  return {
    id: 'event-1',
    title: '원래 일정',
    memo: '',
    color: '#6C5CE7',
    type: 'custom',
    startDate: '2026-08-27',
    endDate: '2026-08-27',
    createdBy: '배한솔',
    createdAt: '2026-08-27T00:00:00.000Z',
    ...overrides,
  };
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

function findButtonByText(node: ReactNode, label: string): ButtonElement {
  const button = findButtons(node).find((candidate) => textContent(candidate).includes(label));
  assert.ok(button, `button '${label}' must exist`);
  return button;
}

function findTitleInput(node: ReactNode): InputElement {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findTitleInputOrUndefined(child);
      if (found) return found;
    }
  } else {
    const found = findTitleInputOrUndefined(node);
    if (found) return found;
  }
  assert.fail('an editable title input must exist');
}

function findTitleInputOrUndefined(node: ReactNode): InputElement | undefined {
  if (!isValidElement(node)) return undefined;
  const props = node.props as { children?: ReactNode; type?: string; value?: unknown };
  if (node.type === 'input' && (props.type === undefined || props.type === 'text')) return node as InputElement;
  const children = props.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findTitleInputOrUndefined(child);
      if (found) return found;
    }
    return undefined;
  }
  return findTitleInputOrUndefined(children);
}

function findAlerts(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(findAlerts);
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode; role?: string };
  return [
    ...(props.role === 'alert' ? [node] : []),
    ...findAlerts(props.children),
  ];
}

function rejectedThenable(reason: Error): Promise<void> {
  return {
    then(_resolve: (() => void) | undefined, reject: ((error: Error) => void) | undefined) {
      reject?.(reason);
    },
  } as unknown as Promise<void>;
}

function deferredThenable(): { promise: Promise<void>; reject: (reason: Error) => void } {
  let rejectHandler: ((reason: Error) => void) | undefined;
  return {
    promise: {
      then(_resolve: (() => void) | undefined, reject: ((reason: Error) => void) | undefined) {
        rejectHandler = reject;
      },
    } as unknown as Promise<void>,
    reject(reason: Error) {
      rejectHandler?.(reason);
    },
  };
}

async function invoke(button: ButtonElement): Promise<void> {
  await button.props.onClick?.();
}

async function renderQuickEdit(
  store: HookStore,
  callbacks: {
    onClose: () => void;
    onUpdate: (id: string, updates: Partial<TestCalendarEvent>) => void | Promise<void>;
    onDelete: (id: string) => void | Promise<void>;
    onDuplicate?: (event: TestCalendarEvent) => void | Promise<void>;
  },
  target = event(),
  runEffects = false,
): Promise<ReactNode> {
  const EventQuickEdit = await loadQuickEdit();
  const globalScope = globalThis as typeof globalThis & {
    document?: {
      body: object;
      addEventListener: () => void;
      removeEventListener: () => void;
    };
  };
  const previousDocument = globalScope.document;
  globalScope.document = {
    body: {},
    addEventListener(type: string, listener: (event: unknown) => void) {
      const bucket = quickEditDocumentListeners.get(type) ?? new Set();
      bucket.add(listener);
      quickEditDocumentListeners.set(type, bucket);
    },
    removeEventListener(type: string, listener: (event: unknown) => void) {
      quickEditDocumentListeners.get(type)?.delete(listener);
    },
  };
  activeHooks = store;
  resetHookCursors(store);
  capturedPortal = undefined;
  try {
    const render = () => EventQuickEdit({
      event: target,
      position: { x: 0, y: 0 },
      onClose: callbacks.onClose,
      onUpdate: callbacks.onUpdate,
      onDelete: callbacks.onDelete,
      onDuplicate: callbacks.onDuplicate ?? (() => {}),
    });
    render();
    if (runEffects) {
      flushEffects(store);
      resetHookCursors(store);
      render();
    }
    assert.ok(capturedPortal, 'quick edit portal must be captured');
    return capturedPortal;
  } finally {
    activeHooks = undefined;
    if (previousDocument === undefined) delete globalScope.document;
    else globalScope.document = previousDocument;
  }
}

async function renderSidePanel(
  store: HookStore,
  callbacks: {
    onClose: () => void;
    onUpdate: (id: string, updates: Partial<TestCalendarEvent>) => void | Promise<void>;
    onDelete: (id: string) => void | Promise<void>;
  },
  target = event(),
  runEffects = false,
): Promise<ReactNode> {
  const EventSidePanel = await loadSidePanel();
  const globalScope = globalThis as typeof globalThis & {
    window?: { addEventListener: () => void; removeEventListener: () => void };
  };
  const previousWindow = globalScope.window;
  if (runEffects) {
    globalScope.window = {
      addEventListener() {},
      removeEventListener() {},
    };
  }
  activeHooks = store;
  resetHookCursors(store);
  try {
    const render = () => EventSidePanel({
      event: target,
      onClose: callbacks.onClose,
      onUpdate: callbacks.onUpdate,
      onDelete: callbacks.onDelete,
      onNavigate: () => {},
    });
    let panel = render();
    if (runEffects) {
      flushEffects(store);
      resetHookCursors(store);
      panel = render();
    }
    return panel;
  } finally {
    activeHooks = undefined;
    if (runEffects) {
      if (previousWindow === undefined) delete globalScope.window;
      else globalScope.window = previousWindow;
    }
  }
}

test('quick edit stays open and explains a failed save', async () => {
  const hooks = createHookStore();
  hooks.state[1] = 'edit';
  hooks.state[2] = '바꾼 일정';
  let closeCalls = 0;
  const persistenceError = new Error('save failed');
  const callbacks = {
    onClose: () => { closeCalls += 1; },
    onUpdate: () => rejectedThenable(persistenceError),
    onDelete: () => {},
  };

  await invoke(findButtonByText(await renderQuickEdit(hooks, callbacks), '저장'));

  assert.equal(closeCalls, 0, 'failed save must not close the quick editor');
  const recovered = await renderQuickEdit(hooks, callbacks);
  assert.match(textContent(recovered), /일정 저장에 실패했어요/);
  assert.equal(findAlerts(recovered).length, 1, 'failed save must be announced to the user');
});

test('quick edit stays open and explains a failed deletion', async () => {
  const hooks = createHookStore();
  let closeCalls = 0;
  const persistenceError = new Error('delete failed');
  const callbacks = {
    onClose: () => { closeCalls += 1; },
    onUpdate: () => {},
    onDelete: () => rejectedThenable(persistenceError),
  };

  await invoke(findButtonByText(await renderQuickEdit(hooks, callbacks), '삭제'));

  assert.equal(closeCalls, 0, 'failed deletion must not close the quick editor');
  const recovered = await renderQuickEdit(hooks, callbacks);
  assert.match(textContent(recovered), /일정 삭제에 실패했어요/);
  assert.equal(findAlerts(recovered).length, 1, 'failed deletion must be announced to the user');
});

test('quick edit rehydrates a teammate update after preserving its failed-save rollback', async () => {
  const hooks = createHookStore();
  const originalEvent = event();
  const persistence = deferredThenable();
  const updateCalls: Array<Partial<TestCalendarEvent>> = [];
  const callbacks = {
    onClose: () => {},
    onUpdate: (_id: string, updates: Partial<TestCalendarEvent>) => {
      updateCalls.push(updates);
      return persistence.promise;
    },
    onDelete: () => {},
  };

  await renderQuickEdit(hooks, callbacks, originalEvent, true);
  hooks.state[1] = 'edit';
  hooks.state[2] = '내 저장 시도';

  await invoke(findButtonByText(await renderQuickEdit(hooks, callbacks, originalEvent, true), '저장'));
  persistence.reject(new Error('save failed'));

  const rollback = await renderQuickEdit(hooks, callbacks, event(), true);
  assert.match(textContent(rollback), /일정 저장에 실패했어요/);
  assert.equal(
    findTitleInput(rollback).props.value,
    '내 저장 시도',
    'the matching local rollback must retain the retry draft',
  );

  const teammateRefresh = await renderQuickEdit(
    hooks,
    callbacks,
    event({
      title: '팀원이 바꾼 최신 일정',
      startDate: '2026-08-28',
      endDate: '2026-08-29',
      type: 'scene',
      memo: '팀원이 남긴 최신 메모',
    }),
    true,
  );
  assert.equal(
    findAlerts(teammateRefresh).length,
    0,
    'a later teammate update must clear the stale local failure explanation',
  );
  assert.equal(
    findTitleInput(teammateRefresh).props.value,
    '팀원이 바꾼 최신 일정',
    'a later teammate update must replace the failed local draft before another save',
  );
  await invoke(findButtonByText(teammateRefresh, '저장'));
  assert.equal(
    updateCalls.length,
    1,
    'the rehydrated title, dates, type, and memo must not be saved back over the teammate update',
  );
});

test('quick edit accepts an early teammate refresh instead of treating it as a failed-save rollback', async () => {
  const hooks = createHookStore();
  const originalEvent = event();
  const persistence = deferredThenable();
  const updateCalls: Array<Partial<TestCalendarEvent>> = [];
  const callbacks = {
    onClose: () => {},
    onUpdate: (_id: string, updates: Partial<TestCalendarEvent>) => {
      updateCalls.push(updates);
      return persistence.promise;
    },
    onDelete: () => {},
  };
  const teammateEvent = event({
    title: '팀원이 먼저 바꾼 일정',
    startDate: '2026-08-28',
    endDate: '2026-08-29',
    type: 'scene',
    memo: '팀원이 먼저 남긴 메모',
  });

  await renderQuickEdit(hooks, callbacks, originalEvent, true);
  hooks.state[1] = 'edit';
  hooks.state[2] = '내 저장 시도';

  await invoke(findButtonByText(await renderQuickEdit(hooks, callbacks, originalEvent, true), '저장'));
  await renderQuickEdit(hooks, callbacks, teammateEvent, true);
  persistence.reject(new Error('save failed'));

  const recovered = await renderQuickEdit(hooks, callbacks, teammateEvent, true);
  assert.equal(
    findAlerts(recovered).length,
    0,
    'an early teammate refresh must clear the local failure explanation instead of being consumed as rollback',
  );
  assert.equal(
    findTitleInput(recovered).props.value,
    '팀원이 먼저 바꾼 일정',
    'an early teammate refresh must replace the stale local draft immediately after failure',
  );
  await invoke(findButtonByText(recovered, '저장'));
  assert.equal(
    updateCalls.length,
    1,
    'the rehydrated teammate data must not be written back as another stale save',
  );
});

test('side panel keeps edit mode and explains a failed save', async () => {
  const hooks = createHookStore();
  hooks.state[0] = true;
  hooks.state[1] = '바꾼 일정';
  const persistenceError = new Error('save failed');
  const callbacks = {
    onClose: () => {},
    onUpdate: () => rejectedThenable(persistenceError),
    onDelete: () => {},
  };

  await invoke(findButtonByText(await renderSidePanel(hooks, callbacks), '저장'));

  const recovered = await renderSidePanel(hooks, callbacks);
  assert.ok(findButtons(recovered).some((button) => textContent(button).includes('저장')), 'failed save must keep side-panel edit mode open');
  assert.match(textContent(recovered), /일정 저장에 실패했어요/);
  assert.equal(findAlerts(recovered).length, 1, 'failed save must be announced to the user');
});

test('side panel stays open and explains a failed deletion', async () => {
  const hooks = createHookStore();
  let closeCalls = 0;
  const persistenceError = new Error('delete failed');
  const callbacks = {
    onClose: () => { closeCalls += 1; },
    onUpdate: () => {},
    onDelete: () => rejectedThenable(persistenceError),
  };

  await invoke(findButtonByText(await renderSidePanel(hooks, callbacks), '삭제'));

  assert.equal(closeCalls, 0, 'failed deletion must not close the side panel');
  const recovered = await renderSidePanel(hooks, callbacks);
  assert.match(textContent(recovered), /일정 삭제에 실패했어요/);
  assert.equal(findAlerts(recovered).length, 1, 'failed deletion must be announced to the user');
});

test('side panel keeps failed save recovery when a same-event rollback is batched with rejection', async () => {
  const hooks = createHookStore();
  const originalEvent = event();
  const persistence = deferredThenable();
  const callbacks = {
    onClose: () => {},
    onUpdate: () => persistence.promise,
    onDelete: () => {},
  };

  await renderSidePanel(hooks, callbacks, originalEvent, true);
  hooks.state[0] = true;
  hooks.state[1] = '바꾼 일정';

  await invoke(findButtonByText(await renderSidePanel(hooks, callbacks, originalEvent, true), '저장'));
  persistence.reject(new Error('save failed'));

  const restoredSameEvent = await renderSidePanel(
    hooks,
    callbacks,
    event(),
    true,
  );
  assert.ok(
    findButtons(restoredSameEvent).some((button) => textContent(button).includes('저장')),
    'a rollback refresh for the same event must keep retryable edit mode open',
  );
  assert.match(
    textContent(restoredSameEvent),
    /일정 저장에 실패했어요/,
    'a rollback refresh for the same event must keep its failure explanation visible',
  );
  assert.equal(
    findTitleInput(restoredSameEvent).props.value,
    '바꾼 일정',
    'a rollback refresh must keep the retry draft instead of overwriting it',
  );
});

test('side panel keeps failed deletion explanation when a same-event rollback is batched with rejection', async () => {
  const hooks = createHookStore();
  const originalEvent = event();
  const persistence = deferredThenable();
  const callbacks = {
    onClose: () => {},
    onUpdate: () => {},
    onDelete: () => persistence.promise,
  };

  await renderSidePanel(hooks, callbacks, originalEvent, true);
  await invoke(findButtonByText(await renderSidePanel(hooks, callbacks, originalEvent), '삭제'));
  persistence.reject(new Error('delete failed'));

  const restoredSameEvent = await renderSidePanel(
    hooks,
    callbacks,
    event(),
    true,
  );
  assert.match(
    textContent(restoredSameEvent),
    /일정 삭제에 실패했어요/,
    'a rollback refresh for the same event must keep its deletion failure explanation visible',
  );
});

test('side panel accepts a teammate update after preserving its failed-save rollback', async () => {
  const hooks = createHookStore();
  const originalEvent = event();
  const persistence = deferredThenable();
  const callbacks = {
    onClose: () => {},
    onUpdate: () => persistence.promise,
    onDelete: () => {},
  };

  await renderSidePanel(hooks, callbacks, originalEvent, true);
  hooks.state[0] = true;
  hooks.state[1] = '내 저장 시도';

  await invoke(findButtonByText(await renderSidePanel(hooks, callbacks, originalEvent, true), '저장'));
  persistence.reject(new Error('save failed'));

  const rollback = await renderSidePanel(
    hooks,
    callbacks,
    event({ title: '원래 일정' }),
    true,
  );
  assert.match(textContent(rollback), /일정 저장에 실패했어요/);
  assert.equal(
    findTitleInput(rollback).props.value,
    '내 저장 시도',
    'the matching local rollback must retain the retry draft',
  );

  const teammateRefresh = await renderSidePanel(
    hooks,
    callbacks,
    event({ title: '팀원이 바꾼 최신 일정' }),
    true,
  );
  assert.equal(
    findButtons(teammateRefresh).some((button) => textContent(button).includes('저장')),
    false,
    'a later teammate update must leave failed local edit mode',
  );
  assert.equal(
    findAlerts(teammateRefresh).length,
    0,
    'a later teammate update must clear the stale local failure explanation',
  );

  await invoke(findButtonByText(teammateRefresh, '편집'));
  const editableTeammateRefresh = await renderSidePanel(hooks, callbacks, event({ title: '팀원이 바꾼 최신 일정' }));
  assert.equal(
    findTitleInput(editableTeammateRefresh).props.value,
    '팀원이 바꾼 최신 일정',
    'a later teammate update must replace the failed local draft before another save',
  );
});

test('side panel rehydrates a teammate update when a failed save has no rollback refresh', async () => {
  const hooks = createHookStore();
  const originalEvent = event();
  const teammateEvent = event({
    title: '팀원이 바꾼 최신 일정',
    memo: '동료가 남긴 메모',
    startDate: '2026-08-28',
    endDate: '2026-08-29',
  });
  const persistence = deferredThenable();
  const updateCalls: Array<Partial<TestCalendarEvent>> = [];
  const callbacks = {
    onClose: () => {},
    onUpdate: (_id: string, updates: Partial<TestCalendarEvent>) => {
      updateCalls.push(updates);
      return persistence.promise;
    },
    onDelete: () => {},
  };

  await renderSidePanel(hooks, callbacks, originalEvent, true);
  hooks.state[0] = true;
  hooks.state[1] = '내 저장 시도';

  await invoke(findButtonByText(await renderSidePanel(hooks, callbacks, originalEvent, true), '저장'));
  persistence.reject(new Error('save failed'));

  const teammateRefresh = await renderSidePanel(hooks, callbacks, teammateEvent, true);
  assert.equal(
    findButtons(teammateRefresh).some((button) => textContent(button).includes('저장')),
    false,
    'a teammate update must leave failed local edit mode when no matching rollback arrived',
  );
  assert.equal(
    findAlerts(teammateRefresh).length,
    0,
    'a teammate update must clear the failed local save explanation instead of being consumed as rollback',
  );

  await invoke(findButtonByText(teammateRefresh, '편집'));
  const editableTeammateRefresh = await renderSidePanel(hooks, callbacks, teammateEvent);
  assert.equal(
    findTitleInput(editableTeammateRefresh).props.value,
    '팀원이 바꾼 최신 일정',
    'the panel must rehydrate the teammate title before a retry can overwrite it',
  );
  await invoke(findButtonByText(editableTeammateRefresh, '저장'));
  assert.equal(
    updateCalls.length,
    1,
    'the rehydrated teammate event must not be sent back as the stale local retry',
  );
});

test('side panel accepts an early teammate refresh before a failed save settles', async () => {
  const hooks = createHookStore();
  const originalEvent = event();
  const teammateEvent = event({
    title: '팀원이 먼저 바꾼 일정',
    memo: '동료가 먼저 남긴 메모',
    startDate: '2026-08-28',
    endDate: '2026-08-29',
  });
  const persistence = deferredThenable();
  const updateCalls: Array<Partial<TestCalendarEvent>> = [];
  const callbacks = {
    onClose: () => {},
    onUpdate: (_id: string, updates: Partial<TestCalendarEvent>) => {
      updateCalls.push(updates);
      return persistence.promise;
    },
    onDelete: () => {},
  };

  await renderSidePanel(hooks, callbacks, originalEvent, true);
  hooks.state[0] = true;
  hooks.state[1] = '내 저장 시도';

  await invoke(findButtonByText(await renderSidePanel(hooks, callbacks, originalEvent, true), '저장'));
  await renderSidePanel(hooks, callbacks, teammateEvent, true);
  persistence.reject(new Error('save failed'));

  const recovered = await renderSidePanel(hooks, callbacks, teammateEvent, true);
  assert.equal(
    findButtons(recovered).some((button) => textContent(button).includes('저장')),
    false,
    'an early teammate refresh must leave edit mode when the local save later fails',
  );
  assert.equal(
    findAlerts(recovered).length,
    0,
    'an early teammate refresh must clear the failed local save explanation',
  );

  await invoke(findButtonByText(recovered, '편집'));
  const editable = await renderSidePanel(hooks, callbacks, teammateEvent, true);
  assert.equal(
    findTitleInput(editable).props.value,
    '팀원이 먼저 바꾼 일정',
    'the teammate event captured during the pending save must replace the stale draft after rejection',
  );
  await invoke(findButtonByText(editable, '저장'));
  assert.equal(
    updateCalls.length,
    1,
    'the captured teammate event must not be written back as a stale retry',
  );
});

test('side panel keeps the retry draft when its own optimistic save renders before the rejection', async () => {
  const hooks = createHookStore();
  const originalEvent = event();
  const persistence = deferredThenable();
  const callbacks = {
    onClose: () => {},
    onUpdate: () => persistence.promise,
    onDelete: () => {},
  };

  await renderSidePanel(hooks, callbacks, originalEvent, true);
  hooks.state[0] = true;
  hooks.state[1] = '내 저장 시도';

  await invoke(findButtonByText(await renderSidePanel(hooks, callbacks, originalEvent, true), '저장'));

  // 저장이 오래 걸려 낙관적 갱신이 먼저 화면에 반영된 상태에서 요청이 실패한다.
  const optimisticEvent = event({ title: '내 저장 시도' });
  await renderSidePanel(hooks, callbacks, optimisticEvent, true);
  persistence.reject(new Error('save failed'));

  const recovered = await renderSidePanel(hooks, callbacks, optimisticEvent, true);
  assert.ok(
    findButtons(recovered).some((button) => textContent(button).includes('저장')),
    'a rendered optimistic save must not be mistaken for a teammate update that closes edit mode',
  );
  assert.match(
    textContent(recovered),
    /일정 저장에 실패했어요/,
    'the failure explanation must survive its own optimistic refresh',
  );
  assert.equal(
    findTitleInput(recovered).props.value,
    '내 저장 시도',
    'the retry draft must survive a rejection that arrives after the optimistic render',
  );

  // 그 뒤 도착한 동료의 실제 변경은 여전히 최신 값으로 다시 채운다.
  const teammateEvent = event({ title: '팀원이 바꾼 일정' });
  const rehydrated = await renderSidePanel(hooks, callbacks, teammateEvent, true);
  assert.equal(
    findAlerts(rehydrated).length,
    0,
    'a later teammate change must still clear the local failure explanation',
  );
});

test('side panel drops its failed-save recovery once the user cancels the edit', async () => {
  const hooks = createHookStore();
  const originalEvent = event();
  const persistence = deferredThenable();
  const updateCalls: Array<Partial<TestCalendarEvent>> = [];
  const callbacks = {
    onClose: () => {},
    onUpdate: (_id: string, updates: Partial<TestCalendarEvent>) => {
      updateCalls.push(updates);
      return persistence.promise;
    },
    onDelete: () => {},
  };

  await renderSidePanel(hooks, callbacks, originalEvent, true);
  hooks.state[0] = true;
  hooks.state[1] = '내가 버릴 제목';

  await invoke(findButtonByText(await renderSidePanel(hooks, callbacks, originalEvent, true), '저장'));
  persistence.reject(new Error('save failed'));

  const failed = await renderSidePanel(hooks, callbacks, originalEvent, true);
  assert.match(textContent(failed), /일정 저장에 실패했어요/);

  await invoke(findButtonByText(failed, '취소'));
  const cancelled = await renderSidePanel(hooks, callbacks, originalEvent, true);
  assert.equal(findAlerts(cancelled).length, 0, '편집을 취소하면 실패 안내도 함께 사라진다');

  // 동료가 우연히 버려진 초안과 같은 내용으로 바꿔도 로컬 echo로 오인하면 안 된다.
  const teammateEvent = event({ title: '내가 버릴 제목' });
  await renderSidePanel(hooks, callbacks, teammateEvent, true);
  await invoke(findButtonByText(await renderSidePanel(hooks, callbacks, teammateEvent, true), '편집'));
  const editable = await renderSidePanel(hooks, callbacks, teammateEvent, true);
  assert.equal(
    findTitleInput(editable).props.value,
    '내가 버릴 제목',
    '취소 뒤 편집은 버려진 초안이 아니라 정본 값에서 시작한다',
  );
  await invoke(findButtonByText(editable, '저장'));
  assert.equal(updateCalls.length, 1, '정본과 같은 값은 다시 저장 요청을 만들지 않는다');
});

test('side panel and quick edit refuse a second save while the first one is still pending', async () => {
  const sidePanelHooks = createHookStore();
  const sidePanelEvent = event();
  const sidePanelPersistence = deferredThenable();
  const sidePanelUpdates: Array<Partial<TestCalendarEvent>> = [];
  const sidePanelCallbacks = {
    onClose: () => {},
    onUpdate: (_id: string, updates: Partial<TestCalendarEvent>) => {
      sidePanelUpdates.push(updates);
      return sidePanelPersistence.promise;
    },
    onDelete: () => {},
  };

  await renderSidePanel(sidePanelHooks, sidePanelCallbacks, sidePanelEvent, true);
  sidePanelHooks.state[0] = true;
  sidePanelHooks.state[1] = '첫 번째 저장';
  await invoke(findButtonByText(await renderSidePanel(sidePanelHooks, sidePanelCallbacks, sidePanelEvent, true), '저장'));

  // 저장이 아직 끝나지 않은 사이에 초안을 더 바꾸고 다시 저장을 눌러 본다.
  sidePanelHooks.state[1] = '두 번째 저장';
  const pendingPanel = await renderSidePanel(sidePanelHooks, sidePanelCallbacks, sidePanelEvent, true);
  const pendingSaveButton = findButtonByText(pendingPanel, '저장');
  assert.equal(pendingSaveButton.props.disabled, true, '저장 중에는 저장 버튼을 다시 누를 수 없다');
  await invoke(pendingSaveButton);
  assert.equal(
    sidePanelUpdates.length,
    1,
    '진행 중인 저장이 끝나기 전에는 같은 일정의 두 번째 저장을 보내지 않는다',
  );

  const quickHooks = createHookStore();
  const quickEvent = event();
  const quickPersistence = deferredThenable();
  const quickUpdates: Array<Partial<TestCalendarEvent>> = [];
  const quickCallbacks = {
    onClose: () => {},
    onUpdate: (_id: string, updates: Partial<TestCalendarEvent>) => {
      quickUpdates.push(updates);
      return quickPersistence.promise;
    },
    onDelete: () => {},
  };

  await renderQuickEdit(quickHooks, quickCallbacks, quickEvent, true);
  quickHooks.state[1] = 'edit';
  quickHooks.state[2] = '첫 번째 저장';
  await invoke(findButtonByText(await renderQuickEdit(quickHooks, quickCallbacks, quickEvent, true), '저장'));

  quickHooks.state[2] = '두 번째 저장';
  const pendingQuick = await renderQuickEdit(quickHooks, quickCallbacks, quickEvent, true);
  const pendingQuickSave = findButtonByText(pendingQuick, '저장');
  assert.equal(pendingQuickSave.props.disabled, true, '빠른 편집도 저장 중에는 저장 버튼을 잠근다');
  await invoke(pendingQuickSave);
  assert.equal(quickUpdates.length, 1, '빠른 편집도 진행 중인 저장과 두 번째 저장을 겹치지 않는다');
});

test('editors lock their draft fields while a save is pending', async () => {
  // 저장 버튼만 잠그면 그 사이에 고친 내용이 화면에는 보이지만 저장되지 않은 채
  // 편집기가 닫혀 조용히 사라진다. 진행 중에는 입력칸도 함께 잠근다.
  const quickHooks = createHookStore();
  const quickEvent = event();
  const quickPersistence = deferredThenable();
  const quickCallbacks = {
    onClose: () => {},
    onUpdate: () => quickPersistence.promise,
    onDelete: () => {},
  };

  await renderQuickEdit(quickHooks, quickCallbacks, quickEvent, true);
  quickHooks.state[1] = 'edit';
  quickHooks.state[2] = '저장할 제목';
  await invoke(findButtonByText(await renderQuickEdit(quickHooks, quickCallbacks, quickEvent, true), '저장'));

  const pendingQuick = await renderQuickEdit(quickHooks, quickCallbacks, quickEvent, true);
  assert.equal(
    findTitleInput(pendingQuick).props.disabled,
    true,
    '빠른 편집은 저장 중 제목 입력을 잠근다',
  );

  const sidePanelHooks = createHookStore();
  const sidePanelEvent = event();
  const sidePanelPersistence = deferredThenable();
  const sidePanelCallbacks = {
    onClose: () => {},
    onUpdate: () => sidePanelPersistence.promise,
    onDelete: () => {},
  };

  await renderSidePanel(sidePanelHooks, sidePanelCallbacks, sidePanelEvent, true);
  sidePanelHooks.state[0] = true;
  sidePanelHooks.state[1] = '저장할 제목';
  await invoke(findButtonByText(await renderSidePanel(sidePanelHooks, sidePanelCallbacks, sidePanelEvent, true), '저장'));

  const pendingPanel = await renderSidePanel(sidePanelHooks, sidePanelCallbacks, sidePanelEvent, true);
  assert.equal(
    findTitleInput(pendingPanel).props.disabled,
    true,
    '상세 패널도 저장 중 제목 입력을 잠근다',
  );
});

test('side panel rehydrates a same-event teammate update that is unrelated to a local mutation', async () => {
  const hooks = createHookStore();
  const originalEvent = event();
  const teammateUpdate = event({ title: '팀원이 바꾼 일정' });
  const callbacks = {
    onClose: () => {},
    onUpdate: () => {},
    onDelete: () => {},
  };

  await renderSidePanel(hooks, callbacks, originalEvent, true);
  hooks.state[0] = true;
  hooks.state[1] = '내 임시 제목';

  const refreshed = await renderSidePanel(hooks, callbacks, teammateUpdate, true);
  assert.equal(
    findButtons(refreshed).some((button) => textContent(button).includes('저장')),
    false,
    'an unrelated teammate update must leave local edit mode and use the latest event data',
  );

  await invoke(findButtonByText(refreshed, '편집'));
  const editable = await renderSidePanel(hooks, callbacks, teammateUpdate);
  assert.equal(
    findTitleInput(editable).props.value,
    '팀원이 바꾼 일정',
    'an unrelated teammate update must replace the stale local draft with the latest title',
  );
});

test('the side panel names the subscription and shows its time', async () => {
  const hooks = createHookStore();
  const callbacks = { onClose() {}, onUpdate() {}, onDelete() {} };
  const subscribed = event({
    id: 'ics:sub-1:ext-1:2026-08-27',
    title: '외부 세미나',
    createdBy: '외부 팀 캘린더',
    source: 'ics',
    sourceCalendarId: 'ics:sub-1',
    canEdit: false,
    isReadOnly: true,
    allDay: false,
    startTime: '14:00',
    endTime: '15:00',
  });

  const panel = await renderSidePanel(hooks, callbacks, subscribed);
  const text = textContent(panel);

  assert.match(text, /외부 팀 캘린더/, '구독 일정은 구독 이름을 보여 준다');
  assert.doesNotMatch(text, /이전 일정/, "'이전 일정' 폴백으로 새지 않는다");
  assert.match(text, /14:00 – 15:00/, '구독 시각 일정의 시각을 보여 준다');
});

test('side panel explains a failed calendar move instead of silently closing', async () => {
  const hooks = createHookStore();
  const originalEvent = event({
    source: 'bflow',
    sourceCalendarId: 'bflow:calendar-2',
    calendarId: 'calendar-2',
    color: '#8B8DA3',
    canEdit: true,
    isReadOnly: false,
  });
  const persistence = deferredThenable();
  const callbacks = {
    onClose: () => {},
    onUpdate: () => persistence.promise,
    onDelete: () => {},
  };

  await renderSidePanel(hooks, callbacks, originalEvent, true);
  hooks.state[0] = true;          // editing
  hooks.state[5] = 'calendar-1';  // 다른 캘린더로 옮긴다

  await invoke(findButtonByText(await renderSidePanel(hooks, callbacks, originalEvent, true), '저장'));

  // calendarService의 낙관 반영은 목적지 캘린더의 색·권한까지 파생해서 얹는다.
  // 실제 서비스는 목적지 캘린더 기준으로 색·권한·공개범위까지 명시해서 얹는다.
  const optimisticEvent = event({
    source: 'bflow',
    sourceCalendarId: 'bflow:calendar-1',
    calendarId: 'calendar-1',
    color: '#6C5CE7',
    canEdit: true,
    isReadOnly: false,
    isPrivate: false,
  });
  await renderSidePanel(hooks, callbacks, optimisticEvent, true);
  persistence.reject(new Error('move failed'));

  const recovered = await renderSidePanel(hooks, callbacks, optimisticEvent, true);
  assert.match(
    textContent(recovered),
    /일정 저장에 실패했어요/,
    '캘린더를 옮기다 실패해도 안내 없이 편집이 닫히면 안 된다',
  );
  assert.ok(
    findButtons(recovered).some((button) => textContent(button).includes('저장')),
    '실패한 이동은 편집 모드와 초안을 유지한다',
  );
});

test('quick edit stays open and explains a failed duplicate', async () => {
  const hooks = createHookStore();
  let closeCalls = 0;
  const readOnly = event({
    source: 'bflow',
    sourceCalendarId: 'bflow:view-share',
    calendarId: 'view-share',
    canEdit: false,
    isReadOnly: true,
  });
  const callbacks = {
    onClose: () => { closeCalls += 1; },
    onUpdate: () => {},
    onDelete: () => {},
    onDuplicate: () => rejectedThenable(new Error('duplicate failed')),
  };

  await invoke(findButtonByText(await renderQuickEdit(hooks, callbacks, readOnly), '복사'));

  assert.equal(closeCalls, 0, '복사가 실패하면 팝업을 닫지 않는다');
  const recovered = await renderQuickEdit(hooks, callbacks, readOnly);
  assert.match(textContent(recovered), /복사하지 못했어요/);
  assert.equal(findAlerts(recovered).length, 1, '복사 실패도 사용자에게 알린다');
});

test('quick edit closes on a successful duplicate', async () => {
  const hooks = createHookStore();
  let closeCalls = 0;
  const callbacks = {
    onClose: () => { closeCalls += 1; },
    onUpdate: () => {},
    onDelete: () => {},
    onDuplicate: () => Promise.resolve(),
  };

  await invoke(findButtonByText(await renderQuickEdit(hooks, callbacks), '복사'));
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(closeCalls, 1, '복사가 성공하면 평소처럼 닫힌다');
});

test('quick edit ignores outside clicks and Escape while it is animating away', async () => {
  const hooks = createHookStore();
  let closeCalls = 0;
  const callbacks = { onClose: () => { closeCalls += 1; }, onUpdate: () => {}, onDelete: () => {} };
  const listeners = captureQuickEditDocumentListeners();
  // 하네스 계약: 같은 이벤트 객체를 재사용해야 rehydrate effect가 돌지 않는다.
  const target = event();
  try {
    quickEditIsPresent = false;
    await renderQuickEdit(hooks, callbacks, target, true);

    listeners.fire('mousedown', { target: {} });
    listeners.fire('keydown', { key: 'Escape' });
    assert.equal(closeCalls, 0, 'exit 중인 인스턴스는 새 팝업의 첫 클릭을 삼키지 않는다');
  } finally {
    quickEditIsPresent = true;
    listeners.restore();
  }
});

test('quick edit keeps its portal dropdown interactive and still closes for outside clicks', async () => {
  const hooks = createHookStore();
  let closeCalls = 0;
  const callbacks = { onClose: () => { closeCalls += 1; }, onUpdate: () => {}, onDelete: () => {} };
  const listeners = captureQuickEditDocumentListeners();
  try {
    await renderQuickEdit(hooks, callbacks, event(), true);
    hooks.refs[0].current = { contains: () => false };
    listeners.fire('mousedown', { target: { closest: (selector: string) => selector === '[data-dropdown-owner="calendar-quick-edit"]' ? {} : null } });
    assert.equal(closeCalls, 0, 'choosing a calendar in the body portal must not dismiss the editor');
    listeners.fire('mousedown', { target: { closest: () => null } });
    assert.equal(closeCalls, 1, 'a normal outside click still dismisses the editor');
  } finally {
    listeners.restore();
  }
});

test('quick edit refuses to close while a save is still pending', async () => {
  const hooks = createHookStore();
  let closeCalls = 0;
  const persistence = deferredThenable();
  const callbacks = {
    onClose: () => { closeCalls += 1; },
    onUpdate: () => persistence.promise,
    onDelete: () => {},
  };
  const listeners = captureQuickEditDocumentListeners();
  // 하네스 계약: 같은 이벤트 객체를 재사용해야 rehydrate effect가 초안을 지우지 않는다.
  const target = event();
  try {
    await renderQuickEdit(hooks, callbacks, target, true);
    hooks.state[1] = 'edit';
    hooks.state[2] = '바꾼 일정';
    await invoke(findButtonByText(await renderQuickEdit(hooks, callbacks, target, true), '저장'));

    listeners.fire('mousedown', { target: {} });
    listeners.fire('keydown', { key: 'Escape' });
    assert.equal(closeCalls, 0, '저장 중에 닫으면 실패 안내를 띄울 곳이 사라진다');

    persistence.reject(new Error('save failed'));
    const recovered = await renderQuickEdit(hooks, callbacks, target, true);
    assert.match(textContent(recovered), /일정 저장에 실패했어요/);
  } finally {
    listeners.restore();
  }
});

function findSelects(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  node = resolveGlassDropdown(node);
  if (Array.isArray(node)) return node.flatMap(findSelects);
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [
    ...(element.type === 'select' ? [element] : []),
    ...findSelects(element.props.children as ReactNode),
  ];
}

test('editors lock calendar, tag and chip pickers while a save is pending', async () => {
  // 퀵에디트: 저장 대기 중에는 캘린더·태그 변경 요청 자체를 보내지 않는다.
  const quickHooks = createHookStore();
  const quickTarget = event({
    source: 'bflow',
    sourceCalendarId: 'bflow:calendar-1',
    calendarId: 'calendar-1',
  });
  const updates: Array<Partial<TestCalendarEvent>> = [];
  const persistence = deferredThenable();
  const quickCallbacks = {
    onClose: () => {},
    onUpdate: (_id: string, patch: Partial<TestCalendarEvent>) => {
      updates.push(patch);
      return persistence.promise;
    },
    onDelete: () => {},
  };

  await renderQuickEdit(quickHooks, quickCallbacks, quickTarget, true);
  quickHooks.state[1] = 'edit';
  quickHooks.state[2] = '바꾼 일정';
  await invoke(findButtonByText(await renderQuickEdit(quickHooks, quickCallbacks, quickTarget, true), '저장'));
  assert.equal(updates.length, 1, '저장 요청이 하나 나갔다');

  const pendingTree = await renderQuickEdit(quickHooks, quickCallbacks, quickTarget, true);
  const calendarSelect = findSelects(pendingTree)
    .find((element) => element.props['aria-label'] === '캘린더');
  if (calendarSelect) {
    (calendarSelect.props.onChange as ((changeEvent: unknown) => void) | undefined)?.({
      target: { value: 'calendar-2' },
    });
    await Promise.resolve();
  }
  assert.equal(updates.length, 1, '저장 대기 중에는 캘린더 변경을 보내지 않는다');

  // 상세 패널: 저장 대기 중에는 태그 칩도 잠근다.
  const panelHooks = createHookStore();
  const panelTarget = event({
    source: 'bflow',
    sourceCalendarId: 'bflow:calendar-1',
    calendarId: 'calendar-1',
  });
  const panelPersistence = deferredThenable();
  const panelCallbacks = {
    onClose: () => {},
    onUpdate: () => panelPersistence.promise,
    onDelete: () => {},
  };

  await renderSidePanel(panelHooks, panelCallbacks, panelTarget, true);
  panelHooks.state[0] = true;
  panelHooks.state[1] = '바꾼 일정';
  await invoke(findButtonByText(await renderSidePanel(panelHooks, panelCallbacks, panelTarget, true), '저장'));

  const panelPending = await renderSidePanel(panelHooks, panelCallbacks, panelTarget, true);
  const noneChip = findButtons(panelPending).find((button) => textContent(button).trim() === '없음');
  assert.ok(noneChip, "태그 '없음' 칩이 있다");
  assert.equal(noneChip.props.disabled, true, '저장 대기 중에는 태그 칩도 잠근다');
});
