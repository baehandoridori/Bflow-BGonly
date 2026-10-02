import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  activityScale,
  createFrameLoop,
  shouldSkipFrame,
  stepActivityProgress,
  type FrameInfo,
} from '../../src/utils/frameLoop.ts';
import {
  BACKGROUND_FADE_MS,
  BACKGROUND_LOOP_MAX_FPS,
  holdBackgroundLoops,
  isBackgroundLoopHeld,
  readBackgroundActivity,
  resetBackgroundActivityForTest,
  resolveBackgroundActivity,
  subscribeBackgroundActivity,
} from '../../src/utils/backgroundActivity.ts';

/* 움직임 폴리싱 바탕 C — 보이지 않는 무게 덜기(겉모습은 그대로, 방식만 가볍게).
   ① 움직이는 요소의 흐림 제거 ② 무한 paint 장식 → 미리 그린 층의 opacity
   ③ 배경 루프 30장 상한·창을 떠나면 서서히 멈춤·끌기 중 멈춤·입자 빛 스프라이트 ④ 대시보드 hover 재렌더 줄이기 */

const read = (file: string) => readFileSync(file, 'utf-8').replace(/\r\n/g, '\n');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/* ─── ③ 배경 루프 ─── */

function fakeFrames(stepMs = 16) {
  const queue = new Map<number, (now: number) => void>();
  let next = 1;
  let now = 0;
  return {
    requestFrame: (cb: (now: number) => void) => { const id = next++; queue.set(id, cb); return id; },
    cancelFrame: (id: number) => { queue.delete(id); },
    pending: () => queue.size,
    advance(ms: number) { now += ms; },
    tick(ms = stepMs) {
      now += ms;
      const callbacks = [...queue.values()];
      queue.clear();
      for (const cb of callbacks) cb(now);
    },
  };
}

test('초당 장 수 상한: 60Hz 화면에서 30장 상한이면 두 프레임마다 한 장, 첫 장은 늘 그린다', () => {
  assert.equal(shouldSkipFrame(100, null, 30), false, '첫 장');
  assert.equal(shouldSkipFrame(116.7, 100, 30), true);
  assert.equal(shouldSkipFrame(133.3, 100, 30), false);
  assert.equal(shouldSkipFrame(116.7, 100, undefined), false, '상한 없음');

  const frames = fakeFrames(1000 / 60);
  let draws = 0;
  const loop = createFrameLoop(() => { draws += 1; }, { still: false, maxFps: 30, ...frames });
  for (let i = 0; i < 60; i += 1) frames.tick();
  assert.ok(draws >= 29 && draws <= 31, `1초에 약 30장 (그린 장: ${draws})`);
  assert.equal(frames.pending(), 1, '넘긴 프레임에도 다음 프레임은 예약돼 있다');
  loop.dispose();
});

test('배율 진행: 목표 쪽으로 경과/길이만큼, 길이 0 이면 바로. 배율은 부드럽게 출발·도착(smoothstep)', () => {
  assert.equal(stepActivityProgress(1, 0, 150, 1500), 0.9);
  assert.equal(stepActivityProgress(0.05, 0, 150, 1500), 0);
  assert.equal(stepActivityProgress(0.95, 1, 150, 1500), 1);
  assert.equal(stepActivityProgress(0.4, 0, 16, 0), 0);
  assert.equal(activityScale(0), 0);
  assert.equal(activityScale(1), 1);
  assert.equal(activityScale(0.5), 0.5);
  assert.ok(activityScale(0.1) < 0.1, '출발은 느리게');
});

test('서서히 멈춤: 배율이 1→0 으로 줄며 움직임 시간(dtMs)도 줄고, 0 에 닿으면 마지막 장을 그린 뒤 잠든다', () => {
  const frames = fakeFrames();
  const infos: FrameInfo[] = [];
  const loop = createFrameLoop((_now, info) => { infos.push(info); }, { still: false, ...frames });
  frames.tick();
  frames.tick();
  assert.equal(infos.at(-1)!.scale, 1);
  assert.equal(infos.at(-1)!.dtMs, 16);

  loop.setActive(false, 160);
  const before = infos.length;
  for (let i = 0; i < 20; i += 1) frames.tick();
  const fading = infos.slice(before);
  assert.equal(fading.length, 10, '160ms ÷ 16ms = 10장 동안 줄어든다');
  for (let i = 1; i < fading.length; i += 1) {
    assert.ok(fading[i].scale <= fading[i - 1].scale, '배율은 줄기만 한다');
    assert.ok(fading[i].dtMs <= fading[i - 1].dtMs);
    assert.equal(fading[i].realDtMs, 16, '실제 경과는 그대로');
  }
  assert.equal(fading.at(-1)!.scale, 0);
  assert.equal(fading.at(-1)!.dtMs, 0);
  assert.equal(loop.isScheduled(), false, '멈춘 뒤에는 프레임을 예약하지 않는다(CPU 0)');
  assert.equal(loop.getScale(), 0);
  loop.dispose();
});

