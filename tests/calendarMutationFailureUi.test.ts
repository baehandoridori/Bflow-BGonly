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
  source?: 'bflow' | 'google' | 'vacation';
  sourceCalendarId?: string;
  calendarId?: string;
  tagId?: string;
  canEdit?: boolean;
  isReadOnly?: boolean;
  allDay?: boolean;
  startTime?: string;
  endTime?: string;
};

type ButtonElement = ReactElement<{
  children?: ReactNode;
  onClick?: () => unknown;
}, 'button'>;

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
  onDuplicate: (event: TestCalendarEvent) => void;
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

async function invoke(button: ButtonElement): Promise<void> {
  await button.props.onClick?.();
}

async function renderQuickEdit(
  store: HookStore,
  callbacks: {
    onClose: () => void;
    onUpdate: (id: string, updates: Partial<TestCalendarEvent>) => void | Promise<void>;
    onDelete: (id: string) => void | Promise<void>;
  },
): Promise<ReactNode> {
  const EventQuickEdit = await loadQuickEdit();
  const globalScope = globalThis as typeof globalThis & { document?: { body: object } };
  const previousDocument = globalScope.document;
  globalScope.document = { body: {} };
  activeHooks = store;
  resetHookCursors(store);
  capturedPortal = undefined;
  try {
    EventQuickEdit({
      event: event(),
      position: { x: 0, y: 0 },
      onClose: callbacks.onClose,
      onUpdate: callbacks.onUpdate,
      onDelete: callbacks.onDelete,
      onDuplicate: () => {},
    });
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

test('side panel keeps failed save recovery on a same-event rollback refresh', async () => {
  const hooks = createHookStore();
  hooks.state[0] = true;
  hooks.state[1] = '바꾼 일정';
  const callbacks = {
    onClose: () => {},
    onUpdate: () => rejectedThenable(new Error('save failed')),
    onDelete: () => {},
  };

  await invoke(findButtonByText(await renderSidePanel(hooks, callbacks), '저장'));

  const restoredSameEvent = await renderSidePanel(
    hooks,
    callbacks,
    event({ title: '복구된 원래 일정' }),
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

  const nextEvent = await renderSidePanel(hooks, callbacks, event({ id: 'event-2', title: '다른 일정' }), true);
  assert.equal(
    findButtons(nextEvent).some((button) => textContent(button).includes('저장')),
    false,
    'switching to another event must leave the old retry mode behind',
  );
  assert.equal(findAlerts(nextEvent).length, 0, 'switching to another event must clear the previous event failure');
});
