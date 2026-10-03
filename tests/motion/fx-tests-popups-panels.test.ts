import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { createElement, isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { CONTENT_SWAP_KEYFRAMES, CONTENT_SWAP_MS, imageSwapKeyframes } from '../../src/utils/contentSwap.ts';
import { EASE_CSS } from '../../src/utils/motion.ts';
import { popClassName, popOriginFromPoint } from '../../src/utils/popupMotion.ts';

/* 움직임 폴리싱 검증 지적 review-motion-rules-4 / popups-panels 갈래 리뷰 — 뮤테이션에서 살아남은 연결을 지킨다.
   - 11번: 첫 열림·교체 판정(useSwapIn·useSwapFade), 새 그림은 decode 뒤에 떠오르고 다 뜨면 아래층을 지움.
   - 8번: 메뉴가 '누른 지점' 쪽 모서리에서 피어나는 기준점 연결.
   훅·컴포넌트는 실제 소스를 esbuild 로 묶어, React 훅만 흉내 내는 작은 하네스에서 직접 돌린다(소스는 그대로). */

const nodeRequire = createRequire(import.meta.url);
const read = (path: string) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
/** 주석을 뺀 코드만 — 설명 글에 같은 낱말이 나와도 세지 않게. */
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

async function bundle(contents: string, external: string[]): Promise<string> {
  const result = await build({
    stdin: { contents, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    logLevel: 'silent',
    loader: { '.css': 'empty' },
    external,
  });
  return result.outputFiles[0].text;
}

function load(source: string, resolve: (id: string) => unknown): Record<string, any> {
  const module = { exports: {} as Record<string, any> };
  new Function('require', 'module', 'exports', source)(resolve, module, module.exports);
  return module.exports;
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/* ─── 훅 하네스: useState·useRef·useMemo·useCallback·useEffect·useLayoutEffect ───
   - 렌더 중 자기 setState 는 그 자리에서 다시 그린다(React 와 같게).
   - 커밋 순서: 자식 → 부모, layout 이펙트 다음 passive 이펙트. 보이지 않게 된 컴포넌트는 정리(cleanup)한다.
   - ref 가 걸린 DOM 요소는 makeHost 가 만든 가짜 객체를 받는다. */

interface Pending { kind: 'layout' | 'passive'; fn: () => void | (() => void); deps?: readonly unknown[] }
interface Instance { slots: any[]; pending: Map<number, Pending>; cursor: number; renderUpdate: boolean }
interface HostNode { type: string; props: Record<string, any>; children: unknown }

function createHookHarness(makeHost: (type: string, props: Record<string, any>) => unknown) {
  const real = nodeRequire('react');
  const instances = new Map<string, Instance>();
  let active: Instance | null = null;
  let tree: unknown = null;
  const changed = (a?: readonly unknown[], b?: readonly unknown[]) =>
    !a || !b || a.length !== b.length || a.some((value, index) => !Object.is(value, b[index]));
  const current = () => {
    if (!active) throw new Error('훅은 렌더 중에만');
    return active;
  };
  const effect = (kind: Pending['kind']) => (fn: Pending['fn'], deps?: readonly unknown[]) => {
    const instance = current();
    const index = instance.cursor++;
    const committed = instance.slots[index];
    if (committed && deps && !changed(committed.deps, deps)) {
      instance.pending.delete(index);
      return;
    }
    instance.pending.set(index, { kind, fn, deps });
  };
  const react = {
    ...real,
    useState(initial: unknown) {
      const instance = current();
      const index = instance.cursor++;
      const slot = (instance.slots[index] ??= { value: typeof initial === 'function' ? (initial as () => unknown)() : initial });
      slot.set ??= (next: unknown) => {
        const value = typeof next === 'function' ? (next as (prev: unknown) => unknown)(slot.value) : next;
        if (Object.is(value, slot.value)) return;
        slot.value = value;
        if (active === instance) instance.renderUpdate = true;
      };
      return [slot.value, slot.set];
    },
    useRef(initial: unknown) {
      const instance = current();
      const index = instance.cursor++;
      return (instance.slots[index] ??= { current: initial });
    },
    useMemo(fn: () => unknown, deps: readonly unknown[]) {
      const instance = current();
      const index = instance.cursor++;
      const slot = instance.slots[index];
      if (!slot || changed(slot.deps, deps)) instance.slots[index] = { deps, value: fn() };
      return instance.slots[index].value;
    },
    useCallback(fn: unknown, deps: readonly unknown[]) {
      return react.useMemo(() => fn, deps);
    },
    /** Provider 없이 그리므로 늘 기본값. */
    useContext(context: { _currentValue: unknown }) {
      return context._currentValue;
    },
    useEffect: effect('passive'),
    useLayoutEffect: effect('layout'),
  };

  const visit = (node: any, path: string, seen: Set<string>, order: Instance[]): unknown => {
    if (Array.isArray(node)) return node.map((child, index) => visit(child, `${path}/${child?.key ?? index}`, seen, order));
    if (!isValidElement(node)) return node;
    const element = node as any;
    if (typeof element.type === 'function') {
      const id = `${path}:${element.type.name}:${element.key ?? ''}`;
      let instance = instances.get(id);
      if (!instance) {
        instance = { slots: [], pending: new Map(), cursor: 0, renderUpdate: false };
        instances.set(id, instance);
      }
      seen.add(id);
      let child: unknown;
      for (let pass = 0; ; pass++) {
        if (pass > 25) throw new Error(`${id}: 렌더 중 setState 가 끝나지 않음`);
        instance.cursor = 0;
        instance.renderUpdate = false;
        const parent = active;
        active = instance;
        try {
          child = element.type(element.props);
        } finally {
          active = parent;
        }
        if (!instance.renderUpdate) break;
      }
      const out = visit(child, `${id}/`, seen, order);
      order.push(instance);
      return out;
    }
    const props = (element.props ?? {}) as Record<string, any>;
    if (typeof element.type === 'string' && element.ref && typeof element.ref === 'object') {
      element.ref.current ??= makeHost(element.type, props);
    }
    const host: HostNode = { type: String(element.type), props, children: visit(props.children, `${path}/${String(element.type)}`, seen, order) };
    return host;
  };

  const render = (element: ReactElement) => {
    for (let pass = 0; pass < 25; pass++) {
      const seen = new Set<string>();
      const order: Instance[] = [];
      tree = visit(element, 'root', seen, order);
      for (const [id, instance] of instances) {
        if (seen.has(id)) continue;
        for (const slot of instance.slots) slot?.cleanup?.();
        instances.delete(id);
      }
      let ran = false;
      for (const kind of ['layout', 'passive'] as const) {
        for (const instance of order) {
          for (const [index, pending] of instance.pending) {
            if (pending.kind !== kind) continue;
            instance.pending.delete(index);
            instance.slots[index]?.cleanup?.();
            instance.slots[index] = { deps: pending.deps, cleanup: pending.fn() };
            ran = true;
          }
        }
      }
      // 이펙트가 상태를 바꿨을 수 있다 — 한 번 더 그려 보고, 돌 이펙트가 없으면 끝.
      if (!ran) return tree;
    }
    throw new Error('렌더가 끝나지 않음');
  };

  const collect = (node: unknown): HostNode[] => {
    if (Array.isArray(node)) return node.flatMap((child) => collect(child));
    if (!node || typeof node !== 'object' || !('type' in node)) return [];
    const host = node as HostNode;
    return [host, ...collect(host.children)];
  };

  return { react, render, hosts: () => collect(tree) };
}

/* ─── 가짜 DOM 요소 ─── */

interface FakeAnimation {
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  cancelled: boolean;
  finished: Promise<void>;
  finish(): void;
  cancel(): void;
}

function fakeAnimatable() {
  const calls: FakeAnimation[] = [];
  return {
    calls,
    animate(keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      let finish!: () => void;
      const finished = new Promise<void>((resolve) => { finish = resolve; });
      const animation: FakeAnimation = {
        keyframes,
        options,
        cancelled: false,
        finished,
        finish: () => finish(),
        cancel() { animation.cancelled = true; },
      };
      calls.push(animation);
      return animation;
    },
  };
}

function fakeImage(src: string) {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const decoded = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  decoded.catch(() => undefined);
  const img = {
    src,
    complete: false,
    naturalWidth: 0,
    decodeCalls: 0,
    decode() {
      img.decodeCalls += 1;
      return decoded;
    },
    resolveDecode: () => resolve(),
    rejectDecode: () => reject(new Error('decode failed')),
    addEventListener() {},
    removeEventListener() {},
  };
  return img;
}

/* ─── 11번: 첫 열림·교체 판정 훅 ─── */

let swapSource: Promise<string> | undefined;
async function swapProbe() {
  const source = await (swapSource ??= bundle("export * from './src/hooks/useContentSwap';", ['react', 'react/jsx-runtime']));
  const harness = createHookHarness(() => undefined);
  const hooks = load(source, (id) => (id === 'react' ? harness.react : nodeRequire(id)));
  const el = fakeAnimatable();
  const ref = { current: el };
  function SwapProbe({ k, reduce }: { k: string | null; reduce: boolean }) {
    const swapped = hooks.useSwapIn(k);
    hooks.useSwapFade(ref, k, reduce);
    return createElement('div', { 'data-swapped': swapped });
  }
  return {
    el,
    /** 같은 프로브를 key 하나로 다시 그린다. 교체 여부를 돌려준다. */
    show(k: string | null, reduce = false): boolean {
      harness.render(createElement(SwapProbe, { key: 'probe', k, reduce }));
      return harness.hosts()[0].props['data-swapped'] as boolean;
    },
  };
}

test('useSwapIn: 닫힘 → 첫 열림은 교체가 아니고, 열린 채 다른 항목으로 바뀐 뒤로만 교체다(닫았다 열면 다시 처음)', async () => {
  const probe = await swapProbe();
  const keys: Array<string | null> = [null, 'a', 'a', 'b', 'b', 'a', null, 'c', 'c'];
  assert.deepEqual(keys.map((k) => probe.show(k)), [false, false, false, true, true, true, false, false, false]);
});

test('useSwapFade: 첫 열림에는 돌지 않고, 열린 채 바뀔 때만 140ms 4px 떠오름 — 다음 교체가 오면 이전 움직임은 멈춘다', async () => {
  const probe = await swapProbe();
  const { calls } = probe.el;
  probe.show(null);
  probe.show('a');
  assert.equal(calls.length, 0, '닫혀 있다가 처음 열릴 때는 내용만 따로 떠오르지 않는다(창 셸이 맡음)');
  probe.show('a');
  assert.equal(calls.length, 0, '같은 항목이면 다시 돌지 않는다');
  probe.show('b');
  assert.equal(calls.length, 1, '열린 채 다른 항목 → 내용만 떠오른다');
  assert.deepEqual(calls[0].keyframes, CONTENT_SWAP_KEYFRAMES);
  assert.equal(calls[0].options.duration, CONTENT_SWAP_MS.content);
  assert.equal(calls[0].options.easing, EASE_CSS.out);
  probe.show('a');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].cancelled, true, '빠르게 넘기면 앞 움직임은 멈추고 새로 시작');
  probe.show(null);
  assert.equal(calls.length, 2, '닫힐 때는 돌지 않는다');
  assert.equal(calls[1].cancelled, true);
  probe.show('c');
  assert.equal(calls.length, 2, '닫았다 다시 열면 다시 첫 열림');
});

test('useSwapFade: 처음부터 열린 채 그려지면 돌지 않고, 동작 줄이기면 opacity 만 100ms(움직임 없음)', async () => {
  const probe = await swapProbe();
  const { calls } = probe.el;
  probe.show('a', true);
  assert.equal(calls.length, 0, '첫 그림에서는 돌지 않는다');
  probe.show('b', true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].keyframes, [{ opacity: 0 }, { opacity: 1 }], '동작 줄이기: transform 없이 opacity 만');
  assert.equal(calls[0].options.duration, CONTENT_SWAP_MS.reduced);
  probe.show('b', false);
  assert.equal(calls.length, 1, '설정만 바뀌면 다시 돌지 않는다');
});

