import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import type { GanttSpace } from '../src/features/gantt/types.ts';

type Props = {space: GanttSpace; users: Array<{id: string; name: string}>};
type ElementProps = {
  children?: ReactNode; role?: string; id?: string; style?: {left?: number; top?: number};
  'aria-label'?: string; 'aria-describedby'?: string;
  onPointerEnter?: (event: {clientX: number; clientY: number}) => void;
  onPointerLeave?: () => void; onFocus?: (event: {currentTarget: unknown}) => void; onBlur?: () => void;
};
type Element = ReactElement<ElementProps>;
const space: GanttSpace = {id: 'space', ownerId: 'owner', name: '제작 공유', shared: true, revision: 1, members: [{userId: 'owner', canEdit: true}, {userId: 'lead', canEdit: true}, {userId: 'newcomer', canEdit: false}]};
const users = [{id: 'owner', name: '소유자'}, {id: 'lead', name: '리드'}, {id: 'newcomer', name: '신입'}];
const bundle = build({entryPoints: ['src/features/gantt/GanttShareTooltip.tsx'], bundle: true, format: 'cjs', platform: 'node', target: 'node22', write: false, external: ['react', 'react/jsx-runtime', 'react-dom', 'lucide-react', '@/utils/glassStyles']});
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const element = node as Element;return [element, ...elements(element.props.children)];
}
function text(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  return isValidElement(node) ? text((node.props as ElementProps).children) : '';
}

async function harness(initial: Props = {space, users}) {
  let props = initial, time = 0, nextTimer = 0, cursor = 0, dirty = false;
  const hooks: Array<{value?: unknown; deps?: readonly unknown[]; cleanup?: () => void}> = [];
  let effects: Array<() => void> = [], layouts: Array<() => void> = [];
  const timers = new Map<number, {at: number; callback: () => void}>();
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const anchor = {getBoundingClientRect: () => ({left: 700, right: 780, top: 500, bottom: 520, width: 80, height: 20}), contains: (target: unknown) => target === anchor};
  const box = {getBoundingClientRect: () => ({width: 220, height: 180}), contains: (target: unknown) => target === box};
  const body = {}, portals: unknown[] = [];
  const nodeRequire = createRequire(import.meta.url), react = nodeRequire('react');
  const changed = (before?: readonly unknown[], after?: readonly unknown[]) => !before || !after || before.length !== after.length || before.some((value, index) => !Object.is(value, after[index]));
  const effect = (queue: Array<() => void>, callback: () => void | (() => void), deps?: readonly unknown[]) => {
    const index = cursor++, slot = hooks[index] ??= {};
    if (changed(slot.deps, deps)) {slot.deps = deps;queue.push(() => {slot.cleanup?.();slot.cleanup = callback() || undefined;});}
  };
  const memo = (factory: () => unknown, deps?: readonly unknown[]) => {
    const index = cursor++, slot = hooks[index] ??= {};
    if (changed(slot.deps, deps)) {slot.value = factory();slot.deps = deps;}return slot.value;
  };
  const module = {exports: {} as {GanttShareTooltip?: (props: Props) => ReactNode}};
  new Function('require', 'module', 'exports', 'window', 'document', 'setTimeout', 'clearTimeout', (await bundle).outputFiles[0].text)(
    (name: string) => {
      if (name === 'react') return {...react,
        useState(initial: unknown) {
          const index = cursor++, slot = hooks[index] ??= {value: typeof initial === 'function' ? (initial as () => unknown)() : initial};
          return [slot.value, (next: unknown) => {const value = typeof next === 'function' ? (next as (previous: unknown) => unknown)(slot.value) : next;if (!Object.is(value, slot.value)) {slot.value = value;dirty = true;}}];
        },
        useRef(initial: unknown) {return (hooks[cursor++] ??= {value: {current: initial}}).value;},
        useMemo: memo, useCallback: (fn: unknown, deps?: readonly unknown[]) => memo(() => fn, deps),
        useEffect: (fn: () => void | (() => void), deps?: readonly unknown[]) => effect(effects, fn, deps),
        useLayoutEffect: (fn: () => void | (() => void), deps?: readonly unknown[]) => effect(layouts, fn, deps),
      };
      if (name === 'react-dom') return {createPortal: (child: ReactNode, target: unknown) => {portals.push(target);return child;}};
      if (name === 'lucide-react') return {UsersRound: () => null};
      if (name === '@/utils/glassStyles') return {tooltipGlassStyle: {}};
      return nodeRequire(name);
    }, module, module.exports,
    {innerWidth: 800, innerHeight: 600, addEventListener(name: string, fn: (event: unknown) => void) {if (!listeners.has(name)) listeners.set(name, new Set());listeners.get(name)!.add(fn);}, removeEventListener(name: string, fn: (event: unknown) => void) {listeners.get(name)?.delete(fn);}},
    {body}, (callback: () => void, delay: number) => {const id = ++nextTimer;timers.set(id, {at: time + delay, callback});return id;}, (id: number) => timers.delete(id),
  );
  return {
    anchor, portals, body,
    update(next: Props) {props = next;},
    render() {
      for (let pass = 0; pass < 10; pass++) {
        cursor = 0;dirty = false;const tree = module.exports.GanttShareTooltip!(props);
        for (const element of elements(tree)) {const ref = (element as unknown as {ref?: {current: unknown}}).ref;if (ref) ref.current = element.props.role === 'tooltip' ? box : anchor;}
        const queued = [...effects, ...layouts];effects = [];layouts = [];queued.forEach(run => run());
        if (!dirty) return tree;
      }
      throw new Error('tooltip render did not settle');
    },
    advance(ms: number) {time += ms;for (const [id, timer] of [...timers]) if (timer.at <= time) {timers.delete(id);timer.callback();}},
    dispatch(name: string, event: unknown = {}) {listeners.get(name)?.forEach(listener => listener(event));},
    cleanup() {hooks.forEach(slot => slot.cleanup?.());},
  };
}
function badge(tree: ReactNode) {const found = elements(tree).find(node => node.props['aria-label']?.startsWith('공유된 팀원'));assert.ok(found);return found;}
function tooltip(tree: ReactNode) {return elements(tree).find(node => node.props.role === 'tooltip');}

