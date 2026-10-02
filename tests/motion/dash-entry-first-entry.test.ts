import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { EASE_CSS } from '../../src/utils/motion.ts';
import {
  ENTRY_CONTENT_RISE_PX,
  ENTRY_CURTAIN_DELAY_MS,
  ENTRY_CURTAIN_MS,
  ENTRY_FILL_MS,
  ENTRY_TEXT_EXIT_EASE,
  ENTRY_TEXT_EXIT_MS,
  ENTRY_TEXT_RISE_PX,
  ENTRY_VIEW_WAIT_MAX_MS,
  ENTRY_WIDGET_MAX_RANK,
  ENTRY_WIDGET_MS,
  ENTRY_WIDGET_STEP_MS,
  ENTRY_WINDOW_MS,
  LOADING_SPLASH_FADE_MS,
  canLiftEntryCurtain,
  createEntryCurtainStore,
  createEntryGate,
  entryDelayMs,
  entryRanks,
  type EntryCurtainState,
} from '../../src/utils/firstEntryMotion.ts';

/* 움직임 폴리싱 13번 — 아침 첫 진입 (갈래 dash-entry) */

const read = (path: string) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
const entryCss = () => {
  const css = read('src/styles/motion-view-entry.css');
  const at = css.indexOf('/* ─── 13. 아침 첫 진입');
  assert.ok(at > 0, '13번 절');
  return css.slice(at);
};
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

test('사양 수치: 글자 300ms(in 곡선, 30px) · 150ms 뒤 덮개 350ms · 위젯 320ms 28ms 간격 최대 8단계 · 차오름 700ms · 영상 교차 200ms', () => {
  assert.equal(ENTRY_TEXT_EXIT_MS, 300);
  assert.equal(ENTRY_TEXT_EXIT_EASE, EASE_CSS.in);
  assert.equal(ENTRY_TEXT_RISE_PX, 30);
  assert.equal(ENTRY_CURTAIN_DELAY_MS, 150);
  assert.equal(ENTRY_CURTAIN_MS, 350);
  assert.equal(ENTRY_WIDGET_MS, 320);
  assert.equal(ENTRY_WIDGET_STEP_MS, 28);
  assert.equal(ENTRY_WIDGET_MAX_RANK, 8);
  assert.equal(ENTRY_CONTENT_RISE_PX, 6);
  assert.equal(ENTRY_FILL_MS, 700);
  assert.equal(LOADING_SPLASH_FADE_MS, 200);
  // 첫 진입 표시는 마지막 위젯의 차오름이 끝난 뒤에 지운다
  assert.ok(ENTRY_WINDOW_MS >= entryDelayMs(ENTRY_WIDGET_MAX_RANK) + Math.max(ENTRY_WIDGET_MS, ENTRY_FILL_MS));
  assert.ok(ENTRY_WINDOW_MS < 1500, '너무 오래 남지 않게');
});

test('위젯 순서: 위쪽 줄부터, 같은 줄은 왼쪽부터 — 8단계에서 멈춘다', () => {
  const layout = [
    { i: 'memo', x: 0, y: 14 },
    { i: 'calendar', x: 10, y: 0 },
    { i: 'overall', x: 0, y: 0 },
    { i: 'episodes', x: 5, y: 0 },
    { i: 'dept', x: 15, y: 0 },
    { i: 'assignee', x: 19, y: 0 },
    { i: 'whiteboard', x: 5, y: 14 },
    { i: 'retakes', x: 15, y: 16 },
    { i: 'tasks', x: 10, y: 18 },
    { i: 'vacation', x: 5, y: 31 },
    { i: 'activity', x: 15, y: 35 },
  ];
  const ranks = entryRanks(layout);
  assert.deepEqual(
    ['overall', 'episodes', 'calendar', 'dept', 'assignee', 'memo', 'whiteboard', 'retakes', 'tasks', 'vacation', 'activity'].map((id) => ranks.get(id)),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 8],
  );
  // 같은 자리면 id 순으로 고정(렌더마다 바뀌지 않게), 입력 배열은 건드리지 않는다
  const tie = [{ i: 'b', x: 0, y: 0 }, { i: 'a', x: 0, y: 0 }];
  assert.deepEqual([...entryRanks(tie)], [['a', 0], ['b', 1]]);
  assert.deepEqual(tie.map((t) => t.i), ['b', 'a']);
  assert.equal(entryRanks([]).size, 0);
});