/* ─── 11번: 캐릭터 그림 겹쳐 바꾸기(실제 CharacterImageFrame) ─── */

let frameSource: Promise<string> | undefined;
async function frameHarness({ reduce }: { reduce: boolean }) {
  const source = await (frameSource ??= bundle(
    "export { CharacterImageFrame } from './src/components/characters/CharacterImageFrame';",
    ['react', 'react/jsx-runtime', 'framer-motion', 'lucide-react'],
  ));
  const images = new Map<string, ReturnType<typeof fakeImage>>();
  const layerDivs = new Map<string, ReturnType<typeof fakeAnimatable>>();
  const harness = createHookHarness((type, props) => {
    if (type === 'img') {
      const img = fakeImage(String(props.src));
      images.set(img.src, img);
      return img;
    }
    if (type === 'div') {
      const div = fakeAnimatable();
      const child = props.children;
      if (isValidElement(child) && child.type === 'img') layerDivs.set(String((child.props as { src: string }).src), div);
      return div;
    }
    return undefined;
  });
  const mod = load(source, (id) => {
    if (id === 'react') return harness.react;
    if (id === 'framer-motion') return { useReducedMotion: () => reduce };
    if (id === 'lucide-react') return new Proxy({}, { get: () => () => null });
    return nodeRequire(id);
  });
  let props: Record<string, unknown> = {};
  const draw = () => harness.render(createElement(mod.CharacterImageFrame, { key: 'frame', ...props }));
  return {
    frame(next: Record<string, unknown>) {
      props = { alt: '복장 그림', ...next };
      draw();
    },
    rerender: draw,
    /** 지금 그려진 그림 층 — [src, 받는 중이라 숨김?, 아래층(aria-hidden)?] */
    layers: () => harness.hosts()
      .filter(isLayer)
      .map((host) => {
        const img = host.children as HostNode;
        return [img.props.src as string, host.props.style?.opacity === 0, host.props['aria-hidden'] === true] as const;
      }),
    img: (src: string) => {
      const img = images.get(src);
      assert.ok(img, `${src} 그림 요소 없음`);
      return img;
    },
    div: (src: string) => {
      const div = layerDivs.get(src);
      assert.ok(div, `${src} 층 없음`);
      return div;
    },
    animations: () => [...layerDivs.values()].flatMap((div) => div.calls),
  };
}