test('다시 움직임: 잠든 루프를 깨우고, 쉬는 동안 흐른 시간만큼 점이 튀지 않으며(첫 장은 기본 간격) 배율이 0→1', () => {
  const frames = fakeFrames();
  const infos: FrameInfo[] = [];
  const loop = createFrameLoop((_now, info) => { infos.push(info); }, { still: false, active: false, ...frames });
  frames.tick();
  assert.equal(infos.length, 1, '처음부터 비활성이면 첫 장만 그리고 잠든다');
  assert.equal(infos[0].dtMs, 0);
  assert.equal(loop.isScheduled(), false);

  frames.advance(60_000); // 1분 동안 다른 프로그램 사용
  loop.setActive(true, 96);
  assert.equal(loop.isScheduled(), true, '깨어난다');
  for (let i = 0; i < 8; i += 1) frames.tick();
  const resumed = infos.slice(1);
  assert.equal(resumed[0].realDtMs, 1000 / 60, '깨어난 첫 장은 쉬던 시간이 아니라 기본 간격');
  for (let i = 1; i < resumed.length; i += 1) assert.ok(resumed[i].scale >= resumed[i - 1].scale);
  assert.equal(resumed.at(-1)!.scale, 1);
  assert.equal(loop.isScheduled(), true, '움직이는 동안은 계속 이어 간다');
  // 가상 시계는 움직인 만큼만 흐른다(쉬던 1분은 들어가지 않는다)
  const sum = resumed.reduce((acc, info) => acc + info.dtMs, 0);
  assert.ok(Math.abs(resumed.at(-1)!.time - sum) < 1e-6);
  assert.ok(resumed.at(-1)!.time < 200);
  loop.dispose();
});

test('창이 가려지면(길이 0) 바로 멈추고, 잠든 동안 invalidate 는 시간을 흘리지 않고 한 장만 다시 그린다', () => {
  const frames = fakeFrames();
  const infos: FrameInfo[] = [];
  const loop = createFrameLoop((_now, info) => { infos.push(info); }, { still: false, ...frames });
  frames.tick();
  loop.setActive(false, 0);
  assert.equal(loop.getScale(), 0, '길이 0 은 다음 장을 기다리지 않고 바로 0');
  frames.tick();
  assert.equal(infos.at(-1)!.scale, 0);
  assert.equal(loop.isScheduled(), false);
  const time = infos.at(-1)!.time;

  loop.invalidate();
  frames.tick();
  frames.tick();
  assert.equal(infos.length, 3, '한 장만');
  assert.equal(infos.at(-1)!.dtMs, 0);
  assert.equal(infos.at(-1)!.time, time);
  assert.equal(loop.isScheduled(), false);

  // 비활성인 채로 다른 이유(끌기)로 바뀌어도 잠든 루프를 깨우지 않는다
  loop.setActive(false, BACKGROUND_FADE_MS.hold);
  assert.equal(loop.isScheduled(), false);
  loop.dispose();
});

test('멈춤(동작 줄이기·가볍게) 장은 시간이 흐르지 않고, 멈춤과 비활성이 겹쳐도 한 장으로 끝', () => {
  const frames = fakeFrames();
  const infos: FrameInfo[] = [];
  const loop = createFrameLoop((_now, info) => { infos.push(info); }, { still: true, maxFps: 30, ...frames });
  frames.tick();
  loop.invalidate();
  frames.tick();
  assert.equal(infos.length, 2);
  assert.ok(infos.every((info) => info.dtMs === 0 && info.realDtMs === 0 && info.time === 0));
  loop.setActive(false, BACKGROUND_FADE_MS.blur);
  loop.setActive(true, BACKGROUND_FADE_MS.resume);
  frames.tick();
  assert.equal(infos.length, 2, '멈춤 상태에서는 창 상태가 바뀌어도 다시 그리지 않는다');
  loop.dispose();
});

