import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  HIGHLIGHT_DURATION_MS,
  compositingStatusChanged,
  useTransientHighlightStore,
} from '../../src/stores/transientHighlightStore.ts';
import {
  PART_DRAWER_FALLBACK_MS,
  PART_DRAWER_HOLD,
  PART_DRAWER_TRANSITION,
  runPartDrawer,
  settlePartDrawerOpen,
} from '../../src/views/compositing-dashboard/cards/partDrawer.ts';

/* 움직임 폴리싱 5번 — 컴포지팅 카드: 깜빡 재등장 · 즉시 어두워짐 · 펼칠 때 겹침/툭 내려앉음 · 등장 blur. */

const read = (path: string) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const ruleBody = (css: string, selector: string) => {
  const at = css.indexOf(`${selector} {`);
  assert.ok(at >= 0, `${selector} 규칙을 찾지 못했다`);
  return css.slice(at, css.indexOf('}', at) + 1);
};
const msOf = (value: string) => Number(value.replace('ms', ''));

/* ─── 단계 변경 물듦: 단계가 실제로 바뀐 원격 변경만 ─── */

test('단계 변화 판정: 행이 없던 씬은 배치로 보고, 같은 단계는 물들이지 않는다', () => {
  assert.equal(compositingStatusChanged(undefined, { status: 'batch' }), false);
  assert.equal(compositingStatusChanged(undefined, { status: 'combine' }), true);
  assert.equal(compositingStatusChanged({ status: 'done' }, { status: 'done' }), false);
  assert.equal(compositingStatusChanged({ status: 'adjust' }, { status: 'done' }), true);
});

test('highlight: add 마다 seq 가 커지고, 물듦 key(washSeq)는 단계가 바뀐 add 에서만 바뀐다', () => {
  const store = useTransientHighlightStore;
  try {
    store.getState().add('5:a003', 'u2', { wash: true });
    const first = store.getState().highlights.get('5:a003');
    assert.ok(first);
    assert.equal(first.washSeq, first.seq, '단계 변화 → 물듦');

    // 단계가 그대로인 변경(오류 메모 등) — 이름 동그라미만 다시, 이미 도는 물듦은 끊지 않는다(같은 key 유지).
    store.getState().add('5:a003', 'u2');
    const second = store.getState().highlights.get('5:a003');
    assert.ok(second && second.seq > first.seq);
    assert.equal(second.washSeq, first.seq);

    store.getState().add('5:a003', 'u3', { wash: true });
    const third = store.getState().highlights.get('5:a003');
    assert.ok(third && third.washSeq === third.seq && third.seq > second.seq);

    // 처음부터 단계 변화가 없으면 물듦 없음
    store.getState().add('5:b001', 'u2', { wash: false });
    assert.equal(store.getState().highlights.get('5:b001')?.washSeq, null);
  } finally {
    store.getState().clearAll();
  }
});

test('수신 처리: 덮어쓰기 전 값과 비교해 wash 를 넘긴다(본인 변경은 highlight 없음 그대로)', () => {
  const view = read('src/views/CompositingDashboardView.tsx');
  const start = view.indexOf('subscribeCompositingStatesRealtime((row, eventType)');
  assert.ok(start >= 0);
  const handler = view.slice(start, view.indexOf('return () => {', start));
  const previousAt = handler.indexOf('const previous = useDataStore.getState().compositingStates.get(key);');
  const writeAt = handler.indexOf('setCompositingStateInStore(key, row);');
  assert.ok(previousAt >= 0 && writeAt > previousAt, '저장소를 덮어쓰기 전에 이전 값을 읽어야 한다');
  assert.match(handler, /row\.updatedBy !== currentUser\.id\) \{\n\s+addHighlight\(key, row\.updatedBy, \{ wash: compositingStatusChanged\(previous, row\) \}\);/);
});