const isLayer = (host: HostNode) => {
  const child = host.children as HostNode | null;
  return host.type === 'div' && !!child && typeof child === 'object' && child.type === 'img'
    && String(host.props.className ?? '').includes('absolute inset-0');
};

test('그림 교체: 새 그림은 decode 가 끝나기 전엔 숨긴 채 옛 그림을 보여 주고, 끝난 뒤에야 누른 쪽에서 떠오른다', async () => {
  const h = await frameHarness({ reduce: false });
  h.frame({ url: 'a.png', swapDirection: 0 });
  assert.deepEqual(h.layers(), [['a.png', false, false]], '처음 그림은 기다리지 않고 바로');
  assert.equal(h.img('a.png').decodeCalls, 0);

  h.frame({ url: 'b.png', swapDirection: 1 });
  assert.deepEqual(h.layers(), [['a.png', false, true], ['b.png', true, false]], '옛 그림은 아래층에 그대로, 새 그림은 숨긴 채 받는 중');
  assert.equal(h.img('b.png').decodeCalls, 1, '새 그림 decode 를 기다린다');
  assert.equal(h.animations().length, 0, 'decode 전에는 아무것도 움직이지 않는다(빈 칸 번쩍임 X)');

  h.img('b.png').resolveDecode();
  await flush();
  h.rerender();
  assert.deepEqual(h.layers(), [['a.png', false, true], ['b.png', false, false]]);
  assert.equal(h.div('a.png').calls.length, 0, '아래층(옛 그림)은 움직이지 않는다');
  const [enter, ...rest] = h.div('b.png').calls;
  assert.ok(enter, '준비되면 떠오른다');
  assert.equal(rest.length, 0, '한 번만');
  assert.deepEqual(enter.keyframes, imageSwapKeyframes(1), '› 를 눌렀으니 오른쪽 6px 에서');
  assert.equal(enter.options.duration, CONTENT_SWAP_MS.image);
  assert.equal(enter.options.easing, EASE_CSS.out);

  enter.finish();
  await flush();
  h.rerender();
  assert.deepEqual(h.layers(), [['b.png', false, false]], '다 떠오르면 아래층을 지운다');
  assert.equal(h.div('b.png').calls.length, 1, '자리 잡은 뒤 다시 돌지 않는다');
});

