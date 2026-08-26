import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';

type DndModule = {
  useTimeGridDnD(options: {
    scrollContainerRef: { current: { scrollTop: number; getBoundingClientRect(): { top: number; bottom: number } } | null };
    onCreate?: (date: string, startTime: string, endTime: string) => void;
    onEventChange?: (id: string, identity: unknown, patch: unknown) => void;
  }): {
    isDragging: boolean;
    isDragActive: boolean;
    preview: unknown;
    beginCreate(event: unknown, target: unknown): void;
    beginEventDrag(event: unknown, source: unknown, mode: 'move' | 'resize-end', target: unknown): void;
    shouldSuppressClick(): boolean;
  };
};

async function loadDnD(): Promise<DndModule> {
  const result = await build({
    entryPoints: ['src/hooks/useTimeGridDnD.ts'], bundle: true, format: 'cjs', platform: 'node', target: 'node22', write: false, external: ['react'],
  });
  const module = { exports: {} as Record<string, unknown> };
  const require = createRequire(import.meta.url);
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(
    (id: string) => id === 'react' ? require('react') : require(id), module, module.exports,
  );
  return module.exports as unknown as DndModule;
}

type Listener = (event: any) => void;

function installDomHookHarness(module: DndModule, options: Parameters<DndModule['useTimeGridDnD']>[0]) {
  const React = createRequire(import.meta.url)('react');
  const dispatcher = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher;
  const previousDispatcher = dispatcher.current;
  const previousDocument = (globalThis as any).document;
  const previousWindow = (globalThis as any).window;
  const listeners = new Map<string, Set<Listener>>();
  const styleNodes = new Map<string, any>();
  const intervals = new Map<number, () => void>();
  let nextInterval = 1;
  const column = {
    dataset: { date: '2026-08-24', timeGridBandStart: '540' },
    getBoundingClientRect: () => ({ top: 100, bottom: 500 }),
    closest: () => column,
  };
  const document = {
    body: { style: {} as Record<string, string> },
    head: { appendChild: (node: any) => { if (node.id) styleNodes.set(node.id, node); } },
    createElement: () => ({ id: '', textContent: '', remove() { styleNodes.delete(this.id); } }),
    getElementById: (id: string) => styleNodes.get(id) ?? null,
    elementFromPoint: () => column,
    addEventListener(type: string, listener: Listener) { (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(listener); },
    removeEventListener(type: string, listener: Listener) { listeners.get(type)?.delete(listener); },
  };
  (globalThis as any).document = document;
  (globalThis as any).window = {
    setInterval(fn: () => void) { const id = nextInterval++; intervals.set(id, fn); return id; },
    clearInterval(id: number) { intervals.delete(id); },
  };

  const values: unknown[] = [];
  const refs: unknown[] = [];
  const cleanups: Array<(() => void) | undefined> = [];
  let cursor = 0;
  let effectCursor = 0;
  let value: ReturnType<DndModule['useTimeGridDnD']>;
  dispatcher.current = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
      return [values[index], (next: unknown) => { values[index] = typeof next === 'function' ? (next as any)(values[index]) : next; }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in refs)) refs[index] = { current: initial };
      return refs[index];
    },
    useCallback(fn: unknown) { cursor++; return fn; },
    useEffect(effect: () => void | (() => void)) { const index = effectCursor++; cleanups[index] = effect() || undefined; },
  };
  const render = () => {
    cleanups.splice(0).forEach((cleanup) => cleanup?.());
    cursor = 0;
    effectCursor = 0;
    value = module.useTimeGridDnD(options);
    return value;
  };
  const fire = (type: string, event: any) => [...(listeners.get(type) ?? [])].forEach((listener) => listener(event));
  return {
    column,
    render,
    fire,
    tickIntervals: () => intervals.forEach((tick) => tick()),
    hasPointerBlock: () => styleNodes.has('time-grid-dnd-pointer-block'),
    restore() {
      cleanups.forEach((cleanup) => cleanup?.());
      dispatcher.current = previousDispatcher;
      (globalThis as any).document = previousDocument;
      (globalThis as any).window = previousWindow;
    },
  };
}

