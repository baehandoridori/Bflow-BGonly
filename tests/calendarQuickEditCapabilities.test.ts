import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createElement, forwardRef, Fragment, type ComponentType, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';

type QuickEditEvent = {
  id: string;
  title: string;
  memo: string;
  color: string;
  type: 'custom';
  startDate: string;
  endDate: string;
  createdBy: string;
  createdAt: string;
  source?: 'bflow' | 'google';
  sourceCalendarId?: string;
  calendarId?: string;
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

let bundledQuickEdit: Promise<ComponentType<QuickEditProps>> | undefined;

async function loadQuickEdit(): Promise<ComponentType<QuickEditProps>> {
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
    const MotionDiv = forwardRef<HTMLDivElement, Record<string, unknown>>((props, ref) => {
      const {
        initial: _initial,
        animate: _animate,
        exit: _exit,
        transition: _transition,
        ...elementProps
      } = props;
      return createElement('div', { ...elementProps, ref });
    });
    const Icon = () => createElement('span', { 'aria-hidden': 'true' });
    const runtimeRequire = (id: string): unknown => {
      if (id === 'react') return nodeRequire('react');
      if (id === 'react/jsx-runtime') return nodeRequire('react/jsx-runtime');
      if (id === 'react-dom') return { createPortal: (child: ReactNode) => child };
      if (id === 'framer-motion') {
        return {
          motion: { div: MotionDiv },
          AnimatePresence: ({ children }: { children: ReactNode }) => createElement(Fragment, null, children),
        };
      }
      if (id === 'lucide-react') {
        return { X: Icon, Copy: Icon, Trash2: Icon, Check: Icon, Palette: Icon, Pencil: Icon };
      }
      if (id === '@/stores/useAppStore') {
        return { useAppStore: (selector: (state: { colorMode: string }) => unknown) => selector({ colorMode: 'dark' }) };
      }
      if (id === '@/stores/useAuthStore') {
        return { useAuthStore: (selector: (state: { users: unknown[] }) => unknown) => selector({ users: [] }) };
      }
      if (id === '@/components/common/EntityAwareInput') {
        return { EntityAwareInput: () => createElement('textarea', { readOnly: true }) };
      }
      if (id === '@/utils/glassStyles') return { floatingGlassStyle: {} };
      return nodeRequire(id);
    };

    const evaluate = new Function('require', 'module', 'exports', source);
    evaluate(runtimeRequire, module, module.exports);
    return module.exports.EventQuickEdit as ComponentType<QuickEditProps>;
  });
  return bundledQuickEdit;
}

function event(overrides: Partial<QuickEditEvent>): QuickEditEvent {
  return {
    id: 'event-1',
    title: '테스트 일정',
    memo: '',
    color: '#6C5CE7',
    type: 'custom',
    startDate: '2026-08-24',
    endDate: '2026-08-24',
    createdBy: 'user-1',
    createdAt: '2026-08-24T00:00:00.000Z',
    ...overrides,
  };
}

async function renderQuickEdit(target: QuickEditEvent): Promise<string> {
  const EventQuickEdit = await loadQuickEdit();
  const globalScope = globalThis as typeof globalThis & { document?: { body: object } };
  const previousDocument = globalScope.document;
  globalScope.document = { body: {} };
  try {
    return renderToStaticMarkup(createElement(EventQuickEdit, {
      event: target,
      position: { x: 0, y: 0 },
      onClose: () => {},
      onUpdateColor: () => {},
      onUpdate: () => {},
      onDelete: () => {},
      onDuplicate: () => {},
    }));
  } finally {
    if (previousDocument === undefined) delete globalScope.document;
    else globalScope.document = previousDocument;
  }
}

test('quick editor hides unsupported color controls while preserving legacy private colors', async () => {
  const cases: Array<{ name: string; target: QuickEditEvent; showsColor: boolean }> = [
    {
      name: 'new personal B flow event',
      target: event({ source: 'bflow', sourceCalendarId: 'bflow:personal-cal', calendarId: 'personal-cal' }),
      showsColor: false,
    },
    {
      name: 'new shared B flow event',
      target: event({ source: 'bflow', sourceCalendarId: 'bflow:shared-cal', calendarId: 'shared-cal' }),
      showsColor: false,
    },
    {
      name: 'Google event',
      target: event({ source: 'google', sourceCalendarId: 'primary' }),
      showsColor: false,
    },
    {
      name: 'legacy private event',
      target: event({ source: 'bflow', sourceCalendarId: 'supabase-private' }),
      showsColor: true,
    },
  ];

  for (const { name, target, showsColor } of cases) {
    const markup = await renderQuickEdit(target);
    assert.equal(markup.includes('색상'), showsColor, name);
    assert.equal(markup.includes('일정 편집'), true, `${name}: edit tab remains available`);
    if (showsColor) {
      assert.equal(markup.includes('복사'), true, `${name}: legacy duplicate remains in the color tab`);
      assert.equal(markup.includes('삭제'), true, `${name}: legacy delete remains in the color tab`);
    }
  }
});

test('quick editor keeps duplicate and delete actions when color changes are unsupported', async () => {
  const cases: Array<{ name: string; target: QuickEditEvent }> = [
    {
      name: 'new personal B flow event',
      target: event({ source: 'bflow', sourceCalendarId: 'bflow:personal-cal', calendarId: 'personal-cal' }),
    },
    {
      name: 'new shared B flow event',
      target: event({ source: 'bflow', sourceCalendarId: 'bflow:shared-cal', calendarId: 'shared-cal' }),
    },
    {
      name: 'Google event',
      target: event({ source: 'google', sourceCalendarId: 'primary' }),
    },
  ];

  for (const { name, target } of cases) {
    const markup = await renderQuickEdit(target);
    assert.equal(markup.includes('복사'), true, `${name}: duplicate remains available`);
    assert.equal(markup.includes('삭제'), true, `${name}: delete remains available`);
  }
});
