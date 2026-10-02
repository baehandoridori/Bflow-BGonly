import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  CARD_CASCADE_DURATION_MS,
  COMPOSITING_EP_SWAP,
  DASHBOARD_CONTENT_KEYFRAMES,
  DASHBOARD_CONTENT_SWAP_MS,
  RAPID_SWAP_MS,
  SCENE_GROUP_SWAP,
  VIEW_REVEAL_KEYFRAMES,
  VIEW_REVEAL_MS,
  VIEW_REVEAL_REDUCED_MS,
  VIEW_SPINNER_DELAY_MS,
  cardCascadeDelayMs,
  cardCascadeStyle,
  compareSceneLocation,
  createRapidGate,
  dashboardBoardIdentity,
  episodeDirection,
  groupSwapKeyframes,
  parseSceneGroupKey,
  sceneGroupKey,
  shouldSkipViewReveal,
  viewRevealTiming,
} from '../../src/utils/viewTransitionMotion.ts';
import { EASE_CSS } from '../../src/utils/motion.ts';

/* 움직임 폴리싱 12번 — 화면·파트·에피소드를 바꿀 때 한 덩어리로 스르륵(+대시보드 탭은 판 그대로 내용만). */

const read = (path: string) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
const stripCssComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/* ─── 순수 규칙 ─────────────────────────────────────────────── */

test('화면 덮개: 0.18초 out 곡선으로 opacity 1→0 만, 동작 줄이기는 0.12초', () => {
  assert.equal(VIEW_REVEAL_MS, 180);
  assert.equal(VIEW_REVEAL_REDUCED_MS, 120);
  assert.deepEqual(VIEW_REVEAL_KEYFRAMES, [{ opacity: 1 }, { opacity: 0 }]);
  // 덮개는 opacity 만 움직인다(위치·크기 없음).
  for (const frame of VIEW_REVEAL_KEYFRAMES) assert.deepEqual(Object.keys(frame), ['opacity']);
  assert.deepEqual(viewRevealTiming(false), { duration: 180, easing: EASE_CSS.out });
  assert.deepEqual(viewRevealTiming(true), { duration: 120, easing: EASE_CSS.out });
});

test('로딩 동그라미는 0.25초를 넘길 때만', () => {
  assert.equal(VIEW_SPINNER_DELAY_MS, 250);
});

test('덮개 생략: 첫 화면·배플레이그라운드·알림 링크로 씬 창을 바로 여는 경우', () => {
  const base = { view: 'assignee', isFirstView: false, pendingDeepLink: null, pendingSceneModalRequest: null };
  assert.equal(shouldSkipViewReveal(base), false);
  assert.equal(shouldSkipViewReveal({ ...base, isFirstView: true }), true, '앱 첫 진입은 첫 진입 연출 몫');
  assert.equal(shouldSkipViewReveal({ ...base, view: 'playground' }), true);
  assert.equal(shouldSkipViewReveal({ ...base, view: 'scenes' }), false, '그냥 씬 목록으로 가면 덮개');
  assert.equal(shouldSkipViewReveal({ ...base, view: 'scenes', pendingSceneModalRequest: { sceneUuid: 'x' } }), true);
  assert.equal(shouldSkipViewReveal({ ...base, view: 'scenes', pendingDeepLink: { sheetName: 's', sceneId: 'a001' } }), true);
  // 씬 창 요청은 씬 목록으로 갈 때만 의미가 있다.
  assert.equal(shouldSkipViewReveal({ ...base, view: 'dashboard', pendingSceneModalRequest: { sceneUuid: 'x' } }), false);
});

