import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';

type EntityAwareInputModule = {
  EntityAwareInput(props: Record<string, unknown>): unknown;
};

const closedBy: string[] = [];

async function loadEntityAwareInput(): Promise<EntityAwareInputModule> {
  const result = await build({
    entryPoints: ['src/components/common/EntityAwareInput.tsx'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    write: false,
    external: [
      'react',
      'react/jsx-runtime',
      '@/hooks/useMentionAutocomplete',
      '@/hooks/useHashtagAutocomplete',
    ],
  });
  const module = { exports: {} as Record<string, unknown> };
  const nodeRequire = createRequire(import.meta.url);
  const stubAutocomplete = (label: string) => () => ({
    active: false,
    items: [],
    index: 0,
    refresh() {},
    close() { closedBy.push(label); },
    select() {},
    onKeyDown: () => false,
  });
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(
    (id: string) => {
      if (id === '@/hooks/useMentionAutocomplete') return { useMentionAutocomplete: stubAutocomplete('mention') };
      if (id === '@/hooks/useHashtagAutocomplete') return { useHashtagAutocomplete: stubAutocomplete('hashtag') };
      return nodeRequire(id);
    },
    module,
    module.exports,
  );
  return module.exports as unknown as EntityAwareInputModule;
}

/** 렌더 사이에 ref·effect 상태를 유지하는 최소 하네스. */
function createHarness(module: EntityAwareInputModule) {
  const nodeRequire = createRequire(import.meta.url);
  const React = nodeRequire('react') as {
    __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: { ReactCurrentDispatcher: { current: unknown } };
  };
  const dispatcher = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher;
  const previous = dispatcher.current;
  const states: unknown[] = [];
  const refs: unknown[] = [];
  const effectDeps: Array<readonly unknown[] | undefined> = [];
  const cleanups: Array<(() => void) | undefined> = [];
  let stateCursor = 0;
  let refCursor = 0;
  let effectCursor = 0;
  let pending: Array<{ index: number; effect: () => void | (() => void) }> = [];

  const changed = (before: readonly unknown[] | undefined, next: readonly unknown[] | undefined) => (
    before === undefined || next === undefined || before.length !== next.length
      || before.some((value, index) => !Object.is(value, next[index]))
  );

  dispatcher.current = {
    useState(initial: unknown) {
      const slot = stateCursor++;
      if (!(slot in states)) states[slot] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [states[slot], (next: unknown) => {
        states[slot] = typeof next === 'function' ? (next as (value: unknown) => unknown)(states[slot]) : next;
      }];
    },
    useRef(initial: unknown) {
      const slot = refCursor++;
      if (!(slot in refs)) refs[slot] = { current: initial };
      return refs[slot];
    },
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
      const slot = effectCursor++;
      if (!changed(effectDeps[slot], deps)) return;
      effectDeps[slot] = deps;
      pending.push({ index: slot, effect });
    },
    useMemo(factory: () => unknown) { return factory(); },
    useCallback(fn: unknown) { return fn; },
  };

  return {
    render(props: Record<string, unknown>) {
      stateCursor = 0;
      refCursor = 0;
      effectCursor = 0;
      module.EntityAwareInput({
        value: '',
        onChange() {},
        users: [],
        ...props,
      });
    },
    flushEffects() {
      const queued = pending;
      pending = [];
      for (const { index, effect } of queued) {
        cleanups[index]?.();
        cleanups[index] = effect() || undefined;
      }
    },
    restore() {
      cleanups.forEach((cleanup) => cleanup?.());
      dispatcher.current = previous;
    },
  };
}

test('EntityAwareInput: 입력칸이 잠기면 열려 있던 자동완성도 닫는다', async () => {
  const module = await loadEntityAwareInput();
  const harness = createHarness(module);
  try {
    closedBy.length = 0;
    harness.render({ disabled: false });
    harness.flushEffects();
    assert.deepEqual(closedBy, [], '평소에는 자동완성을 건드리지 않는다');

    harness.render({ disabled: true });
    harness.flushEffects();
    assert.deepEqual(
      [...closedBy].sort(),
      ['hashtag', 'mention'],
      '잠기면 @멘션·#태그 자동완성을 모두 닫는다',
    );
  } finally {
    harness.restore();
  }
});
