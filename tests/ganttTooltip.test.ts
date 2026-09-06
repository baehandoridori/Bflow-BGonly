import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import {createTask} from '../src/features/gantt/domain.ts';
import type {GanttHover} from '../src/features/gantt/GanttTooltip.tsx';

type Props = {hover:GanttHover|null;resetKey?:string};
type ElementProps = {
  children?: ReactNode; role?: string; id?: string; className?:string; style?: {left?: number; top?: number};
  'aria-label'?: string; 'aria-describedby'?: string;
  onPointerEnter?: (event: {clientX: number; clientY: number}) => void;
  onPointerLeave?: () => void; onFocus?: (event: {currentTarget: unknown}) => void; onBlur?: () => void;
};
type Element = ReactElement<ElementProps>;
const memo=Array.from({length:80},(_,i)=>`메모 ${i+1}번째 문장`).join('\n');
const item:GanttHover={task:{...createTask('검증 항목','2026-09-06'),memo},x:780,y:570,workers:'배한솔',typeLabel:'작업',context:'프로젝트 › 그룹',duration:'1일',hasDates:true,progress:35,completed:false};
const bundle = build({entryPoints: ['src/features/gantt/GanttTooltip.tsx'], bundle: true, format: 'cjs', platform: 'node', target: 'node22', write: false, external: ['react', 'react/jsx-runtime', 'react-dom', 'lucide-react', '@/utils/glassStyles']});
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

async function harness(initial: Props = {hover:item}) {
  let props = initial, time = 0, nextTimer = 0, cursor = 0, dirty = false;
  const hooks: Array<{value?: unknown; deps?: readonly unknown[]; cleanup?: () => void}> = [];
  let effects: Array<() => void> = [], layouts: Array<() => void> = [];
  const timers = new Map<number, {at: number; callback: () => void}>();
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const captureModes=new Map<string,boolean>();
  const anchor = {getBoundingClientRect: () => ({left: 700, right: 780, top: 500, bottom: 520, width: 80, height: 20}), contains: (target: unknown) => target === anchor};
  let memoFocuses=0;const box = {focus(){memoFocuses++;},getBoundingClientRect: () => ({width: 220, height: 180}), contains: (target: unknown) => target === box};
  const body = {}, portals: unknown[] = [];let activeElement:unknown=null,focusReturns=0;
  let focusSelector='';const document={body,get activeElement(){return activeElement;},querySelector(selector:string){focusSelector=selector;return {focus(){focusReturns++;activeElement=anchor;}};}};
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
  const module = {exports: {} as {GanttTooltip?: (props: Props) => ReactNode}};
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
    {innerWidth: 800, innerHeight: 600, addEventListener(name: string, fn: (event: unknown) => void, capture=false) {captureModes.set(name,capture);if (!listeners.has(name)) listeners.set(name, new Set());listeners.get(name)!.add(fn);}, removeEventListener(name: string, fn: (event: unknown) => void) {listeners.get(name)?.delete(fn);}},
    document, (callback: () => void, delay: number) => {const id = ++nextTimer;timers.set(id, {at: time + delay, callback});return id;}, (id: number) => timers.delete(id),
  );
  return {
    anchor, box, portals, body, captureModes,memoFocuses:()=>memoFocuses,focusSelector:()=>focusSelector, focusPopup(){activeElement=box;},focusReturns:()=>focusReturns,
    update(next: Props) {props = next;},
    render() {
      for (let pass = 0; pass < 10; pass++) {
        cursor = 0;dirty = false;const tree = module.exports.GanttTooltip!(props);
        for (const element of elements(tree)) {const ref = (element as unknown as {ref?: {current: unknown}}).ref;if (ref) ref.current = element.props.role === 'tooltip' ? box : anchor;}
        const queued = [...effects, ...layouts];effects = [];layouts = [];queued.forEach(run => run());
        if (!dirty) return tree;
      }
      throw new Error('tooltip render did not settle');
    },
    advance(ms: number) {time += ms;for (const [id, timer] of [...timers]) if (timer.at <= time) {timers.delete(id);timer.callback();}},
    dispatch(name:string,event:Record<string,unknown>={}){const input={defaultPrevented:false,propagationStopped:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.propagationStopped=true;},...event};listeners.get(name)?.forEach(listener=>listener(input));return input;},
    cleanup() {hooks.forEach(slot => slot.cleanup?.());},
  };
}

function tooltip(tree:ReactNode){return elements(tree).find(node=>node.props.role==='tooltip');}

test('task tooltip retains the entire multiline memo and shows deferred row details',async()=>{
  const h=await harness();try{
    assert.equal(tooltip(h.render()),undefined);h.advance(119);assert.equal(tooltip(h.render()),undefined);
    h.advance(1);const popup=tooltip(h.render());assert.ok(popup);
    assert.equal(text(elements(popup).find(node=>node.props.className==='gantt-hover-memo')),memo);
    assert.match(text(popup),/작업 · 35% · 1일/);assert.match(text(popup),/프로젝트 › 그룹/);assert.match(text(popup),/배한솔/);
    assert.ok(h.portals.every(target=>target===h.body));
    assert.ok(popup.props.style!.left!>=8&&popup.props.style!.left!+220<=792);
    assert.ok(popup.props.style!.top!>=8&&popup.props.style!.top!+180<=592);
  }finally{h.cleanup();}
});