test('카드 차례 등장: 20ms 간격, 마지막 카드도 0.2초 안에 출발 → 0.4초면 모두 도착', () => {
  assert.equal(cardCascadeDelayMs(0), 0);
  assert.equal(cardCascadeDelayMs(1), 20);
  assert.equal(cardCascadeDelayMs(5), 100);
  assert.equal(cardCascadeDelayMs(10), 200);
  assert.equal(cardCascadeDelayMs(19), 200, '20명이어도 마지막 지연은 0.2초');
  assert.equal(cardCascadeDelayMs(-3), 0);
  assert.equal(cardCascadeDelayMs(Number.NaN), 0);
  assert.equal(cardCascadeDelayMs(19) + CARD_CASCADE_DURATION_MS, 400);
  assert.deepEqual(cardCascadeStyle(3), { animationDelay: '60ms' });
});

test('연타 판정: 300ms 안에 다시 바꾸면 연출 생략, 첫 전환과 뜸한 전환은 연출', () => {
  assert.equal(RAPID_SWAP_MS, 300);
  const gate = createRapidGate();
  assert.equal(gate.hit(1000), false, '첫 전환');
  assert.equal(gate.hit(1100), true);
  assert.equal(gate.hit(1350), true, '연타 중에는 마지막 전환 기준');
  assert.equal(gate.hit(1700), false, '잠시 쉬면 다시 연출');
});

test('방향: 다음 에피소드·뒤 파트는 오른쪽(1), 이전은 왼쪽(-1), 같으면 0', () => {
  assert.equal(compareSceneLocation({ episode: 5, part: 'C' }, { episode: 6, part: 'A' }), 1);
  assert.equal(compareSceneLocation({ episode: 6, part: 'A' }, { episode: 5, part: 'D' }), -1);
  assert.equal(compareSceneLocation({ episode: 5, part: 'A' }, { episode: 5, part: 'B' }), 1);
  assert.equal(compareSceneLocation({ episode: 5, part: 'C' }, { episode: 5, part: 'B' }), -1);
  assert.equal(compareSceneLocation({ episode: 5, part: 'a' }, { episode: 5, part: 'A' }), 0, '대소문자만 다른 같은 파트');
  assert.equal(compareSceneLocation({ episode: 5, part: null }, { episode: 5, part: 'A' }), 0, '모르면 방향 없음');
  assert.equal(episodeDirection(5, 6), 1);
  assert.equal(episodeDirection(6, 5), -1);
  assert.equal(episodeDirection(5, 5), 0);
  assert.equal(episodeDirection(null, 5), 0);
});

test('씬 목록 묶음 키: 에피소드가 없으면 null(움직이지 않음), 파트 이름에 | 가 있어도 되돌린다', () => {
  assert.equal(sceneGroupKey(null, 'A'), null);
  assert.equal(sceneGroupKey(undefined, 'A'), null);
  assert.equal(sceneGroupKey(5, 'A'), '5|A');
  assert.equal(sceneGroupKey(5, null), '5|');
  assert.deepEqual(parseSceneGroupKey('5|A'), { episode: 5, part: 'A' });
  assert.deepEqual(parseSceneGroupKey('5|'), { episode: 5, part: null });
  assert.deepEqual(parseSceneGroupKey('12|A|B'), { episode: 12, part: 'A|B' });
});

test('묶음 미끄러짐 키프레임: 다음은 오른쪽에서, 이전은 왼쪽에서, 끝은 제자리(translate 0) · opacity 0→1', () => {
  assert.deepEqual(groupSwapKeyframes(1, 16), [
    { opacity: 0, transform: 'translateX(16px)' },
    { opacity: 1, transform: 'translateX(0px)' },
  ]);
  assert.deepEqual(groupSwapKeyframes(-1, 10), [
    { opacity: 0, transform: 'translateX(-10px)' },
    { opacity: 1, transform: 'translateX(0px)' },
  ]);
  assert.deepEqual(groupSwapKeyframes(0, 16)[0], { opacity: 0, transform: 'translateY(6px)' });
  // 사양: 컴포지팅 EP ±16px 240ms, 씬 목록은 6~16px 안에서 보통 박자.
  assert.deepEqual(COMPOSITING_EP_SWAP, { distancePx: 16, durationMs: 240 });
  assert.ok(SCENE_GROUP_SWAP.distancePx >= 6 && SCENE_GROUP_SWAP.distancePx <= 16);
  assert.equal(SCENE_GROUP_SWAP.durationMs, 180);
});