test('그림 교체: decode 가 실패해도 그림을 이미 받았으면 띄우고, 못 받았으면 숨긴 채 옛 그림을 둔다', async () => {
  const h = await frameHarness({ reduce: false });
  h.frame({ url: 'a.png', swapDirection: 0 });
  h.frame({ url: 'b.png', swapDirection: -1 });
  const b = h.img('b.png');
  b.complete = true;
  b.naturalWidth = 320;
  b.rejectDecode();
  await flush();
  h.rerender();
  assert.equal(h.div('b.png').calls.length, 1, '받아진 그림은 decode 실패여도 띄운다');
  assert.deepEqual(h.div('b.png').calls[0].keyframes, imageSwapKeyframes(-1));

  const h2 = await frameHarness({ reduce: false });
  h2.frame({ url: 'a.png', swapDirection: 0 });
  h2.frame({ url: 'c.png', swapDirection: 1 });
  h2.img('c.png').rejectDecode();
  await flush();
  h2.rerender();
  assert.deepEqual(h2.layers(), [['a.png', false, true], ['c.png', true, false]], '못 받은 그림은 숨긴 채, 옛 그림 유지');
  assert.equal(h2.animations().length, 0);
});

test('그림 교체: 받는 중에 다른 그림으로 넘겼다 돌아와도, 늦게 끝난 옛 decode 가 새로 받는 그림을 먼저 띄우지 않는다', async () => {
  const h = await frameHarness({ reduce: false });
  h.frame({ url: 'a.png', swapDirection: 0 });
  h.frame({ url: 'b.png', swapDirection: 1 });
  const staleB = h.img('b.png');
  h.frame({ url: 'c.png', swapDirection: 1 });
  assert.deepEqual(h.layers(), [['a.png', false, true], ['c.png', true, false]], '받던 b 는 버리고 c 를 받는다');
  h.frame({ url: 'b.png', swapDirection: -1 });
  const freshB = h.img('b.png');
  assert.notEqual(freshB, staleB, '다시 받는 b 는 새 그림 요소');
  staleB.resolveDecode();
  await flush();
  h.rerender();
  assert.deepEqual(h.layers(), [['a.png', false, true], ['b.png', true, false]], '옛 요청이 끝났다고 새 그림을 띄우지 않는다');
  assert.equal(h.animations().length, 0);
  freshB.resolveDecode();
  await flush();
  h.rerender();
  assert.equal(h.div('b.png').calls.length, 1);
});