test('배경 상태 판단표: 가려짐=바로, 끌기=0.3초, 다른 프로그램=1.5초에 걸쳐 멈춤, 돌아오면 0.6초에 걸쳐 이어 감', () => {
  assert.equal(BACKGROUND_LOOP_MAX_FPS, 30);
  assert.deepEqual(resolveBackgroundActivity({ visible: false, focused: true, held: false }), { active: false, fadeMs: 0 });
  assert.deepEqual(resolveBackgroundActivity({ visible: true, focused: true, held: true }), { active: false, fadeMs: 300 });
  assert.deepEqual(resolveBackgroundActivity({ visible: true, focused: false, held: false }), { active: false, fadeMs: 1500 });
  assert.deepEqual(resolveBackgroundActivity({ visible: true, focused: true, held: false }), { active: true, fadeMs: 600 });
  assert.ok(BACKGROUND_FADE_MS.blur >= 1000 && BACKGROUND_FADE_MS.blur <= 2000, "사양: '1~2초에 걸쳐 천천히 멈추고'");
});

test('끌기 중 멈춤 요청: 여러 곳이 요청하면 모두 풀릴 때까지, 같은 해제를 두 번 불러도 한 번만, 바뀔 때만 알림', () => {
  resetBackgroundActivityForTest();
  let notified = 0;
  const unsubscribe = subscribeBackgroundActivity(() => { notified += 1; });
  const releaseA = holdBackgroundLoops();
  assert.equal(isBackgroundLoopHeld(), true);
  assert.equal(readBackgroundActivity().active, false, '창이 없는 환경도 끌기 중엔 멈춤');
  const releaseB = holdBackgroundLoops();
  assert.equal(notified, 1, '처음 요청 때만 알린다');
  releaseA();
  releaseA();
  assert.equal(isBackgroundLoopHeld(), true, 'B 가 아직 잡고 있다');
  releaseB();
  assert.equal(isBackgroundLoopHeld(), false);
  assert.equal(notified, 2, '모두 풀렸을 때 한 번 더');
  assert.deepEqual(readBackgroundActivity(), { active: true, fadeMs: 600 }, '창이 없는 환경은 늘 보이고 포커스 있음');
  unsubscribe();
  resetBackgroundActivityForTest();
});

test('창 상태 읽기: 포커스가 없으면 천천히 멈춤, 가려지면 바로 멈춤', () => {
  resetBackgroundActivityForTest();
  const g = globalThis as unknown as { document?: unknown };
  const previous = g.document;
  try {
    g.document = { visibilityState: 'visible', hasFocus: () => false };
    assert.deepEqual(readBackgroundActivity(), { active: false, fadeMs: 1500 });
    g.document = { visibilityState: 'hidden', hasFocus: () => true };
    assert.deepEqual(readBackgroundActivity(), { active: false, fadeMs: 0 });
    g.document = { visibilityState: 'visible', hasFocus: () => { throw new Error('x'); } };
    assert.equal(readBackgroundActivity().active, true, 'hasFocus 를 못 읽으면 움직임 유지');
  } finally {
    if (previous === undefined) delete g.document;
    else g.document = previous;
  }
});