test('대시보드: 같은 레이아웃끼리는 같은 판(배경↔액팅, 에피소드↔에피소드), 내용만 0.18초 opacity', () => {
  assert.equal(dashboardBoardIdentity(false, 'all'), 'all');
  assert.equal(dashboardBoardIdentity(false, 'bg'), 'dept');
  assert.equal(dashboardBoardIdentity(false, 'acting'), 'dept');
  assert.equal(dashboardBoardIdentity(true, 'all'), 'ep');
  assert.equal(dashboardBoardIdentity(true, 'bg'), 'ep');
  assert.equal(DASHBOARD_CONTENT_SWAP_MS, 180);
  assert.deepEqual(DASHBOARD_CONTENT_KEYFRAMES, [{ opacity: 0 }, { opacity: 1 }]);
});

/* ─── 배선 가드 ─────────────────────────────────────────────── */

test('사이드바 화면 이동: 본문 위 덮개 한 장만 걷고, 본문(main)에는 opacity·transform 을 걸지 않는다', () => {
  const layout = read('src/components/layout/MainLayout.tsx');
  assert.match(layout, /<main ref=\{mainRef\} className=\{immersive \? 'flex-1 overflow-hidden' : 'flex-1 overflow-auto p-4'\}>/);
  assert.match(layout, /<div ref=\{coverRef\} aria-hidden="true" className="bf-view-cover" \/>/);
  assert.match(layout, /cover\.animate\(VIEW_REVEAL_KEYFRAMES, viewRevealTiming\(prefersReducedMotion\(\)\)\)/);
  assert.match(layout, /shouldSkipViewReveal\(\{ view, isFirstView, \.\.\.readPendingSceneOpen\(\) \}\)/);
  assert.match(layout, /if \(state\.lastView === view\) return;/, 'StrictMode 이중 실행에도 한 번만');
  assert.doesNotMatch(layout, /mainRef\.current\.animate|main[^\n]*style=\{\{[^}]*(opacity|transform)/);

  const css = stripCssComments(read('src/styles/motion-view-transition.css'));
  const cover = css.match(/\.bf-view-cover \{([^}]*)\}/);
  assert.ok(cover, '.bf-view-cover 규칙');
  assert.match(cover[1], /position: absolute;/);
  assert.match(cover[1], /pointer-events: none;/);
  assert.match(cover[1], /opacity: 0;/);
  assert.match(cover[1], /background: rgb\(var\(--color-bg-primary\)\);/);
});

test('화면 코드: 250ms 지연 동그라미 + 그려지는 순간 신호, hover 때 그 화면만 미리 받기', () => {
  const app = read('src/App.tsx');
  assert.match(app, /<Suspense fallback=\{<DelayedViewSpinner \/>\}>\n\s*<ViewReady view=\{safeCurrentView\} \/>\n\s*\{view\}/);
  for (const name of ['Dashboard', 'ScenesView', 'AssigneeView', 'VacationView', 'SettingsView']) {
    assert.match(app, new RegExp(`const ${name} = lazy\\(\\(\\) => load${name === 'Dashboard' ? 'Dashboard' : name.replace(/View$/, '')}View\\(\\)`), name);
  }
  // 배플레이그라운드는 자체 진입 연출 — 직접 lazy 유지(다른 테스트가 고정).
  assert.match(app, /lazy\(\(\) => import\('@\/views\/PlaygroundView'\)\)/);

  const sidebar = read('src/components/layout/Sidebar.tsx');
  assert.match(sidebar, /onMouseEnter=\{\(\) => prefetchView\(item\.id\)\}/);
  assert.match(sidebar, /onFocus=\{\(\) => prefetchView\(item\.id\)\}/);
  const loaders = read('src/views/viewLoaders.ts');
  assert.doesNotMatch(loaders, /requestIdleCallback/, '전부 미리 받지 않는다');
  assert.match(loaders, /export function prefetchView\(view: ViewMode\): void/);

  const reveal = read('src/components/layout/ViewReveal.tsx');
  assert.match(reveal, /window\.setTimeout\(\(\) => setVisible\(true\), VIEW_SPINNER_DELAY_MS\)/);

  const header = read('src/components/layout/Header.tsx');
  assert.match(header, /<span key=\{headerTitle\} className="bf-view-title">\{headerTitle\}<\/span>/);
});