test('pointer can cross into a memo and scroll or select its contents without dismissing it',async()=>{
  const h=await harness();try{
    h.render();h.advance(120);let popup=tooltip(h.render())!;h.update({hover:null});h.render();
    h.advance(100);popup.props.onPointerEnter!({clientX:700,clientY:500});h.advance(200);assert.ok(tooltip(h.render()));
    for(const event of ['wheel','scroll','pointerdown']){h.dispatch(event,{target:h.box});assert.ok(tooltip(h.render()),event+' inside memo must preserve it');}
    popup=tooltip(h.render())!;popup.props.onPointerLeave!();h.advance(60);assert.equal(tooltip(h.render()),undefined);
  }finally{h.cleanup();}
});

test('Escape stays dismissed while the same row remains hovered and a fresh entry reopens it',async()=>{
  const h=await harness();try{
    h.render();h.advance(120);assert.ok(tooltip(h.render()));h.dispatch('keydown',{key:'Escape'});assert.equal(tooltip(h.render()),undefined);
    h.update({hover:{...item,x:100}});h.render();h.advance(300);assert.equal(tooltip(h.render()),undefined);
    h.update({hover:null});h.render();h.update({hover:item});h.render();h.advance(120);assert.ok(tooltip(h.render()));
  }finally{h.cleanup();}
});

test('keyboard memo focus supports scrolling and Escape returns focus to the originating bar',async()=>{
  const h=await harness();try{
    h.render();h.advance(120);const popup=tooltip(h.render())!;h.update({hover:null});h.render();
    h.focusPopup();popup.props.onFocus!({currentTarget:h.box});h.advance(200);assert.ok(tooltip(h.render()));
    h.dispatch('wheel',{target:h.box});assert.ok(tooltip(h.render()));h.dispatch('keydown',{key:'Escape'});
    assert.equal(tooltip(h.render()),undefined);assert.equal(h.focusReturns(),1);assert.equal(h.focusSelector(),`button.gantt-bar[data-gantt-hover-anchor="${item.task.id}"]`);
  }finally{h.cleanup();}
});

test('outside scrolling, pointer gesture, blur and resize immediately dismiss the memo',async()=>{
  for(const event of ['scroll','wheel','pointerdown','blur','resize']){
    const h=await harness();try{h.render();h.advance(120);assert.ok(tooltip(h.render()));h.dispatch(event,{target:h.body});assert.equal(tooltip(h.render()),undefined,event);}finally{h.cleanup();}
  }
});

test('switching to another row refreshes the memo and empty groups do not invent date ranges',async()=>{
  const h=await harness();try{
    h.render();h.advance(120);h.render();const group={...item,task:{...createTask('빈 그룹'),kind:'group' as const,memo:'그룹 마지막 메모'},typeLabel:'그룹',hasDates:false,duration:'',context:'프로젝트'};
    h.update({hover:group});h.render();h.advance(120);const popup=tooltip(h.render())!;
    assert.match(text(popup),/그룹 마지막 메모/);assert.match(text(popup),/등록된 하위 일정이 없습니다/);assert.doesNotMatch(text(popup),/2026-09-06/);
  }finally{h.cleanup();}
});


test('changed project data dismisses a retained memo even while its popup is hovered',async()=>{
  const h=await harness({hover:item,resetKey:'revision1'});try{
    h.render();h.advance(120);const popup=tooltip(h.render())!;popup.props.onPointerEnter!({clientX:500,clientY:300});
    h.update({hover:null,resetKey:'revision1'});h.render();h.advance(200);assert.ok(tooltip(h.render()));
    h.update({hover:null,resetKey:'revision2'});assert.equal(tooltip(h.render()),undefined);
  }finally{h.cleanup();}
});


test('only a visible memo consumes Escape in capture before the workspace handler',async()=>{
  const h=await harness();try{
    h.render();assert.equal(h.captureModes.get('keydown'),true);
    const pending=h.dispatch('keydown',{key:'Escape'});assert.equal(pending.defaultPrevented,false);assert.equal(pending.propagationStopped,false);
    h.advance(120);assert.ok(tooltip(h.render()));
    const open=h.dispatch('keydown',{key:'Escape'});assert.equal(open.defaultPrevented,true);assert.equal(open.propagationStopped,true);assert.equal(tooltip(h.render()),undefined);
    const closed=h.dispatch('keydown',{key:'Escape'});assert.equal(closed.defaultPrevented,false);assert.equal(closed.propagationStopped,false);
  }finally{h.cleanup();}
});


test('F2 opens and focuses the full memo immediately without waiting for pointer hover delay',async()=>{
  const h=await harness({hover:{...item,focusMemo:true}});try{assert.ok(tooltip(h.render()));assert.equal(h.memoFocuses(),1);h.advance(500);h.render();assert.equal(h.memoFocuses(),1);}finally{h.cleanup();}
});