test('출발 지연: 28ms 간격, 최대 224ms, 이상한 값은 0', () => {
  assert.equal(entryDelayMs(0), 0);
  assert.equal(entryDelayMs(1), 28);
  assert.equal(entryDelayMs(8), 224);
  assert.equal(entryDelayMs(12), 224);
  assert.equal(entryDelayMs(-3), 0);
  assert.equal(entryDelayMs(Number.NaN), 0);
  assert.equal(entryDelayMs(2.7), 56);
});

test('덮개 걷기 시점: 클릭 뒤 최소 150ms, 첫 화면이 대시보드면 그려진 뒤(늦으면 최대 대기 후)', () => {
  const base = { minDelayMs: ENTRY_CURTAIN_DELAY_MS, viewReady: true, waitForView: true };
  assert.equal(canLiftEntryCurtain({ ...base, elapsedMs: 100 }), false, '글자가 먼저 떠오르기 시작하게');
  assert.equal(canLiftEntryCurtain({ ...base, elapsedMs: 150 }), true);
  assert.equal(canLiftEntryCurtain({ ...base, elapsedMs: 400, viewReady: false }), false, '빈 화면이 비치지 않게');
  assert.equal(canLiftEntryCurtain({ ...base, elapsedMs: ENTRY_VIEW_WAIT_MAX_MS, viewReady: false }), true, '너무 늦으면 그냥 걷는다');
  assert.equal(canLiftEntryCurtain({ ...base, elapsedMs: 160, viewReady: false, waitForView: false }), true, '대시보드가 아닌 첫 화면');
  assert.equal(canLiftEntryCurtain({ ...base, minDelayMs: 0, elapsedMs: 0 }), true, '동작 줄이기면 바로');
});

test("'앱 켠 뒤 첫 1회' 문: 한 번만 맡고, StrictMode 의 두 번 실행은 다시 맡고, 진짜로 떠나면 끝", () => {
  const gate = createEntryGate();
  assert.equal(gate.claim(), true);
  assert.equal(gate.claim(), false, '이미 맡은 동안 다른 대시보드는 못 맡는다');
  // StrictMode: 정리 → 같은 틱에 다시 실행
  gate.release();
  assert.equal(gate.claim(), true);
  gate.settle(); // 다음 틱 — 이미 다시 맡았으니 그대로
  assert.equal(gate.phase, 'active');
  gate.finish();
  assert.equal(gate.phase, 'done');
  assert.equal(gate.claim(), false, '다른 화면 갔다 와도 반복하지 않는다');

  const left = createEntryGate();
  left.claim();
  left.release();
  left.settle(); // 연출 도중 다른 화면으로 떠남
  assert.equal(left.phase, 'done');
  assert.equal(left.claim(), false);
});

test('덮개 상태: 바뀔 때만 html 속성에 적고 알린다, viewReady 도 알린다', () => {
  const applied: EntryCurtainState[] = [];
  const store = createEntryCurtainStore((state) => applied.push(state));
  let calls = 0;
  const off = store.subscribe(() => { calls += 1; });
  store.set('down');
  store.set('down');
  store.setViewReady(true);
  store.setViewReady(true);
  store.set('lifting');
  store.set(null);
  assert.deepEqual(applied, ['down', 'lifting', null]);
  assert.equal(calls, 4);
  assert.equal(store.viewReady, true);
  off();
  store.set('down');
  assert.equal(calls, 4, '해제 뒤에는 부르지 않는다');
});