test('그림 교체: 동작 줄이기면 옆에서 밀려오지 않고 opacity 만 100ms', async () => {
  const h = await frameHarness({ reduce: true });
  h.frame({ url: 'a.png', swapDirection: 0 });
  h.frame({ url: 'b.png', swapDirection: 1 });
  h.img('b.png').resolveDecode();
  await flush();
  h.rerender();
  const [enter] = h.div('b.png').calls;
  assert.ok(enter);
  assert.deepEqual(enter.keyframes, [{ opacity: 0 }, { opacity: 1 }]);
  assert.equal(enter.options.duration, CONTENT_SWAP_MS.reduced);
});

/* ─── 11번: 화면 연결(휴가·리테이크) ─── */

test('휴가 날짜 카드: 교체 판정은 고른 날짜 key 로, 동작 줄이기는 앱 설정을 따른다', () => {
  const view = code('src/views/VacationView.tsx');
  assert.match(view, /const \{ reduce \} = useMotionPref\(\);\n\s+const dateSwapIn = useSwapIn\(selectedDate\);/);
  assert.match(view, /<div key=\{selectedDate\} className=\{swapInClassName\(dateSwapIn, true\) \|\| undefined\}>/);
});

test('리테이크 상세 칸: 교체 판정은 리테이크 id 로, 셸은 동작 줄이기를 따르고, 안쪽 내용에 교체 클래스를 붙인다', () => {
  const panel = code('src/views/compositing/RevisionDetailPanel.tsx');
  const start = panel.indexOf('export const DetailPanel = forwardRef');
  const end = panel.indexOf('function DetailPanelContent(');
  assert.ok(start >= 0 && end > start, 'DetailPanel 셸');
  const shell = panel.slice(start, end);
  assert.match(shell, /const \{ reduce \} = useMotionPref\(\);\n\s+const swapIn = useSwapIn\(props\.revision\.id\);/);
  assert.match(shell, /\{\.\.\.sidePanelPreset\(reduce\)\}/);
  assert.match(shell, /<DetailPanelContent key=\{props\.revision\.id\} \{\.\.\.props\} swapIn=\{swapIn\} \/>/);
  assert.match(panel.slice(end), /<div className=\{`p-5 \$\{swapInClassName\(swapIn\)\}`\}>/);
});

/* ─── 8번: 메뉴 기준점은 '누른 지점'(보정 전) 기준, 상자는 보정된 자리 ─── */

