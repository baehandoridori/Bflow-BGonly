import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';

type DndModule = {
  useTimeGridDnD(options: {
    scrollContainerRef: { current: { scrollTop: number; getBoundingClientRect(): { top: number; bottom: number } } | null };
    onCreate?: (date: string, startTime: string, endTime: string) => void;
    onEventChange?: (id: string, identity: unknown, patch: unknown) => void | Promise<void>;
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

function installDomHookHarness(
  module: DndModule,
  options: Parameters<DndModule['useTimeGridDnD']>[0],
  pointerTargetAt?: (clientX: number, clientY: number, defaultColumn: unknown) => unknown,
) {
  const React = createRequire(import.meta.url)('react');
  const dispatcher = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher;
  const previousDispatcher = dispatcher.current;
  const previousDocument = (globalThis as any).document;
  const previousWindow = (globalThis as any).window;
  const listeners = new Map<string, Set<Listener>>();
  const styleNodes = new Map<string, any>();
  const intervals = new Map<number, () => void>();
  const frames = new Map<number, FrameRequestCallback>();
  let nextInterval = 1;
  let nextFrame = 1;
  const scroller = options.scrollContainerRef.current;
  const column = {
    dataset: { date: '2026-08-24', timeGridBandStart: '540' },
    getBoundingClientRect: () => ({
      top: 100 - (scroller?.scrollTop ?? 0),
      bottom: 500 - (scroller?.scrollTop ?? 0),
    }),
    closest: () => column,
  };
  const document = {
    body: { style: {} as Record<string, string> },
    head: { appendChild: (node: any) => { if (node.id) styleNodes.set(node.id, node); } },
    createElement: () => ({ id: '', textContent: '', remove() { styleNodes.delete(this.id); } }),
    getElementById: (id: string) => styleNodes.get(id) ?? null,
    elementFromPoint: (clientX: number, clientY: number) => pointerTargetAt?.(clientX, clientY, column) ?? column,
    addEventListener(type: string, listener: Listener) { (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(listener); },
    removeEventListener(type: string, listener: Listener) { listeners.get(type)?.delete(listener); },
  };
  (globalThis as any).document = document;
  (globalThis as any).window = {
    setInterval(fn: () => void) { const id = nextInterval++; intervals.set(id, fn); return id; },
    clearInterval(id: number) { intervals.delete(id); },
    requestAnimationFrame(callback: FrameRequestCallback) { const id = nextFrame++; frames.set(id, callback); return id; },
    cancelAnimationFrame(id: number) { frames.delete(id); },
  };

  const values: unknown[] = [];
  const refs: unknown[] = [];
  const callbackValues: unknown[] = [];
  const callbackDependencies: Array<readonly unknown[] | undefined> = [];
  const cleanups: Array<(() => void) | undefined> = [];
  const effectDependencies: Array<readonly unknown[] | undefined> = [];
  let cursor = 0;
  let effectCursor = 0;
  let value: ReturnType<DndModule['useTimeGridDnD']>;
  const dependenciesChanged = (previous: readonly unknown[] | undefined, next: readonly unknown[] | undefined) => (
    previous === undefined || next === undefined || previous.length !== next.length
      || previous.some((dependency, index) => dependency !== next[index])
  );
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
    useCallback(fn: unknown, dependencies?: readonly unknown[]) {
      const index = cursor++;
      if (!(index in callbackValues) || dependenciesChanged(callbackDependencies[index], dependencies)) {
        callbackValues[index] = fn;
        callbackDependencies[index] = dependencies;
      }
      return callbackValues[index];
    },
    useEffect(effect: () => void | (() => void), dependencies?: readonly unknown[]) {
      const index = effectCursor++;
      if (!dependenciesChanged(effectDependencies[index], dependencies)) return;
      cleanups[index]?.();
      cleanups[index] = effect() || undefined;
      effectDependencies[index] = dependencies;
    },
  };
  const render = () => {
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
    pendingFrames: () => frames.size,
    flushFrames: () => {
      const pending = [...frames.entries()];
      frames.clear();
      pending.forEach(([, callback]) => callback(16));
    },
    readPreview: () => values[1],
    hasPointerBlock: () => styleNodes.has('time-grid-dnd-pointer-block'),
    unmount: () => cleanups.splice(0).forEach((cleanup) => cleanup?.()),
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

test('useTimeGridDnD DOM: Escape 뒤 mouseup click은 create와 event drag의 연속 열림을 막는다', async () => {
  const createHarness = installDomHookHarness(await loadDnD(), {
    scrollContainerRef: { current: { scrollTop: 0, getBoundingClientRect: () => ({ top: 100, bottom: 500 }) } },
  });
  try {
    let dnd = createHarness.render();
    dnd.beginCreate(event(10, 156), { date: '2026-08-24', bandStartMin: 540, column: createHarness.column });
    dnd = createHarness.render();
    createHarness.fire('mousemove', { clientX: 20, clientY: 184 });
    dnd = createHarness.render();
    assert.equal(dnd.isDragActive, true, '임계값을 넘긴 create만 뒤이은 click을 막아야 한다');
    createHarness.fire('keydown', { key: 'Escape', preventDefault() {} });
    createHarness.fire('mouseup', {});
    dnd = createHarness.render();
    assert.equal(dnd.shouldSuppressClick(), true, 'Escape로 취소한 create의 mouseup click은 일정 만들기 모달을 열지 않는다');
  } finally {
    createHarness.restore();
  }

  const dragHarness = installDomHookHarness(await loadDnD(), {
    scrollContainerRef: { current: { scrollTop: 0, getBoundingClientRect: () => ({ top: 100, bottom: 500 }) } },
  });
  try {
    let dnd = dragHarness.render();
    dnd.beginEventDrag(event(10, 156), source, 'move', { date: '2026-08-24', bandStartMin: 540, column: dragHarness.column });
    dnd = dragHarness.render();
    dragHarness.fire('mousemove', { clientX: 20, clientY: 184 });
    dnd = dragHarness.render();
    assert.equal(dnd.isDragActive, true, '임계값을 넘긴 event drag만 뒤이은 click을 막아야 한다');
    dragHarness.fire('keydown', { key: 'Escape', preventDefault() {} });
    dragHarness.fire('mouseup', {});
    dnd = dragHarness.render();
    assert.equal(dnd.shouldSuppressClick(), true, 'Escape로 취소한 event drag의 mouseup click은 상세 패널을 열지 않는다');
  } finally {
    dragHarness.restore();
  }
});

test('useTimeGridDnD DOM: 새 일정 수직 선택은 옆 날짜 열을 지나도 시작한 날짜에 저장한다', async () => {
  const creates: unknown[][] = [];
  let adjacentColumn: any;
  const harness = installDomHookHarness(
    await loadDnD(),
    {
      scrollContainerRef: { current: { scrollTop: 0, getBoundingClientRect: () => ({ top: 100, bottom: 500 }) } },
      onCreate: (...args) => creates.push(args),
    },
    (clientX, _clientY, defaultColumn) => clientX >= 150 ? adjacentColumn : defaultColumn,
  );
  adjacentColumn = {
    dataset: { date: '2026-08-25', timeGridBandStart: '540' },
    getBoundingClientRect: harness.column.getBoundingClientRect,
    closest: () => adjacentColumn,
  };
  try {
    let dnd = harness.render();
    dnd.beginCreate(event(10, 156), { date: '2026-08-24', bandStartMin: 540, column: harness.column });
    dnd = harness.render();
    harness.fire('mousemove', { clientX: 200, clientY: 184 });
    dnd = harness.render();
    harness.fire('mouseup', {});

    assert.deepEqual(
      creates,
      [['2026-08-24', '10:00', '10:30']],
      '수직 create는 시작 열의 날짜 하나만 사용한다',
    );
  } finally {
    harness.restore();
  }
});

test('useTimeGridDnD DOM: 가장자리의 정지·5px 미만 후보는 스크롤·프리뷰·완료를 만들지 않는다', async () => {
  const changes: unknown[][] = [];
  const scroller = { scrollTop: 0, getBoundingClientRect: () => ({ top: 100, bottom: 500 }) };
  const harness = installDomHookHarness(await loadDnD(), {
    scrollContainerRef: { current: scroller },
    onEventChange: (...args) => changes.push(args),
  });
  try {
    let dnd = harness.render();
    dnd.beginEventDrag(event(10, 496), source, 'move', { date: '2026-08-24', bandStartMin: 540, column: harness.column });
    dnd = harness.render();
    harness.tickIntervals();
    assert.equal(scroller.scrollTop, 0, '정지한 edge press는 16ms 스크롤을 시작하지 않는다');
    assert.equal(harness.hasPointerBlock(), false);
    assert.equal(harness.pendingFrames(), 0);

    harness.fire('mousemove', { clientX: 13, clientY: 499 });
    harness.tickIntervals();
    assert.equal(scroller.scrollTop, 0, '5px 미만의 edge movement도 자동 스크롤하지 않는다');
    assert.equal(harness.readPreview(), dnd.preview, '프레임 전 후보는 원래 preview를 유지한다');
    harness.fire('mouseup', {});
    assert.deepEqual(changes, []);
  } finally {
    harness.restore();
  }
});

test('useTimeGridDnD DOM: 활성 드래그는 rAF로 합치고 고정 포인터 auto-scroll 뒤 최신 시간을 보인다', async () => {
  const scroller = { scrollTop: 0, getBoundingClientRect: () => ({ top: 100, bottom: 500 }) };
  const harness = installDomHookHarness(await loadDnD(), {
    scrollContainerRef: { current: scroller },
  });
  try {
    let dnd = harness.render();
    dnd.beginEventDrag(event(10, 156), source, 'move', { date: '2026-08-24', bandStartMin: 540, column: harness.column });
    dnd = harness.render();

    harness.fire('mousemove', { clientX: 16, clientY: 490 });
    harness.fire('mousemove', { clientX: 20, clientY: 490 });
    assert.equal(harness.pendingFrames(), 1, '여러 native mousemove는 하나의 rAF로 합쳐진다');
    assert.deepEqual(harness.readPreview(), dnd.preview, 'rAF 전에는 React preview state를 다시 쓰지 않는다');

    harness.flushFrames();
    const beforeScroll = harness.readPreview() as { startTime: string };
    assert.notEqual(beforeScroll.startTime, '09:00');
    harness.tickIntervals();
    assert.ok(scroller.scrollTop > 0, '5px 이후 edge loop만 스크롤을 소유한다');
    assert.equal(harness.pendingFrames(), 1, '고정 포인터 scroll 보정도 다음 한 프레임으로 합친다');
    harness.flushFrames();
    const afterScroll = harness.readPreview() as { startTime: string };
    assert.notEqual(afterScroll.startTime, beforeScroll.startTime, '스크롤 뒤 같은 포인터의 time preview를 다시 계산한다');
  } finally {
    harness.restore();
  }
});

test('useTimeGridDnD DOM: mouseup은 대기 rAF의 최신 값을 완료하고 Escape·unmount는 이를 취소한다', async () => {
  const changes: unknown[][] = [];
  const createHarness = async () => installDomHookHarness(await loadDnD(), {
    scrollContainerRef: { current: { scrollTop: 0, getBoundingClientRect: () => ({ top: 100, bottom: 500 }) } },
    onEventChange: (...args) => changes.push(args),
  });
  const completionHarness = await createHarness();
  try {
    let dnd = completionHarness.render();
    dnd.beginEventDrag(event(10, 156), source, 'move', { date: '2026-08-24', bandStartMin: 540, column: completionHarness.column });
    dnd = completionHarness.render();
    completionHarness.fire('mousemove', { clientX: 20, clientY: 184 });
    assert.equal(completionHarness.pendingFrames(), 1);
    completionHarness.fire('mouseup', {});
    assert.equal(completionHarness.pendingFrames(), 0, 'mouseup은 대기 frame을 남기지 않는다');
    assert.deepEqual(changes, [[
      'shared-id',
      { id: 'shared-id', source: 'google', sourceCalendarId: 'team-a' },
       { startDate: '2026-08-24', endDate: '2026-08-24', startTime: '09:30', endTime: '10:30' },
    ]], 'mouseup은 frame 전 최신 포인터 위치로 정확히 완료한다');
  } finally {
    completionHarness.restore();
  }

  const cancellationHarness = await createHarness();
  try {
    let dnd = cancellationHarness.render();
    dnd.beginEventDrag(event(10, 156), source, 'move', { date: '2026-08-24', bandStartMin: 540, column: cancellationHarness.column });
    dnd = cancellationHarness.render();
    cancellationHarness.fire('mousemove', { clientX: 20, clientY: 184 });
    assert.equal(cancellationHarness.pendingFrames(), 1);
    cancellationHarness.fire('keydown', { key: 'Escape' });
    assert.equal(cancellationHarness.pendingFrames(), 0, 'Escape는 대기 frame을 취소한다');
    cancellationHarness.fire('mouseup', {});
    assert.equal(changes.length, 1, 'Escape 뒤 mouseup은 새 완료를 만들지 않는다');

    dnd = cancellationHarness.render();
    dnd.beginEventDrag(event(10, 156), source, 'move', { date: '2026-08-24', bandStartMin: 540, column: cancellationHarness.column });
    dnd = cancellationHarness.render();
    cancellationHarness.fire('mousemove', { clientX: 20, clientY: 184 });
    assert.equal(cancellationHarness.pendingFrames(), 1);
    cancellationHarness.unmount();
    assert.equal(cancellationHarness.pendingFrames(), 0, 'unmount도 대기 frame을 취소한다');
    cancellationHarness.fire('mouseup', {});
    assert.equal(changes.length, 1, 'unmount 뒤에는 남은 listener가 완료하지 않는다');
  } finally {
    cancellationHarness.restore();
  }
});

test('useTimeGridDnD DOM: mouseup에서 거부된 일정 변경 저장은 전역 Promise 오류로 남기지 않는다', async () => {
  const persistenceError = new Error('저장 실패');
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args);
  const harness = installDomHookHarness(await loadDnD(), {
    scrollContainerRef: { current: { scrollTop: 0, getBoundingClientRect: () => ({ top: 100, bottom: 500 }) } },
    onEventChange: () => Promise.reject(persistenceError),
  });
  try {
    let dnd = harness.render();
    dnd.beginEventDrag(event(10, 156), source, 'move', { date: '2026-08-24', bandStartMin: 540, column: harness.column });
    dnd = harness.render();
    harness.fire('mousemove', { clientX: 20, clientY: 184 });
    harness.fire('mouseup', {});

    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(warnings, [['[Calendar] 시간표 일정 변경 저장 실패:', persistenceError]]);
  } finally {
    harness.restore();
    console.warn = originalWarn;
  }
});

type CalendarDndModule = {
  useCalendarDnD(
    onEventMove: (eventId: string, newStart: string, newEnd: string) => void,
    onEventResize: (eventId: string, newStart: string, newEnd: string) => void,
  ): {
    isDragging: boolean;
    preview: { eventId: string; newStartDate: string; newEndDate: string } | null;
    startDrag(
      eventId: string,
      mode: 'move' | 'resize-start' | 'resize-end',
      startDate: string,
      endDate: string,
      mouseX: number,
      anchorDate: string,
    ): void;
  };
};

async function loadCalendarDnD(): Promise<CalendarDndModule> {
  const result = await build({
    entryPoints: ['src/hooks/useCalendarDnD.ts'], bundle: true, format: 'cjs', platform: 'node', target: 'node22', write: false, external: ['react'],
  });
  const module = { exports: {} as Record<string, unknown> };
  const require = createRequire(import.meta.url);
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(
    (id: string) => id === 'react' ? require('react') : require(id), module, module.exports,
  );
  return module.exports as unknown as CalendarDndModule;
}

function installCalendarDndHarness(
  module: CalendarDndModule,
  onMove: (eventId: string, newStart: string, newEnd: string) => void,
  onResize: (eventId: string, newStart: string, newEnd: string) => void,
) {
  const React = createRequire(import.meta.url)('react');
  const dispatcher = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher;
  const previousDispatcher = dispatcher.current;
  const previousDocument = (globalThis as any).document;
  const previousWindow = (globalThis as any).window;
  const listeners = new Map<string, Set<Listener>>();
  const styleNodes = new Map<string, any>();
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 1;
  const dateElement = (date: string) => ({
    getAttribute: (name: string) => name === 'data-date' ? date : null,
    parentElement: null,
  });
  const bodyStyle: Record<string, string> = {};
  const document = {
    body: { style: bodyStyle },
    head: { appendChild: (node: any) => { if (node.id) styleNodes.set(node.id, node); } },
    createElement: () => ({ id: '', textContent: '', remove() { styleNodes.delete(this.id); } }),
    getElementById: (id: string) => styleNodes.get(id) ?? null,
    elementFromPoint: (clientX: number) => dateElement(clientX < 150 ? '2026-08-25' : '2026-08-26'),
    addEventListener(type: string, listener: Listener) { (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(listener); },
    removeEventListener(type: string, listener: Listener) { listeners.get(type)?.delete(listener); },
  };
  (globalThis as any).document = document;
  (globalThis as any).window = {
    requestAnimationFrame(callback: FrameRequestCallback) { const id = nextFrame++; frames.set(id, callback); return id; },
    cancelAnimationFrame(id: number) { frames.delete(id); },
  };

  const values: unknown[] = [];
  const refs: unknown[] = [];
  const cleanups: Array<(() => void) | undefined> = [];
  let cursor = 0;
  let effectCursor = 0;
  let value: ReturnType<CalendarDndModule['useCalendarDnD']>;
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
    value = module.useCalendarDnD(onMove, onResize);
    return value;
  };
  return {
    render,
    fire(type: string, event: any) { [...(listeners.get(type) ?? [])].forEach((listener) => listener(event)); },
    readDrag: () => values[0],
    readPreview: () => values[1],
    pendingFrames: () => frames.size,
    flushFrames() {
      const pending = [...frames.entries()];
      frames.clear();
      pending.forEach(([, callback]) => callback(16));
    },
    hasPointerBlock: () => styleNodes.has('dnd-pointer-block'),
    bodyStyle,
    restore() {
      cleanups.forEach((cleanup) => cleanup?.());
      dispatcher.current = previousDispatcher;
      (globalThis as any).document = previousDocument;
      (globalThis as any).window = previousWindow;
    },
  };
}

test('useCalendarDnD DOM: mousemove 프리뷰는 프레임당 한 번만 반영하고 가장 최신 날짜를 유지한다', async () => {
  const moves: Array<[string, string, string]> = [];
  const harness = installCalendarDndHarness(await loadCalendarDnD(), (...args) => moves.push(args), () => {});
  try {
    let dnd = harness.render();
    dnd.startDrag('event-1', 'move', '2026-08-24', '2026-08-24', 0, '2026-08-24');
    dnd = harness.render();

    harness.fire('mousemove', { clientX: 100, clientY: 20 });
    harness.fire('mousemove', { clientX: 200, clientY: 20 });
    assert.equal(harness.pendingFrames(), 1, '연속 mousemove는 하나의 animation frame으로 합쳐진다');
    assert.deepEqual(harness.readPreview(), {
      eventId: 'event-1', newStartDate: '2026-08-24', newEndDate: '2026-08-24',
    }, '프레임 전에는 렌더링 상태를 중복 갱신하지 않는다');

    harness.flushFrames();
    assert.deepEqual(harness.readPreview(), {
      eventId: 'event-1', newStartDate: '2026-08-26', newEndDate: '2026-08-26',
    }, '프레임에서 가장 나중에 가리킨 날짜가 보인다');

    harness.fire('mouseup', {});
    assert.deepEqual(moves, [['event-1', '2026-08-26', '2026-08-26']]);
  } finally {
    harness.restore();
  }
});

test('useCalendarDnD DOM: Escape는 대기 프레임과 드래그를 취소하고 뒤이은 mouseup 저장을 막는다', async () => {
  const moves: Array<[string, string, string]> = [];
  const harness = installCalendarDndHarness(await loadCalendarDnD(), (...args) => moves.push(args), () => {});
  try {
    let dnd = harness.render();
    dnd.startDrag('event-2', 'move', '2026-08-24', '2026-08-24', 0, '2026-08-24');
    dnd = harness.render();
    assert.equal(harness.hasPointerBlock(), true);
    assert.equal(harness.bodyStyle.userSelect, 'none');
    assert.equal(harness.bodyStyle.cursor, 'grabbing');

    harness.fire('mousemove', { clientX: 100, clientY: 20 });
    assert.equal(harness.pendingFrames(), 1);
    harness.fire('keydown', { key: 'Escape', preventDefault() {} });
    assert.equal(harness.pendingFrames(), 0, 'Escape는 아직 실행되지 않은 프레임도 취소한다');
    assert.equal(harness.readDrag(), null);
    assert.equal(harness.readPreview(), null);

    dnd = harness.render();
    assert.equal(dnd.isDragging, false);
    assert.equal(harness.hasPointerBlock(), false);
    assert.equal(harness.bodyStyle.userSelect, '');
    assert.equal(harness.bodyStyle.cursor, '');
    harness.fire('mouseup', {});
    assert.equal(moves.length, 0, 'Escape 뒤 mouseup은 이동 callback을 호출하지 않는다');
  } finally {
    harness.restore();
  }
});

test('useCalendarDnD DOM: 프레임 전 mouseup도 최신 날짜로 딱 한 번 저장한다', async () => {
  const resizes: Array<[string, string, string]> = [];
  const harness = installCalendarDndHarness(await loadCalendarDnD(), () => {}, (...args) => resizes.push(args));
  try {
    let dnd = harness.render();
    dnd.startDrag('event-3', 'resize-end', '2026-08-24', '2026-08-24', 0, '2026-08-24');
    dnd = harness.render();
    harness.fire('mousemove', { clientX: 200, clientY: 20 });
    assert.equal(harness.pendingFrames(), 1);

    harness.fire('mouseup', {});
    assert.deepEqual(resizes, [['event-3', '2026-08-24', '2026-08-26']]);
    assert.equal(harness.pendingFrames(), 0, 'mouseup 정리는 대기 프레임을 남기지 않는다');
  } finally {
    harness.restore();
  }
});