test('카드 차례 등장(인원별·팀원·에피소드)은 CSS 한 번 — 메인 스레드 y·30ms 간격 지연이 남지 않는다', () => {
  for (const path of ['src/views/AssigneeView.tsx', 'src/views/TeamView.tsx', 'src/views/EpisodeView.tsx']) {
    const src = read(path);
    assert.match(src, /className="bf-card-cascade" style=\{cardCascadeStyle\(i\)\}/, path);
    assert.doesNotMatch(src, /delay: i \* 0\.0[34]/, path);
  }
  const css = stripCssComments(read('src/styles/motion-view-transition.css'));
  assert.match(css, /\.bf-card-cascade \{\s*animation: bf-card-cascade-in 200ms var\(--ease-out\) backwards;\s*\}/);
  assert.match(css, /from \{ opacity: 0; transform: translateY\(8px\); \}/);
});

test('씬 목록 파트·에피소드: 묶음 하나만 미끄러지고, 시트 줄마다 따로 떠오르지 않는다', () => {
  const scenes = read('src/views/ScenesView.tsx');
  assert.equal((scenes.match(/<div ref=\{sceneGroupSwapRef\} className="relative z-10 flex h-full min-h-0 flex-col">/g) ?? []).length, 2, '통합·부서 두 갈래');
  assert.match(scenes, /useGroupSwapMotion\(\n\s*sceneGroupSwapRef,/);
  assert.match(scenes, /sceneDetailOpenRef\.current \|\| Boolean\(app\.pendingDeepLink \|\| app\.pendingSceneModalRequest\)/, '씬 창이 열리는 중엔 생략');
  const sheet = read('src/components/scenes/SceneSheetView.tsx');
  assert.doesNotMatch(sheet, /motion\.tr/);

  const hook = read('src/hooks/useGroupSwapMotion.ts');
  assert.match(hook, /useLayoutEffect\(/);
  assert.match(hook, /const rapid = now - state\.at < RAPID_SWAP_MS;/);
  assert.match(hook, /state\.animation\?\.cancel\(\);/);
  assert.match(hook, /animateEl\(ref\.current, groupSwapKeyframes\(/, '동작 줄이기는 animateEl 이 opacity 만 남긴다');
  assert.doesNotMatch(hook, /fill:/, '끝값(transform)을 남기지 않는다');
});

test('컴포지팅 EP 전환: 카드 영역 한 덩어리 ±16px, cascade 는 처음·↻ 에만', () => {
  const src = read('src/views/CompositingDashboardView.tsx');
  assert.match(src, /useGroupSwapMotion\(epSwapRef, episodeNumber === null \? null : String\(episodeNumber\),/);
  assert.match(src, /direction: \(prev, next\) => episodeDirection\(Number\(prev\), Number\(next\)\)/);
  assert.match(src, /ref=\{epSwapRef\}\n\s*className=\{cascadeArmed \? undefined : 'bf-cascade-quiet'\}/);
  const css = stripCssComments(read('src/styles/motion-view-transition.css'));
  assert.match(css, /\.bf-cascade-quiet \.bf-cascade-item \{\s*animation: none;\s*\}/);
});

test('대시보드 탭: 판 제자리 — 탭마다 다시 만들지 않고, 판(유리)에는 opacity 를 걸지 않는다', () => {
  const dash = read('src/views/Dashboard.tsx');
  assert.doesNotMatch(dash, /WidthProvider\(|import \{[^}]*WidthProvider/, '1280px 로 먼저 그렸다 옆으로 쓸리는 원인');
  assert.match(dash, /const boardWidth = useMeasuredWidth\(boardRef\);/);
  assert.match(dash, /<ResponsiveGridLayout\n\s*key=\{boardIdentity\}\n\s*width=\{boardWidth\}/);
  assert.doesNotMatch(dash, /<AnimatePresence mode="wait">\n\s*<motion\.div\n\s*key=\{`\$\{isEpMode/, '탭마다 판을 사라지게 했다 다시 그리지 않는다');
  assert.match(dash, /querySelectorAll\('\[data-widget-body\]'\)/);
  assert.match(dash, /\[scrollbar-gutter:stable\]/, '스크롤바가 생겨도 판 폭이 그대로');
  const widget = read('src/components/widgets/Widget.tsx');
  assert.match(widget, /<div data-widget-body className="flex-1 overflow-auto p-4">\{children\}<\/div>/);
});

test('동작 줄이기: 위젯 자리 전환·카드 등장·제목 페이드를 끈다', () => {
  const css = stripCssComments(read('src/styles/motion-view-transition.css'));
  const reduceBlocks = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
  assert.match(reduceBlocks, /\.react-grid-layout \.react-grid-item,[\s\S]*?transition: none !important;/, 'widget-animations.css 의 !important 보다 특이도 높게');
  assert.match(reduceBlocks, /\.bf-view-title,\s*\.bf-card-cascade \{\s*animation: none;/);
  assert.match(reduceBlocks, /\.bf-vac-sync-bar \{\s*animation: none;/);
});

test('휴가 달 넘김: 캘린더처럼 두 달이 겹쳐 넘어가고, 연타·동작 줄이기는 바로', () => {
  const src = read('src/views/VacationView.tsx');
  assert.match(src, /const VACATION_MONTH_SLIDE_VARIANTS = createMonthSlideVariants\(\n\s*24,/);
  assert.match(src, /<div className="grid flex-1 min-h-0" style=\{MONTH_STACK_STYLE\}>\n\s*<AnimatePresence initial=\{false\} custom=\{monthSlide\}>/);
  assert.match(src, /initial=\{monthSlide\.instant \? false : 'enter'\}/);
  assert.match(src, /const monthSlide: MonthSlide = \{ direction, instant: rapidMonthNav \|\| reduceMotion \};/);
  // 층 키 ref 는 훅이라 '휴가 미연동' 조기 반환보다 앞에 있어야 한다(연동 상태가 바뀌면 훅 개수가 달라진다).
  const refAt = src.indexOf('const monthLayerKeyRef = useRef(');
  const earlyReturnAt = src.indexOf('if (!vacationConnected) {');
  assert.ok(refAt > 0 && earlyReturnAt > 0 && refAt < earlyReturnAt, '훅 순서');
  assert.doesNotMatch(src, /<AnimatePresence mode="wait" initial=\{false\}>\n\s*<motion\.div\n\s*key=\{monthKey\}/, '나간 뒤에야 들어오는 빈 화면 제거');
  assert.doesNotMatch(src, /x: direction \* 40/);
  // 나가는 달이 나중에 떨어질 때 들어온 달의 행 높이 관찰을 끊지 않는다.
  assert.match(src, /const measureWeekRow = useCallback\(\(el: HTMLDivElement \| null\) => \{[\s\S]*?if \(!el\) return;\n\s*weekRowObserverRef\.current\?\.disconnect\(\);/);
  // 동기화 막대: 메인 스레드 framer 무한 반복 대신 CSS.
  assert.doesNotMatch(src, /repeat: Infinity/);
  assert.match(src, /className="bf-vac-sync-bar h-full rounded-full"/);
  // 화면 들어올 때 따로 미끄러지지 않는다(덮개가 맡음).
  assert.doesNotMatch(src, /initial=\{\{ opacity: 0, y: 12 \}\}/);
});