test('CSS: 위젯 지연 칸이 entryDelayMs 와 같고, 박자는 사양대로', () => {
  const section = entryCss();
  for (let rank = 1; rank <= ENTRY_WIDGET_MAX_RANK; rank += 1) {
    assert.match(section, new RegExp(`\\[data-entry-rank='${rank}'\\] \\{ --bf-entry-delay: ${entryDelayMs(rank)}ms; \\}`));
  }
  assert.doesNotMatch(section, /\[data-entry-rank='9'\]/, '순위는 8에서 멈춘다');
  assert.match(section, /\.bf-entry-curtain-lift \{\s*animation: bf-entry-curtain-out 350ms ease forwards;\s*pointer-events: none;/);
  assert.match(section, /@keyframes bf-entry-text-out \{\s*to \{ opacity: 0; transform: translateY\(-30px\); \}/);
  assert.match(section, /\.bf-entry-text-exit \{\s*animation: bf-entry-text-out 300ms var\(--ease-in\) forwards;/, '지연 없음');
  assert.match(section, /\.bf-loading-splash-out \{\s*animation: bf-loading-splash-out 200ms ease forwards;/);
  assert.match(section, /@keyframes bf-entry-rise \{\s*from \{ transform: translateY\(6px\); \}/);
  assert.match(section, /\[data-entry-rank\] > :first-child \{\s*animation: bf-entry-widget-in 320ms var\(--ease-out\) var\(--bf-entry-delay, 0ms\) backwards;/);
  assert.match(section, /\[data-entry-rank\] > :first-child > :last-child \{\s*animation: bf-entry-rise 320ms var\(--ease-out\) var\(--bf-entry-delay, 0ms\) backwards;/);
  for (const name of ['fill-x', 'fill-sx', 'fill-y']) {
    assert.match(section, new RegExp(`\\.bf-entry-${name} \\{[^}]*animation: bf-entry-${name} 700ms var\\(--ease-out\\) var\\(--bf-entry-delay, 0ms\\) backwards;`));
  }
  assert.match(section, /\.bf-entry-ring \{\s*animation: bf-entry-ring-draw 700ms var\(--ease-out\)/);
  assert.match(section, /\.bf-entry-ring-cap \{\s*animation: bf-entry-ring-cap 700ms var\(--ease-out\)/);
});

test('CSS: 첫 진입 연출은 html[data-dash-entry] 아래에서만, 덮개가 내려가 있는 동안은 멈춤, 동작 줄이기면 통째로 끔', () => {
  const rules = stripComments(entryCss());
  const animated = [
    '[data-entry-rank] > :first-child',
    '[data-entry-rank] > :first-child > :last-child',
    '[data-entry-rank] .bf-entry-fill-x',
    '[data-entry-rank] .bf-entry-fill-sx',
    '[data-entry-rank] .bf-entry-fill-y',
    '[data-entry-rank] .bf-entry-ring',
    '[data-entry-rank] .bf-entry-ring-cap',
  ];
  const pausedBlock = rules.match(/((?:html\[data-entry-curtain='down'\]\[data-dash-entry\] [^,{]+,?\s*)+)\{\s*animation-play-state: paused;\s*\}/);
  assert.ok(pausedBlock, '덮개 아래 멈춤 규칙');
  const reduceBlock = rules.slice(rules.indexOf('@media (prefers-reduced-motion: reduce)'));
  const selectorList = (block: string) => block.split('{')[0].split(',').map((sel) => sel.trim()).filter(Boolean);
  const paused = selectorList(pausedBlock![1]);
  const reduced = selectorList(reduceBlock.slice(reduceBlock.indexOf('{') + 1));
  for (const selector of animated) {
    assert.ok(rules.includes(`html[data-dash-entry] ${selector} {`), `첫 진입 표시 아래에서만: ${selector}`);
    assert.ok(paused.includes(`html[data-entry-curtain='down'][data-dash-entry] ${selector}`), `덮개 아래 멈춤: ${selector}`);
    assert.ok(reduced.includes(`html[data-dash-entry] ${selector}`), `동작 줄이기: ${selector}`);
  }
  assert.match(reduceBlock, /\.bf-entry-breathe,\s*\.bf-entry-glow,\s*\.bf-entry-nudge \{\s*animation: none;/);
  // 움직임은 opacity·transform 만(원 그리기만 stroke-dasharray). 폭·높이·그림자·배경 애니메이션 금지
  const keyframes = rules.match(/@keyframes [\w-]+ \{[\s\S]*?\n\}/g) ?? [];
  assert.ok(keyframes.length >= 12);
  for (const block of keyframes) {
    const props = [...block.matchAll(/([a-z-]+):/g)].map((m) => m[1]);
    for (const prop of props) assert.ok(['opacity', 'transform', 'stroke-dasharray'].includes(prop), `${block.split('{')[0]}: ${prop}`);
  }
  assert.doesNotMatch(rules, /backdrop-filter|animation:[^;]*infinite[^;]*;[^}]*filter/);
  // !important 는 위젯 판 자리 이동 전환을 덮개가 떠 있는 동안 끄는 한 곳뿐(대시보드가 나중에 불러오는 CSS 를 이겨야 함)
  assert.equal((rules.match(/!important/g) ?? []).length, 1);
  assert.match(rules, /html\[data-entry-curtain\] \.react-grid-layout \.react-grid-item \{\s*transition: none !important;/);
});

test('대시보드: 위젯 칸에 등장 순위, 첫 진입 훅은 레이아웃으로 순위를 만든다', () => {
  const dashboard = read('src/views/Dashboard.tsx');
  assert.match(dashboard, /const entryRanks = useFirstDashboardEntry\(currentLayout\);/);
  assert.match(dashboard, /key=\{item\.i\}\n\s*data-entry-rank=\{entryRanks\.get\(item\.i\)\}/);
  const hook = read('src/hooks/useFirstDashboardEntry.ts');
  assert.match(hook, /useLayoutEffect\(/, '첫 페인트 전에 표시를 켠다');
  assert.match(hook, /dashboardEntryGate\.claim\(\)/);
  assert.match(hook, /entryCurtain\.state === 'down'/, '덮개가 걷히기 시작한 뒤부터 시간을 잰다');
  assert.match(hook, /window\.setTimeout\(finish, ENTRY_WINDOW_MS\)/);
  assert.match(hook, /dashboardEntryGate\.release\(\);\n\s*window\.setTimeout\(\(\) => dashboardEntryGate\.settle\(\), 0\);/);
  // 구독을 건 뒤에 viewReady 를 알린다(덮개가 같은 순간 걷혀도 놓치지 않게)
  assert.ok(hook.indexOf('entryCurtain.subscribe(') < hook.lastIndexOf('entryCurtain.setViewReady(true)'));
});

test('막대·원에 첫 진입 차오름 클래스', () => {
  const has = (path: string, cls: string, count = 1) => {
    const src = read(path);
    // 'bf-entry-ring' 이 'bf-entry-ring-cap' 안에서 세지지 않게 앞뒤가 이름 글자(-·영숫자)가 아닌 곳만
    assert.equal((src.match(new RegExp(`(?<![\\w-])${cls}(?![\\w-])`, 'g')) ?? []).length, count, `${path}: ${cls}`);
  };
  has('src/components/widgets/charts/HorizontalBar.tsx', 'bf-entry-fill-x');
  has('src/components/widgets/charts/VerticalBar.tsx', 'bf-entry-fill-y');
  has('src/components/widgets/charts/StatCard.tsx', 'bf-entry-fill-x');
  has('src/components/widgets/charts/DonutChart.tsx', 'bf-entry-ring');
  has('src/components/widgets/StageBarsWidget.tsx', 'bf-entry-fill-x');
  has('src/components/widgets/AssigneeCardsWidget.tsx', 'bf-entry-fill-x');
  has('src/components/widgets/EpisodeSummaryWidget.tsx', 'bf-entry-fill-x', 2);
  has('src/components/widgets/DepartmentComparisonWidget.tsx', 'bf-entry-fill-y', 3);
  has('src/components/widgets/DepartmentComparisonWidget.tsx', 'bf-entry-fill-x');
  has('src/components/widgets/DepartmentComparisonWidget.tsx', 'bf-entry-fill-sx');
  has('src/components/widgets/OverallProgressWidget.tsx', 'bf-entry-ring');
  has('src/components/widgets/OverallProgressWidget.tsx', 'bf-entry-ring-cap');
  // 이어 붙은 칸 막대는 칸 묶음 하나만 늘린다(칸마다 밀면 가운데 칸이 엉뚱한 자리에서 보인다)
  const dept = read('src/components/widgets/DepartmentComparisonWidget.tsx');
  assert.match(dept, /<div className="bf-entry-fill-sx flex h-full w-full">\n\s*\{deptStats\.map\(\(d\) => \{\n\s*if \(d\.stats\.totalScenes === 0\) return null;/);
});

test('첫 화면 덮개: 불투명 바탕, 클릭 즉시 글자가 떠오르며 흐려짐, 덮개 걷힘과 위젯 등장은 같은 순간', () => {
  const src = read('src/components/auth/LoginScreen.tsx');
  assert.doesNotMatch(src, /phase === 'done'/, '퇴장 연출이 잘리던 return null 제거');
  assert.match(src, /'fixed inset-0 flex flex-col items-center justify-center overflow-hidden select-none z-\[9998\] bg-bg-primary'/);
  assert.match(src, /<GradientBackdrop intensity="normal" enabled=\{gradientEnabled\} \/>/);
  assert.match(src, /className=\{cn\('flex flex-col items-center', exiting && 'bf-entry-text-exit'\)\}/);
  assert.match(src, /<ClickPrompt exiting=\{exiting\} \/>/);
  assert.match(src, /exit=\{\{ opacity: 0, transition: \{ duration: 0\.2, delay: 0 \} \}\}/, '안내 문구 exit 에 0.4초 지연이 걸리지 않게');
  // 대기 중 숨쉬는 빛은 CSS(합성 스레드) — framer 무한 반복(메인 스레드 filter·textShadow·x) 없음
  assert.doesNotMatch(src, /repeat: Infinity/);
  assert.match(src, /bf-entry-glow/);
  assert.match(src, /bf-entry-nudge/);
  // 덮개 속성과 클래스는 같은 순간에 DOM 에 적는다
  const lift = src.slice(src.indexOf("rootRef.current?.classList.add('bf-entry-curtain-lift');"));
  assert.ok(lift.length > 0);
  assert.match(lift, /^rootRef\.current\?\.classList\.add\('bf-entry-curtain-lift'\);\n\s*entryCurtain\.set\('lifting'\);\n\s*setLifting\(true\);/);
  assert.match(src, /entryCurtain\.set\('down'\);\n\s*return \(\) => entryCurtain\.set\(null\);/);
  assert.match(src, /e\.animationName === 'bf-entry-curtain-out'\) complete\(\)/);
  assert.match(src, /window\.setTimeout\(complete, ENTRY_CURTAIN_MS \+ 300\)/, 'animationend 가 오지 않아도 끝난다');
  assert.match(src, /const minDelayMs = reduce \? 0 : ENTRY_CURTAIN_DELAY_MS;/);
  // 타이머가 조금 일찍 불려 150ms 에 못 미치면 다시 잡는다 — 안 그러면 최대 대기(1.5초)까지 덮개가 멈춘다(실측 4번 중 1번)
  assert.match(src, /if \(elapsedMs < minDelayMs\) \{\n\s*timers\.push\(window\.setTimeout\(check, minDelayMs - elapsedMs \+ 1\)\);\n\s*return;\n\s*\}/);
  // 글자 연출 도중 클릭해 넘어간 뒤 연출 완료 콜백이 단계를 되돌리지 않는다
  assert.match(src, /setPhase\(\(current\) => \(current === 'landing' \? 'ready' : current\)\)/);
  // 로그인 성공도 같은 퇴장 — 사용자 정보가 들어오면 카드가 떠오르며 사라진다
  assert.match(src, /if \(mode !== 'login' \|\| !currentUser \|\| phase === 'exit'\) return;\n\s*beginExit\(/);
  // 본문에서 useLayoutEffect·외부 훅을 부르지 않는다(tests/loginUpdateEntry.test.ts 가 함수로 직접 부른다)
  const body = src.slice(src.indexOf('export function LoginScreen('));
  assert.doesNotMatch(body, /useLayoutEffect|useMotionPref|useReducedMotion/);
});

test('앱: 덮개·로딩 영상은 같은 key 로 모든 화면 묶음에 — 메인은 덮개 아래에서 미리 그리고, 인사는 덮개가 걷힌 뒤', () => {
  const app = read('src/App.tsx');
  assert.match(app, /<LoginScreen\n\s*key="entry-overlay"/);
  assert.equal((app.match(/<LoginScreen\b/g) ?? []).length, 1, '덮개 요소는 한 곳에서 만든다');
  assert.equal((app.match(/\{entryOverlay\}/g) ?? []).length, 3, '비로그인·덮개만·메인 묶음');
  assert.match(app, /<LoadingSplash\n\s*key="loading-splash"/);
  assert.equal((app.match(/\{loadingSplashOverlay\}/g) ?? []).length, 4, '로딩·비로그인·덮개만·메인 묶음');
  assert.match(app, /if \(entryOverlayVisible && !mainPrimed\) \{/);
  assert.match(app, /const primeMain = useCallback\(\(\) => \{ startTransition\(\(\) => setMainPrimed\(true\)\); \}, \[\]\);/);
  assert.match(app, /if \(!authReady \|\| currentUser\) return;\n\s*setLoginCurtain\(true\);\n\s*setMainPrimed\(false\);/, '로그인 전에 덮개를 켜 두어 사용자 정보가 먼저 그려져도 덮개가 남는다');
  assert.match(app, /\{welcomeUser && !loginCurtain && \(/);
  assert.match(app, /if \(showSplash \|\| loginCurtain \|\| updateToastShownRef\.current\) return;/);
  // 자동 인사는 기존대로 덮개(스플래시)가 끝난 뒤
  assert.match(app, /if \(!authReady \|\| !currentUser \|\| showSplash \|\| welcomeUser\) return;/);
  const splash = read('src/components/auth/LoadingSplash.tsx');
  assert.match(splash, /fading \? 'bf-loading-splash-out' : 'cursor-pointer'/);
  assert.match(splash, /'fixed inset-0 z-\[9999\]/, '다음 화면 위에 덮개로 남는다');
});
