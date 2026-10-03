import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  BADGE_EXIT_MS,
  BADGE_EXIT_TRANSFORM,
  BADGE_POP_KEYFRAMES,
  BADGE_POP_TIMING,
  SLIDE_LAYOUT_TRANSITION,
  SLIDE_TIMING,
  insetRect,
  measureWithin,
  nearestScrollTop,
  planSlide,
  rectWithin,
  restingStyle,
  sameSlideRect,
  shouldPopBadge,
  slideKeyframes,
  visualSlideRect,
  type SlideRect,
} from '../../src/utils/slidingIndicator.ts';

/* 움직임 폴리싱 7번 — 선택 표시가 미끄러져 따라오기(사이드바·탭·보기 전환·검색 목록) + 숫자 배지 '톡'. */

const read = (path: string) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');

/* ─── 박자(사양 수치) ─── */

test('박자: 사이드바 260ms 튕김 거의 없는 곡선 · 탭 220ms out · 목록 120ms snap · 배지 220/120ms', () => {
  assert.deepEqual({ ...SLIDE_TIMING.rail }, { duration: 260, easing: 'cubic-bezier(0.3, 1.25, 0.5, 1)' });
  assert.deepEqual({ ...SLIDE_TIMING.tab }, { duration: 220, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
  assert.deepEqual({ ...SLIDE_TIMING.list }, { duration: 120, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
  assert.deepEqual({ ...BADGE_POP_TIMING }, { duration: 220, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
  assert.deepEqual(BADGE_POP_KEYFRAMES.map((frame) => frame.transform), ['scale(1)', 'scale(1.25)', 'scale(1)']);
  assert.deepEqual([...BADGE_EXIT_TRANSFORM], ['scale(1)', 'scale(0.6)']);
  assert.equal(BADGE_EXIT_MS, 120);
  // 이미 layoutId 로 미끄러지던 대시보드·씬 목록 부서 탭도 같은 220ms·out 으로 맞춘다.
  assert.deepEqual(SLIDE_LAYOUT_TRANSITION, { duration: 0.22, ease: [0.16, 1, 0.3, 1] });
});

/* ─── 재기 ─── */

test('measureWithin: offsetParent 사슬을 따라 container 기준 좌표를 더하고, 중간 부모의 테두리도 더한다', () => {
  const container = { offsetLeft: 500, offsetTop: 500, offsetWidth: 300, offsetHeight: 40, offsetParent: null };
  const wrapper = { offsetLeft: 8, offsetTop: 84, offsetWidth: 176, offsetHeight: 40, offsetParent: container, clientLeft: 1, clientTop: 2 };
  const item = { offsetLeft: 4, offsetTop: 0, offsetWidth: 60, offsetHeight: 36, offsetParent: wrapper };
  assert.deepEqual(measureWithin(item, container), { x: 4 + 1 + 8, y: 0 + 2 + 84, w: 60, h: 36 });
  assert.deepEqual(measureWithin(wrapper, container), { x: 8, y: 84, w: 176, h: 40 });
  // container 가 사슬에 없으면(position static) null → 사각형 차이로 대신한다.
  assert.equal(measureWithin(item, { other: true }), null);
});

test('rectWithin: 화면 사각형 차이에 container 테두리·스크롤을 보정한다', () => {
  const rect = rectWithin(
    { left: 130, top: 260, width: 50, height: 36 },
    { left: 100, top: 200, width: 400, height: 300 },
    { clientLeft: 1, clientTop: 1, scrollLeft: 0, scrollTop: 120 },
  );
  assert.deepEqual(rect, { x: 29, y: 179, w: 50, h: 36 });
});

test('insetRect: 좌우로 들여 쓴 밑줄(상세 창 탭 left-3 right-3)', () => {
  assert.deepEqual(insetRect({ x: 20, y: 0, w: 60, h: 40 }, { x: 12 }), { x: 32, y: 0, w: 36, h: 40 });
  const same = { x: 1, y: 2, w: 3, h: 4 };
  assert.equal(insetRect(same), same);
  assert.equal(insetRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 8 }).w, 0, '음수 폭이 되지 않는다');
});

test('restingStyle: 움직이는 축만 transform·크기로 정하고 나머지는 CSS 에 맡긴다', () => {
  const rect = { x: 12.345, y: 84, w: 56, h: 40 };
  assert.deepEqual(restingStyle(rect, 'x'), { transform: 'translate3d(12.35px, 0px, 0px)', width: '56px' });
  assert.deepEqual(restingStyle(rect, 'y'), { transform: 'translate3d(0px, 84px, 0px)', height: '40px' });
  assert.deepEqual(restingStyle(rect, 'both'), { transform: 'translate3d(12.35px, 84px, 0px)', width: '56px', height: '40px' });
});

/* ─── 미끄러짐(FLIP) ─── */

test('slideKeyframes: 새 크기로 바로 바꾼 뒤 이전 자리·크기에서 transform 하나로 푼다(폭 애니메이션 없음)', () => {
  const from = { x: 2, y: 2, w: 34, h: 28 };
  const to = { x: 36, y: 2, w: 40, h: 28 };
  const frames = slideKeyframes(from, to, 'both');
  assert.ok(frames);
  assert.deepEqual(frames, [
    { transform: 'translate3d(2px, 2px, 0px) scale(0.85, 1)' },
    { transform: 'translate3d(36px, 2px, 0px) scale(1, 1)' },
  ]);
  for (const frame of frames) assert.deepEqual(Object.keys(frame), ['transform'], '합성 스레드 속성만');
  // 세로 메뉴: 가로·폭은 CSS 가 맡으니 무시한다.
  assert.deepEqual(slideKeyframes({ x: 0, y: 84, w: 47, h: 40 }, { x: 99, y: 180, w: 175, h: 40 }, 'y'), [
    { transform: 'translate3d(0px, 84px, 0px) scale(1, 1)' },
    { transform: 'translate3d(0px, 180px, 0px) scale(1, 1)' },
  ]);
  assert.equal(slideKeyframes(to, { ...to, x: 36.3 }, 'x'), null, '0.5px 안이면 움직이지 않는다');
  assert.equal(sameSlideRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 50, y: 0, w: 10, h: 10 }, 'y'), true, '세로 축은 가로 이동을 보지 않는다');
});

test('visualSlideRect: 미끄러지는 중의 계산된 transform 에서 보이는 자리를 되짚는다(연타 이어 가기)', () => {
  const layout = { x: 100, y: 2, w: 40, h: 28 };
  assert.deepEqual(visualSlideRect('matrix(0.85, 0, 0, 1, 61.5, 2)', layout), { x: 61.5, y: 2, w: 34, h: 28 });
  const m3d = 'matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 132.5, 0, 1)';
  assert.deepEqual(visualSlideRect(m3d, { x: 0, y: 180, w: 47, h: 40 }), { x: 0, y: 132.5, w: 47, h: 40 });
  assert.equal(visualSlideRect('none', layout), null);
  assert.equal(visualSlideRect('rotate(3deg)', layout), null);
  assert.equal(visualSlideRect('matrix(1, 0, 0, 1, 0)', layout), null);
});

test('planSlide: 키가 바뀌면 미끄러지고, 크기 변화·첫 표시·막힘(동작 줄이기·목록 교체)은 바로 놓는다', () => {
  const a: SlideRect = { x: 2, y: 2, w: 34, h: 28 };
  const b: SlideRect = { x: 36, y: 2, w: 40, h: 28 };
  const base = { axis: 'both' as const, target: b, previous: a, visual: null, running: false, keyMoved: true, blockSlide: false };

  const slide = planSlide(base);
  assert.equal(slide.kind, 'place');
  assert.ok(slide.kind === 'place' && slide.frames && slide.frames.length === 2);

  assert.deepEqual(planSlide({ ...base, target: a }), { kind: 'keep' }, '같은 자리면 그대로(진행 중인 미끄러짐도 끊지 않는다)');
  assert.deepEqual(planSlide({ ...base, previous: null }), { kind: 'place', frames: null }, '숨어 있다 나타나면 바로');
  assert.deepEqual(planSlide({ ...base, keyMoved: false }), { kind: 'place', frames: null }, '창 크기·라벨 축약은 바로 맞춘다');
  assert.deepEqual(planSlide({ ...base, blockSlide: true }), { kind: 'place', frames: null }, '동작 줄이기·목록 교체 직후는 바로');

  // 연타: 미끄러지는 중이면 보이는 자리에서 새 목표로 이어 간다(키가 아니라 크기 변화로 다시 재도 이어 간다).
  const visual: SlideRect = { x: 20, y: 2, w: 37, h: 28 };
  const retarget = planSlide({ ...base, previous: b, target: { x: 80, y: 2, w: 30, h: 28 }, visual, running: true, keyMoved: false });
  assert.ok(retarget.kind === 'place' && retarget.frames);
  assert.equal(retarget.frames[0].transform, 'translate3d(20px, 2px, 0px) scale(1.2333, 1)');
});

test('배지: 늘 때만 톡 — 처음 그릴 때·줄 때·0 일 때는 조용히', () => {
  assert.equal(shouldPopBadge(null, 3), false);
  assert.equal(shouldPopBadge(0, 1), true);
  assert.equal(shouldPopBadge(2, 3), true);
  assert.equal(shouldPopBadge(3, 2), false);
  assert.equal(shouldPopBadge(3, 0), false);
});

test('nearestScrollTop: 목록 상자 하나만 가장 적게 옮긴다(이미 보이면 그대로)', () => {
  assert.equal(nearestScrollTop(0, 340, 100, 60), null);
  assert.equal(nearestScrollTop(0, 340, 320, 60), 40);
  assert.equal(nearestScrollTop(200, 340, 150, 60), 150);
  assert.equal(nearestScrollTop(10, 340, -4, 60), 0);
});

/* ─── 소스 가드 ─── */

test('공용 훅: WAAPI transform 하나 + 인라인 쉬는 자리 — 클래스 토글·폭 애니메이션·animation:none 없음', () => {
  const hook = read('src/hooks/useSlidingIndicator.ts');
  assert.match(hook, /el\.animate\(plan\.frames, \{ duration: timing\.duration, easing: timing\.easing \}\)/);
  assert.match(hook, /new ResizeObserver\(\(\) => \{\s*const state = stateRef\.current;\s*const pending = state\.pending;\s*state\.pending = null;\s*placeRef\.current\(pending \? pending\.slide && !pending\.block : false, pending\?\.block \?\? false\);/, '칸 크기 변화는 바로 맞추고, 적어 둔 선택 이동도 이 알림에서 한다');
  assert.match(hook, /blockSlide: block \|\| state\.holdSlide \|\| Boolean\(opts\.reduce\)/, '동작 줄이기·목록 교체면 미끄러짐 없음');
  // 최종 성능 측정 지적: 커밋 직후(layout effect)에 칸을 재면 바뀐 화면 전체의 레이아웃을 클릭 처리 안에서 강제한다.
  // 키가 바뀐 effect 는 할 일만 적고 감시를 다시 걸어(observe) 레이아웃이 끝난 뒤 알림에서 잰다(감시가 없는 환경만 바로).
  const keyEffectStart = hook.indexOf('const keyChanged = state.key !== key;');
  const keyEffect = hook.slice(keyEffectStart, hook.indexOf('}, [key, options.resetKey, ...deps]);'));
  assert.ok(keyEffectStart > 0 && keyEffect.length > 0, '키 effect');
  assert.match(keyEffect, /state\.pending = \{ slide: \(pending\?\.slide \?\? false\) \|\| keyChanged, block: \(pending\?\.block \?\? false\) \|\| block \};/);
  assert.match(keyEffect, /observer\.unobserve\(container\);\s*observer\.observe\(container\);/);
  assert.equal(keyEffect.match(/placeRef\.current\(/g)?.length, 1, '바로 재는 건 크기 감시가 없는 환경 하나뿐');
  assert.match(keyEffect, /if \(typeof ResizeObserver === 'undefined'\) \{\s*placeRef\.current\(keyChanged && !block, block\);\s*return;\s*\}/);
  assert.match(hook, /dataset\.slideKey === key/, '인덱스가 아니라 키로 찾는다');
  assert.doesNotMatch(hook, /classList\.(add|remove|toggle)|animation\s*[:=]\s*['"]?none|scrollIntoView/);
  const component = read('src/components/ui/SlidingIndicator.tsx');
  assert.match(component, /const \{ reduce \} = useMotionPref\(\);/);
  assert.match(component, /export const SlidingIndicator = memo\(/);
  assert.match(component, /visibility: 'hidden'/, '첫 측정 전에는 숨긴다');
  assert.match(component, /'absolute inset-0 transition-opacity duration-base'/, '색 바뀜은 겹친 층의 opacity');
  const badge = read('src/components/ui/CountBadge.tsx');
  assert.match(badge, /if \(!reduce && shouldPopBadge\(previous, count\)\)/);
  assert.match(badge, /setLeaving\(count <= 0 && renderedCount > 0 && !reduce\)/, '동작 줄이기면 0 이 되는 즉시 사라진다');
});

test('사이드바: 누르자마자 표시 출발(flushSync) → 화면 그리기는 다음 프레임, 클릭 없는 이동은 currentView 를 따른다', () => {
  const sidebar = read('src/components/layout/Sidebar.tsx');
  assert.match(sidebar, /import \{ flushSync \} from 'react-dom';/);
  assert.match(sidebar, /const shownView = pendingNav && pendingNav\.from === currentView \? pendingNav\.view : currentView;/);
  assert.match(sidebar, /flushSync\(\(\) => setPendingNav\(\{ view, from: currentView \}\)\);/);
  assert.match(sidebar, /schedule\.frame = requestAnimationFrame\(\(\) => \{\s*schedule\.frame = null;\s*schedule\.timers\.push\(setTimeout\(apply, 0\)\);/);
  assert.match(sidebar, /setView\(view\);\s*setPendingNav\(null\);/, '화면과 표시를 한 번에 확정');
  assert.match(sidebar, /<SlidingIndicator\s+activeKey=\{shownView\}\s+axis="y"\s+timing="rail"\s+deps=\{\[navItems\]\}\s+className="left-2 right-2 rounded-lg bg-accent\/20"/);
  assert.match(sidebar, /shownView === item\.id\s*\? 'text-accent'/);
  assert.doesNotMatch(sidebar, /'bg-accent\/20 text-accent'/, '버튼마다 배경을 껐다 켜지 않는다');
  assert.equal(sidebar.match(/<CountBadge\b/g)?.length, 2, '리테이크·컴포지팅 숫자 배지');
  assert.doesNotMatch(sidebar, /totalOpenRevisions > 0 &&|compositingErrorCount > 0 &&/, '0 이 되는 순간 줄며 사라지려면 배지가 직접 언마운트를 맡는다');
});

const TAB_SITES: [string, RegExp[], RegExp[]][] = [
  ['src/components/scenes/UnifiedSceneDetailModal.tsx',
    [/<SlidingIndicator\s+activeKey=\{tab\}\s+inset=\{\{ x: 12 \}\}/, /data-slide-key=\{slideKey\}/],
    [/\{active && \(\s*<span\s+aria-hidden\s+className="absolute left-3 right-3 -bottom-px/]],
  ['src/views/ScheduleView.tsx',
    [/<SlidingIndicator activeKey=\{viewMode\} axis="both"/, /<SlidingIndicator activeKey=\{weekSubMode\} axis="both"/],
    [/viewMode === m\s*\? 'bg-accent\/20 text-accent'/, /weekSubMode === '(card|timegrid)' \? 'bg-accent\/20 text-accent'/]],
  ['src/components/calendar/EventQuickEdit.tsx',
    [/<SlidingIndicator activeKey=\{tab\} className="bottom-0 h-0\.5 bg-accent" \/>/],
    [/borderBottom: tab === '(calendar|edit)' \? '2px solid rgb\(var\(--color-accent\)\)'/]],
  ['src/views/ScenesView.tsx',
    [/<SlidingIndicator activeKey=\{statusFilter\} axis="both">\s*<SlideToneLayers active=\{statusFilter\} tones=\{STATUS_FILTER_TONES\}/],
    [/f === 'done' \? 'bg-green-500\/20 text-green-400'/]],
  ['src/views/CompositingView.tsx',
    [/<SlidingIndicator activeKey=\{groupMode\} axis="both"/, /<SlidingIndicator activeKey=\{statusFilter\} axis="both"/],
    [/\? 'bg-accent text-white'/, /\? 'bg-accent\/20 text-accent shadow-sm'/]],
  ['src/views/RetakeHubView.tsx',
    [/<SlidingIndicator activeKey=\{tab\} className="bottom-0 h-0\.5 bg-accent" \/>/],
    [/'text-accent border-accent'/]],
  ['src/views/CharacterBoardView.tsx',
    [/<SlidingIndicator activeKey=\{tab\} axis="both"/, /<SlidingIndicator activeKey=\{heightCompareMode \? null : viewMode\} axis="both"/, /tones=\{CHARACTER_STATUS_FILTER_TONES\}/],
    [/active \? 'bg-accent\/20 text-accent'/, /f === 'done' \? 'bg-green-500\/20 text-green-400'/]],
  ['src/views/EpisodeView.tsx',
    [/<SlidingIndicator activeKey=\{viewMode\} axis="both"/],
    [/viewMode === '(card|matrix)'\s*\? 'bg-accent\/20 text-accent'/]],
  ['src/components/settings/SettingsSidebar.tsx',
    [/activeKey=\{group\.tabs\.some\(\(tab\) => tab\.id === active\) \? active : null\}\s+axis="y"\s+timing="rail"/],
    [/\? 'bg-accent\/15 text-accent'/, /transition-all/]],
  ['src/features/gantt/GanttView.tsx',
    [/<span className="gantt-status-filter"><SlidingIndicator activeKey=\{statusFilter\} axis="both" className="gantt-status-filter-indicator"\/>/, /data-slide-key=\{filter\}/],
    []],
];

test('탭·세그먼트·보기 전환: 표시 하나가 미끄러지고 칸마다 배경을 껐다 켜지 않는다', () => {
  for (const [file, must, mustNot] of TAB_SITES) {
    const source = read(file);
    assert.match(source, /import \{ SlidingIndicator(, SlideToneLayers)? \} from '@\/components\/ui\/SlidingIndicator';/, file);
    for (const pattern of must) assert.match(source, pattern, `${file}: ${pattern}`);
    for (const pattern of mustNot) assert.doesNotMatch(source, pattern, `${file}: ${pattern}`);
  }
  const css = read('src/styles/motion-chrome-popups.css');
  assert.match(css, /\.gantt \.gantt-status-filter > button\[aria-pressed='true'\] \{\s*background: transparent;\s*border-color: transparent;/);
});

test('검색·멘션·태그 목록: 강조 막대 120ms, 검색어·후보가 바뀌면 바로 놓이고 스크롤은 목록 상자만 즉시', () => {
  for (const file of ['src/components/spotlight/SpotlightSearch.tsx', 'src/components/common/MentionDropdown.tsx', 'src/components/common/HashtagDropdown.tsx']) {
    const source = read(file);
    assert.match(source, /axis="y"\s+timing="list"\s+resetKey=\{/, file);
    assert.match(source, /revealInList\(container, /, file);
    assert.doesNotMatch(source, /scrollIntoView/, `${file}: scrollIntoView 는 바깥 상자까지 움직인다`);
    assert.doesNotMatch(source, /\? 'bg-accent\/15' :|'bg-accent\/15 border-l-2 border-accent pl-\[18px\]'/, `${file}: 줄마다 배경을 껐다 켜지 않는다`);
  }
});

test('이미 미끄러지던 대시보드·씬 목록 부서 탭은 layoutId 를 유지하고 박자만 맞춘다', () => {
  for (const [file, count] of [['src/views/Dashboard.tsx', 4], ['src/views/ScenesView.tsx', 2]] as const) {
    const source = read(file);
    assert.doesNotMatch(source, /stiffness: 400, damping: 30/, file);
    assert.equal(source.match(/transition=\{SLIDE_LAYOUT_TRANSITION\}/g)?.length, count, file);
  }
});
