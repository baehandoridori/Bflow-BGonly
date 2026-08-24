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
  canEdit?: boolean;
  isReadOnly?: boolean;
};

type QuickEditProps = {
  event: QuickEditEvent;
  position: { x: number; y: number };
  onClose(): void;
  onUpdateColor(id: string, color: string): void;
  onUpdate(id: string, updates: Partial<QuickEditEvent>): void;
  onDelete(id: string): void;
  onDuplicate(event: QuickEditEvent): void;
};

type QuickEditComponent = (props: QuickEditProps) => ReactNode;

type ButtonElement = ReactElement<{
  'aria-describedby'?: string;
  'aria-label'?: string;
  className?: string;
  children?: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  style?: Record<string, unknown>;
}, 'button'>;

type QuickEditCallbacks = Pick<
  QuickEditProps,
  'onClose' | 'onUpdateColor' | 'onUpdate' | 'onDelete' | 'onDuplicate'
>;

let bundledQuickEdit: Promise<QuickEditComponent> | undefined;
let forcedTab: 'color' | 'edit' = 'color';
let forcedEventType: QuickEditEventType | undefined;
let capturedPortalChild: ReactNode;

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
            const value = typeof initial === 'function'
              ? (initial as () => unknown)()
              : initial;
            if (value === 'color') return [forcedTab, () => {}];
            if (typeof value === 'string' && ['custom', 'episode', 'part', 'scene', 'vacation'].includes(value)) {
              return [forcedEventType ?? value, () => {}];
            }
            return [value, () => {}];
          },
          useEffect: () => {},
          useRef: (initial: unknown) => ({ current: initial }),
          useCallback: (callback: unknown) => callback,
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
        };
      }
      if (id === 'lucide-react') {
        const Icon = () => null;
        return { X: Icon, Copy: Icon, Trash2: Icon, Check: Icon, Palette: Icon, Pencil: Icon };
      }
      if (id === '@/stores/useAppStore') {
        return { useAppStore: (selector: (state: { colorMode: string }) => unknown) => selector({ colorMode: 'dark' }) };
      }
      if (id === '@/stores/useAuthStore') {
        return { useAuthStore: (selector: (state: { users: unknown[] }) => unknown) => selector({ users: [] }) };
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
  tab: 'color' | 'edit',
  callbacks: Partial<QuickEditCallbacks> = {},
  draftType?: QuickEditEventType,
): Promise<ReactNode> {
  const EventQuickEdit = await loadQuickEdit();
  const globalScope = globalThis as typeof globalThis & { document?: { body: object } };
  const previousDocument = globalScope.document;
  globalScope.document = { body: {} };
  forcedTab = tab;
  forcedEventType = draftType;
  capturedPortalChild = undefined;
  try {
    EventQuickEdit({
      event: target,
      position: { x: 0, y: 0 },
      onClose: callbacks.onClose ?? (() => {}),
      onUpdateColor: callbacks.onUpdateColor ?? (() => {}),
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

const newBflowCases: Array<{ name: string; target: QuickEditEvent }> = [
  {
    name: 'bflow source-calendar prefix',
    target: event({ sourceCalendarId: 'bflow:calendar-1', calendarId: 'calendar-1', type: 'scene' }),
  },
  {
    name: 'bflow source with calendar id',
    target: event({ source: 'bflow', calendarId: 'calendar-1', type: 'part' }),
  },
];

test('new B flow color swatches are disabled and cannot call the color updater', async () => {
  for (const { name, target } of newBflowCases) {
    const colorUpdates: Array<[string, string]> = [];
    const tree = await renderQuickEdit(target, 'color', {
      onUpdateColor: (id, color) => colorUpdates.push([id, color]),
    });
    const swatches = colorButtons(tree);
    assert.equal(swatches.length, 10, `${name}: all current swatches remain visible`);
    for (const swatch of swatches) {
      assert.equal(swatch.props.disabled, true, `${name}: swatch is display-only`);
      assert.equal(
        swatch.props['aria-describedby'],
        `calendar-derived-fields-${target.id}`,
        `${name}: disabled swatch explains why it is read-only`,
      );
      assert.match(swatch.props['aria-label'] ?? '', /변경 불가/, `${name}: swatch has an accessible label`);
      swatch.props.onClick?.();
    }
    assert.match(textContent(tree), /소속 캘린더와 연결 정보로 결정/);
    assert.deepEqual(colorUpdates, [], `${name}: display-only swatches never update color`);
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

test('new B flow save omits derived type while retaining editable fields', async () => {
  const updates: Array<{ id: string; patch: Partial<QuickEditEvent> }> = [];
  const target = newBflowCases[0].target;
  const tree = await renderQuickEdit(target, 'edit', {
    onUpdate: (id, patch) => updates.push({ id, patch }),
  });

  findButtonByText(tree, '저장').props.onClick?.();

  assert.deepEqual(updates, [{
    id: target.id,
    patch: {
      title: target.title,
      startDate: target.startDate,
      endDate: target.endDate,
      memo: target.memo,
    },
  }]);
  assert.equal(Object.hasOwn(updates[0].patch, 'type'), false);
});

test('legacy private and Google events keep enabled editing but omit an unchanged type from save', async () => {
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
    const colorUpdates: Array<[string, string]> = [];
    const updates: Array<{ id: string; patch: Partial<QuickEditEvent> }> = [];
    const colorTree = await renderQuickEdit(target, 'color', {
      onUpdateColor: (id, color) => colorUpdates.push([id, color]),
    });
    const swatch = colorButtons(colorTree).find((button) => button.props.style?.background === '#74B9FF');
    assert.ok(swatch, `${name}: expected color swatch exists`);
    assert.notEqual(swatch.props.disabled, true, `${name}: color remains editable`);
    swatch.props.onClick?.();
    assert.deepEqual(colorUpdates, [[target.id, '#74B9FF']], `${name}: color updater receives the choice`);

    const editTree = await renderQuickEdit(target, 'edit', {
      onUpdate: (id, patch) => updates.push({ id, patch }),
    });
    for (const label of ['커스텀', '에피소드', '파트', '씬']) {
      assert.notEqual(findButtonByText(editTree, label).props.disabled, true, `${name}: ${label} remains editable`);
    }
    findButtonByText(editTree, '저장').props.onClick?.();
    assert.equal(Object.hasOwn(updates[0].patch, 'type'), false, `${name}: unchanged type is not sent`);
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

test('vacation keeps its existing color and edit-tab behavior', async () => {
  const target = event({ source: 'vacation', type: 'vacation' });
  const colorTree = await renderQuickEdit(target, 'color');
  assert.equal(colorButtons(colorTree).length, 10);
  assert.notEqual(colorButtons(colorTree)[0].props.disabled, true);
  const editTab = findButtonByText(colorTree, '일정 편집');
  assert.match(String(editTab.props.className), /cursor-not-allowed/);
});

test('new B flow duplicate and delete actions still invoke their callback and close once', async () => {
  const target = newBflowCases[0].target;
  for (const action of ['복사', '삭제'] as const) {
    const duplicated: QuickEditEvent[] = [];
    const deleted: string[] = [];
    let closeCount = 0;
    const tree = await renderQuickEdit(target, 'color', {
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

test('read-only calendar events expose no quick-edit write action', async () => {
  const cases: Array<{ name: string; target: QuickEditEvent }> = [
    {
      name: 'explicit read-only B flow event',
      target: event({
        source: 'bflow',
        calendarId: 'calendar-shared',
        isReadOnly: true,
      }),
    },
    {
      name: 'calendar event without edit permission',
      target: event({
        source: 'bflow',
        calendarId: 'calendar-shared',
        canEdit: false,
      }),
    },
  ];

  for (const { name, target } of cases) {
    const colorUpdates: Array<[string, string]> = [];
    const updates: Array<{ id: string; patch: Partial<QuickEditEvent> }> = [];
    const deleted: string[] = [];
    const duplicated: QuickEditEvent[] = [];
    let closeCount = 0;
    const colorTree = await renderQuickEdit(target, 'color', {
      onClose: () => { closeCount += 1; },
      onUpdateColor: (id, color) => colorUpdates.push([id, color]),
      onUpdate: (id, patch) => updates.push({ id, patch }),
      onDelete: (id) => deleted.push(id),
      onDuplicate: (value) => duplicated.push(value),
    });

    assert.match(textContent(colorTree), /보기 전용/);
    assert.equal(findButtonByText(colorTree, '일정 편집').props.disabled, true, `${name}: edit tab is disabled`);
    for (const swatch of colorButtons(colorTree)) {
      assert.equal(swatch.props.disabled, true, `${name}: color is disabled`);
      swatch.props.onClick?.();
    }
    for (const action of ['복사', '삭제'] as const) {
      const button = findButtonByText(colorTree, action);
      assert.equal(button.props.disabled, true, `${name}: ${action} is disabled`);
      assert.equal(button.props.onClick, undefined, `${name}: ${action} has no write handler`);
    }

    const editTree = await renderQuickEdit(target, 'edit', {
      onClose: () => { closeCount += 1; },
      onUpdate: (id, patch) => updates.push({ id, patch }),
      onDelete: (id) => deleted.push(id),
      onDuplicate: (value) => duplicated.push(value),
    });
    assert.match(textContent(editTree), /보기 전용 일정/);
    assert.equal(findButtons(editTree).some((button) => textContent(button).includes('저장')), false, `${name}: save is absent`);

    assert.deepEqual(colorUpdates, []);
    assert.deepEqual(updates, []);
    assert.deepEqual(deleted, []);
    assert.deepEqual(duplicated, []);
    assert.equal(closeCount, 0, `${name}: blocked actions do not close the popup`);
  }
});