test('배경 다섯 곳: 문지기 옵션으로 루프를 만들고, now 대신 배율이 곱해진 시간으로 움직인다', () => {
  const files = [
    'src/views/Dashboard.tsx',
    'src/components/auth/LoginScreen.tsx',
    'src/components/effects/StarNestBackground.tsx',
    'src/components/effects/BflowStarNestBackground.tsx',
    'src/components/settings/EffectsSection.tsx',
  ];
  for (const file of files) {
    const source = read(file);
    assert.match(source, /createFrameLoop\((animate|render|draw), loopOptions\(\)\)/, `${file}: 문지기 옵션`);
    assert.match(source, /info\.dtMs/, `${file}: 배율이 곱해진 경과`);
    assert.doesNotMatch(source, /lastTime \? timestamp - lastTime|lastNow \? Math\.min/, `${file}: 실제 시각으로 경과를 재지 않는다`);
  }
  assert.match(read('src/components/effects/StarNestBackground.tsx'), /gl\.uniform1f\(locs\.uTime, info\.time \* 0\.001\);/);
  const bflow = read('src/components/effects/BflowStarNestBackground.tsx');
  assert.match(bflow, /const now = info\.time;/);
  assert.match(bflow, /particle\.age \+= realDt;/, '마우스 잔상은 실제 시간으로 사라진다');

  const gate = read('src/hooks/useBackgroundLoopGate.ts');
  assert.match(gate, /subscribeBackgroundActivity\(/);
  assert.match(gate, /loopRef\.current\?\.setActive\(active, fadeMs\);/);
  assert.match(gate, /maxFps: BACKGROUND_LOOP_MAX_FPS/);
});

test('대시보드: 입자 빛은 미리 그린 스프라이트, 위젯을 끄는 동안 배경 멈춤 요청', () => {
  const dash = read('src/views/Dashboard.tsx');
  const plexus = dash.slice(dash.indexOf('function DashboardPlexus'), dash.indexOf('function DashboardBackgroundArt'));
  assert.doesNotMatch(plexus, /createRadialGradient/, '매 프레임 입자마다 그라데이션을 새로 만들지 않는다');
  assert.match(plexus, /ctx\.drawImage\(sprite, p\.x - glR, p\.y - glR, glR \* 2, glR \* 2\);/);
  assert.match(dash, /grad\.addColorStop\(0, `rgba\(\$\{r\},\$\{g\},\$\{b\},1\)`\);\s*grad\.addColorStop\(0\.3, `rgba\(\$\{r\},\$\{g\},\$\{b\},0\.3\)`\);/, '예전 빛 모양(가운데:30% 지점 = 1:0.3)');
  assert.match(dash, /useEffect\(\(\) => \(isActive \? holdBackgroundLoops\(\) : undefined\), \[isActive\]\);/);
});

/* ─── ④ 대시보드 hover 재렌더 ─── */

test('대시보드 hover 존: 위젯 요소를 id 별로 한 번만 만들고, 같은 값이면 상태를 다시 넣지 않는다', () => {
  const dash = read('src/views/Dashboard.tsx');
  assert.match(dash, /const key = `\$\{isEpMode\}:\$\{id\}`;/);
  assert.match(dash, /\{getCachedWidgetComponent\(item\.i, isEpMode\) \?\? \(/);
  assert.doesNotMatch(dash, /\{getWidgetComponent\(item\.i, isEpMode\)/, '렌더마다 새 요소를 만들지 않는다');
  assert.match(dash, /if \(hoveredIdRef\.current !== nextHovered\) \{\s*hoveredIdRef\.current = nextHovered;\s*setHoveredId\(nextHovered\);/);
  assert.match(dash, /if \(\(edgeZonesRef\.current\[item\.i\] \?\? null\) !== zone\) \{/);
  assert.match(dash, /if \(edgeZonesRef\.current\[item\.i\] != null\) \{/);
  assert.doesNotMatch(dash, /setEdgeZones\(\(p\) =>/, '함수형 갱신은 같은 값이어도 렌더를 예약한다');
});

/* ─── ② 무한 paint 장식 → 미리 그린 층의 opacity ─── */

function keyframesBody(css: string, name: string): string {
  const at = css.indexOf(`@keyframes ${name} {`);
  assert.ok(at >= 0, `@keyframes ${name} 없음`);
  let depth = 0;
  for (let i = css.indexOf('{', at); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') { depth -= 1; if (depth === 0) return css.slice(at, i + 1); }
  }
  throw new Error('닫는 괄호 없음');
}

function animatedProps(body: string): string[] {
  return [...body.matchAll(/([a-z-]+)\s*:/g)].map(([, prop]) => prop);
}

test('숨쉬는 장식 키프레임은 opacity·transform 만 움직인다(box-shadow·filter 키프레임 금지)', () => {
  const css = stripComments(read('src/index.css'));
  for (const name of ['comment-unread-badge-pulse', 'bflow-peak-bar-pulse', 'bflow-badge-pulse', 'bflow-badge-ring', 'bflow-bulk-bar-pulse']) {
    const props = animatedProps(keyframesBody(css, name));
    assert.ok(props.length > 0, name);
    for (const prop of props) assert.ok(prop === 'opacity' || prop === 'transform', `${name}: ${prop}`);
  }
  // 움직이는 층은 가상 요소다
  for (const selector of ['.comment-unread-badge::after', '.bflow-peak-pulse::after', '.bflow-badge-pulse::before', '.bflow-badge-pulse::after', '.bflow-bulk-bar-pulse::after']) {
    const at = css.indexOf(`${selector} {`);
    assert.ok(at >= 0, `${selector} 규칙 없음`);
  }
  assert.match(css, /\.comment-unread-badge::after \{[^}]*animation: comment-unread-badge-pulse 2\.6s ease-in-out infinite;/);
  assert.match(css, /\.bflow-peak-pulse::after \{[^}]*animation: bflow-peak-bar-pulse 1\.6s ease-in-out infinite;/);
  assert.match(css, /\.bflow-badge-pulse::after \{[^}]*animation: bflow-badge-pulse 2s ease-in-out infinite;/);
  // 일괄 작업 바: 나타날 때 두 번만
  assert.match(css, /\.bflow-bulk-bar-pulse::after \{[^}]*animation: bflow-bulk-bar-pulse 2\.4s ease-in-out 2;/);
  // 장식 클래스 자체에는 animation 이 없다(배지·막대 본체를 다시 칠하지 않는다)
  for (const cls of ['.comment-unread-badge', '.bflow-peak-pulse', '.bflow-badge-pulse', '.bflow-bulk-bar-pulse']) {
    const rules = [...css.matchAll(new RegExp(`(^|\\n)${cls.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`, 'g'))];
    assert.ok(rules.length > 0, cls);
    for (const [, , body] of rules) assert.doesNotMatch(body, /animation/, `${cls} 본체에 animation`);
  }
});

test('동작 줄이기에서는 빛 층이 멈춘다', () => {
  const css = stripComments(read('src/index.css'));
  for (const selector of ['.comment-unread-badge::after', '.bflow-bulk-bar-pulse::after']) {
    assert.ok(css.includes(`@media (prefers-reduced-motion: reduce) {\n  ${selector} {\n    animation: none !important;`), selector);
  }
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce) {\n  .bflow-badge-pulse::before,\n  .bflow-badge-pulse::after {\n    animation: none !important;'));
});

test('일괄 작업 바: 빛 층이 잘리지 않게 바 본체에는 overflow 가 없고, 가로 스크롤은 안쪽 줄이 맡는다. 흐림 없음', () => {
  const view = read('src/views/ScenesView.tsx');
  const at = view.indexOf('className="bflow-bulk-bar-pulse');
  const tag = view.slice(at, view.indexOf('>', view.indexOf('}}', at)));
  assert.doesNotMatch(tag, /overflow/);
  assert.doesNotMatch(tag, /backdropFilter/);
  assert.match(view, /<div className="flex flex-wrap items-center justify-center gap-3 overflow-x-auto px-5 py-2\.5">/);
});

/* ─── ① 움직이는 요소의 흐림 제거 ─── */

test('흐림 없는 유리 스타일: 흐림을 빼고 바탕 97%, 테두리·그림자는 원본과 같다', async () => {
  const glass = read('src/utils/glassStyles.ts');
  const solid = glass.slice(glass.indexOf('export const floatingSolidStyle'), glass.indexOf('};', glass.indexOf('export const floatingSolidStyle')));
  assert.doesNotMatch(solid, /backdropFilter|WebkitBackdropFilter/);
  assert.match(solid, /background: 'rgb\(var\(--color-bg-card\) \/ 0\.97\)'/);
  assert.match(solid, /border: floatingGlassStyle\.border,\s*boxShadow: floatingGlassStyle\.boxShadow,/);
  const elevated = glass.slice(glass.indexOf('export const elevatedSolidStyle'), glass.indexOf('};', glass.indexOf('export const elevatedSolidStyle')));
  assert.doesNotMatch(elevated, /backdropFilter/);
  assert.match(elevated, /0\.97/);
});

test('열리며 움직이는 펼침 메뉴·팝오버는 흐림 없는 짝을 쓴다', () => {
  for (const file of [
    'src/components/common/GlassDropdown.tsx',
    'src/views/compositing/sharedComponents.tsx',
    'src/components/calendar/CalendarGrid.tsx',
    'src/components/calendar/EventQuickEdit.tsx',
    'src/components/calendar/EventSidePanel.tsx',
  ]) {
    const source = read(file);
    assert.match(source, /floatingSolidStyle/, file);
    assert.doesNotMatch(source, /floatingGlassStyle/, file);
  }
});

test('알림 카드(토스트)는 뒤 흐림 없이 바탕 97%', () => {
  const css = stripComments(read('src/index.css'));
  const at = css.indexOf('[data-sonner-toaster] [data-sonner-toast].bflow-toast {');
  const body = css.slice(at, css.indexOf('}', at));
  assert.doesNotMatch(body, /backdrop-filter/);
  assert.match(body, /--normal-bg: rgb\(var\(--color-bg-card\) \/ 0\.97\);/);
  assert.match(body, /background: rgb\(var\(--color-bg-card\) \/ 0\.97\) !important;/);
});

test('인사 말풍선: transform 문자열로 떠오르고(가운데 정렬은 바깥 틀), 사라질 때 흐려지지 않는다', () => {
  const toast = read('src/components/WelcomeToast.tsx');
  assert.doesNotMatch(toast, /filter: 'blur/);
  assert.doesNotMatch(toast, /\b(x|y|scale): /, 'framer 개별 x·y·scale 값 금지');
  assert.match(toast, /transform: 'translateY\(60px\) scale\(0\.92\)'/);
  assert.match(toast, /transitionEnd: \{ transform: 'none' \}/);
  assert.match(toast, /transform: \['translateY\(0px\) scale\(1\)', 'translateY\(20px\) scale\(0\.95\)'\]/);
  assert.match(toast, /className="fixed inset-x-0 bottom-8 z-\[10001\] flex justify-center pointer-events-none"/);
  assert.match(toast, /style=\{elevatedSolidStyle\}/);
  assert.match(toast, /const \{ reduce \} = useMotionPref\(\);/);
});

test('타임라인 미리보기 카드: 흐림 없음, 움직이는 값은 transform·opacity 뿐(폭·높이·filter·배경 전환 없음)', () => {
  const timeline = read('src/views/compositing-dashboard/timeline/TimelinePanel.tsx');
  // 위쪽의 querySelector 문자열이 아니라 카드 버튼의 속성 줄
  const at = timeline.indexOf('data-compositing-carousel-card="true"\n');
  const card = timeline.slice(at, timeline.indexOf('</button>', at));
  assert.doesNotMatch(card, /backdrop-blur/);
  assert.match(card, /'transition-\[transform,opacity\] duration-150 ease-out cursor-pointer'/);
  assert.doesNotMatch(card, /filter:/);
  assert.doesNotMatch(card, /\n\s+width,\n|\n\s+height,\n/);
  assert.match(card, /width: CAROUSEL_CARD_WIDTH,\s*height: CAROUSEL_CARD_HEIGHT,/);
  assert.match(card, /background: 'rgb\(var\(--color-bg-card\) \/ 0\.92\)'/, '옆 카드 바탕 .74 → .92');
  assert.match(card, /opacity: isCenter \? 1 : 0,/);
  assert.match(card, /style=\{\{ opacity: dimOpacity \}\}/);
});

test('스크롤 따라오는 띠 3곳과 전체 화면 막 2곳에 흐림이 없다', () => {
  const sticky: Array<[string, RegExp]> = [
    ['src/views/CharacterBoardView.tsx', /sticky top-0 z-20 -mx-6 bg-bg-primary\/\[0\.97\] px-6 pt-4 pb-3 flex flex-col gap-2\.5/],
    ['src/views/ScenesView.tsx', /sticky top-0 z-30 flex flex-col gap-2 bg-bg-card\/\[0\.97\] border border-bg-border rounded-xl p-3 shadow-\[0_14px_32px_rgba\(0,0,0,0\.24\)\]"/],
    ['src/components/calendar/WeekTimeGridView.tsx', /sticky top-0 z-30 border-b border-bg-border\/40 bg-bg-primary\/\[0\.97\]"/],
  ];
  for (const [file, pattern] of sticky) assert.match(read(file), pattern, file);
  assert.match(read('src/components/update/UpdateCenterModal.tsx'), /fixed inset-0 z-\[10020\] flex items-center justify-center bg-black\/60 px-4"/);
  const spotlight = read('src/components/spotlight/SpotlightSearch.tsx');
  assert.doesNotMatch(spotlight, /backdropFilter|WebkitBackdropFilter/);
  assert.match(spotlight, /backgroundColor: 'rgb\(var\(--color-overlay\) \/ calc\(var\(--overlay-alpha\) \+ 0\.08\)\)'/);
});