test('씬 우클릭 메뉴(실제 렌더): 화면 오른쪽 아래 끝에서 밀려나면 기준점이 누른 지점 쪽(오른쪽 아래)으로 뒤집힌다', async () => {
  const source = await bundle(
    "export { SceneContextMenu } from './src/components/scenes/SceneContextMenu';",
    ['react', 'react/jsx-runtime', 'react-dom', 'lucide-react'],
  );
  const { SceneContextMenu } = load(source, (id) => nodeRequire(id));
  const viewport = { innerWidth: 1600, innerHeight: 900 };
  const hadWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: viewport });
  try {
    const render = (x: number, y: number) => {
      const html = renderToStaticMarkup(createElement(SceneContextMenu, { x, y, current: null, onSelect() {}, onClose() {} }));
      const menu = html.match(/<div role="menu" style="([^"]*)" class="([^"]*)"/);
      assert.ok(menu, html.slice(0, 200));
      const num = (name: string) => Number(menu[1].match(new RegExp(`(?:^|;)${name}:(-?[\\d.]+)px`))?.[1]);
      const origin = menu[1].match(/--pop-origin:(-?[\d.]+)px (-?[\d.]+)px/);
      assert.ok(origin, '기준점 인라인 값');
      return { left: num('left'), top: num('top'), width: num('width'), origin: { x: Number(origin[1]), y: Number(origin[2]) }, className: menu[2] };
    };

    const corner = { x: 1590, y: 880 };
    const placed = render(corner.x, corner.y);
    assert.ok(placed.left < corner.x && placed.top < corner.y, '화면 안으로 밀려났다');
    // 아래 끝에 붙었으니 메뉴 높이 = 화면 높이 - 8 - top
    const height = viewport.innerHeight - 8 - placed.top;
    const expected = popOriginFromPoint(corner, { left: placed.left, top: placed.top, width: placed.width, height });
    assert.deepEqual(placed.origin, { x: expected.x, y: expected.y });
    assert.ok(expected.x > 0 && expected.y > 0 && expected.up, '누른 지점 = 메뉴 오른쪽 아래 근처');
    assert.ok(placed.className.startsWith(`${popClassName(expected)} `), '아래에서 위로 피어남');

    const free = render(300, 200);
    assert.deepEqual({ left: free.left, top: free.top, origin: free.origin }, { left: 300, top: 200, origin: { x: 0, y: 0 } }, '밀려나지 않으면 왼쪽 위 모서리');
  } finally {
    if (hadWindow) Object.defineProperty(globalThis, 'window', hadWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('태그 관리·간트·캘린더 빠른 편집: 자리를 고친 그 자리에서 기준점도 함께 정한다(누른 곳 기준, 상자는 고친 자리)', () => {
  const tag = code('src/components/calendar/TagManagerPopover.tsx');
  assert.match(
    tag,
    /const next = calculatePosition\(anchorRect, width, height\);\n\s+setPosition\(next\);\n\s+setPopOrigin\(popOriginFromAnchor\(anchorRect, \{ \.\.\.next, width, height \}\)\);/,
    '태그 관리: 버튼(anchorRect) 기준, 고친 자리 상자',
  );
  assert.match(tag, /useLayoutEffect\(\(\) => \{\n\s+updatePosition\(\);/, '태그 관리: 그리기 전에');

  const gantt = code('src/features/gantt/GanttDialogs.tsx');
  assert.match(
    gantt,
    /useLayoutEffect\(\(\)=>\{const r=ref\.current\?\.getBoundingClientRect\(\);if\(r\)\{const next=\{left:Math\.max\(8,Math\.min\(target\.x,[^;]*;setPosition\(next\);setOrigin\(popOriginFromPoint\(target,\{\.\.\.next,width:r\.width,height:r\.height\}\)\);\}\}/,
    '간트: 우클릭 지점(target) 기준, 고친 자리 상자',
  );

  const quick = code('src/components/calendar/EventQuickEdit.tsx');
  assert.match(
    quick,
    /const next = clampMenuToViewport\(position, rect, \{ width: window\.innerWidth, height: window\.innerHeight \}\);\n\s+setAdjusted\(\{\n\s+\.\.\.next,\n\s+origin: popOriginFromPoint\(position, \{ left: next\.x, top: next\.y, width: rect\.width, height: rect\.height \}\),\n\s+\}\);/,
    '빠른 편집: 우클릭 지점(position) 기준, 고친 자리 상자',
  );
});