test('카드: 셸의 차례 등장 animation 을 덮던 flashing 클래스 대신 앞면 위 색 층을 key 로 다시 튼다', () => {
  const card = read('src/views/compositing-dashboard/cards/SceneCard.tsx');
  assert.doesNotMatch(card, /'flashing'/);
  assert.doesNotMatch(card, /--current-status-color/);
  assert.match(card, /key=\{highlight\.washSeq\}\n\s+className="bf-status-wash"\n\s+style=\{\{ background: `var\(\$\{tokenVar\}\)` \}\}/);
  // 물듦 층은 버튼(불투명 앞면) 안 마지막 자식 — 앞면 아래 배경을 칠하면 가려서 안 보였다.
  const wash = card.indexOf('className="bf-status-wash"');
  const buttonEnd = card.indexOf('</button>');
  assert.ok(wash > 0 && wash < buttonEnd, '물듦 층은 카드 버튼 안에 있어야 한다');
  assert.ok(card.slice(wash, buttonEnd).split('\n').length < 8, '버튼의 마지막 자식');
  // 이름 동그라미: add 마다 다시 '톡'. 예전 인라인 fadeOut 키프레임은 쓰지 않는다.
  assert.match(card, /key=\{highlight\.seq\}\n\s+className="bf-comp-avatar /);
  assert.doesNotMatch(card, /fadeOut/);
  // 핀·선택 배지 등장, 핀 라벨 밀려 들어옴
  assert.match(card, /scene-card-selection-badge bf-comp-pop-in /);
  assert.match(card, /scene-card-pin-badge bf-comp-pop-in /);
  assert.match(card, /className="bf-comp-label-in /);
});

test('CSS: 물듦은 앞면 층 opacity 0 → .28(25%) → 0 · 0.9초, 동작 줄이기면 0.2초 한 번', () => {
  const css = stripComments(read('src/styles/motion-live-drag.css'));
  const wash = ruleBody(css, '.bf-status-wash');
  assert.match(wash, /position: absolute;/);
  assert.match(wash, /inset: 0;/);
  assert.match(wash, /pointer-events: none;/);
  assert.match(wash, /animation: bf-status-wash 900ms ease-out forwards;/);
  assert.match(css, /@keyframes bf-status-wash \{\n\s+0% \{ opacity: 0; \}\n\s+25% \{ opacity: 0\.28; \}\n\s+100% \{ opacity: 0; \}\n\}/);
  const keyframes = css.slice(css.indexOf('@keyframes bf-status-wash'), css.indexOf('@keyframes bf-comp-pop-in'));
  assert.doesNotMatch(keyframes, /background|box-shadow/, '색 변화는 겹친 층의 opacity 로만');
  const reduce = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduce, /\.bf-status-wash \{\n\s+animation-duration: 200ms !important;/);
});

test('CSS: 이름 동그라미는 scale .6 → 1 220ms 로 나타나 highlight 가 끝나는 순간에 맞춰 사라진다', () => {
  const css = stripComments(read('src/styles/motion-live-drag.css'));
  assert.match(css, /@keyframes bf-comp-pop-in \{\n\s+from \{ opacity: 0; transform: scale\(0\.6\); \}\n\}/);
  const avatar = ruleBody(css, '.bf-comp-avatar').replace(/\s+/g, ' ');
  const pop = avatar.match(/bf-comp-pop-in (\d+ms) cubic-bezier\(0\.2, 0\.9, 0\.3, 1\.2\)/);
  assert.ok(pop, '등장: 220ms 튕김 곡선');
  assert.equal(pop[1], '220ms');
  const away = avatar.match(/bf-comp-fade-away (\d+ms) var\(--ease-in\) (\d+ms) forwards/);
  assert.ok(away, '퇴장: 지연 뒤 한 번, 끝값 유지');
  assert.equal(msOf(away[1]) + msOf(away[2]), HIGHLIGHT_DURATION_MS, '퇴장 끝 = highlight 끝(언마운트)');
  assert.match(ruleBody(css, '.bf-comp-label-in'), /animation: bf-comp-label-in 160ms var\(--ease-out\);/);
  assert.match(css, /@keyframes bf-comp-label-in \{\n\s+from \{ opacity: 0; transform: translateX\(-4px\); \}/);
});

test('index.css: 깜빡 재등장 규칙 삭제, 어두워짐 0.2초, 등장 blur·will-change 제거, 동작 줄이기 지연 0s', () => {
  const css = stripComments(read('src/index.css'));
  assert.doesNotMatch(css, /\.scene-card\.flashing/);
  assert.doesNotMatch(css, /bf-status-flash/);
  assert.doesNotMatch(css, /@keyframes fadeOut\b/);

  const cascade = css.slice(css.indexOf('@keyframes bf-cascade-in'), css.indexOf('.bf-cascade-item {'));
  assert.match(cascade, /opacity: 0;\n\s+transform: translateY\(var\(--motion-cascade-translate, 14px\)\) scale\(0\.92\);/);
  assert.doesNotMatch(cascade, /filter|blur/, "'흐렸다 선명해지는' 효과는 뺀다");
  assert.doesNotMatch(cascade, /\bto \{/, '끝값은 카드의 지금 값(어두워짐·핀 위치)으로 이어지게 비운다');
  const item = ruleBody(css, '.bf-cascade-item');
  assert.match(item, /animation: bf-cascade-in var\(--motion-cascade-duration, 560ms\) cubic-bezier\(0\.2, 0\.7, 0\.2, 1\) backwards;/);
  assert.doesNotMatch(item, /will-change/);

  const sceneCard = css.slice(css.indexOf('.scene-card {'), css.indexOf('.scene-card:hover'));
  assert.match(sceneCard, /opacity 200ms ease,/, '띄우기·칩 필터로 어두워질 때 0.2초');

  const reduceStart = css.lastIndexOf('@media (prefers-reduced-motion: reduce)', css.indexOf('.scene-card.pinned {\n    transform: none !important;'));
  const reduce = css.slice(reduceStart, css.indexOf('@keyframes char-overlay-in'));
  assert.match(reduce, /\.bf-cascade-item \{\n\s+animation-delay: 0s !important;\n\s+\}/);
  assert.doesNotMatch(reduce, /animation-delay: 0 !important/, "'0' 은 시간 값으로 무효라 규칙이 버려진다");
  assert.doesNotMatch(reduce, /\.bf-cascade-item,\n/, '동작 줄이기: 차례 등장은 200ms 가 아니라 즉시');
});

/* ─── 파트 서랍 ─── */

interface FakeStyle { maxHeight: string; overflow: string; transition: string; opacity: string; transform: string }

interface FakeDrawer {
  style: FakeStyle;
  log: string[];
  readonly offsetHeight: number;
  scrollHeight: number;
  getBoundingClientRect(): { height: number };
  listeners: Set<(event: TransitionEvent) => void>;
  addEventListener(type: 'transitionend', listener: (event: TransitionEvent) => void): void;
  removeEventListener(type: 'transitionend', listener: (event: TransitionEvent) => void): void;
  fire(target: unknown, propertyName: string): void;
}

function fakeDrawer(scrollHeight: number, rectHeight = 0): FakeDrawer {
  const log: string[] = [];
  const raw: FakeStyle = { maxHeight: '', overflow: '', transition: '', opacity: '', transform: '' };
  const style = new Proxy(raw, {
    set(target, key: string, value: string) {
      (target as unknown as Record<string, string>)[key] = value;
      log.push(`${key}=${value}`);
      return true;
    },
  });
  const el: FakeDrawer = {
    style,
    log,
    get offsetHeight() { log.push('flush'); return rectHeight; },
    scrollHeight,
    getBoundingClientRect: () => ({ height: rectHeight }),
    listeners: new Set(),
    addEventListener(_type, listener) { el.listeners.add(listener); },
    removeEventListener(_type, listener) { el.listeners.delete(listener); },
    fire(target, propertyName) {
      for (const listener of [...el.listeners]) listener({ target, propertyName } as unknown as TransitionEvent);
    },
  };
  return el;
}

function fakeTimers() {
  const pending = new Map<number, () => void>();
  let next = 1;
  return {
    pending,
    setTimer: (fn: () => void, ms: number) => {
      assert.equal(ms, PART_DRAWER_FALLBACK_MS);
      const id = next++;
      pending.set(id, fn);
      return id;
    },
    clearTimer: (handle: unknown) => { pending.delete(handle as number); },
    runAll: () => {
      for (const [id, fn] of [...pending]) {
        pending.delete(id);
        fn();
      }
    },
  };
}

const plainStyle = (style: FakeStyle) => ({ ...style });

test('서랍 펼침: 0 에서 출발해 칸 밖으로 안 나온 채 실제 높이까지, 끝나면 넘침 허용', () => {
  assert.match(PART_DRAWER_TRANSITION, /^max-height 280ms cubic-bezier\(0\.22, 1, 0\.36, 1\), /);
  // 출발 높이를 박는 순간에도 투명도·위치 전환은 이어진다(none 이면 흐려지던 값이 끝값으로 튀었다 돌아온다).
  assert.equal(PART_DRAWER_HOLD, 'opacity 180ms ease, transform 220ms ease');

  // 방금 마운트된 서랍은 이미 제 높이(270)로 놓여 있어도 0 에서 출발한다. 한 줄짜리(270 < 320)도 실제 높이까지만.
  const el = fakeDrawer(270, 270);
  const timers = fakeTimers();
  let settled = 0;
  runPartDrawer(el as never, true, { fromZero: true, onSettled: () => { settled += 1; }, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  const flush = el.log.indexOf('flush');
  assert.ok(flush > 0, '출발 높이를 한 번 계산시킨 뒤 목표값을 준다');
  const before = el.log.slice(0, flush);
  assert.ok(before.includes('overflow=hidden'));
  assert.ok(before.includes('maxHeight=0px'), '첫 프레임 높이 0 — 아래 파트 제목줄이 먼저 툭 내려앉지 않게');
  assert.ok(before.includes(`transition=${PART_DRAWER_HOLD}`));
  assert.deepEqual(el.log.slice(flush + 1), [`transition=${PART_DRAWER_TRANSITION}`, 'maxHeight=270px']);
  assert.equal(el.style.overflow, 'hidden', '펼치는 동안은 칸 밖으로 안 나온다');

  el.fire({}, 'max-height'); // 안쪽 카드에서 올라온 transitionend 는 무시
  el.fire(el, 'opacity');
  assert.equal(settled, 0);
  el.fire(el, 'max-height');
  assert.equal(settled, 1);
  assert.deepEqual(plainStyle(el.style), { maxHeight: '', overflow: '', transition: '', opacity: '', transform: '' });
  assert.equal(el.listeners.size, 0);
  assert.equal(timers.pending.size, 0);
  el.fire(el, 'max-height');
  assert.equal(settled, 1, '한 번만');
});

test('서랍 접힘: 지금 높이에서 0 으로, 안전 마감 타이머로도 끝나고, 취소하면 끝내지 않는다', () => {
  const el = fakeDrawer(510, 510);
  const timers = fakeTimers();
  let settled = 0;
  runPartDrawer(el as never, false, { onSettled: () => { settled += 1; }, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  const flush = el.log.indexOf('flush');
  assert.ok(el.log.slice(0, flush).includes('maxHeight=510px'), "'none' 에서는 전환이 안 되므로 지금 높이를 숫자로 먼저");
  assert.ok(el.log.slice(flush).includes('maxHeight=0px'));
  assert.equal(el.style.opacity, '0');
  timers.runAll();
  assert.equal(settled, 1);
  assert.equal(el.style.maxHeight, '0px', '접힘 끝은 호출한 쪽이 언마운트 — 값을 비우지 않는다');

  // 접히던 중 다시 펼침: 지금 보이는 높이(120)에서 출발, 앞선 접힘은 취소
  const el2 = fakeDrawer(510, 120);
  const t2 = fakeTimers();
  let closed = 0;
  const cancel = runPartDrawer(el2 as never, false, { onSettled: () => { closed += 1; }, setTimer: t2.setTimer, clearTimer: t2.clearTimer });
  cancel();
  assert.equal(el2.listeners.size, 0);
  assert.equal(t2.pending.size, 0);
  el2.log.length = 0;
  runPartDrawer(el2 as never, true, { setTimer: t2.setTimer, clearTimer: t2.clearTimer });
  const flush2 = el2.log.indexOf('flush');
  assert.ok(el2.log.slice(0, flush2).includes('maxHeight=120px'));
  assert.ok(el2.log.slice(0, flush2).includes('opacity='), '펼칠 땐 흐려짐을 되돌린다');
  assert.ok(el2.log.slice(flush2).includes('maxHeight=510px'));
  assert.equal(el2.style.overflow, 'hidden');
  assert.equal(closed, 0);

  const el3 = fakeDrawer(10);
  el3.style.maxHeight = '0px';
  el3.style.overflow = 'hidden';
  el3.style.opacity = '0';
  settlePartDrawerOpen(el3 as never);
  assert.deepEqual(plainStyle(el3.style), { maxHeight: '', overflow: '', transition: '', opacity: '', transform: '' });
});

test('PartCardRow: 머리줄을 누른 경우에만 서랍을 돌리고, 동작 줄이기·EP 전환은 즉시', () => {
  const row = read('src/views/compositing-dashboard/cards/PartCardRow.tsx');
  assert.doesNotMatch(row, /Math\.max\(320/, '최소 320px 로 붙어 아래 파트가 먼저 툭 내려앉았다');
  assert.doesNotMatch(row, /overflow: expanded \? 'visible'/, '처음부터 넘침 허용이면 펼치는 동안 아래 파트와 겹친다');
  assert.match(row, /const animate = animateNextToggleRef\.current && !reduce;/);
  assert.match(row, /return runPartDrawer\(wrap, expanded, \{\n\s+fromZero,\n\s+onSettled: expanded \? undefined : \(\) => setRendered\(false\),\n\s+\}\);/);
  assert.match(row, /if \(expanded\) settlePartDrawerOpen\(wrap\);\n\s+else setRendered\(false\);/);
  assert.match(row, /animateNextToggleRef\.current = true;\n\s+toggleExpand\(partId\);/);
  assert.match(row, /onToggle=\{handleToggle\}/);
  // 머리줄-카드 간격이 바깥 gap 이면 서랍이 생기고 사라질 때 8px 툭 움직인다 → 서랍 안쪽 여백으로.
  assert.match(row, /<div className="flex flex-col">\n\s+<PartHeader/);
  assert.match(row, /paddingTop: 42,/);
});