const event = (x: number, y: number) => ({ button: 0, clientX: x, clientY: y, currentTarget: {} });
const source = { id: 'shared-id', source: 'google' as const, sourceCalendarId: 'team-a', startDate: '2026-08-24', endDate: '2026-08-24', startTime: '09:00', endTime: '10:00' };

test('useTimeGridDnD DOM: 클릭 후보는 pointer target을 보존하고 임계값 뒤에만 이동·자동스크롤·완료를 수행한다', async () => {
  const changes: Array<[string, unknown, unknown]> = [];
  const scroller = { scrollTop: 0, getBoundingClientRect: () => ({ top: 100, bottom: 500 }) };
  const harness = installDomHookHarness(await loadDnD(), {
    scrollContainerRef: { current: scroller },
    onEventChange: (id, identity, patch) => changes.push([id, identity, patch]),
  });
  try {
    let dnd = harness.render();
    dnd.beginEventDrag(event(200, 156), source, 'move', { date: '2026-08-24', bandStartMin: 540, column: harness.column });
    dnd = harness.render();
    assert.equal(harness.hasPointerBlock(), false, '5px 미만 클릭 후보는 원래 버튼의 click target을 가리지 않는다');
    harness.fire('mousemove', { clientX: 203, clientY: 159 });
    dnd = harness.render();
    assert.equal(dnd.isDragActive, false);
    assert.equal(dnd.shouldSuppressClick(), false);
    assert.equal(changes.length, 0);

    harness.fire('mousemove', { clientX: 210, clientY: 490 });
    dnd = harness.render();
    assert.equal(dnd.isDragActive, true);
    assert.equal(harness.hasPointerBlock(), true);
    harness.tickIntervals();
    assert.ok(scroller.scrollTop > 0, '활성 드래그만 16ms interval edge=40 자동 스크롤을 소유한다');
    harness.fire('mouseup', {});
    dnd = harness.render();
    assert.equal(changes.length, 1);
    assert.deepEqual(changes[0][0], 'shared-id');
    assert.deepEqual(changes[0][1], { id: 'shared-id', source: 'google', sourceCalendarId: 'team-a' });
    assert.equal(dnd.shouldSuppressClick(), true, '완료 직후 click만 억제한다');
  } finally {
    harness.restore();
  }
});

test('useTimeGridDnD DOM: create·resize callback, Escape 취소, 읽기전용 inertness를 실제 리스너로 보장한다', async () => {
  const creates: unknown[][] = [];
  const changes: unknown[][] = [];
  const harness = installDomHookHarness(await loadDnD(), {
    scrollContainerRef: { current: { scrollTop: 0, getBoundingClientRect: () => ({ top: 100, bottom: 500 }) } },
    onCreate: (...args) => creates.push(args),
    onEventChange: (...args) => changes.push(args),
  });
  try {
    let dnd = harness.render();
    dnd.beginEventDrag(event(10, 156), { ...source, isReadOnly: true }, 'move', { date: '2026-08-24', bandStartMin: 540, column: harness.column });
    dnd = harness.render();
    assert.equal(dnd.isDragging, false);

    dnd.beginCreate(event(10, 156), { date: '2026-08-24', bandStartMin: 540, column: harness.column });
    dnd = harness.render();
    harness.fire('mousemove', { clientX: 20, clientY: 184 });
    dnd = harness.render();
    harness.fire('mouseup', {});
    dnd = harness.render();
    assert.deepEqual(creates, [['2026-08-24', '10:00', '10:30']]);

    dnd.beginEventDrag(event(10, 156), source, 'resize-end', { date: '2026-08-24', bandStartMin: 540, column: harness.column });
    dnd = harness.render();
    harness.fire('mousemove', { clientX: 20, clientY: 184 });
    dnd = harness.render();
    harness.fire('keydown', { key: 'Escape' });
    dnd = harness.render();
    assert.equal(dnd.preview, null);
    assert.equal(changes.length, 0, 'Escape는 완료 callback을 발생시키지 않는다');
  } finally {
    harness.restore();
  }
});