test('share hover lists only shared members with their actual names and permissions', async () => {
  const h = await harness();let tree = h.render();
  assert.match(text(badge(tree)), /공유 2명/);assert.equal(tooltip(tree), undefined);
  assert.equal(typeof badge(tree).props.onPointerEnter, 'function', 'the badge exposes a delayed member tooltip');
  badge(tree).props.onPointerEnter!({clientX: 780, clientY: 570});h.advance(119);assert.equal(tooltip(h.render()), undefined);
  h.advance(1);tree = h.render();const popup = tooltip(tree);assert.ok(popup);
  const rows = elements(popup).filter(node => node.type === 'li').map(text);
  assert.deepEqual(rows, ['리드편집', '신입보기']);assert.doesNotMatch(text(popup), /소유자/);
  assert.equal(badge(tree).props['aria-describedby'], popup.props.id);
  assert.ok(h.portals.every(target => target === h.body));
  assert.ok(popup.props.style!.left! >= 8 && popup.props.style!.left! + 220 <= 792);
  assert.ok(popup.props.style!.top! >= 8 && popup.props.style!.top! + 180 <= 592);
  h.cleanup();
});

test('keyboard focus exposes the current roster and Escape dismisses it', async () => {
  const h = await harness();let tree = h.render();
  assert.equal(typeof badge(tree).props.onFocus, 'function', 'keyboard users can inspect the roster');
  badge(tree).props.onFocus!({currentTarget: h.anchor});h.advance(120);tree = h.render();assert.ok(tooltip(tree));
  h.update({space: {...space, members: [{userId: 'newcomer', canEdit: true}]}, users: [{id: 'newcomer', name: '변경된 이름'}]});tree = h.render();
  assert.deepEqual(elements(tooltip(tree)).filter(node => node.type === 'li').map(text), ['변경된 이름편집']);
  h.dispatch('keydown', {key: 'Escape'});tree = h.render();assert.equal(tooltip(tree), undefined);assert.equal(badge(tree).props['aria-describedby'], undefined);
  h.cleanup();
});

test('empty shared folders explain the empty roster and private folders have no badge', async () => {
  const h = await harness({space: {...space, members: [{userId: 'owner', canEdit: true}]}, users});let tree = h.render();
  assert.match(text(badge(tree)), /공유 0명/);
  assert.equal(typeof badge(tree).props.onPointerEnter, 'function');badge(tree).props.onPointerEnter!({clientX: 100, clientY: 100});h.advance(120);tree = h.render();
  assert.ok(tooltip(tree));assert.match(text(tooltip(tree)), /공유된 팀원이 없습니다/);
  h.dispatch('scroll');assert.equal(tooltip(h.render()), undefined);
  h.update({space: {...space, shared: false}, users});assert.equal(h.render(), null);h.cleanup();
});

test('the popup remains hoverable and a dismissed popup cannot keep a later hover stuck open', async () => {
  const h = await harness();let tree = h.render();
  badge(tree).props.onPointerEnter!({clientX: 100, clientY: 100});h.advance(120);tree = h.render();
  badge(tree).props.onPointerLeave!();tooltip(tree)!.props.onPointerEnter!({clientX: 100, clientY: 130});h.advance(60);tree = h.render();
  assert.ok(tooltip(tree), 'moving from the badge into the roster keeps it readable');
  h.dispatch('scroll');tree = h.render();assert.equal(tooltip(tree), undefined);
  badge(tree).props.onPointerEnter!({clientX: 100, clientY: 100});h.advance(120);tree = h.render();assert.ok(tooltip(tree));
  badge(tree).props.onPointerLeave!();h.advance(60);
  assert.equal(tooltip(h.render()), undefined, 'a prior dismissed popup does not retain hover ownership');
  h.cleanup();
});
